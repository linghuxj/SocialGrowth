import test from "node:test";
import assert from "node:assert/strict";
import { arrangeBusinessPlanRequestSchema, arrangeBusinessPlanResponseSchema, businessPlanCurrentViewSchema } from "./business-plan-task.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const approvalId = "22222222-2222-4222-8222-222222222222";
const metadata = { contractVersion: "2026-09-29.identity-v1", requestId: "request-123", idempotencyKey: "plan-request-key-0001" };
const scope = { projectVersion: 3, approvalId, window: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" } };
const view = { projectId, currentScope: scope, plan: null, tasks: [], executionAllowed: false, publicationAllowed: false };

test("business plan contract permits an explicit empty plan and fixed closed permissions", () => {
  assert.equal(businessPlanCurrentViewSchema.safeParse(view).success, true);
  assert.equal(arrangeBusinessPlanResponseSchema.safeParse({ ...view, outcome: "direction_confirmation_required", requestId: "request-33333333-3333-4333-8333-333333333333" }).success, true);
  for (const invalid of [
    { ...view, executionAllowed: true },
    { ...view, publicationAllowed: true },
    { ...view, tasks: [{ taskId: projectId }] },
    { ...view, plan: { planId: projectId, revision: 1, projectVersion: 4, approvalId, window: scope.window, scopeState: "current", recordedAt: "2026-10-04T00:00:00Z" } },
  ]) assert.equal(businessPlanCurrentViewSchema.safeParse(invalid).success, false);
});

test("arrangement request rejects client-authored task/model fields and requires an expected scope", () => {
  const request = { metadata, expectedProjectVersion: 3, expectedApprovalId: approvalId, expectedPlanRevision: 0 };
  assert.equal(arrangeBusinessPlanRequestSchema.safeParse(request).success, true);
  for (const extra of [{ plan: {} }, { task: {} }, { modelOutput: "client text" }, { executionAllowed: true }]) {
    assert.equal(arrangeBusinessPlanRequestSchema.safeParse({ ...request, ...extra }).success, false);
  }
  assert.equal(arrangeBusinessPlanRequestSchema.safeParse({ ...request, expectedPlanRevision: -1 }).success, false);
});
