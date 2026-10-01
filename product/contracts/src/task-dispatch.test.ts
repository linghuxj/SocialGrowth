import assert from "node:assert/strict";
import test from "node:test";
import { centralPublicationTaskSchema, taskDispatchNoticeSchema, taskExecutionObservationSchema, taskProtocolVersion } from "./task-dispatch.js";
const id = "a0000000-0000-4000-8000-000000000001", id2 = "a0000000-0000-4000-8000-000000000002";
const scope = { taskId: id, taskRevision: 1, projectId: id, taskAttemptId: id, deviceId: id, identityId: id };
const object = { objectId: id, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" };
const task = { protocolVersion: taskProtocolVersion, ...scope, kind: "publish_content", platform: "facebook", form: "facebook_video", arrangementRevision: 1, projectVersion: 1,
  assignmentId: id, assignmentVersion: 1, approvalId: id, approvalVersion: 1, contentUnitId: id, variantId: id, materialRevision: 1, languageTag: "en-us", objects: [object], title: "Explicit title", caption: "Explicit caption\nsecond line",
  scheduledAt: "2026-10-01T00:00:00.123456789123Z", window: { startsAt: "2026-10-01T00:00:00.123456789123Z", endsAt: "2026-10-01T00:00:01Z" }, recovery: { roundId: id, maxAttempts: 2, maxElapsedMs: 300000 } };
test("central task strict version and references reject missing scope, shell, locators and caller privileges", () => {
  centralPublicationTaskSchema.parse(task);
  for (const patch of [{ taskId: undefined }, { taskAttemptId: undefined }, { protocolVersion: "old" }, { taskRevision: 0 }, { assignmentVersion: true }, { materialRevision: 1001 },
    { shell: "arbitrary command" }, { executionAllowed: true }, { accessToken: "secret" }, { objects: [{ ...object, key: "private" }] }, { languageTag: "en-US" },
    { title: " explicit" }, { caption: "contains\u0000nul" }, { recovery: { ...task.recovery, maxElapsedMs: 0 } }]) assert.equal(centralPublicationTaskSchema.safeParse({ ...task, ...patch }).success, false);
});
test("four forms bind platform, ordered unique files and video/image metadata without proving actual media", () => {
  for (const form of ["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"] as const) centralPublicationTaskSchema.parse({ ...task, form, platform: form.startsWith("facebook_") ? "facebook" : "youtube", objects: form === "facebook_image_text" ? [{ ...object, contentType: "image/png" }, { ...object, objectId: id2, contentType: "image/jpeg" }] : task.objects });
  for (const patch of [{ platform: "youtube" }, { objects: [] }, { objects: [object, { ...object, objectId: id2 }] }, { objects: [{ ...object, contentType: "image/png" }] },
    { form: "facebook_image_text", objects: [object] }, { form: "facebook_image_text", objects: [{ ...object, contentType: "image/png" }, { ...object, objectId: id.toUpperCase(), contentType: "image/png" }] }]) assert.equal(centralPublicationTaskSchema.safeParse({ ...task, ...patch }).success, false);
});
test("task schedule uses exact inclusive start/exclusive end and long fractional offset comparison", () => {
  centralPublicationTaskSchema.parse({ ...task, scheduledAt: "2026-10-01T08:00:00.123456789123+08:00" });
  for (const patch of [{ scheduledAt: "2026-10-01T00:00:00.123456789122Z" }, { scheduledAt: task.window.endsAt }, { window: { startsAt: task.window.endsAt, endsAt: task.window.startsAt } },
    { scheduledAt: "0000-01-01T00:00:00Z" }]) assert.equal(centralPublicationTaskSchema.safeParse({ ...task, ...patch }).success, false);
});
test("queue notice is minimal recheck reference not executable contract, action permit or publishing success", () => {
  const notice = { protocolVersion: taskProtocolVersion, messageId: id, ...scope, purpose: "recheck_central_task", executionAllowed: false }; taskDispatchNoticeSchema.parse(notice);
  for (const patch of [{ purpose: "publish" }, { executionAllowed: true }, { objects: task.objects }, { caption: "private caption" }, { permit: id }, { status: "completed" }]) assert.equal(taskDispatchNoticeSchema.safeParse({ ...notice, ...patch }).success, false);
});
test("engine completion and claimed platform result remain independent with strict source observation facts", () => {
  const observation = { protocolVersion: taskProtocolVersion, ...scope, sourceId: id, sourceEventId: id, occurredAt: task.scheduledAt, receivedAt: task.scheduledAt, engineState: "completed", publicationState: "not_submitted", platformContentId: null, evidenceIds: [] };
  taskExecutionObservationSchema.parse(observation);
  taskExecutionObservationSchema.parse({ ...observation, engineState: "failed", publicationState: "submission_unknown" });
  taskExecutionObservationSchema.parse({ ...observation, publicationState: "reported_published", platformContentId: "explicit-platform-id", evidenceIds: [id] });
  taskExecutionObservationSchema.parse({ ...observation, publicationState: "reported_not_published", evidenceIds: [id] });
  for (const patch of [{ occurredAt: "2026-10-01T00:00:00.123456789124Z" }, { publicationState: "published_verified" }, { publicationState: "reported_published" },
    { publicationState: "reported_not_published" }, { platformContentId: "unrelated" }, { evidenceIds: [id, id.toUpperCase()] }, { secret: "private" }]) assert.equal(taskExecutionObservationSchema.safeParse({ ...observation, ...patch }).success, false);
});
