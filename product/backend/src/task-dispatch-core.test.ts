import assert from "node:assert/strict";
import test from "node:test";
import { taskProtocolVersion } from "@socialgrowth/product-contracts";
import { classifyTaskObservation, createTaskRecheckNotice, TaskDispatchError } from "./task-dispatch-core.js";
const id = "a0000000-0000-4000-8000-000000000001", other = "a0000000-0000-4000-8000-000000000002";
const scope = { taskId: id, taskRevision: 1, projectId: id, taskAttemptId: id, deviceId: id, identityId: id };
const task = { protocolVersion: taskProtocolVersion, ...scope, kind: "publish_content", platform: "facebook", form: "facebook_video", arrangementRevision: 1, projectVersion: 1, assignmentId: id, assignmentVersion: 1,
  approvalId: id, approvalVersion: 1, contentUnitId: id, variantId: id, materialRevision: 1, languageTag: "en-us", objects: [{ objectId: id, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" }], title: "Explicit title", caption: "Explicit caption",
  scheduledAt: "2026-10-01T00:00:00Z", window: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T00:00:01Z" }, recovery: { roundId: id, maxAttempts: 2, maxElapsedMs: 300000 } };
const observation = { protocolVersion: taskProtocolVersion, ...scope, sourceId: id, sourceEventId: id, occurredAt: task.scheduledAt, receivedAt: task.scheduledAt, engineState: "completed", publicationState: "not_submitted", platformContentId: null, evidenceIds: [] };
test("task notice keeps original task revision/attempt scope and carries no files, captions or action authority", () => {
  const before = structuredClone(task), notice = createTaskRecheckNotice(task, other);
  assert.deepEqual(notice, { protocolVersion: taskProtocolVersion, messageId: other, ...scope, purpose: "recheck_central_task", executionAllowed: false }); assert.deepEqual(task, before);
  assert.throws(() => createTaskRecheckNotice(task, "not-id"), e => e instanceof TaskDispatchError && e.code === "INPUT_INVALID");
});
test("all engine states with unknown submission only verify original attempt and never resubmit or release quota", () => {
  for (const engineState of ["running", "completed", "interrupted", "failed"]) {
    const result = classifyTaskObservation(task, { ...observation, engineState, publicationState: "submission_unknown" });
    assert.equal(result.handling, "verify_original_submission"); assert.equal(result.taskAttemptId, id); assert.equal(result.executionAllowed, false); assert.equal(result.publicationAllowed, false); assert.equal(result.quotaReleaseAllowed, false);
  }
  assert.equal(classifyTaskObservation(task, observation).handling, "recheck_current_task");
  for (const publicationState of ["reported_published", "reported_not_published"]) assert.equal(classifyTaskObservation(task, { ...observation, publicationState, platformContentId: publicationState === "reported_published" ? "platform-id" : null, evidenceIds: [id] }).handling, "verify_reported_evidence");
});
test("mismatched attempt/device/project/identity/task/revision is rejected, not reassigned to new execution", () => {
  for (const key of ["taskId", "projectId", "taskAttemptId", "deviceId", "identityId"] as const) assert.throws(() => classifyTaskObservation(task, { ...observation, [key]: other }), e => e instanceof TaskDispatchError && e.code === "SCOPE_MISMATCH");
  assert.throws(() => classifyTaskObservation(task, { ...observation, taskRevision: 2 }), e => e instanceof TaskDispatchError && e.code === "SCOPE_MISMATCH");
  assert.equal(classifyTaskObservation(task, { ...observation, deviceId: id.toUpperCase() }).taskId, id);
  assert.throws(() => classifyTaskObservation(task, { ...observation, publicationState: "published_verified" }), e => e instanceof TaskDispatchError && e.code === "INPUT_INVALID");
});
