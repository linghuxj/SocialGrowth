import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import { projectCycleConfigurationReadResponseSchema, projectCycleConfigurationCommandReadResponseSchema,
  saveProjectCycleConfigurationReceiptSchema, saveProjectCycleConfigurationRequestSchema } from "./project-cycle-next-config.js";

const uuidA = "11111111-1111-4111-8111-111111111111", uuidB = "22222222-2222-4222-8222-222222222222";
const metadata = { contractVersion, requestId: "cycle-config-request-01", idempotencyKey: "cycle-config-command-0001" };
const config = { configurationRevision: 1, basedOnCycleId: uuidA, businessTimeZone: "Asia/Shanghai", reviewIntervalDays: 14,
  trafficMinimumPerCycle: 2, effectiveStartsAt: "2026-10-11T00:00:00.000000Z", projectedEndsAt: "2026-10-25T00:00:00.000000Z",
  confirmedByOperatorId: uuidB, confirmedAt: "2026-10-04T00:00:00.000000Z", requestId: metadata.requestId };
const receipt = { projectId: uuidA, outcome: "confirmed", configurationRevision: 1, nextConfiguration: config, reason: null,
  requestId: metadata.requestId, replayed: false, recordedAt: config.confirmedAt, executionAllowed: false, publicationAllowed: false } as const;

test("next config DTO separates operator confirmation from materialized cycle and strict command continuation", () => {
  const read = projectCycleConfigurationReadResponseSchema.parse({ contractVersion, projectId: uuidA, observedAt: config.confirmedAt,
    configurationRevision: 1, currentCycle: { cycleId: uuidA, cycleNumber: 1, configVersion: 3, businessTimeZone: "UTC",
      reviewIntervalDays: 7, trafficMinimumPerCycle: 1, startsAt: "2026-10-04T00:00:00.000000Z", endsAt: config.effectiveStartsAt,
      recordedAt: config.confirmedAt, origin: { kind: "initial_direction_approval", approvalId: uuidB } },
    nextConfiguration: { ...config, application: { state: "pending", materializedCycleId: null, reason: null } }, nextCycle: null, executionAllowed: false, publicationAllowed: false });
  assert.equal(read.nextConfiguration?.effectiveStartsAt, read.currentCycle?.endsAt);
  assert.equal(read.nextCycle, null);
  assert.equal(projectCycleConfigurationCommandReadResponseSchema.parse({ status: "found", projectId: uuidA,
    requestId: receipt.requestId, receipt }).receipt?.replayed, false);
  assert.equal(projectCycleConfigurationCommandReadResponseSchema.parse({ status: "not_found", projectId: uuidA,
    requestId: null, receipt: null }).status, "not_found");
  assert.equal(saveProjectCycleConfigurationReceiptSchema.safeParse({ ...receipt, outcome: "unresolved" }).success, false);
});

test("next config command cannot supply cycle boundaries or a replacement initial start", () => {
  const valid = { metadata, expectedConfigurationRevision: 0, businessTimeZone: "Asia/Shanghai", reviewIntervalDays: 14, trafficMinimumPerCycle: 2 };
  assert.equal(saveProjectCycleConfigurationRequestSchema.safeParse(valid).success, true);
  assert.equal(saveProjectCycleConfigurationRequestSchema.safeParse({ ...valid, firstCycleStartsAt: config.effectiveStartsAt }).success, false);
  assert.equal(saveProjectCycleConfigurationRequestSchema.safeParse({ ...valid, startsAt: config.effectiveStartsAt }).success, false);
});
