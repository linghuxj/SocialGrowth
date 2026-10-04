import assert from "node:assert/strict";
import test from "node:test";
import { ProjectLifecycleController } from "./project-lifecycle.controller.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const projectId = "a0000000-0000-4000-8000-000000000001";
const variantId = "a0000000-0000-4000-8000-000000000002";
const token = "A".repeat(43), request = { headers: { cookie: `__Host-sg_operator_session=${token}` } };
const body = { metadata: { contractVersion: "2026-09-29.identity-v1", requestId: "a0000000-0000-4000-8000-000000000003", idempotencyKey: "lifecycle-idempotency-0001" },
  expectedLifecycleRevision: 0, intent: "pause" };

test("lifecycle routes forward only locators and strict request bodies to authenticated source service", async () => {
  const calls: unknown[] = [];
  const service = {
    read: async (...args: unknown[]) => { calls.push(["read", ...args]); return { projectId, lifecycleRevision: 0, intent: null, requestId: null, recordedAt: null }; },
    setIntent: async (...args: unknown[]) => { calls.push(["set", ...args]); return { projectId, lifecycleRevision: 1, intent: "pause_requested", requestId: body.metadata.requestId,
      recordedAt: "2026-10-04T00:00:00Z", changed: true, replayed: false, impactedTaskCount: 0, cancelledTaskCount: 0 }; },
    withdrawMaterial: async (...args: unknown[]) => { calls.push(["withdraw", ...args]); return { projectId, variantId, materialRevision: 1,
      requestId: body.metadata.requestId, changed: true, replayed: false, impactedTaskCount: 0, cancelledTaskCount: 0 }; },
  };
  const controller = new ProjectLifecycleController(service as never);
  await controller.read(projectId, request);
  await controller.setIntent(projectId, body, request, "csrf");
  const withdrawal = { metadata: body.metadata, expectedMaterialRevision: 1 };
  await controller.withdrawMaterial(projectId, variantId, withdrawal, request, "csrf");
  assert.deepEqual(calls[0], ["read", token, projectId]);
  assert.deepEqual(calls[1], ["set", token, "csrf", projectId, body]);
  assert.deepEqual(calls[2], ["withdraw", token, "csrf", projectId, variantId, withdrawal]);
});

test("lifecycle controller does not turn stale source errors into a receipt", async () => {
  const controller = new ProjectLifecycleController({
    read: async () => { throw new ProductTransactionError("FACT_VERSION_STALE", "Current facts changed"); },
    setIntent: async () => { throw new ProductTransactionError("FACT_VERSION_STALE", "Current facts changed"); },
    withdrawMaterial: async () => { throw new ProductTransactionError("FACT_VERSION_STALE", "Current facts changed"); },
  } as never);
  await assert.rejects(controller.setIntent(projectId, body, request, "csrf"));
  await assert.rejects(controller.withdrawMaterial(projectId, variantId, { metadata: body.metadata, expectedMaterialRevision: 1 }, request, "csrf"));
});
