import assert from "node:assert/strict";
import { constants, createDecipheriv, createHash, createPublicKey, generateKeyPairSync, privateDecrypt, sign, verify, type KeyObject } from "node:crypto";
import test from "node:test";
import {
  MediaInputEnvelopeError,
  sealMediaInputCredential,
  signMediaInputSubmit,
  type MediaInputActionScope,
  type MediaInputAuthorizedFence,
  type MediaInputPasswordReceipt,
} from "./media-input-envelope.js";

const helloDomain = Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-HELLO-V1\0", "ascii");
const envelopeDomain = Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-ENVELOPE-V1\0", "ascii");
const statusDomain = Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-STATUS-V1\0", "ascii");
const order = 0xffff_ffff_0000_0000_ffff_ffff_ffff_ffff_bce6_faada7179e84f3b9cac2fc632551n;

function uuid(n: number): string {
  const tail = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

function uuidBytes(id: string): Buffer { return Buffer.from(id.replaceAll("-", ""), "hex"); }
function u16(n: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function u64(n: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64BE(n); return b; }
function len16(b: Buffer): Buffer { return Buffer.concat([u16(b.length), b]); }
function sha(b: Buffer): Buffer { return createHash("sha256").update(b).digest(); }

function derInt(v: bigint): Buffer {
  const hex = v.toString(16);
  let b = Buffer.from(hex.padStart(hex.length + (hex.length % 2), "0"), "hex");
  while (b.length > 1 && b[0] === 0 && (b[1]! & 0x80) === 0) b = b.subarray(1);
  if ((b[0]! & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([Buffer.from([2, b.length]), b]);
}

function lowS(signature: Buffer): Buffer {
  assert.equal(signature[0], 0x30);
  const rLength = signature[3]!;
  const r = BigInt(`0x${signature.subarray(4, 4 + rLength).toString("hex")}`);
  const sTag = 4 + rLength;
  const sLength = signature[sTag + 1]!;
  const rawS = BigInt(`0x${signature.subarray(sTag + 2, sTag + 2 + sLength).toString("hex")}`);
  const s = rawS > order / 2n ? order - rawS : rawS;
  const values = Buffer.concat([derInt(r), derInt(s)]);
  return Buffer.concat([Buffer.from([0x30, values.length]), values]);
}

const fence: MediaInputAuthorizedFence = {
  installationId: uuid(20), installationGeneration: 3n, leaseUntilMillis: 2_000_000_120_000n,
  holderGrantValidUntilMillis: 2_000_000_090_000n,
};

function action(fieldRef: "login" | "password" | "submit_login", actionNumber: number): MediaInputActionScope {
  return {
    accountId: uuid(1), platform: "facebook", credentialId: uuid(2), expectedRevision: 9n, projectId: uuid(3),
    deviceId: uuid(4), taskId: uuid(5), taskAttemptId: uuid(6), operationKind: "assist_existing_login",
    actionId: uuid(actionNumber), fieldRef, authorizationId: uuid(7), holderId: uuid(8), controlGeneration: 12n,
    serial: "RFCW40MYYCV",
    ...(fieldRef === "submit_login" ? { targetViewIdResourceName: "com.facebook.katana:id/login_button" } : {}),
  };
}

function encodeScope(scope: MediaInputActionScope): Buffer {
  const pkg = Buffer.from(scope.platform === "facebook" ? "com.facebook.katana" : "com.google.android.youtube", "ascii");
  const view = Buffer.from(scope.fieldRef === "submit_login" ? scope.targetViewIdResourceName! : "", "ascii");
  return Buffer.concat([
    uuidBytes(scope.accountId), uuidBytes(scope.credentialId), uuidBytes(scope.projectId), uuidBytes(scope.taskId), uuidBytes(scope.taskAttemptId),
    Buffer.from([1]), uuidBytes(scope.actionId), uuidBytes(scope.actionId), uuidBytes(scope.authorizationId), uuidBytes(scope.holderId),
    uuidBytes(scope.deviceId), uuidBytes(fence.installationId), u64(scope.expectedRevision), u64(fence.installationGeneration),
    u64(scope.controlGeneration), u64(fence.leaseUntilMillis), u64(fence.holderGrantValidUntilMillis),
    Buffer.from([scope.platform === "facebook" ? 1 : 2]), len16(Buffer.from(scope.serial, "utf8")), len16(pkg), len16(view),
    Buffer.from([scope.fieldRef === "login" ? 1 : scope.fieldRef === "password" ? 2 : 3]),
  ]);
}

function rawHello(scope: MediaInputActionScope): Buffer {
  return Buffer.concat([Buffer.from("SGMH", "ascii"), Buffer.from([1]), encodeScope(scope)]);
}

function signedLowS(message: Buffer, privateKey: KeyObject): Buffer {
  for (let attempt = 0; attempt < 32; attempt++) {
    const signature = lowS(sign("sha256", message, privateKey));
    const sTag = 4 + signature[3]!;
    const sLength = signature[sTag + 1]!;
    const s = BigInt(`0x${signature.subarray(sTag + 2, sTag + 2 + sLength).toString("hex")}`);
    if (s <= order / 2n) return signature;
  }
  throw new Error("fixture signature unavailable");
}

function helloProof(scope: MediaInputActionScope, installationPrivate: KeyObject,
  phonePublicSpki: Buffer, nonce: Buffer): Buffer {
  const request = rawHello(scope);
  const signed = Buffer.concat([helloDomain, u32(request.length), request, nonce, u16(phonePublicSpki.length), phonePublicSpki]);
  const signature = signedLowS(signed, installationPrivate);
  return Buffer.concat([Buffer.from("SGHP", "ascii"), Buffer.from([1]), u32(request.length), request, nonce,
    u16(phonePublicSpki.length), phonePublicSpki, Buffer.from([signature.length]), signature]);
}

function statusFrame(scope: MediaInputActionScope, nonce: Buffer,
  installationPrivate: KeyObject, phase = 3): Buffer {
  const prefix = Buffer.concat([
    Buffer.from("SGMS", "ascii"), Buffer.from([1]), uuidBytes(scope.deviceId), uuidBytes(fence.installationId),
    u64(fence.installationGeneration), nonce, uuidBytes(scope.actionId), uuidBytes(scope.actionId), sha(rawHello(scope)),
    u64(1n), Buffer.from([phase]),
  ]);
  const signature = signedLowS(Buffer.concat([statusDomain, prefix]), installationPrivate);
  return Buffer.concat([prefix, Buffer.from([signature.length]), signature]);
}

function parseEnvelope(frame: Buffer) {
  let offset = 0;
  const take = (n: number) => { const b = frame.subarray(offset, offset + n); assert.equal(b.length, n); offset += n; return b; };
  assert.equal(take(4).toString("ascii"), "SGME");
  assert.equal(take(1)[0], 1);
  const keyId = take(take(1)[0]!).toString("ascii");
  const grantLength = take(4).readUInt32BE();
  const grant = take(grantLength);
  const mode = take(1)[0]!;
  let wrapped: Buffer | null = null, iv: Buffer | null = null, ciphertext: Buffer | null = null, tag: Buffer | null = null;
  if (mode === 1) {
    const wrappedLength = take(2).readUInt16BE();
    wrapped = take(wrappedLength); iv = take(12);
    const ciphertextLength = take(4).readUInt32BE(); ciphertext = take(ciphertextLength); tag = take(16);
  }
  const signedEnd = offset;
  const signatureLength = take(1)[0]!;
  const signature = take(signatureLength);
  assert.equal(offset, frame.length);
  return { keyId, grant, mode, prefix: frame.subarray(0, signedEnd), wrapped, iv, ciphertext, tag, signature };
}

function makeCryptoFixture() {
  const installation = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signing = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const phone = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
  const signingSpki = createPublicKey(signing.privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const now = 2_000_000_000_000n;
  const localFence = { ...fence, leaseUntilMillis: now + 120_000n, holderGrantValidUntilMillis: now + 90_000n };
  const key = { keyId: sha(signingSpki).toString("hex"), privateKey: signing.privateKey };
  const proofScope = action("password", 9);
  const nonce = Buffer.alloc(32, 0x5a);
  const phoneSpki = phone.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const proof = helloProof(proofScope, installation.privateKey, phoneSpki, nonce);
  return { installation, signing, phone, key, now, localFence, proofScope, nonce, phoneSpki, proof };
}

test("credential SGME matches rev15 bytes, binds exact grant AAD, and never exposes the selected field", () => {
  const f = makeCryptoFixture();
  const scope = { ...f.proofScope, fieldRef: "password" as const };
  const proof = helloProof(scope, f.installation.privateKey, f.phoneSpki, f.nonce);
  const context = { scope, fence: f.localFence, helloProofFrame: proof, enrolledInstallationPublicKey: f.installation.publicKey };
  const secret = Buffer.from("密碼-value-42", "utf8");
  const expectedSecret = Buffer.from(secret);
  const frame = sealMediaInputCredential({ context, credentialValueUtf8: secret, nowMillis: f.now,
    issuedAtMillis: f.now - 1n, expiresAtMillis: f.now + 20_000n, signingKey: f.key });
  assert.deepEqual(secret, expectedSecret, "borrowed secret bytes are not mutated");
  assert.ok(frame.length <= 8192);
  assert.equal(frame.includes(secret), false);
  const parsed = parseEnvelope(frame);
  assert.equal(parsed.keyId, f.key.keyId);
  assert.equal(parsed.mode, 1);
  assert.equal(parsed.wrapped?.length, 256);
  assert.equal(parsed.iv?.length, 12);
  assert.equal(parsed.tag?.length, 16);
  assert.deepEqual(sha(f.phoneSpki), parsed.grant.subarray(parsed.grant.length - 96, parsed.grant.length - 64));
  assert.deepEqual(sha(proof), parsed.grant.subarray(parsed.grant.length - 64, parsed.grant.length - 32));
  assert.equal(parsed.grant.subarray(0, 4).toString("ascii"), "SGMP");
  assert.equal(parsed.grant[4], 1);

  const recoveredAes = privateDecrypt({ key: f.phone.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, parsed.wrapped!);
  const open = createDecipheriv("aes-256-gcm", recoveredAes, parsed.iv!, { authTagLength: 16 });
  open.setAAD(parsed.grant); open.setAuthTag(parsed.tag!);
  assert.deepEqual(Buffer.concat([open.update(parsed.ciphertext!), open.final()]), expectedSecret);
  assert.equal(verify("sha256", Buffer.concat([envelopeDomain, parsed.prefix]), f.signing.publicKey, parsed.signature), true);
});

test("credential seal rejects malformed proof, unknown scope fields, expired grants, oversized values, and invalid UTF-8", () => {
  const f = makeCryptoFixture();
  const scope = { ...f.proofScope, fieldRef: "login" as const };
  const proof = helloProof(scope, f.installation.privateKey, f.phoneSpki, f.nonce);
  const context = { scope, fence: f.localFence, helloProofFrame: proof, enrolledInstallationPublicKey: f.installation.publicKey };
  const base = { context, credentialValueUtf8: Buffer.from("synthetic", "utf8"), nowMillis: f.now,
    issuedAtMillis: f.now, expiresAtMillis: f.now + 1_000n, signingKey: f.key };
  const rejected = (input: unknown) => assert.throws(() => sealMediaInputCredential(input as never), MediaInputEnvelopeError);
  rejected({ ...base, context: { ...context, helloProofFrame: Buffer.concat([proof, Buffer.from([0])]) } });
  rejected({ ...base, context: { ...context, scope: { ...scope, unexpected: true } } });
  rejected({ ...base, nowMillis: f.now, issuedAtMillis: f.now + 1n, expiresAtMillis: f.now + 2n });
  rejected({ ...base, nowMillis: f.now, issuedAtMillis: f.now, expiresAtMillis: f.now + 30_001n });
  rejected({ ...base, nowMillis: f.now, issuedAtMillis: f.now, expiresAtMillis: f.localFence.leaseUntilMillis + 1n });
  rejected({ ...base, credentialValueUtf8: Buffer.alloc(0) });
  rejected({ ...base, credentialValueUtf8: Buffer.alloc(4097, 0x61) });
  rejected({ ...base, credentialValueUtf8: Buffer.from([0xc0, 0xaf]) });
});

test("submit SGME mode 0 binds a signed phase-3 password receipt and contains no secret fields", () => {
  const f = makeCryptoFixture();
  const passwordScope = { ...f.proofScope, fieldRef: "password" as const };
  const submitScope = { ...passwordScope, fieldRef: "submit_login" as const, actionId: uuid(10),
    targetViewIdResourceName: "com.facebook.katana:id/login_button" };
  const priorProof = helloProof(passwordScope, f.installation.privateKey, f.phoneSpki, f.nonce);
  const currentProof = helloProof(submitScope, f.installation.privateKey, f.phoneSpki, Buffer.alloc(32, 0x6b));
  const receipt: MediaInputPasswordReceipt = { passwordScope, helloProofFrame: priorProof,
    statusFrame: statusFrame(passwordScope, f.nonce, f.installation.privateKey) };
  const frame = signMediaInputSubmit({ context: { scope: submitScope, fence: f.localFence,
    helloProofFrame: currentProof, enrolledInstallationPublicKey: f.installation.publicKey }, priorPasswordReceipt: receipt,
    nowMillis: f.now, issuedAtMillis: f.now, expiresAtMillis: f.now + 15_000n, signingKey: f.key });
  const parsed = parseEnvelope(frame);
  assert.equal(parsed.mode, 0);
  assert.equal(parsed.wrapped, null);
  assert.equal(parsed.iv, null);
  assert.equal(parsed.ciphertext, null);
  assert.equal(parsed.tag, null);
  assert.equal(parsed.grant.length, 5 + encodeScope(submitScope).length + 8 + 8 + 32 + 32 + 32 + 32 + 16 + 32 + 32);
  assert.deepEqual(parsed.grant.subarray(-80, -64), uuidBytes(passwordScope.actionId));
  assert.deepEqual(parsed.grant.subarray(-64, -32), sha(receipt.statusFrame));
  assert.deepEqual(parsed.grant.subarray(-32), f.nonce);
  assert.equal(verify("sha256", Buffer.concat([envelopeDomain, parsed.prefix]), f.signing.publicKey, parsed.signature), true);
});

test("submit rejects unverified or mismatched prior receipts and target field confusion", () => {
  const f = makeCryptoFixture();
  const passwordScope = { ...f.proofScope, fieldRef: "password" as const };
  const submitScope = { ...passwordScope, fieldRef: "submit_login" as const, actionId: uuid(10),
    targetViewIdResourceName: "com.facebook.katana:id/login_button" };
  const priorProof = helloProof(passwordScope, f.installation.privateKey, f.phoneSpki, f.nonce);
  const context = { scope: submitScope, fence: f.localFence,
    helloProofFrame: helloProof(submitScope, f.installation.privateKey, f.phoneSpki, Buffer.alloc(32, 0x6b)),
    enrolledInstallationPublicKey: f.installation.publicKey };
  const receipt: MediaInputPasswordReceipt = { passwordScope, helloProofFrame: priorProof,
    statusFrame: statusFrame(passwordScope, f.nonce, f.installation.privateKey) };
  const base = { context, priorPasswordReceipt: receipt, nowMillis: f.now, issuedAtMillis: f.now,
    expiresAtMillis: f.now + 1_000n, signingKey: f.key };
  const rejected = (input: unknown) => assert.throws(() => signMediaInputSubmit(input as never), MediaInputEnvelopeError);
  const tampered = Buffer.from(receipt.statusFrame); tampered[tampered.length - 1] ^= 1;
  rejected({ ...base, priorPasswordReceipt: { ...receipt, statusFrame: tampered } });
  rejected({ ...base, priorPasswordReceipt: { ...receipt, statusFrame: statusFrame(passwordScope, f.nonce, f.installation.privateKey, 4) } });
  rejected({ ...base, priorPasswordReceipt: { ...receipt, passwordScope: { ...passwordScope, taskAttemptId: uuid(99) } } });
  rejected({ ...base, context: { ...context, scope: { ...submitScope, targetViewIdResourceName: "com.facebook.katana:id/other", fieldRef: "password" } } });
});
