import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, materialUploadTicketViewSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { MaterialUploadController } from "./material-upload.controller.js";
import type { MaterialRuntime } from "./material-runtime.js";
import { MaterialUploadError } from "./material-upload-core.js";
const id = "a0000000-0000-4000-8000-000000000001", session = "A".repeat(43);
const input = { metadata: { contractVersion, requestId: "request-upload-http", idempotencyKey: "idempotency-upload-http" }, projectId: id, objectId: id, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" };
const request = { headers: { cookie: `unrelated=skip; __Host-sg_operator_session=${session}` } };
const saved = { ...input, descriptor: { ...input, key: "internal-do-not-disclose", storageLocationId: id, storageBindingDigest: "d".repeat(64), secret: "must-not-expose" },
  status: "pending_bytes", preparedAt: "2026-10-01T00:00:00.123456Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false, changed: true, replayed: false };
test("upload controller forwards exact current cookie/CSRF and allowlists minimal bytes ticket", async () => {
  const controller = new MaterialUploadController({ uploads: () => ({ prepare: async (token: string, csrf: string, value: unknown) => {
    assert.equal(token, session); assert.equal(csrf, "current-csrf"); assert.deepEqual(value, input); return saved;
  }, read: async () => saved }) } as unknown as MaterialRuntime);
  const response = await controller.prepare(id.toUpperCase(), input, request, "current-csrf");
  assert.equal(response.changed, true); assert.ok(!JSON.stringify(response).includes("internal-do-not-disclose"));
  materialUploadTicketViewSchema.parse(await controller.read(id, id, request));
  await assert.rejects(controller.prepare(id, { ...input, endpoint: "https://untrusted.invalid" }, request, "current-csrf"), e => e instanceof HttpException && e.getStatus() === 400);
  await assert.rejects(controller.prepare("b0000000-0000-4000-8000-000000000001", input, request, "current-csrf"), e => e instanceof HttpException && e.getStatus() === 400);
});
test("upload errors and ambiguous cookies fail without raw configuration or descriptor details", async () => {
  let seen = "not-called";
  const controller = new MaterialUploadController({ uploads: () => ({ prepare: async (token: string) => { seen = token; throw new MaterialUploadError("CONFIGURATION_REQUIRED"); }, read: async () => { throw new Error("secret-storage-response"); } }) } as unknown as MaterialRuntime);
  await assert.rejects(controller.prepare(id, input, { headers: { cookie: `__Host-sg_operator_session=${session}; __Host-sg_operator_session=${session}` } }, ""), e => e instanceof HttpException && e.getStatus() === 503 && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR");
  assert.equal(seen, "");
  await assert.rejects(controller.read(id, id, request), e => e instanceof HttpException && e.getStatus() === 500 && !JSON.stringify(e.getResponse()).includes("secret-storage"));
  const invalidResult = new MaterialUploadController({ uploads: () => ({ read: async () => ({ ...saved, status: "verified_bytes" }) }) } as unknown as MaterialRuntime);
  await assert.rejects(invalidResult.read(id, id, request), e => e instanceof HttpException && e.getStatus() === 500 && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR");
});
