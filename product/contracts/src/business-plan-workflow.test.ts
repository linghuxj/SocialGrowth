import assert from "node:assert/strict";
import test from "node:test";
import { businessPlanWorkflowResponseSchema, type BusinessPlanWorkflowResponse } from "./business-plan-workflow.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
type Task = BusinessPlanWorkflowResponse["tasks"][number];
const blocked = (): Task => ({
  taskId, taskRevision: 1, planId: "33333333-3333-4333-8333-333333333333", planRevision: 1,
  contentUnitId: "44444444-4444-4444-8444-444444444444", variantId: "55555555-5555-4555-8555-555555555555",
  materialRevision: 1, expectedFiles: [], identityId: "66666666-6666-4666-8666-666666666666", platform: "facebook",
  form: "facebook_video", scheduledAt: "2026-10-05T00:00:00Z", attempt: null, operation: null,
  workflow: { state: "blocked", claimId: null, leaseUntil: null, blockers: ["executor_unconnected"], submissionState: "not_started", verifiedResult: null },
  assistanceTodoId: null, recheckStatus: "not_requested", recheckBlockers: [],
});
const response = (task: Task = blocked()): BusinessPlanWorkflowResponse => ({ projectId, checkedAt: "2026-10-05T00:00:00Z",
  ports: { executor: "unconnected", proofVerifier: "unconnected" }, tasks: [task] });

test("logical reservation and unconnected ports remain blocked, never operations", () => {
  const task = blocked();
  task.attempt = { taskAttemptId: "77777777-7777-4777-8777-777777777777", attemptNumber: 1, state: "pending_current_checks" };
  assert.equal(businessPlanWorkflowResponseSchema.parse(response(task)).tasks[0]?.operation, null);
});

test("rejects success-shaped projections without operation, proof result, and matching submission state", () => {
  const base = blocked();
  const invalid: Task[] = [
    { ...base, workflow: { ...base.workflow, state: "verified", submissionState: "verified_published", verifiedResult: { resultId: "r", verifiedAt: "2026-10-05T00:00:00Z" } } },
    { ...base, operation: { operationId: "op", state: "verified" }, workflow: { ...base.workflow, state: "verified", submissionState: "verified_published", verifiedResult: null } },
    { ...base, operation: { operationId: "op", state: "verified" }, workflow: { ...base.workflow, state: "verified", submissionState: "unknown", verifiedResult: { resultId: "r", verifiedAt: "2026-10-05T00:00:00Z" } } },
    { ...base, workflow: { ...base.workflow, state: "running", submissionState: "in_progress" } },
    { ...base, operation: { operationId: "op", state: "running" }, workflow: { ...base.workflow, state: "submission_unknown", submissionState: "unknown" } },
    { ...base, workflow: { ...base.workflow, claimId: "88888888-8888-4888-8888-888888888888" } },
    { ...base, assistanceTodoId: "99999999-9999-4999-8999-999999999999", recheckStatus: "verified_recovered" },
    { ...base, recheckStatus: "pending" },
  ];
  for (const [index, item] of invalid.entries()) assert.equal(businessPlanWorkflowResponseSchema.safeParse(response(item)).success, false, `invalid projection ${index}`);
});

test("accepts only internally consistent trusted terminal result projections", () => {
  const task = { ...blocked(), operation: { operationId: "op-123", state: "verified" as const },
    workflow: { state: "verified" as const, claimId: null, leaseUntil: null, blockers: [], submissionState: "verified_published" as const,
      verifiedResult: { resultId: "trusted-report-123", verifiedAt: "2026-10-05T00:00:00Z" } } };
  assert.equal(businessPlanWorkflowResponseSchema.parse(response(task)).tasks[0]?.workflow.state, "verified");
});

test("rejects duplicate task identities in one project projection", () => {
  const item = blocked();
  assert.throws(() => businessPlanWorkflowResponseSchema.parse({ ...response(item), tasks: [item, { ...item }] }));
});
