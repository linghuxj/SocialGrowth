import assert from "node:assert/strict";
import test from "node:test";
import { emptyProjectPlanningInputs, projectPlanningInputsSchema, projectPlanningDraftViewSchema } from "./project-planning.js";
const projectId = "00000000-0000-4000-8000-000000000001";
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
