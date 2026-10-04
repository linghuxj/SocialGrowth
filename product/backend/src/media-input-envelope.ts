import {
  constants as cryptoConstants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import type { MediaInputGrantSigningKey } from "./media-input-grant-key-file.js";

const HELLO_DOMAIN = Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-HELLO-V1\0", "ascii");
const ENVELOPE_DOMAIN = Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-ENVELOPE-V1\0", "ascii");
const STATUS_DOMAIN = Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-STATUS-V1\0", "ascii");
const MAX_HELLO_BYTES = 1024;
const MAX_ENVELOPE_BYTES = 8192;
const MAX_GRANT_BYTES = 2048;
const MAX_CIPHERTEXT_BYTES = 4096;
const MAX_GRANT_LIFETIME_MS = 30_000n;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const P256_ORDER = 0xffff_ffff_0000_0000_ffff_ffff_ffff_ffff_bce6_faada7179e84f3b9cac2fc632551n;
const P256_HALF_ORDER = P256_ORDER / 2n;
const PLATFORM_CODE = { facebook: 1, youtube: 2 } as const;
const PLATFORM_PACKAGE = { facebook: "com.facebook.katana", youtube: "com.google.android.youtube" } as const;
const FIELD_CODE = { login: 1, password: 2, submit_login: 3 } as const;

export type MediaInputPlatform = keyof typeof PLATFORM_CODE;
export type MediaInputCredentialField = "login" | "password";

/** Public executor input. This deliberately contains action IDs only. */
export interface MediaInputActionScope {
  readonly accountId: string;
  readonly platform: MediaInputPlatform;
  readonly credentialId: string;
  readonly expectedRevision: bigint;
  readonly projectId: string;
  readonly deviceId: string;
  readonly taskId: string;
  readonly taskAttemptId: string;
  readonly operationKind: "assist_existing_login";
  readonly actionId: string;
  readonly fieldRef: MediaInputCredentialField | "submit_login";
  readonly authorizationId: string;
  readonly holderId: string;
  readonly controlGeneration: bigint;
  readonly serial: string;
  readonly targetViewIdResourceName?: string;
}

export interface MediaInputAuthorizedFence {
  readonly installationId: string;
  readonly installationGeneration: bigint;
  readonly leaseUntilMillis: bigint;
  readonly holderGrantValidUntilMillis: bigint;
}

/**
 * Internal encoding context only. It does not establish authorization. The
 * caller must build it only from a fresh backend authorizer and current DB /
 * enrollment facts; installation data, lease bounds and the platform package
 * never come from the public action request or a phone-provided fence.
 */
export interface MediaInputAuthorizedGrantContext {
  readonly scope: MediaInputActionScope;
  readonly fence: MediaInputAuthorizedFence;
  readonly helloProofFrame: Buffer;
  readonly enrolledInstallationPublicKey: KeyObject;
}

export interface MediaInputPasswordReceipt {
  readonly passwordScope: MediaInputActionScope & { readonly fieldRef: "password" };
  readonly helloProofFrame: Buffer;
  readonly statusFrame: Buffer;
}

export interface SealMediaInputCredentialInput {
  readonly context: MediaInputAuthorizedGrantContext & { readonly scope: MediaInputActionScope & { readonly fieldRef: MediaInputCredentialField } };
  /** Borrowed exact UTF-8 bytes for only the selected credential field. */
  readonly credentialValueUtf8: Buffer;
  readonly nowMillis: bigint;
  readonly issuedAtMillis: bigint;
  readonly expiresAtMillis: bigint;
  readonly signingKey: MediaInputGrantSigningKey;
}

export interface SignMediaInputSubmitInput {
  readonly context: MediaInputAuthorizedGrantContext & { readonly scope: MediaInputActionScope & { readonly fieldRef: "submit_login"; readonly targetViewIdResourceName: string } };
  /** Backend-authoritative durable receipt; this module verifies its SGMS signature and exact bindings. */
  readonly priorPasswordReceipt: MediaInputPasswordReceipt;
  readonly nowMillis: bigint;
  readonly issuedAtMillis: bigint;
  readonly expiresAtMillis: bigint;
  readonly signingKey: MediaInputGrantSigningKey;
}

export class MediaInputEnvelopeError extends Error {
  constructor() { super("MEDIA_INPUT_ENVELOPE_UNAVAILABLE"); }
}

function fail(): never { throw new MediaInputEnvelopeError(); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, i) => key === sorted[i]);
}

