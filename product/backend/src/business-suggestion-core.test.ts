import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { BusinessSuggestionError, checkBusinessSuggestion, type BusinessSuggestionContext } from "./business-suggestion-core.js";
import { reserveContentQuota, type ContentQuotaSnapshot } from "./content-quota-core.js";
const now = "2026-10-01T00:00:00.000001Z";
const code = (c: string) => (e: unknown) => e instanceof BusinessSuggestionError && e.code === c && e.message === c && !e.cause;
function fixture() {
  const projectId = randomUUID(), contentUnitId = randomUUID(), variantId = randomUUID(), identityId = randomUUID(), taskId = randomUUID(), factId = randomUUID();
  const quota: ContentQuotaSnapshot = { units: [{ contentUnitId, projectId, mediaKind: "video", seriesId: null, episodeNumber: null }],
    variants: [{ variantId, contentUnitId }], identities: [{ identityId, projectId, platform: "facebook" }], slots: [], seriesBindings: [] };
  const context: BusinessSuggestionContext = { projectId, factSetId: randomUUID(), factSetVersion: 1, observedAt: now, purpose: "advisory", projectState: "active",
    approval: { approvalId: randomUUID(), projectVersion: 1, proposalId: randomUUID() },
    approvedWindow: { startsAt: now, endsAt: "2026-10-02T00:00:00Z" }, maxPublicationsPerDay: 3, businessTimeZone: "Asia/Shanghai", approvedForms: ["facebook_video", "youtube_shorts", "youtube_video"], approvedLanguages: ["en"],
    facts: [{ factId, version: 1, kind: "material", availability: "available" }], materials: [{ contentUnitId, variantId, materialVersion: 1, language: "en", state: "candidate" }], tasks: [], quota };
  const common = { suggestionId: randomUUID(), projectId, factSetId: context.factSetId, factSetVersion: 1, approval: structuredClone(context.approval),
    basis: [{ factId, version: 1 }], explanation: "Synthetic explanation, not an AI decision", limitations: ["Fixture only"] };
  const publication = { taskId, contentUnitId, variantId, identityId, form: "facebook_video" as const, scheduledAt: "2026-10-01T01:00:00Z", title: "Synthetic title", caption: "Synthetic caption" };
  const proposal = { ...common, decision: "adjust" as const, changes: [{ kind: "schedule" as const, publication }] };
  return { context, common, proposal, publication, quota };
}
function existing() {
  const f = fixture(), { taskId, contentUnitId, variantId, identityId, form, scheduledAt } = f.publication;
  f.context.quota = reserveContentQuota(f.quota, { taskId, contentUnitId, variantId, identityId, platform: "facebook" }).snapshot;
  f.context.tasks = [{ taskId, contentUnitId, variantId, identityId, form, scheduledAt, version: 1, state: "not_started" }]; return f;
}
test("bounded advisory copies input and tentative quota without creating tasks, permits or AI claims", () => {
  const f = fixture(), old = structuredClone(f), result = checkBusinessSuggestion(f.context, f.proposal, now);
  assert.deepEqual(f, old); assert.equal(result.stage, "checked_advisory_only"); assert.equal(result.tentativeQuota.slots.length, 1);
  assert.ok(result.pendingChecks.includes("atomic_task_revision")); assert.ok(result.pendingChecks.includes("copy_factuality"));
  assert.equal("actionPermission" in result, false); result.suggestion.explanation = "Changed copy"; assert.equal(f.proposal.explanation, old.proposal.explanation);
});
test("maintain never duplicates tasks or resets existing unknown/published slots", () => {
  const f = existing(), q = f.context.quota as ContentQuotaSnapshot; q.slots[0]!.state = "submission_unknown"; f.context.tasks[0]!.state = "submission_unknown";
  const result = checkBusinessSuggestion(f.context, { ...f.common, decision: "maintain", taskIds: [f.publication.taskId] }, now);
  assert.deepEqual(result.tentativeQuota, q); assert.equal(result.suggestion.decision, "maintain");
});
test("initial or direction-change confirmation is only a proposal and cannot contain changes", () => {
  const f = fixture(); f.context.approval = null;
  const common = { ...f.common, approval: null };
  const result = checkBusinessSuggestion(f.context, { ...common, decision: "requires_operator_confirmation", proposedDirection: "Operator must confirm scope" }, now);
  assert.equal(result.tentativeQuota.slots.length, 0);
  assert.throws(() => checkBusinessSuggestion(f.context, { ...common, decision: "adjust", changes: f.proposal.changes }, now), code("APPROVAL_REQUIRED"));
  assert.throws(() => checkBusinessSuggestion(f.context, { ...common, decision: "requires_operator_confirmation", proposedDirection: "New direction", changes: f.proposal.changes }, now), code("INPUT_INVALID"));
});
test("stale fact set, project, approval goal/direction and referenced fact versions are refused", () => {
  const f = fixture();
  for (const patch of [{ projectId: randomUUID() }, { factSetId: randomUUID() }, { factSetVersion: 2 }, { approval: { ...f.common.approval!, proposalId: randomUUID() } },
    { approval: { ...f.common.approval!, projectVersion: 2 } }, { basis: [{ factId: randomUUID(), version: 1 }] }, { basis: [{ factId: f.common.basis[0]!.factId, version: 2 }] }]) {
    assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, ...patch }, now), code("FACTS_STALE"));
  }
});
test("paused/ended projects and empty approval inputs are not treated as unrestricted", () => {
  const f = fixture();
  for (const patch of [{ projectState: "paused" }, { projectState: "ended" }, { approvedWindow: null }, { approvedForms: [] }, { approvedLanguages: [] }]) {
    assert.throws(() => checkBusinessSuggestion({ ...f.context, ...patch }, f.proposal, now), code("OUT_OF_SCOPE"));
  }
});
test("preparing projects have an explicit candidate-only mode and cannot mutate existing task arrangements", () => {
  const f = fixture();
  f.context.projectState = "preparing"; f.context.purpose = "plan_candidate";
  const result = checkBusinessSuggestion(f.context, f.proposal, now);
  assert.equal(result.stage, "checked_advisory_only"); assert.equal(result.tentativeQuota.slots.length, 1);
  const { title: _title, caption: _caption, ...taskFields } = f.publication;
  const existingTask = { ...taskFields, version: 1, state: "not_started" as const };
  f.context.tasks = [existingTask];
  f.context.quota = reserveContentQuota(f.quota, { taskId: existingTask.taskId, contentUnitId: existingTask.contentUnitId, variantId: existingTask.variantId, identityId: existingTask.identityId, platform: "facebook" }).snapshot;
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, changes: [{ kind: "reschedule", taskId: existingTask.taskId, expectedVersion: 1, scheduledAt: now, reason: "fixture" }] }, now), code("TASK_NOT_MUTABLE"));
});
test("daily plan limit uses approved project timezone across DST without conflating quota slots", () => {
  const f = fixture();
  f.context.projectState = "preparing"; f.context.purpose = "plan_candidate";
  f.context.businessTimeZone = "America/Los_Angeles"; f.context.maxPublicationsPerDay = 1;
  f.context.observedAt = "2026-03-01T00:00:00Z";
  f.context.approvedWindow = { startsAt: "2026-03-01T00:00:00Z", endsAt: "2026-04-01T00:00:00Z" };
  const oldUnit = randomUUID(), oldVariant = randomUUID(), oldTask = randomUUID();
  f.quota.units.push({ contentUnitId: oldUnit, projectId: f.context.projectId, mediaKind: "video", seriesId: null, episodeNumber: null });
  f.quota.variants.push({ variantId: oldVariant, contentUnitId: oldUnit });
  f.context.materials.push({ contentUnitId: oldUnit, variantId: oldVariant, materialVersion: 1, language: "en", state: "candidate" });
  f.context.tasks.push({ taskId: oldTask, version: 1, state: "not_started", contentUnitId: oldUnit, variantId: oldVariant,
    identityId: f.publication.identityId, form: "facebook_video", scheduledAt: "2026-03-08T09:30:00Z" });
  f.context.quota = reserveContentQuota(f.quota, { taskId: oldTask, contentUnitId: oldUnit, variantId: oldVariant, identityId: f.publication.identityId, platform: "facebook" }).snapshot;
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, changes: [{ kind: "schedule", publication: { ...f.publication, scheduledAt: "2026-03-08T10:30:00Z" } }] }, "2026-03-01T00:00:00Z"), code("QUOTA_CONFLICT"));
  checkBusinessSuggestion(f.context, { ...f.proposal, changes: [{ kind: "schedule", publication: { ...f.publication, scheduledAt: "2026-03-09T07:01:00Z" } }] }, "2026-03-01T00:00:00Z");
  assert.throws(() => checkBusinessSuggestion({ ...f.context, businessTimeZone: null }, f.proposal, "2026-03-01T00:00:00Z"), code("DATA_INSUFFICIENT"));
});
test("missing/delayed fact is not zero; insufficient decision keeps original task and quota", () => {
  const f = existing(); f.context.facts[0]!.availability = "missing";
  assert.throws(() => checkBusinessSuggestion(f.context, f.proposal, now), code("DATA_INSUFFICIENT"));
  const result = checkBusinessSuggestion(f.context, { ...f.common, decision: "insufficient_data", missingFactIds: [f.common.basis[0]!.factId], taskIds: [f.publication.taskId] }, now);
  assert.deepEqual(result.tentativeQuota, f.context.quota);
  f.context.facts[0]!.availability = "available";
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.common, decision: "insufficient_data", missingFactIds: [f.common.basis[0]!.factId], taskIds: [] }, now), code("FACTS_STALE"));
});
test("precise window is left-closed/right-open with offsets and sub-millisecond comparisons", () => {
  const f = fixture();
  for (const scheduledAt of [now, "2026-10-01T01:00:00.000001+01:00", "2026-10-01T23:59:59.999999999Z"]) {
    checkBusinessSuggestion(f.context, { ...f.proposal, changes: [{ kind: "schedule", publication: { ...f.publication, scheduledAt } }] }, now);
  }
  for (const scheduledAt of ["2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "2026-10-02T01:00:00+01:00"]) {
    assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, changes: [{ kind: "schedule", publication: { ...f.publication, scheduledAt } }] }, now), code("OUT_OF_SCOPE"));
  }
});
test("withdrawn, corrected, wrong language/form or variant material cannot enter new plan", () => {
  const f = fixture();
  for (const patch of [{ state: "withdrawn" }, { state: "needs_correction" }, { language: "fr" }]) {
    assert.throws(() => checkBusinessSuggestion({ ...f.context, materials: [{ ...f.context.materials[0]!, ...patch }] }, f.proposal, now), code("OUT_OF_SCOPE"));
  }
  for (const patch of [{ form: "facebook_image_text" }, { variantId: randomUUID() }]) assert.throws(() => checkBusinessSuggestion(f.context,
    { ...f.proposal, changes: [{ kind: "schedule", publication: { ...f.publication, ...patch } }] }, now), code("OUT_OF_SCOPE"));
});
test("duplicate same-platform language and YT form switching cannot allocate another slot", () => {
  const f = fixture(), other = { ...f.publication, taskId: randomUUID() };
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, changes: [...f.proposal.changes, { kind: "schedule", publication: other }] }, now), code("QUOTA_CONFLICT"));
  f.quota.identities[0]!.platform = "youtube"; f.publication.form = "youtube_shorts" as typeof f.publication.form;
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, changes: [{ kind: "schedule", publication: f.publication },
    { kind: "schedule", publication: { ...f.publication, taskId: randomUUID(), form: "youtube_video" } }] }, now), code("QUOTA_CONFLICT"));
});
test("FB and YT candidates may use separate platform slots but no executable dependency grant", () => {
  const f = fixture(), ytIdentity = randomUUID(); f.quota.identities.push({ identityId: ytIdentity, platform: "youtube", projectId: f.context.projectId });
  const result = checkBusinessSuggestion(f.context, { ...f.proposal, changes: [...f.proposal.changes,
    { kind: "schedule", publication: { ...f.publication, taskId: randomUUID(), identityId: ytIdentity, form: "youtube_shorts" } }] }, now);
  assert.equal(result.tentativeQuota.slots.length, 2); assert.ok(result.pendingChecks.includes("series_execution_dependency"));
});
test("cancel/reschedule only not-started exact-version tasks, cancel never frees quota", () => {
  const f = existing();
  const result = checkBusinessSuggestion(f.context, { ...f.common, decision: "adjust", changes: [{ kind: "cancel", taskId: f.publication.taskId, expectedVersion: 1, reason: "Changed plan" }] }, now);
  assert.deepEqual(result.tentativeQuota, f.context.quota); assert.equal(f.context.tasks[0]!.state, "not_started");
  for (const state of ["in_platform_flow", "submission_unknown", "verified", "cancelled"]) {
    assert.throws(() => checkBusinessSuggestion({ ...f.context, tasks: [{ ...f.context.tasks[0]!, state }] }, { ...f.common, decision: "adjust",
      changes: [{ kind: "reschedule", taskId: f.publication.taskId, expectedVersion: 1, scheduledAt: f.publication.scheduledAt, reason: "Changed plan" }] }, now), code("TASK_NOT_MUTABLE"));
  }
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.common, decision: "adjust", changes: [{ kind: "cancel", taskId: f.publication.taskId, expectedVersion: 2, reason: "Stale" }] }, now), code("FACTS_STALE"));
});
test("unknown quota cannot be hidden behind nominal not-started state", () => {
  const f = existing(); (f.context.quota as ContentQuotaSnapshot).slots[0]!.state = "submission_unknown";
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.common, decision: "adjust", changes: [{ kind: "cancel", taskId: f.publication.taskId, expectedVersion: 1, reason: "Cannot hide submission" }] }, now), code("TASK_NOT_MUTABLE"));
});
test("rescheduling rechecks material and approved form/language, cancellation remains an advisory only", () => {
  const f = existing(), changes = [{ kind: "reschedule", taskId: f.publication.taskId, expectedVersion: 1, scheduledAt: f.publication.scheduledAt, reason: "Move within window" }];
  checkBusinessSuggestion(f.context, { ...f.common, decision: "adjust", changes }, now);
  for (const patch of [{ state: "withdrawn" }, { state: "needs_correction" }, { language: "fr" }]) {
    const context = { ...f.context, materials: [{ ...f.context.materials[0]!, ...patch }] };
    assert.throws(() => checkBusinessSuggestion(context, { ...f.common, decision: "adjust", changes }, now), code("OUT_OF_SCOPE"));
    checkBusinessSuggestion(context, { ...f.common, decision: "adjust", changes: [{ kind: "cancel", taskId: f.publication.taskId, expectedVersion: 1, reason: "Withdrawn material" }] }, now);
  }
  assert.throws(() => checkBusinessSuggestion({ ...f.context, approvedForms: ["youtube_video"] }, { ...f.common, decision: "adjust", changes }, now), code("OUT_OF_SCOPE"));
});
test("cancel plus replacement cannot recycle quota or mutate supplied facts on failure", () => {
  const f = existing(), before = structuredClone(f.context);
  assert.throws(() => checkBusinessSuggestion(f.context, { ...f.common, decision: "adjust", changes: [
    { kind: "cancel", taskId: f.publication.taskId, expectedVersion: 1, reason: "Cancel" }, { kind: "schedule", publication: { ...f.publication, taskId: randomUUID() } }] }, now), code("QUOTA_CONFLICT"));
  assert.deepEqual(f.context, before);
});
test("unknown fields, duplicate references/actions and corrupt or cross-project registries reject without echo", () => {
  const f = fixture();
  for (const patch of [{ approved: true }, { publicationSucceeded: true }, { pause: false }, { recoveryBudget: 100 }, { secret: "synthetic-no-secret" },
    { basis: [...f.common.basis, ...f.common.basis] }, { changes: [...f.proposal.changes, ...f.proposal.changes] }]) {
    assert.throws(() => checkBusinessSuggestion(f.context, { ...f.proposal, ...patch }, now), code("INPUT_INVALID"));
  }
  for (const patch of [{ facts: [...f.context.facts, ...f.context.facts] }, { approvedForms: ["facebook_video", "facebook_video"] }, { quota: {} }]) {
    assert.throws(() => checkBusinessSuggestion({ ...f.context, ...patch }, f.proposal, now), code("FACTS_INVALID"));
  }
  f.quota.identities[0]!.projectId = randomUUID(); assert.throws(() => checkBusinessSuggestion(f.context, f.proposal, now), code("FACTS_INVALID"));
});
test("UUID normalization precedes references; future observation, invalid years and reversed windows fail safely", () => {
  const f = fixture(); checkBusinessSuggestion(f.context, { ...f.proposal, projectId: f.context.projectId.toUpperCase() }, now);
  assert.throws(() => checkBusinessSuggestion({ ...f.context, observedAt: "2026-10-01T00:00:00.000002Z" }, f.proposal, now), code("FACTS_STALE"));
  assert.throws(() => checkBusinessSuggestion(f.context, f.proposal, "0000-10-01T00:00:00Z"), code("INPUT_INVALID"));
  assert.throws(() => checkBusinessSuggestion({ ...f.context, approvedWindow: { startsAt: "2026-10-02T00:00:00Z", endsAt: now } }, f.proposal, now), code("FACTS_INVALID"));
});
test("partial task projection cannot relabel an old reserved/unknown/published slot as a new schedule", () => {
  for (const state of ["reserved", "submission_unknown", "published_verified"] as const) {
    const f = fixture(), { taskId, contentUnitId, variantId, identityId } = f.publication;
    const quota = reserveContentQuota(f.quota, { taskId, contentUnitId, variantId, identityId, platform: "facebook" }).snapshot;
    quota.slots[0]!.state = state; quota.slots[0]!.evidenceId = state === "published_verified" ? randomUUID() : null; f.context.quota = quota;
    assert.equal(f.context.tasks.length, 0); const before = structuredClone(f.context);
    assert.throws(() => checkBusinessSuggestion(f.context, f.proposal, now), code("QUOTA_CONFLICT")); assert.deepEqual(f.context, before);
  }
});
