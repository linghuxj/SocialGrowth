import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { ResourcePreparationController } from "./resource-preparation.controller.js";
import type { ResourceReservationStore } from "./resource-reservation-store.js";
import { ResourceReservationError } from "./resource-reservation-core.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const id = "a0000000-0000-4000-8000-000000000001";
const request = { headers: { cookie: `__Host-sg_operator_session=${"A".repeat(43)}` } };
const input = { metadata: { contractVersion, requestId: "request-resources", idempotencyKey: "resource_preparation_key" },
  expectedResourceVersion: 0, registration: { accountId: id, identityId: id, platform: "facebook", canonicalAccountRef: "declared_login", canonicalIdentityRef: "declared_page" } };
test("resource HTTP only forwards current Cookie/CSRF and strictly rejects credentials, spoofed actors and unsupported versions", async () => {
  let calls = 0;
  const controller = new ResourcePreparationController({ registerIdentity: async (token: string, csrf: string, body: unknown) => {
    if (token === "") throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Fixture rejects an invalid complete Cookie value");
    calls++; assert.equal(token, "A".repeat(43)); assert.equal(csrf, "C".repeat(43)); assert.deepEqual(body, input); return "forward-only";
  } } as unknown as ResourceReservationStore);
  assert.equal(await controller.register(input, request, "C".repeat(43)), "forward-only");
  for (const body of [{ ...input, actorId: id }, { ...input, registration: { ...input.registration, password: "forbidden" } },
    { ...input, metadata: { ...input.metadata, contractVersion: "future" } }]) {
    await assert.rejects(controller.register(body, request, "C".repeat(43)), (e: unknown) => e instanceof HttpException && e.getStatus() === 400);
  }
  await assert.rejects(controller.register(input, { headers: { cookie: `${request.headers.cookie}=suffix` } }, "C".repeat(43)), (e: unknown) => e instanceof HttpException && e.getStatus() === 401);
  assert.equal(calls, 1);
});
test("resource handover and backend errors are safe envelopes and never raw secret exceptions", async () => {
  const controller = new ResourcePreparationController({ read: async () => { throw new Error("secret-database-url"); },
    reserve: async () => { throw new ResourceReservationError("HANDOVER_REQUIRED"); } } as unknown as ResourceReservationStore);
  await assert.rejects(controller.read(request), (e: unknown) => e instanceof HttpException && e.getStatus() === 500 && !JSON.stringify(e.getResponse()).includes("secret-database"));
  const body = { metadata: input.metadata, expectedResourceVersion: 0, expectedProjectVersion: 0, expectedDeviceVersion: 0,
    reservation: { projectId: id, deviceId: id, identityIds: [id] } };
  await assert.rejects(controller.reserve(body, request, "C".repeat(43)), (e: unknown) => e instanceof HttpException && e.getStatus() === 409
    && productErrorResponseSchema.parse(e.getResponse()).error.code === "FACT_VERSION_STALE");
});