function uuidBytes(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) fail();
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function positiveU64(value: unknown): bigint {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_U64) fail();
  return value;
}

function u64(value: bigint): Buffer {
  const out = Buffer.allocUnsafe(8);
  out.writeBigUInt64BE(value);
  return out;
}

function u16(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) fail();
  const out = Buffer.allocUnsafe(2);
  out.writeUInt16BE(value);
  return out;
}

function u32(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) fail();
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32BE(value);
  return out;
}

function u16Bytes(bytes: Buffer): Buffer {
  return Buffer.concat([u16(bytes.length), bytes]);
}

function exactUtf8(value: unknown, minBytes: number, maxBytes: number): Buffer {
  if (typeof value !== "string") fail();
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString("utf8") !== value) fail();
  return bytes;
}

function validUtf8(bytes: Buffer): boolean {
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i]!;
    if (a <= 0x7f) { i++; continue; }
    if (a >= 0xc2 && a <= 0xdf) {
      if (i + 1 >= bytes.length || (bytes[i + 1]! & 0xc0) !== 0x80) return false;
      i += 2; continue;
    }
    if (a >= 0xe0 && a <= 0xef) {
      if (i + 2 >= bytes.length) return false;
      const b = bytes[i + 1]!, c = bytes[i + 2]!;
      if ((c & 0xc0) !== 0x80 || (b & 0xc0) !== 0x80
        || (a === 0xe0 && b < 0xa0) || (a === 0xed && b > 0x9f)) return false;
      i += 3; continue;
    }
    if (a >= 0xf0 && a <= 0xf4) {
      if (i + 3 >= bytes.length) return false;
      const b = bytes[i + 1]!, c = bytes[i + 2]!, d = bytes[i + 3]!;
      if ((b & 0xc0) !== 0x80 || (c & 0xc0) !== 0x80 || (d & 0xc0) !== 0x80
        || (a === 0xf0 && b < 0x90) || (a === 0xf4 && b > 0x8f)) return false;
      i += 4; continue;
    }
    return false;
  }
  return true;
}

function ascii(value: unknown, min: number, max: number, pattern?: RegExp): Buffer {
  if (typeof value !== "string" || value.length < min || value.length > max
    || !/^[\x21-\x7e]+$/.test(value) || (pattern && !pattern.test(value))) fail();
  return Buffer.from(value, "ascii");
}

function packageFor(platform: MediaInputPlatform): string {
  if (platform !== "facebook" && platform !== "youtube") fail();
  return PLATFORM_PACKAGE[platform];
}

