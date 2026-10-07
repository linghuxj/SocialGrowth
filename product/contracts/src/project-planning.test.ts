import assert from "node:assert/strict";
import test from "node:test";
import { emptyProjectPlanningInputs, projectPlanningInputsSchema, projectPlanningDraftViewSchema } from "./project-planning.js";
import { firstBatchContractRegistry } from "./registry.js";
import { planningTimeZoneKeys } from "./planning-time-zone-keys.js";
const projectId = "00000000-0000-4000-8000-000000000001";
test("all four planning contracts preserve exact-case canonical keys and declared aliases, reject case variants before hashing", () => {
  const shapes = (zone: string | null) => {
    const inputs = { ...emptyProjectPlanningInputs(), businessTimeZone: zone };
    const draft = { projectId, projectFactVersion: 1, draftVersion: 1, inputs, status: "unapproved_draft", savedAt: "2026-09-30T00:00:00Z", savedByOperatorId: projectId };
    return { projectPlanningInputs: inputs, projectPlanningDraftView: draft, projectPlanningResponse: { draft },
      saveProjectPlanningRequest: { metadata: { contractVersion: "2026-09-29.identity-v1", requestId: "timezone-request", idempotencyKey: "timezone-command" }, projectId, expectedProjectVersion: 0, expectedDraftVersion: 0, inputs } };
  };
  for (const zone of [...planningTimeZoneKeys, null]) {
    for (const [name, value] of Object.entries(shapes(zone))) {
      const result = firstBatchContractRegistry[name as keyof typeof firstBatchContractRegistry].safeParse(value);
      assert.equal(result.success, true, `${name}/${zone}`);
      assert.deepEqual(result.data, value); // No hidden normalization of the key.
    }
  }
  for (const zone of ["asia/shanghai", "ASIA/SHANGHAI", "Asia/shanghai", "america/new_york", "Etc/utc", "US/eastern", "Asia/Unknown", "GMT+8", " UTC "]) {
    for (const [name, value] of Object.entries(shapes(zone))) assert.equal(firstBatchContractRegistry[name as keyof typeof firstBatchContractRegistry].safeParse(value).success, false, `${name}/${zone}`);
  }
  for (const key of ["UTC", "Asia/Shanghai", "Asia/Kolkata", "Asia/Calcutta", "US/Eastern", "Etc/UTC", "Etc/GMT+8"]) assert.ok(planningTimeZoneKeys.some(zone => zone === key));
});
test("incomplete planning stays explicitly unapproved with no guessed countries, time zone or numerical defaults", () => {
  const inputs = emptyProjectPlanningInputs();
  assert.deepEqual(projectPlanningInputsSchema.parse(inputs), inputs);
  assert.equal(projectPlanningDraftViewSchema.safeParse({ projectId, projectFactVersion: 0, draftVersion: 0, inputs, status: "unapproved_draft", savedAt: null, savedByOperatorId: null }).success, true);
  for (const patch of [{ approved: true }, { postOpeningPriority: "eligibility_only" }, { targetCountries: [" padded "] }, { targetLanguages: ["西班牙语", "西班牙语"] },
    { contentForms: ["instagram_video"] }, { contentForms: ["youtube_shorts", "youtube_shorts"] }, { businessTimeZone: "Asia/Unknown" }, { businessTimeZone: "GMT+8" },
    { trafficMinimumPerCycle: -1 }, { reviewIntervalDays: 0 }, { maxPublicationsPerDay: 1.1 }, { tailObservationDays: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal(projectPlanningInputsSchema.safeParse({ ...inputs, ...patch }).success, false);
});
test("exact publication windows and save provenance reject fabricated authority", () => {
  const inputs = { ...emptyProjectPlanningInputs(), businessTimeZone: "Asia/Shanghai", trafficMinimumPerCycle: 0,
    publishingWindow: { startsAt: "2026-09-30T00:00:00.1234567890Z", endsAt: "2026-09-30T00:00:00.1234567891Z" } };
  assert.equal(projectPlanningInputsSchema.safeParse(inputs).success, true);
  assert.equal(projectPlanningInputsSchema.safeParse({ ...inputs, publishingWindow: { ...inputs.publishingWindow, endsAt: inputs.publishingWindow.startsAt } }).success, false);
  const view = { projectId, projectFactVersion: 1, draftVersion: 1, inputs, status: "unapproved_draft", savedAt: "2026-09-30T00:00:00Z", savedByOperatorId: projectId };
  assert.equal(projectPlanningDraftViewSchema.safeParse(view).success, true);
  for (const patch of [{ status: "approved" }, { savedAt: null }, { draftVersion: 0 }, { permissionGranted: true }]) assert.equal(projectPlanningDraftViewSchema.safeParse({ ...view, ...patch }).success, false);
});
