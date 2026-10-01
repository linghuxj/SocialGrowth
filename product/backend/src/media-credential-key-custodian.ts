import type { MediaCredentialWriteKeys } from "./media-credential-store.js";
import type { MediaCredentialKey } from "./media-credential-envelope.js";

export class MediaCredentialKeyCustodianError extends Error {
  constructor() { super("CONTROLLED_MEDIA_KEYS_UNAVAILABLE"); }
}
const fail = () => new MediaCredentialKeyCustodianError();
const buffers = (keys: MediaCredentialWriteKeys) => [keys.encryption.key, ...keys.digestKeys.map(key => key.key)];
function copy(input: MediaCredentialWriteKeys): MediaCredentialWriteKeys {
  const owned: Buffer[] = [];
  const key = (value: MediaCredentialKey) => {
    if (!value || typeof value.keyId !== "string" || !/^[A-Za-z0-9_-]{1,100}$(?![\s\S])/.test(value.keyId)
      || !Buffer.isBuffer(value.key) || value.key.length !== 32) throw fail();
    const bytes = Buffer.from(value.key); owned.push(bytes); return { keyId: value.keyId, key: bytes };
  };
  try {
    if (!input || !Array.isArray(input.digestKeys) || input.digestKeys.length < 1 || input.digestKeys.length > 16) throw fail();
    const encryption = key(input.encryption), digestKeys = Array.from(input.digestKeys, key), currentDigestKeyId = input.currentDigestKeyId;
    if (new Set(digestKeys.map(value => value.keyId)).size !== digestKeys.length
      || !digestKeys.some(value => value.keyId === currentDigestKeyId) || digestKeys.some(value => value.key.equals(encryption.key))) throw fail();
    return { encryption, digestKeys, currentDigestKeyId };
  } catch { for (const bytes of owned) bytes.fill(0); throw fail(); }
}

// Explicit TRUSTED server-side, process-local custody only. No env/file/KMS
// loading, HTTP administration, plaintext consumer or model/phone protection.
// Private fields prevent accidental JSON/ordinary own-property serialization;
// this is NOT a sandbox against malicious code in the same JS process.
export class MediaCredentialKeyCustodian {
  #keys: MediaCredentialWriteKeys | null = null;
  #disposed = false;
  constructor(input: MediaCredentialWriteKeys | null = null) { this.replace(input); }
  replace(input: MediaCredentialWriteKeys | null): void {
    if (this.#disposed) throw fail();
    const next = input === null ? null : copy(input); // Validate fully BEFORE retiring current ring.
    const old = this.#keys; this.#keys = next;
    if (old) for (const bytes of buffers(old)) bytes.fill(0);
  }
  // Only lend a separate owned snapshot to a synchronous trusted copier.
  // No result is returned; even a thrown callback cannot expose error/cause.
  // An async copier is refused and all borrowed bytes are zeroed immediately.
  // Caller/callback copies, JS strings, OS memory and arbitrary JS are not erased.
  withWriteKeys(consume: (keys: MediaCredentialWriteKeys) => void): void {
    let leased: MediaCredentialWriteKeys | undefined;
    let owned: Buffer[] = [];
    try {
      if (this.#disposed || !this.#keys || typeof consume !== "function") throw fail();
      leased = copy(this.#keys); owned = buffers(leased); // Keep refs BEFORE callback mutation.
      const output: unknown = consume(leased);
      // Refusal must also consume a native rejected Promise, without surfacing
      // its original error/cause as an unhandled rejection. Never await it or
      // keep lent bytes alive for it; this cannot stop arbitrary callback code.
      if (output instanceof Promise) void Promise.prototype.catch.call(output, () => undefined);
      if (output !== undefined) throw fail();
    } catch { throw fail(); } finally { for (const bytes of owned) bytes.fill(0); }
  }
  dispose(): void {
    if (this.#keys) for (const bytes of buffers(this.#keys)) bytes.fill(0);
    this.#keys = null; this.#disposed = true;
  }
}