function validateScope(scope: unknown, fence: MediaInputAuthorizedFence): asserts scope is MediaInputActionScope {
  if (!isRecord(scope)) fail();
  const base = ["accountId", "platform", "credentialId", "expectedRevision", "projectId", "deviceId", "taskId",
    "taskAttemptId", "operationKind", "actionId", "fieldRef", "authorizationId", "holderId", "controlGeneration", "serial"];
  const field = scope.fieldRef;
  const expected = field === "submit_login" ? [...base, "targetViewIdResourceName"] : base;
  if (!hasExactKeys(scope, expected) || scope.operationKind !== "assist_existing_login"
    || (scope.platform !== "facebook" && scope.platform !== "youtube")
    || (field !== "login" && field !== "password" && field !== "submit_login")) fail();
  for (const id of [scope.accountId, scope.credentialId, scope.projectId, scope.deviceId, scope.taskId,
    scope.taskAttemptId, scope.actionId, scope.authorizationId, scope.holderId]) uuidBytes(id);
  positiveU64(scope.expectedRevision);
  positiveU64(scope.controlGeneration);
  uuidBytes(fence.installationId);
  positiveU64(fence.installationGeneration);
  positiveU64(fence.leaseUntilMillis);
  positiveU64(fence.holderGrantValidUntilMillis);
  exactUtf8(scope.serial, 1, 128);
  ascii(packageFor(scope.platform), 1, 255, /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/);
  if (field === "submit_login") {
    const target = ascii(scope.targetViewIdResourceName, 1, 255);
    const escaped = packageFor(scope.platform).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^${escaped}:id/[A-Za-z_][A-Za-z0-9_]*$`).test(target.toString("ascii"))) fail();
  }
}

function encodeScope(scope: MediaInputActionScope, fence: MediaInputAuthorizedFence): Buffer {
  const targetPackage = Buffer.from(packageFor(scope.platform), "ascii");
  const target = scope.fieldRef === "submit_login" ? ascii(scope.targetViewIdResourceName, 1, 255) : Buffer.alloc(0);
  return Buffer.concat([
    uuidBytes(scope.accountId), uuidBytes(scope.credentialId), uuidBytes(scope.projectId), uuidBytes(scope.taskId), uuidBytes(scope.taskAttemptId),
    Buffer.from([1]),
    uuidBytes(scope.actionId), uuidBytes(scope.actionId), uuidBytes(scope.authorizationId), uuidBytes(scope.holderId),
    uuidBytes(scope.deviceId), uuidBytes(fence.installationId),
    u64(scope.expectedRevision), u64(fence.installationGeneration), u64(scope.controlGeneration),
    u64(fence.leaseUntilMillis), u64(fence.holderGrantValidUntilMillis),
    Buffer.from([PLATFORM_CODE[scope.platform]]),
    u16Bytes(exactUtf8(scope.serial, 1, 128)), u16Bytes(targetPackage), u16Bytes(target),
    Buffer.from([FIELD_CODE[scope.fieldRef]]),
  ]);
}

class Cursor {
  private offset = 0;
  constructor(private readonly bytes: Buffer) {}
  take(length: number): Buffer {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) fail();
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  byte(): number { return this.take(1)[0]!; }
  word16(): number { return this.take(2).readUInt16BE(); }
  word32(): number { return this.take(4).readUInt32BE(); }
  word64(): bigint { return this.take(8).readBigUInt64BE(); }
  done(): boolean { return this.offset === this.bytes.length; }
  position(): number { return this.offset; }
}

function p256PublicKey(key: KeyObject): boolean {
  return key.type === "public" && key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
}

function p256PrivateKey(key: KeyObject): boolean {
  return key.type === "private" && key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
}

function parseDerInteger(cursor: Cursor): bigint {
  if (cursor.byte() !== 0x02) fail();
  const length = cursor.byte();
  if (length < 1 || length > 33) fail();
  const bytes = cursor.take(length);
  if ((bytes[0]! & 0x80) !== 0 || (length > 1 && bytes[0] === 0 && (bytes[1]! & 0x80) === 0)) fail();
  if (bytes.length === 1 && bytes[0] === 0) fail();
  return BigInt(`0x${bytes.toString("hex")}`);
}

function derSignatureParts(signature: Buffer): { r: bigint; s: bigint } {
  if (signature.length < 8 || signature.length > 72 || signature[0] !== 0x30 || signature[1] !== signature.length - 2) fail();
  const cursor = new Cursor(signature.subarray(2));
  const r = parseDerInteger(cursor), s = parseDerInteger(cursor);
  if (!cursor.done() || r <= 0n || r >= P256_ORDER || s <= 0n || s >= P256_ORDER || s > P256_HALF_ORDER) fail();
  return { r, s };
}

function derInteger(value: bigint): Buffer {
  const hex = value.toString(16);
  let raw = Buffer.from(hex.padStart(hex.length + (hex.length % 2), "0"), "hex");
  while (raw.length > 1 && raw[0] === 0 && (raw[1]! & 0x80) === 0) raw = raw.subarray(1);
  if ((raw[0]! & 0x80) !== 0) raw = Buffer.concat([Buffer.from([0]), raw]);
  return Buffer.concat([Buffer.from([0x02, raw.length]), raw]);
}

function normalizeLowS(signature: Buffer): Buffer {
  if (signature.length < 8 || signature.length > 72 || signature[0] !== 0x30 || signature[1] !== signature.length - 2) fail();
  const cursor = new Cursor(signature.subarray(2));
  const r = parseDerInteger(cursor);
  const originalS = parseDerInteger(cursor);
  if (!cursor.done() || r <= 0n || r >= P256_ORDER || originalS <= 0n || originalS >= P256_ORDER) fail();
  const s = originalS > P256_HALF_ORDER ? P256_ORDER - originalS : originalS;
  const fields = Buffer.concat([derInteger(r), derInteger(s)]);
  const result = Buffer.concat([Buffer.from([0x30, fields.length]), fields]);
  derSignatureParts(result);
  return result;
}

function verifyP256(key: KeyObject, message: Buffer, signature: Buffer): void {
  if (!p256PublicKey(key)) fail();
  derSignatureParts(signature);
  if (!verify("sha256", message, key, signature)) fail();
}

function validateSigningKey(key: MediaInputGrantSigningKey): void {
  if (!isRecord(key) || !hasExactKeys(key, ["keyId", "privateKey"]) || typeof key.keyId !== "string"
    || !/^[0-9a-f]{64}$/.test(key.keyId) || !(key.privateKey instanceof Object) || !p256PrivateKey(key.privateKey)) fail();
  const publicSpki = createPublicKey(key.privateKey).export({ type: "spki", format: "der" });
  if (!Buffer.isBuffer(publicSpki) || createHash("sha256").update(publicSpki).digest("hex") !== key.keyId) fail();
}

interface ParsedHello {
  readonly request: Buffer;
  readonly nonce: Buffer;
  readonly phoneRsaPublicKey: KeyObject;
  readonly phoneRsaSpki: Buffer;
  readonly proofFrame: Buffer;
}

function helloRequest(scope: MediaInputActionScope, fence: MediaInputAuthorizedFence): Buffer {
  return Buffer.concat([Buffer.from("SGMH", "ascii"), Buffer.from([1]), encodeScope(scope, fence)]);
}

function parseHelloProof(frame: Buffer, expectedRequest: Buffer, enrolledKey: KeyObject): ParsedHello {
  if (!Buffer.isBuffer(frame) || frame.length < 4 + 1 + 4 + 32 + 2 + 1 + 8 || frame.length > MAX_HELLO_BYTES
    || !p256PublicKey(enrolledKey)) fail();
  const cursor = new Cursor(frame);
  if (!cursor.take(4).equals(Buffer.from("SGHP", "ascii")) || cursor.byte() !== 1) fail();
  const requestLength = cursor.word32();
  if (requestLength < 5 || requestLength > MAX_HELLO_BYTES) fail();
  const requestStart = cursor.position();
  const request = cursor.take(requestLength);
  if (!request.equals(expectedRequest) || !request.subarray(0, 4).equals(Buffer.from("SGMH", "ascii")) || request[4] !== 1) fail();
  const nonce = cursor.take(32);
  const spkiLength = cursor.word16();
  if (spkiLength < 1 || spkiLength > 512) fail();
  const spkiStart = cursor.position();
  const phoneRsaSpki = cursor.take(spkiLength);
  const signatureLength = cursor.byte();
  const signature = cursor.take(signatureLength);
  if (!cursor.done()) fail();
  const signedBytes = Buffer.concat([u32(requestLength), frame.subarray(requestStart, spkiStart + spkiLength)]);
  verifyP256(enrolledKey, Buffer.concat([HELLO_DOMAIN, signedBytes]), signature);

  const phoneRsaPublicKey = createPublicKey({ key: phoneRsaSpki, type: "spki", format: "der" });
  const exported = phoneRsaPublicKey.export({ type: "spki", format: "der" });
  if (phoneRsaPublicKey.asymmetricKeyType !== "rsa" || phoneRsaPublicKey.asymmetricKeyDetails?.modulusLength !== 2048
    || !Buffer.isBuffer(exported) || !exported.equals(phoneRsaSpki)) fail();
  return { request, nonce, phoneRsaPublicKey, phoneRsaSpki, proofFrame: frame };
}

function validTimes(now: bigint, issued: bigint, expires: bigint, fence: MediaInputAuthorizedFence): void {
  positiveU64(now); positiveU64(issued); positiveU64(expires);
  if (issued > now || now >= expires || expires <= issued || expires - issued > MAX_GRANT_LIFETIME_MS
    || expires > positiveU64(fence.leaseUntilMillis) || expires > positiveU64(fence.holderGrantValidUntilMillis)) fail();
}

function baseGrant(scope: MediaInputActionScope, fence: MediaInputAuthorizedFence, hello: ParsedHello,
  now: bigint, issued: bigint, expires: bigint): Buffer {
  validTimes(now, issued, expires, fence);
  const grantNonce = randomBytes(32);
  return Buffer.concat([
    Buffer.from("SGMP", "ascii"), Buffer.from([1]), encodeScope(scope, fence), u64(issued), u64(expires), hello.nonce,
    createHash("sha256").update(hello.phoneRsaSpki).digest(), createHash("sha256").update(hello.proofFrame).digest(), grantNonce,
  ]);
}

function signEnvelope(prefix: Buffer, key: MediaInputGrantSigningKey): Buffer {
  const signature = normalizeLowS(sign("sha256", Buffer.concat([ENVELOPE_DOMAIN, prefix]), key.privateKey));
  const frame = Buffer.concat([prefix, Buffer.from([signature.length]), signature]);
  if (frame.length > MAX_ENVELOPE_BYTES) fail();
  return frame;
}

function createSignedGrant(context: MediaInputAuthorizedGrantContext, key: MediaInputGrantSigningKey,
  now: bigint, issued: bigint, expires: bigint): { hello: ParsedHello; grant: Buffer } {
  validateScope(context.scope, context.fence);
  validateSigningKey(key);
  const expected = helloRequest(context.scope, context.fence);
  const hello = parseHelloProof(context.helloProofFrame, expected, context.enrolledInstallationPublicKey);
  const draft = baseGrant(context.scope, context.fence, hello, now, issued, expires);
  if (draft.length > MAX_GRANT_BYTES) fail();
  return { hello, grant: draft };
}

/**
 * Seals only the selected login/password UTF-8 bytes for the ephemeral RSA key
 * proven in SGHP. The borrowed secret Buffer is never mutated; callers must
 * clear their owned plaintext buffer immediately after this synchronous call.
 * This function encodes a backend-authorized context; it does not authorize it.
 */
export function sealMediaInputCredential(input: SealMediaInputCredentialInput): Buffer {
  let aesKey: Buffer | undefined;
  let iv: Buffer | undefined;
  let encrypted: Buffer | undefined;
  try {
    if (!isRecord(input) || !Buffer.isBuffer(input.credentialValueUtf8) || input.credentialValueUtf8.length < 1
      || input.credentialValueUtf8.length > MAX_CIPHERTEXT_BYTES || !validUtf8(input.credentialValueUtf8)
      || input.context?.scope?.fieldRef !== "login" && input.context?.scope?.fieldRef !== "password") fail();
    const { hello, grant } = createSignedGrant(input.context, input.signingKey, input.nowMillis, input.issuedAtMillis, input.expiresAtMillis);
    aesKey = randomBytes(32);
    iv = randomBytes(12);
    const wrapped = publicEncrypt({ key: hello.phoneRsaPublicKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey);
    if (wrapped.length !== 256) fail();
    const cipher = createCipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
    cipher.setAAD(grant);
    encrypted = Buffer.concat([cipher.update(input.credentialValueUtf8), cipher.final()]);
    if (encrypted.length < 1 || encrypted.length > MAX_CIPHERTEXT_BYTES) fail();
    const keyId = Buffer.from(input.signingKey.keyId, "ascii");
    const prefix = Buffer.concat([
      Buffer.from("SGME", "ascii"), Buffer.from([1, keyId.length]), keyId, u32(grant.length), grant, Buffer.from([1]),
      u16(wrapped.length), wrapped, iv, u32(encrypted.length), encrypted, cipher.getAuthTag(),
    ]);
    return signEnvelope(prefix, input.signingKey);
  } catch {
    throw new MediaInputEnvelopeError();
  } finally {
    aesKey?.fill(0);
    iv?.fill(0);
    encrypted?.fill(0);
  }
}

function samePriorActionScope(current: MediaInputActionScope, prior: MediaInputActionScope): boolean {
  return prior.fieldRef === "password" && current.fieldRef === "submit_login"
    && current.accountId === prior.accountId && current.platform === prior.platform && current.credentialId === prior.credentialId
    && current.expectedRevision === prior.expectedRevision && current.projectId === prior.projectId && current.deviceId === prior.deviceId
    && current.taskId === prior.taskId && current.taskAttemptId === prior.taskAttemptId && current.operationKind === prior.operationKind
    && current.authorizationId === prior.authorizationId && current.holderId === prior.holderId
    && current.controlGeneration === prior.controlGeneration && current.serial === prior.serial;
}

interface ParsedStatus {
  readonly deviceId: Buffer;
  readonly installationId: Buffer;
  readonly installationGeneration: bigint;
  readonly sessionNonce: Buffer;
  readonly requestId: Buffer;
  readonly actionId: Buffer;
  readonly helloRequestHash: Buffer;
  readonly phase: number;
}

function parsePriorStatus(frame: Buffer, expectedScope: MediaInputActionScope, fence: MediaInputAuthorizedFence,
  hello: ParsedHello, enrolledKey: KeyObject): ParsedStatus {
  if (!Buffer.isBuffer(frame) || frame.length > MAX_ENVELOPE_BYTES) fail();
  const cursor = new Cursor(frame);
  if (!cursor.take(4).equals(Buffer.from("SGMS", "ascii")) || cursor.byte() !== 1) fail();
  const deviceId = cursor.take(16), installationId = cursor.take(16), installationGeneration = cursor.word64();
  const sessionNonce = cursor.take(32), requestId = cursor.take(16), actionId = cursor.take(16), helloRequestHash = cursor.take(32);
  const sequence = cursor.word64(), phase = cursor.byte();
  const signedEnd = cursor.position();
  const signatureLength = cursor.byte(), signature = cursor.take(signatureLength);
  if (!cursor.done() || sequence <= 0n || installationGeneration !== fence.installationGeneration || phase !== 3
    || !deviceId.equals(uuidBytes(expectedScope.deviceId)) || !installationId.equals(uuidBytes(fence.installationId))
    || !requestId.equals(uuidBytes(expectedScope.actionId)) || !actionId.equals(uuidBytes(expectedScope.actionId))
    || !sessionNonce.equals(hello.nonce) || !helloRequestHash.equals(createHash("sha256").update(hello.request).digest())) fail();
  verifyP256(enrolledKey, Buffer.concat([STATUS_DOMAIN, frame.subarray(0, signedEnd)]), signature);
  return { deviceId, installationId, installationGeneration, sessionNonce, requestId, actionId, helloRequestHash, phase };
}

/** Signs the no-secret submit_login grant, bound to one verified prior password status. */
export function signMediaInputSubmit(input: SignMediaInputSubmitInput): Buffer {
  try {
    if (!isRecord(input) || input.context?.scope?.fieldRef !== "submit_login" || !input.priorPasswordReceipt
      || !isRecord(input.priorPasswordReceipt) || input.priorPasswordReceipt.passwordScope?.fieldRef !== "password") fail();
    validateScope(input.context.scope, input.context.fence);
    const priorScope = input.priorPasswordReceipt.passwordScope;
    validateScope(priorScope, input.context.fence);
    if (!samePriorActionScope(input.context.scope, priorScope)) fail();
    validateSigningKey(input.signingKey);

    const priorHello = parseHelloProof(input.priorPasswordReceipt.helloProofFrame, helloRequest(priorScope, input.context.fence),
      input.context.enrolledInstallationPublicKey);
    parsePriorStatus(input.priorPasswordReceipt.statusFrame, priorScope, input.context.fence, priorHello,
      input.context.enrolledInstallationPublicKey);

    const { grant: base } = createSignedGrant(input.context, input.signingKey, input.nowMillis, input.issuedAtMillis, input.expiresAtMillis);
    const priorClaims = Buffer.concat([
      uuidBytes(priorScope.actionId),
      createHash("sha256").update(input.priorPasswordReceipt.statusFrame).digest(),
      priorHello.nonce,
    ]);
    const grant = Buffer.concat([base, priorClaims]);
    if (grant.length > MAX_GRANT_BYTES) fail();

    const keyId = Buffer.from(input.signingKey.keyId, "ascii");
    const prefix = Buffer.concat([
      Buffer.from("SGME", "ascii"), Buffer.from([1, keyId.length]), keyId, u32(grant.length), grant, Buffer.from([0]),
    ]);
    return signEnvelope(prefix, input.signingKey);
  } catch {
    throw new MediaInputEnvelopeError();
  }
}
