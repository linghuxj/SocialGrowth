import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import { projectLifecycleIntentViewSchema, updateProjectLifecycleIntentRequestSchema, updateProjectLifecycleIntentResponseSchema,
  materialWithdrawalViewSchema, withdrawMaterialRequestSchema, withdrawMaterialResponseSchema } from "./project-lifecycle.js";

const id = "a0000000-0000-4000-8000-000000000001";
test("lifecycle intent projections and commands bind a versioned request receipt without claiming execution", () => {
  const empty = { projectId: id, lifecycleRevision: 0, intent: null, requestId: null, recordedAt: null };
  projectLifecycleIntentViewSchema.parse(empty);
  const body = { metadata: { contractVersion, requestId: id, idempotencyKey: "idempotency-lifecycle-001" }, expectedLifecycleRevision: 0, intent: "pause" };
  updateProjectLifecycleIntentRequestSchema.parse(body);
  const response = { projectId: id, lifecycleRevision: 1, intent: "pause_requested", requestId: body.metadata.requestId,
    recordedAt: "2026-10-04T00:00:00Z", changed: true, replayed: false, impactedTaskCount: 2, cancelledTaskCount: 0 };
  updateProjectLifecycleIntentResponseSchema.parse(response);
  updateProjectLifecycleIntentResponseSchema.parse({ ...response, changed: false, replayed: true });
  for (const patch of [{ intent: "paused" }, { physicalStop: true }, { requestKey: "secret" }, { lifecycleRevision: -1 }])
    assert.equal(projectLifecycleIntentViewSchema.safeParse({ ...empty, ...patch }).success, false);
  assert.equal(updateProjectLifecycleIntentRequestSchema.safeParse({ ...body, deviceId: id }).success, false);
});

test("material withdrawal is an internal terminal fact for one exact variant revision only", () => {
  const missing = { state: "not_withdrawn", materialRevision: null, requestId: null, recordedAt: null };
  materialWithdrawalViewSchema.parse(missing);
  materialWithdrawalViewSchema.parse({ state: "withdrawn", materialRevision: 3, requestId: id, recordedAt: "2026-10-04T00:00:00Z" });
  for (const bad of [
    { state: "not_withdrawn", materialRevision: 3, requestId: id, recordedAt: "2026-10-04T00:00:00Z" },
    { state: "withdrawn", materialRevision: null, requestId: null, recordedAt: null },
    { state: "deleted_from_platform", materialRevision: 3, requestId: id, recordedAt: "2026-10-04T00:00:00Z" },
  ]) assert.equal(materialWithdrawalViewSchema.safeParse(bad).success, false);
  withdrawMaterialRequestSchema.parse({ metadata: { contractVersion, requestId: id, idempotencyKey: "idempotency-withdrawal-001" }, expectedMaterialRevision: 3 });
  assert.equal(withdrawMaterialRequestSchema.safeParse({ metadata: { contractVersion, requestId: "x", idempotencyKey: "y" }, expectedMaterialRevision: 0 }).success, false);
  const response = { projectId: id, variantId: id, materialRevision: 3, requestId: id, changed: true, replayed: false, impactedTaskCount: 1, cancelledTaskCount: 1 };
  withdrawMaterialResponseSchema.parse(response);
  assert.equal(withdrawMaterialResponseSchema.safeParse({ ...response, platformDeletionAllowed: true }).success, false);
});
