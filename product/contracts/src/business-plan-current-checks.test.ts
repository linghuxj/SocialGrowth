import test from "node:test";
import assert from "node:assert/strict";
import { businessPlanCurrentChecksResponseSchema } from "./business-plan-current-checks.js";

const id = "123e4567-e89b-42d3-a456-426614174000";
const valid = {
  projectId: id, checkedAt: "2026-10-04T10:00:00.000Z",
  plan: { planId: id, revision: 1, projectVersion: 3, approvalId: id },
  tasks: [{ taskId: id, taskRevision: 1, planId: id, planRevision: 1, variantId: id, expectedMaterialRevision: 2,
    identityId: id, platform: "youtube", form: "youtube_shorts", scheduledAt: "2026-10-05T10:00:00.000Z",
    expectedFiles: [{ objectId: id, sha256: "a".repeat(64), bytes: 128, contentType: "video/mp4" }],
    currentFiles: [{ objectId: id, sha256: "a".repeat(64), bytes: 128, contentType: "video/mp4" }],
    current: { projectVersion: 4, approvalId: id, materialRevision: 3, materialStatus: "candidate", materialCandidateAllowed: true,
      reservedDeviceId: id, associationCurrent: true, installationGeneration: "4", controlIntent: "active", controlStop: "not_requested",
      participationCurrent: true, networkAdmitted: true },
    impactReferences: [{ impactRevision: 1, reason: "material_revision_changed", observedProjectVersion: 4,
      observedMaterialRevision: 3, recordedAt: "2026-10-04T09:00:00.000Z" }],
    blockers: ["material_revision_changed", "action_inspector_unavailable"] }],
  executionAllowed: false, publicationAllowed: false,
};

test("current checks projection is strict and never conveys execution authority", () => {
  assert.equal(businessPlanCurrentChecksResponseSchema.parse(valid).executionAllowed, false);
  for (const patch of [
    { executionAllowed: true },
    { tasks: [{ ...valid.tasks[0], current: { ...valid.tasks[0].current, controlIntent: "ready" } }] },
    { tasks: [{ ...valid.tasks[0], impactReferences: [{ ...valid.tasks[0].impactReferences[0], observedMaterialRevision: null }] }] },
    { tasks: [{ ...valid.tasks[0], blockers: [] }] },
    { tasks: [{ ...valid.tasks[0], currentFiles: [{ ...valid.tasks[0].currentFiles[0], sha256: "b".repeat(64) }], blockers: ["action_inspector_unavailable"] }] },
    { tasks: [{ ...valid.tasks[0], expectedFiles: [], blockers: ["action_inspector_unavailable"] }] },
    { tasks: [{ ...valid.tasks[0], currentFiles: [], blockers: ["material_revision_changed", "action_inspector_unavailable"] }] },
    { tasks: [{ ...valid.tasks[0], expectedFiles: [...valid.tasks[0].expectedFiles, { ...valid.tasks[0].expectedFiles[0], objectId: "123e4567-e89b-42d3-a456-426614173999" }] }] },
  ]) assert.equal(businessPlanCurrentChecksResponseSchema.safeParse({ ...valid, ...patch }).success, false);
});
