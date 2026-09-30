import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion, createProjectRequestSchema, projectBasicsSchema, projectViewSchema } from "./index.js";
const basics = { name: "首期自营", kind: "company_owned", customerName: null, ownerOperatorId: null, notificationEmail: null };
test("project metadata cannot infer missing inputs, managed customers or approval authority", () => {
  assert.deepEqual(projectBasicsSchema.parse(basics), basics);
  for (const patch of [{ name: " padded " }, { name: "line\nname" }, { kind: "client_managed" }, { customerName: "customer" }, { notificationEmail: "wrong" }, { approved: true }]) {
    assert.equal(projectBasicsSchema.safeParse({ ...basics, ...patch }).success, false);
  }
  const input = { metadata: { contractVersion, requestId: "request-project-contract", idempotencyKey: "project-contract-idempotency" }, basics };
  assert.equal(createProjectRequestSchema.safeParse({ ...input, actorOperatorId: "00000000-0000-4000-8000-000000000001" }).success, false);
});
test("project projections reject invented readiness, running state and inconsistent update clocks", () => {
  const value = { ...basics, projectId: "00000000-0000-4000-8000-000000000001", createdByOperatorId: "00000000-0000-4000-8000-000000000002", factVersion: 0,
    phase: "preparing", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" };
  assert.equal(projectViewSchema.safeParse(value).success, true);
  for (const patch of [{ phase: "running" }, { ready: true }, { kind: "client_managed" }, { updatedAt: "2026-09-29T00:00:00Z" }]) assert.equal(projectViewSchema.safeParse({ ...value, ...patch }).success, false);
});
