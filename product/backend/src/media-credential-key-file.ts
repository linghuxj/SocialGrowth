import { closeSync, lstatSync, openSync, readFileSync, constants } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { MediaCredentialWriteKeys } from "./media-credential-store.js";
import type { MediaCredentialKey } from "./media-credential-envelope.js";

const id = /^[A-Za-z0-9_-]{1,100}$(?![\s\S])/;
function decode(raw: unknown): MediaCredentialKey {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "keyBase64,keyId" || typeof value.keyId !== "string" || !id.test(value.keyId)
    || typeof value.keyBase64 !== "string") throw new Error("invalid");
  const key = Buffer.from(value.keyBase64, "base64");
  if (key.length !== 32 || key.toString("base64") !== value.keyBase64) { key.fill(0); throw new Error("invalid"); }
  return { keyId: value.keyId, key };
}
// Optional, explicit, protected-file custody for controlled media encryption.
// Invalid/missing configuration returns null and all credential writes stay
// closed. This loader never falls back to `.env`, historical keys or random keys.
export function readMediaCredentialKeysFile(path: string | undefined): MediaCredentialWriteKeys | null {
  if (!path || !isAbsolute(path) || path.includes("\0")) return null;
  const owned: Buffer[] = [];
  try {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const parent = lstatSync(dirname(path));
    if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (uid !== null && parent.uid !== uid)) return null;
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let stat;
    let source: string;
    try { stat = lstatSync(path); const opened = readFileSync(fd); source = opened.toString("utf8"); }
    finally { closeSync(fd); }
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.nlink !== 1
      || (uid !== null && stat.uid !== uid) || stat.size < 1 || stat.size > 65_536) return null;
    const raw: unknown = JSON.parse(source);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const object = raw as Record<string, unknown>;
    if (Object.keys(object).sort().join(",") !== "currentDigestKeyId,digestKeys,encryption"
      || typeof object.currentDigestKeyId !== "string" || !id.test(object.currentDigestKeyId)
      || !Array.isArray(object.digestKeys) || object.digestKeys.length < 1 || object.digestKeys.length > 16) return null;
    const encryption = decode(object.encryption); owned.push(encryption.key);
    const digestKeys = object.digestKeys.map(rawKey => { const decoded = decode(rawKey); owned.push(decoded.key); return decoded; });
    const parsedKeys: MediaCredentialWriteKeys = { encryption, digestKeys, currentDigestKeyId: object.currentDigestKeyId };
    if (new Set(digestKeys.map(key => key.keyId)).size !== digestKeys.length
      || !digestKeys.some(key => key.keyId === object.currentDigestKeyId)
      || digestKeys.some(key => key.key.equals(encryption.key))) throw new Error("invalid");
    return parsedKeys;
  } catch {
    for (const key of owned) key.fill(0);
    return null;
  }
}
