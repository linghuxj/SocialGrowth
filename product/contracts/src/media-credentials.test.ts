import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import { mediaCredentialMetadataSchema, readMediaCredentialResponseSchema, writeMediaCredentialRequestSchema, writeMediaCredentialResponseSchema } from "./media-credentials.js";
const id = "a0000000-0000-4000-8000-000000000001";
const command = { metadata: { contractVersion, requestId: "request-credential", idempotencyKey: "credential_intent_1" }, credentialId: id, accountId: id,
  platform: "facebook", expectedRevision: 0, operation: "put", payloadBase64: Buffer.from('{"login":"synthetic","password":" synthetic 密码 "}').toString("base64") };
test("credential transport bounds canonical original bytes, not plaintext/password policy or an encryption assertion", () => {
  assert.ok(writeMediaCredentialRequestSchema.safeParse(command).success);
  for (const n of [1, 2, 3, 8190, 8191, 8192]) assert.ok(writeMediaCredentialRequestSchema.safeParse({ ...command, payloadBase64: Buffer.alloc(n, 255).toString("base64") }).success);
  for (const payloadBase64 of ["", "AA", "AB==", "AAB=", "AA===", "AA==\n", Buffer.alloc(8193).toString("base64"), "秘密"]) assert.equal(writeMediaCredentialRequestSchema.safeParse({ ...command, payloadBase64 }).success, false);
  const { payloadBase64: _secret, ...withoutSecret } = command;
  assert.ok(writeMediaCredentialRequestSchema.safeParse({ ...withoutSecret, operation: "invalidate" }).success);
  assert.equal(writeMediaCredentialRequestSchema.safeParse({ ...command, operation: "invalidate" }).success, false);
});
test("credential paths and requests reject uppercase IDs, unsafe versions, spoofed current authority and raw extra secrets", () => {
  for (const patch of [{ accountId: id.toUpperCase() }, { credentialId: id + "\n" }, { expectedRevision: -1 }, { expectedRevision: 9007199254740992 },
    { operatorId: id }, { actionPermissionGranted: true }, { login: "forbidden" }, { password: "forbidden" }]) assert.equal(writeMediaCredentialRequestSchema.safeParse({ ...command, ...patch }).success, false);
  assert.ok(writeMediaCredentialRequestSchema.safeParse({ ...command, expectedRevision: Number.MAX_SAFE_INTEGER }).success);
});
test("credential metadata is current/unverified only; strict responses reject secret bytes and impossible changed/replayed pairs", () => {
  const credential = { credentialId: id, accountId: id, platform: "facebook", revision: 1, state: "stored_unverified", actionPermissionGranted: false, acceptanceStarted: false };
  assert.ok(readMediaCredentialResponseSchema.safeParse({ contractVersion, credential: null }).success);
  assert.ok(mediaCredentialMetadataSchema.safeParse({ ...credential, state: "invalidated" }).success);
  for (const patch of [{ password: "forbidden" }, { envelope: {} }, { payloadBase64: command.payloadBase64 }, { actionPermissionGranted: true }, { state: "ready" }, { revision: 0 }]) assert.equal(mediaCredentialMetadataSchema.safeParse({ ...credential, ...patch }).success, false);
  for (const [changed, replayed] of [[true, false], [false, false], [false, true]]) assert.ok(writeMediaCredentialResponseSchema.safeParse({ contractVersion, credential, changed, replayed }).success);
  assert.equal(writeMediaCredentialResponseSchema.safeParse({ contractVersion, credential, changed: true, replayed: true }).success, false);
});
