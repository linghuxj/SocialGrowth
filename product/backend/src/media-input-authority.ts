import { createHash, createPublicKey } from "node:crypto";
import type { MediaInputActionScope, MediaInputAuthorizedGrantContext, MediaInputPasswordReceipt } from "./media-input-envelope.js";
import { sealMediaInputCredential, signMediaInputSubmit } from "./media-input-envelope.js";
import { loadMediaInputGrantSigningKey } from "./media-input-grant-key-file.js";
import { MediaInputAuthorityStore, type MediaInputConsumeRequest, type MediaInputEnrollmentCompleteRequest,
  type MediaInputEnrollmentRequest, type MediaInputStatusRequest } from "./media-input-authority-store.js";
import { ProductTransactionError } from "./product-transaction-error.js";

export const MEDIA_INPUT_GRANT_KEY_CONFIG = Symbol.for("socialgrowth.media-input-grant-key-config");
export interface MediaInputGrantKeyConfig {
  readonly keyFilePath: string;
  readonly keyId: string;
  readonly notBeforeMillis: number;
  readonly notAfterMillis: number;
}
export interface MediaInputCredentialSource {
  withCurrentSecretForMediaInput(
    scope: { accountId: string; platform: "facebook" | "youtube"; credentialId: string; expectedRevision: bigint },
    seal: (secretUtf8: Buffer) => Buffer,
  ): Promise<Buffer>;
}
export type MediaInputEnvelopeSink = (envelope: Buffer) => Promise<void>;

const unavailable = () => new ProductTransactionError("AUTHORIZATION_DENIED", "Controlled input authority is unavailable");
function sha256(bytes: Buffer): Buffer { return createHash("sha256").update(bytes).digest(); }
function minBigInt(...values: bigint[]): bigint { return values.reduce((a, b) => a < b ? a : b); }

interface HelloClaims { requestSha256: Buffer; sessionNonce: Buffer; helloProofSha256: Buffer; devicePublicKeySha256: Buffer }
function helloClaims(frame: Buffer): HelloClaims {
  if (!Buffer.isBuffer(frame) || frame.length < 5 + 4 + 1 + 32 + 2 + 1 + 8 || frame.length > 1024
    || frame.toString("ascii", 0, 4) !== "SGHP" || frame[4] !== 1) throw unavailable();
  let cursor = 5;
  const requestLength = frame.readUInt32BE(cursor); cursor += 4;
  if (requestLength < 5 || requestLength > 1024 || cursor + requestLength + 32 + 2 + 1 > frame.length) throw unavailable();
  const request = frame.subarray(cursor, cursor + requestLength); cursor += requestLength;
  if (request.toString("ascii", 0, 4) !== "SGMH" || request[4] !== 1) throw unavailable();
  const sessionNonce = Buffer.from(frame.subarray(cursor, cursor + 32)); cursor += 32;
  const keyLength = frame.readUInt16BE(cursor); cursor += 2;
  if (keyLength < 1 || keyLength > 512 || cursor + keyLength + 1 > frame.length) throw unavailable();
  const spki = frame.subarray(cursor, cursor + keyLength); cursor += keyLength;
  const signatureLength = frame[cursor]!; cursor++;
  if (signatureLength < 8 || signatureLength > 72 || cursor + signatureLength !== frame.length) throw unavailable();
  return { requestSha256: sha256(request), sessionNonce, helloProofSha256: sha256(frame), devicePublicKeySha256: sha256(spki) };
}

