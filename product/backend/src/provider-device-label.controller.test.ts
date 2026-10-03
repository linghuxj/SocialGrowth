import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { ProviderDeviceLabelController } from "./provider-device-label.controller.js";
import type { IdentityTransactionService } from "./identity-transactions.js";
import type { ProviderAuthService } from "./provider-auth-service.js";

const token = "B".repeat(43);
const deviceId = "00000000-0000-4000-8000-00000000000a";
const body = {
  metadata: { contractVersion, requestId: "rename-device-request", idempotencyKey: "rename-device-command-0001" },
  expectedFactVersion: 2,
  displayName: " Desk phone ",
};

test("device label route authenticates provider and passes only path identity and strict versioned input", async () => {
  const calls: unknown[][] = [];
  const controller = new ProviderDeviceLabelController(
    { authenticate: async (value: string) => { assert.equal(value, token); return { providerId: "provider-1" }; } } as unknown as ProviderAuthService,
    { renameProviderDevice: async (...args: unknown[]) => { calls.push(args); return { device: { deviceId, displayName: "Desk phone", factVersion: 3 } }; } } as unknown as IdentityTransactionService,
  );
  await controller.rename(deviceId, body, `Bearer ${token}`);
  assert.deepEqual(calls, [[deviceId, { ...body, displayName: "Desk phone" }, { providerId: "provider-1" }]]);
  await assert.rejects(controller.rename(deviceId, { ...body, providerId: "forged" }, `Bearer ${token}`), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  await assert.rejects(controller.rename("not-a-uuid", body, `Bearer ${token}`), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  await assert.rejects(controller.rename(deviceId, body, undefined), (error: unknown) => error instanceof HttpException && error.getStatus() === 401);
  assert.equal(calls.length, 1);
});

test("device label route masks unexpected service errors", async () => {
  const controller = new ProviderDeviceLabelController(
    { authenticate: async () => ({ providerId: "provider-1" }) } as unknown as ProviderAuthService,
    { renameProviderDevice: async () => { throw new Error("fixture-private-device-fact"); } } as unknown as IdentityTransactionService,
  );
  await assert.rejects(controller.rename(deviceId, body, `Bearer ${token}`), (error: unknown) => {
    if (!(error instanceof HttpException)) return false;
    const response = productErrorResponseSchema.parse(error.getResponse());
    return response.error.code === "INTERNAL_ERROR" && !JSON.stringify(response).includes("fixture-private");
  });
});
