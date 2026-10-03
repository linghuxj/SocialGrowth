import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { projectFeedbackResponseSchema } from "./metric-feedback.js";

const projectId = randomUUID();
const snapshot = {
  snapshotId: randomUUID(), sourceId: randomUUID(), sourceReportId: randomUUID(), definitionId: randomUUID(), projectId,
  identityId: randomUUID(), platform: "facebook", subject: { kind: "account" }, revision: 1, replacesSnapshotId: null,
  measurement: "cumulative", value: "0", availability: "available", missingReason: null, sourceTimeZone: "America/Los_Angeles",
  coverage: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z" },
  statisticsCutoffAt: "2026-10-02T00:00:00Z", collectedAt: "2026-10-02T00:01:00Z",
} as const;
const base = { projectId, observedAt: "2026-10-02T00:02:00Z", contentAttribution: { state: "unknown", reason: "verified_task_publication_source_missing" } } as const;

test("feedback contract distinguishes measured zero from absent and unknown reports", () => {
  const available = projectFeedbackResponseSchema.parse({ ...base, sourceState: "available", sourceReasonCode: null, metrics: [snapshot] });
  assert.equal(available.metrics[0]!.value, "0");
  assert.equal(projectFeedbackResponseSchema.parse({ ...base, sourceState: "unknown", sourceReasonCode: "no_authoritative_report", metrics: [] }).metrics.length, 0);
  assert.equal(projectFeedbackResponseSchema.safeParse({ ...base, sourceState: "available", sourceReasonCode: null, metrics: [] }).success, false);
  assert.equal(projectFeedbackResponseSchema.safeParse({ ...base, sourceState: "not_configured", sourceReasonCode: "source_not_configured", metrics: [snapshot] }).success, false);
});

test("feedback projection is strict and rejects cross-project rows", () => {
  const otherProject = { ...snapshot, projectId: randomUUID() };
  assert.equal(projectFeedbackResponseSchema.safeParse({ ...base, sourceState: "available", sourceReasonCode: null, metrics: [otherProject] }).success, false);
  assert.equal(projectFeedbackResponseSchema.safeParse({ ...base, sourceState: "unknown", sourceReasonCode: "no_authoritative_report", metrics: [], executionAllowed: true }).success, false);
});
