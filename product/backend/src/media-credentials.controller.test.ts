import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { MediaCredentialsController } from "./media-credentials.controller.js";
import type { MediaCredentialStore } from "./media-credential-store.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const id = "a0000000-0000-4000-8000-000000000001", other = "b0000000-0000-4000-8000-000000000001";
const request = { headers: { cookie: `__Host-sg_operator_session=${"A".repeat(43)}` } };
const secret = Buffer.from('{ "login": "synthetic", "password": " synthetic-only 密码 " }');
const command = { metadata: { contractVersion, requestId: "request-sensitive-input", idempotencyKey: "credential_intent_1" },
  credentialId: id, accountId: id, platform: "facebook", expectedRevision: 0, operation: "put", payloadBase64: secret.toString("base64") };
const credential = { credentialId: id, accountId: id, platform: "facebook", revision: 1, state: "stored_unverified", actionPermissionGranted: false, acceptanceStarted: false };
test("credential controller forwards only current Cookie/CSRF and exact decoded bytes, then clears its borrowed buffer", async () => {
  let borrowed: Buffer | undefined, calls = 0;
  const controller = new MediaCredentialsController({ write: async (token: string, csrf: string, input: unknown, bytes: Buffer) => {
    calls++; assert.equal(token, "A".repeat(43)); assert.equal(csrf, "C".repeat(43)); assert.ok(bytes.equals(secret)); borrowed = bytes;
    const { payloadBase64: _secret, ...expected } = command; assert.deepEqual(input, expected); return { credential, changed: true, replayed: false };
  } } as unknown as MediaCredentialStore);
  const result = await controller.write(id, command, request, "C".repeat(43)); assert.equal(calls, 1); assert.deepEqual(result, { contractVersion, credential, changed: true, replayed: false });
  assert.ok(borrowed?.equals(Buffer.alloc(secret.length))); assert.ok(!JSON.stringify(result).includes(command.payloadBase64));
});
test("invalid paths/body authority or invalidation with bytes have zero store calls", async () => {
  let calls = 0; const controller = new MediaCredentialsController({ write: async () => { calls++; } } as unknown as MediaCredentialStore);
  for (const [path, body] of [[other, command], [id, { ...command, acceptanceStarted: true }], [id, { ...command, operation: "invalidate" }], [id, { ...command, payloadBase64: "AB==" }], [id, { ...command, metadata: { ...command.metadata, contractVersion: "future" } }]] as const) {
    await assert.rejects(controller.write(path, body, request, "C".repeat(43)), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  }
  assert.equal(calls, 0);
});
test("backend failure clears owned bytes and emits only server trace/safe envelope, never secret input, driver cause or output payload", async () => {
  let borrowed: Buffer | undefined;
  const controller = new MediaCredentialsController({ write: async (_token: string, _csrf: string, _input: unknown, bytes: Buffer) => {
    borrowed = bytes; throw new Error(command.payloadBase64, { cause: "secret-driver-value" });
  } } as unknown as MediaCredentialStore);
  await assert.rejects(controller.write(id, command, request, "C".repeat(43)), (e: unknown) => {
    if (!(e instanceof HttpException) || e.getStatus() !== 500) return false;
    const result = productErrorResponseSchema.parse(e.getResponse()); assert.notEqual(result.requestId, command.metadata.requestId);
    assert.ok(!JSON.stringify(result).includes(command.payloadBase64) && !JSON.stringify(result).includes("secret-driver")); return true;
  });
  assert.ok(borrowed?.equals(Buffer.alloc(secret.length)));
});
test("metadata read does not ask for secret bytes; body auth failure and corrupt cross-account reply fail closed", async () => {
  const controller = new MediaCredentialsController({ read: async (token: string, accountId: string) => {
    assert.equal(token, "A".repeat(43)); assert.equal(accountId, id); return credential;
  }, write: async () => { throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session required"); } } as unknown as MediaCredentialStore);
  assert.deepEqual(await controller.read(id, request), { contractVersion, credential });
  await assert.rejects(controller.write(id, command, request, undefined), (e: unknown) => e instanceof HttpException && e.getStatus() === 401);
  const corrupt = new MediaCredentialsController({ read: async () => ({ ...credential, accountId: other }) } as unknown as MediaCredentialStore);
  await assert.rejects(corrupt.read(id, request), (e: unknown) => e instanceof HttpException && e.getStatus() === 500);
});