function extractCredentialField(payload: Buffer, selected: "login" | "password"): Buffer {
  let i = 0;
  const output: Buffer[] = [];
  let chosen: Buffer | undefined;
  const fail = (): never => { chosen?.fill(0); for (const part of output) part.fill(0); throw unavailable(); };
  const ws = () => { while (i < payload.length && [0x20, 0x09, 0x0a, 0x0d].includes(payload[i]!)) i++; };
  const appendCodePoint = (parts: Buffer[], cp: number) => {
    if (cp <= 0x7f) parts.push(Buffer.from([cp]));
    else if (cp <= 0x7ff) parts.push(Buffer.from([0xc0 | (cp >> 6), 0x80 | (cp & 63)]));
    else if (cp <= 0xffff) parts.push(Buffer.from([0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]));
    else parts.push(Buffer.from([0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]));
  };
  const string = (decode: boolean): Buffer => {
    if (payload[i++] !== 0x22) fail();
    const parts: Buffer[] = []; let runStart = i;
    while (i < payload.length) {
      const byte = payload[i++]!;
      if (byte === 0x22) {
        if (decode && i - 1 > runStart) parts.push(Buffer.from(payload.subarray(runStart, i - 1)));
        const result = Buffer.concat(parts); for (const part of parts) part.fill(0); return result;
      }
      if (byte < 0x20) fail();
      if (byte !== 0x5c) continue;
      if (decode && i - 1 > runStart) parts.push(Buffer.from(payload.subarray(runStart, i - 1)));
      if (i >= payload.length) fail();
      const escaped = payload[i++]!;
      if (escaped === 0x22 || escaped === 0x5c || escaped === 0x2f) { if (decode) parts.push(Buffer.from([escaped])); }
      else if (escaped === 0x62 || escaped === 0x66 || escaped === 0x6e || escaped === 0x72 || escaped === 0x74) {
        if (decode) parts.push(Buffer.from([escaped === 0x62 ? 8 : escaped === 0x66 ? 12 : escaped === 0x6e ? 10 : escaped === 0x72 ? 13 : 9]));
      } else if (escaped === 0x75) {
        const readHex = (): number => {
          if (i + 4 > payload.length) fail();
          const raw = payload.toString("ascii", i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(raw)) fail();
          i += 4; return Number.parseInt(raw, 16);
        };
        let cp = readHex();
        if (cp >= 0xd800 && cp <= 0xdbff) {
          if (payload[i++] !== 0x5c || payload[i++] !== 0x75) fail();
          const low = readHex(); if (low < 0xdc00 || low > 0xdfff) fail();
          cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        } else if (cp >= 0xdc00 && cp <= 0xdfff) fail();
        if (decode) appendCodePoint(parts, cp);
      } else fail();
      runStart = i;
    }
    return fail();
  };
  try {
    ws(); if (payload[i++] !== 0x7b) fail(); ws();
    const keys = new Set<string>();
    for (let count = 0; count < 2; count++) {
      const keyBytes = string(true); const key = keyBytes.toString("ascii"); keyBytes.fill(0);
      if ((key !== "login" && key !== "password") || keys.has(key)) fail(); keys.add(key);
      ws(); if (payload[i++] !== 0x3a) fail(); ws();
      const value = string(key === selected);
      if (key === selected) chosen = value; else value.fill(0);
      ws(); const delimiter = payload[i++];
      if (count === 0 && delimiter !== 0x2c) fail();
      if (count === 1 && delimiter !== 0x7d) fail();
      ws();
    }
    if (keys.size !== 2 || i !== payload.length || !chosen || chosen.length < 1 || chosen.length > 4096) fail();
    return chosen!;
  } catch { return fail(); }
}

export class MediaInputAuthority {
  constructor(
    private readonly store: MediaInputAuthorityStore,
    private readonly credentialSource: MediaInputCredentialSource,
    private readonly keyConfig: MediaInputGrantKeyConfig | null,
  ) {}

  async enrollmentChallenge(token: string, context: import("./installation-auth-service.js").AuthenticatedInstallation, request: MediaInputEnrollmentRequest) {
    return this.store.enrollmentChallenge(token, context, request);
  }
  async completeEnrollment(token: string, context: import("./installation-auth-service.js").AuthenticatedInstallation, request: MediaInputEnrollmentCompleteRequest) {
    return this.store.completeEnrollment(token, context, request);
  }
  async consumeOnce(token: string, context: import("./installation-auth-service.js").AuthenticatedInstallation, request: MediaInputConsumeRequest) {
    return this.store.consumeOnce(token, context, request);
  }
  async recordStatus(token: string, context: import("./installation-auth-service.js").AuthenticatedInstallation, request: MediaInputStatusRequest) {
    return this.store.recordStatus(token, context, request);
  }

  async grantKeys(token: string, context: import("./installation-auth-service.js").AuthenticatedInstallation) {
    if (!this.keyConfig || !Number.isSafeInteger(this.keyConfig.notBeforeMillis) || !Number.isSafeInteger(this.keyConfig.notAfterMillis)
      || this.keyConfig.notBeforeMillis <= 0 || this.keyConfig.notAfterMillis <= this.keyConfig.notBeforeMillis) throw unavailable();
    await this.store.verifySession(token, context);
    const now = Date.now(); if (now < this.keyConfig.notBeforeMillis || now >= this.keyConfig.notAfterMillis) throw unavailable();
    const key = await loadMediaInputGrantSigningKey(this.keyConfig.keyFilePath, this.keyConfig.keyId);
    const spki = Buffer.from(createPublicKey(key.privateKey).export({ type: "spki", format: "der" }));
    try {
      if (sha256(spki).toString("hex") !== key.keyId) throw unavailable();
      return { contractVersion: "media-credential-input-v1", keys: [{ keyId: key.keyId, algorithm: "ecdsa-p256-sha256",
        spkiDerBase64Url: spki.toString("base64url"), notBefore: this.keyConfig.notBeforeMillis, notAfter: this.keyConfig.notAfterMillis }] };
    } finally { spki.fill(0); }
  }

  async withCredentialForAuthorizedAction(scopeInput: MediaInputActionScope, helloProofFrame: Buffer, sink: MediaInputEnvelopeSink): Promise<void> {
    const scope = this.store.parseScope(scopeInput);
    if (scope.fieldRef === "submit_login" || !Buffer.isBuffer(helloProofFrame) || typeof sink !== "function") throw unavailable();
    const hello = Buffer.from(helloProofFrame), claims = helloClaims(hello);
    let envelope: Buffer | undefined;
    try {
      const current = await this.store.loadCurrent(scope);
      const nowMillis = BigInt(current.databaseNow.getTime());
      const expiresAtMillis = minBigInt(nowMillis + 30_000n, current.leaseUntilMillis, current.holderGrantValidUntilMillis,
        BigInt(current.sessionExpiresAt.getTime()), BigInt(current.participationValidUntil.getTime()));
      if (expiresAtMillis <= nowMillis) throw unavailable();
      const signingKey = await this.signingKey(nowMillis);
      const context: MediaInputAuthorizedGrantContext = { scope, fence: { installationId: current.installationId,
        installationGeneration: current.installationGeneration, leaseUntilMillis: current.leaseUntilMillis,
        holderGrantValidUntilMillis: current.holderGrantValidUntilMillis }, helloProofFrame: hello,
        enrolledInstallationPublicKey: current.enrolledKey.publicKey };
      envelope = await this.credentialSource.withCurrentSecretForMediaInput({ accountId: scope.accountId, platform: scope.platform,
        credentialId: scope.credentialId, expectedRevision: scope.expectedRevision }, secretJson => {
        const selected = extractCredentialField(secretJson, scope.fieldRef as "login" | "password");
        try { return sealMediaInputCredential({ context: { ...context, scope: scope as MediaInputActionScope & { fieldRef: "login" | "password" } },
          credentialValueUtf8: selected, nowMillis, issuedAtMillis: nowMillis, expiresAtMillis, signingKey }); }
        finally { selected.fill(0); }
      });
      const final = await this.store.loadCurrent(scope);
      if (final.snapshot !== current.snapshot) throw unavailable();
      await this.store.persistPendingGrant(scope, current.snapshot, { ...claims, envelopeSha256: sha256(envelope), expiresAtMillis, helloProofFrame: hello });
      await sink(envelope);
    } catch { throw unavailable(); }
    finally { hello.fill(0); envelope?.fill(0); claims.requestSha256.fill(0); claims.sessionNonce.fill(0); claims.helloProofSha256.fill(0); claims.devicePublicKeySha256.fill(0); }
  }

  async withAuthorizedLoginSubmit(scopeInput: MediaInputActionScope, helloProofFrame: Buffer, sink: MediaInputEnvelopeSink): Promise<void> {
    const scope = this.store.parseScope(scopeInput);
    if (scope.fieldRef !== "submit_login" || !scope.targetViewIdResourceName || !Buffer.isBuffer(helloProofFrame) || typeof sink !== "function") throw unavailable();
    const hello = Buffer.from(helloProofFrame), claims = helloClaims(hello); let envelope: Buffer | undefined;
    try {
      const current = await this.store.loadCurrent(scope), prior = await this.store.priorPasswordReceipt(scope, current);
      const nowMillis = BigInt(current.databaseNow.getTime());
      const expiresAtMillis = minBigInt(nowMillis + 30_000n, current.leaseUntilMillis, current.holderGrantValidUntilMillis,
        BigInt(current.sessionExpiresAt.getTime()), BigInt(current.participationValidUntil.getTime()));
      if (expiresAtMillis <= nowMillis) throw unavailable();
      const signingKey = await this.signingKey(nowMillis);
      const context: MediaInputAuthorizedGrantContext = { scope, fence: { installationId: current.installationId,
        installationGeneration: current.installationGeneration, leaseUntilMillis: current.leaseUntilMillis,
        holderGrantValidUntilMillis: current.holderGrantValidUntilMillis }, helloProofFrame: hello,
        enrolledInstallationPublicKey: current.enrolledKey.publicKey };
      const signedEnvelope = signMediaInputSubmit({ context: { ...context, scope: scope as MediaInputActionScope & { fieldRef: "submit_login"; targetViewIdResourceName: string } },
        priorPasswordReceipt: prior as MediaInputPasswordReceipt, nowMillis, issuedAtMillis: nowMillis, expiresAtMillis, signingKey });
      envelope = signedEnvelope;
      const final = await this.store.loadCurrent(scope);
      if (final.snapshot !== current.snapshot) throw unavailable();
      await this.store.persistPendingGrant(scope, current.snapshot, { ...claims, envelopeSha256: sha256(signedEnvelope), expiresAtMillis, helloProofFrame: hello });
      await sink(signedEnvelope);
    } catch { throw unavailable(); }
    finally { hello.fill(0); envelope?.fill(0); claims.requestSha256.fill(0); claims.sessionNonce.fill(0); claims.helloProofSha256.fill(0); claims.devicePublicKeySha256.fill(0); }
  }

  private async signingKey(nowMillis: bigint) {
    if (!this.keyConfig || BigInt(this.keyConfig.notBeforeMillis) > nowMillis || BigInt(this.keyConfig.notAfterMillis) <= nowMillis) throw unavailable();
    return loadMediaInputGrantSigningKey(this.keyConfig.keyFilePath, this.keyConfig.keyId);
  }
}
