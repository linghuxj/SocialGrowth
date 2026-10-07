import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { classifyTaskImpact, TaskImpactError, type TaskImpactSnapshot } from "./task-impact-core.js";
import type { ContentQuotaSnapshot } from "./content-quota-core.js";
const now = "2026-10-01T00:00:00.000001Z";
const states = ["not_started", "in_platform_flow", "submission_unknown", "verified", "cancelled"] as const;
const code = (c: string) => (e: unknown) => e instanceof TaskImpactError && e.code === c && e.message === c && !e.cause;
function fixture() {
  const projectId = randomUUID(), identityId = randomUUID();
  const quota: ContentQuotaSnapshot = { units: [], variants: [], identities: [{ projectId, identityId, platform: "facebook" }], slots: [], seriesBindings: [] };
  const s: TaskImpactSnapshot = { projectId, projectVersion: 4, phase: "paused", materials: [], tasks: [], quota };
  for (const state of states) {
    const contentUnitId = randomUUID(), variantId = randomUUID(), taskId = randomUUID();
    quota.units.push({ contentUnitId, projectId, mediaKind: "video", seriesId: null, episodeNumber: null }); quota.variants.push({ contentUnitId, variantId });
    quota.slots.push({ contentUnitId, variantId, identityId, taskId, platform: "facebook", state: state === "verified" ? "published_verified" : state === "submission_unknown" ? "submission_unknown" : "reserved",
      evidenceId: state === "verified" ? randomUUID() : null });
    s.materials.push({ variantId, version: 3, state: "candidate" });
    s.tasks.push({ taskId, version: 7, contentUnitId, variantId, materialVersion: 3, identityId, platform: "facebook", state, approval: "valid",
      window: { startsAt: "2026-09-30T00:00:00Z", endsAt: "2026-10-02T00:00:00Z" } });
  }
  const common = { changeId: randomUUID(), projectId, expectedProjectVersion: 4 };
  return { s, quota, common };
}
test("five states under pause/end/resume classify 15 directions without any mutation or permission", () => {
  const f = fixture(), before = structuredClone(f.s);
  const expected = { project_paused: ["hold_unstarted_publication", "request_safe_stop_and_inspect", "verify_original_submission", "preserve_verified_history", "preserve_cancelled_history"],
    project_ended: ["cancel_unsubmitted_preserve_quota", "request_safe_stop_and_inspect", "verify_original_submission", "preserve_verified_history", "preserve_cancelled_history"],
    project_resumed: ["recheck_original_task", "request_safe_stop_and_inspect", "verify_original_submission", "preserve_verified_history", "preserve_cancelled_history"] };
  for (const kind of ["project_paused", "project_ended", "project_resumed"] as const) {
    const result = classifyTaskImpact(f.s, { ...f.common, kind }, now); assert.deepEqual(result.decisions.map(v => v.decision), expected[kind]);
    assert.deepEqual(result.unchangedQuota, f.quota); assert.equal(result.stage, "impact_advisory_only");
    assert.equal(result.executionAllowed, false); assert.equal(result.deletionAllowed, false); assert.equal(result.resourceReleaseAllowed, false);
    assert.ok(result.pendingChecks.includes("actual_safe_stop_or_submission_verification"));
  }
  assert.deepEqual(f.s, before);
});
test("material correction/withdrawal impact only the selected variant in all five states", () => {
  for (let i = 0; i < states.length; i++) {
    const f = fixture(), target = f.s.tasks[i]!, before = structuredClone(f.s);
    for (const kind of ["material_corrected", "material_withdrawn"] as const) {
      const event = { ...f.common, kind, variantId: target.variantId, expectedMaterialVersion: 3, ...(kind === "material_corrected" ? { newMaterialVersion: 4 } : {}) };
      const result = classifyTaskImpact(f.s, event, now); assert.equal(result.decisions.length, 1); assert.equal(result.decisions[0]!.taskId, target.taskId);
      const first = kind === "material_corrected" ? "pause_for_material_recheck" : "cancel_unsubmitted_preserve_quota";
      assert.equal(result.decisions[0]!.decision, i === 0 ? first : ["", "request_safe_stop_and_inspect", "verify_original_submission", "preserve_verified_history", "preserve_cancelled_history"][i]);
      assert.deepEqual(result.unchangedQuota, f.quota);
    }
    assert.deepEqual(f.s, before);
  }
});
test("correction does not silently replace an older task material version or approved window", () => {
  const f = fixture(), t = f.s.tasks[0]!; t.materialVersion = 1;
  const result = classifyTaskImpact(f.s, { ...f.common, kind: "material_corrected", variantId: t.variantId, expectedMaterialVersion: 3, newMaterialVersion: 4 }, now);
  assert.equal(result.decisions[0]!.originalMaterialVersion, 1); assert.deepEqual(result.decisions[0]!.originalWindow, t.window);
  assert.equal(result.decisions[0]!.expectedTaskVersion, 7); assert.equal(t.materialVersion, 1);
});
test("resume requires valid current material/approval and leaves expired invalid tasks for operator", () => {
  const f = fixture();
  for (const patch of [{ approval: "revoked" }, { approval: "unknown" }, { materialVersion: 2 }, { window: { startsAt: "2026-09-30T00:00:00Z", endsAt: now } }]) {
    const s = { ...f.s, tasks: [{ ...f.s.tasks[0]!, ...patch }, ...f.s.tasks.slice(1)] };
    const result = classifyTaskImpact(s, { ...f.common, kind: "project_resumed" }, now);
    assert.equal(result.decisions[0]!.decision, "operator_attention"); assert.ok(result.decisions[0]!.reasons.length > 0);
  }
  for (const state of ["withdrawn", "needs_correction"]) {
    const s = { ...f.s, materials: [{ ...f.s.materials[0]!, state }, ...f.s.materials.slice(1)] };
    assert.equal(classifyTaskImpact(s, { ...f.common, kind: "project_resumed" }, now).decisions[0]!.decision, "operator_attention");
  }
});
test("ended project cannot ordinary-resume or re-enable cancelled tasks", () => {
  const f = fixture();
  assert.throws(() => classifyTaskImpact({ ...f.s, phase: "ended" }, { ...f.common, kind: "project_resumed" }, now), code("PROJECT_ENDED"));
  for (const phase of ["draft", "active"]) assert.throws(() => classifyTaskImpact({ ...f.s, phase }, { ...f.common, kind: "project_resumed" }, now), code("RESUME_NOT_APPLICABLE"));
  assert.equal(classifyTaskImpact(f.s, { ...f.common, kind: "project_resumed" }, now).decisions[4]!.decision, "preserve_cancelled_history");
});
test("correction of withdrawn material never silently reapproves or restores unsubmitted task", () => {
  const f = fixture(); f.s.materials[0]!.state = "withdrawn";
  const result = classifyTaskImpact(f.s, { ...f.common, kind: "material_corrected", variantId: f.s.tasks[0]!.variantId, expectedMaterialVersion: 3, newMaterialVersion: 4 }, now);
  assert.equal(result.decisions[0]!.decision, "cancel_unsubmitted_preserve_quota"); assert.equal(f.s.materials[0]!.state, "withdrawn");
});
test("unknown submissions remain independent verification under every event, never cancel or resubmit", () => {
  const f = fixture(), t = f.s.tasks[2]!;
  for (const event of [{ ...f.common, kind: "project_paused" }, { ...f.common, kind: "project_ended" }, { ...f.common, kind: "project_resumed" },
    { ...f.common, kind: "material_withdrawn", variantId: t.variantId, expectedMaterialVersion: 3 },
    { ...f.common, kind: "material_corrected", variantId: t.variantId, expectedMaterialVersion: 3, newMaterialVersion: 4 }]) {
    const result = classifyTaskImpact(f.s, event, now), decision = result.decisions.find(v => v.taskId === t.taskId)!;
    assert.equal(decision.decision, "verify_original_submission"); assert.ok(decision.reasons.includes("result_unknown_never_resubmit"));
    assert.equal(result.deletionAllowed, false); assert.equal(result.resourceReleaseAllowed, false);
  }
});
test("project end preserves verified history and original quota with no deletion or automatic release", () => {
  const f = fixture(), r = classifyTaskImpact(f.s, { ...f.common, kind: "project_ended" }, now);
  assert.equal(r.decisions[3]!.decision, "preserve_verified_history"); assert.deepEqual(r.unchangedQuota, f.quota);
  assert.equal(f.s.phase, "paused"); r.unchangedQuota.slots[3]!.evidenceId = randomUUID(); assert.notEqual(r.unchangedQuota.slots[3]!.evidenceId, f.quota.slots[3]!.evidenceId);
});
test("version/project/material references stale or non-advancing corrections reject safely", () => {
  const f = fixture(), event = { ...f.common, kind: "material_corrected", variantId: f.s.tasks[0]!.variantId, expectedMaterialVersion: 3, newMaterialVersion: 4 };
  for (const patch of [{ projectId: randomUUID() }, { expectedProjectVersion: 3 }, { variantId: randomUUID() }, { expectedMaterialVersion: 2 }]) assert.throws(() => classifyTaskImpact(f.s, { ...event, ...patch }, now), code("FACTS_STALE"));
  for (const newMaterialVersion of [2, 3]) assert.throws(() => classifyTaskImpact(f.s, { ...event, newMaterialVersion }, now), code("INPUT_INVALID"));
});
test("complete task projection is required; omitted slot cannot be silently left out", () => {
  const f = fixture();
  assert.throws(() => classifyTaskImpact({ ...f.s, tasks: f.s.tasks.slice(1) }, { ...f.common, kind: "project_ended" }, now), code("FACTS_INVALID"));
  const q = structuredClone(f.quota); q.slots.pop(); assert.throws(() => classifyTaskImpact({ ...f.s, quota: q }, { ...f.common, kind: "project_ended" }, now), code("FACTS_INVALID"));
});
test("15 state/slot combinations only accept consistent actual-state input shape", () => {
  let count = 0;
  for (let i = 0; i < states.length; i++) for (const state of ["reserved", "submission_unknown", "published_verified"] as const) {
    const f = fixture(); f.quota.slots[i]!.state = state; f.quota.slots[i]!.evidenceId = state === "published_verified" ? randomUUID() : null;
    const expected = i === 3 ? "published_verified" : i === 2 ? "submission_unknown" : "reserved";
    if (state === expected) classifyTaskImpact(f.s, { ...f.common, kind: "project_ended" }, now);
    else assert.throws(() => classifyTaskImpact(f.s, { ...f.common, kind: "project_ended" }, now), code("FACTS_INVALID")); count++;
  }
  assert.equal(count, 15);
});
test("strict event cannot carry confirmed/deletion/stop/publication authority or target replacement", () => {
  const f = fixture();
  for (const patch of [{ operatorConfirmed: true }, { actuallyStopped: true }, { deletePlatformContent: true }, { newIdentityId: randomUUID() }, { permit: randomUUID() }]) {
    assert.throws(() => classifyTaskImpact(f.s, { ...f.common, kind: "project_ended", ...patch }, now), code("INPUT_INVALID"));
  }
  assert.throws(() => classifyTaskImpact(f.s, { ...f.common, kind: "delete_publication" }, now), code("INPUT_INVALID"));
});
test("bad registered references, duplicate task/material, cross-project or future material version close", () => {
  const f = fixture();
  for (const patch of [{ tasks: [f.s.tasks[0]!, ...f.s.tasks] }, { materials: [f.s.materials[0]!, ...f.s.materials] },
    { tasks: [{ ...f.s.tasks[0]!, materialVersion: 4 }, ...f.s.tasks.slice(1)] }, { quota: {} },
    { tasks: [{ ...f.s.tasks[0]!, identityId: randomUUID() }, ...f.s.tasks.slice(1)] }]) assert.throws(() => classifyTaskImpact({ ...f.s, ...patch }, { ...f.common, kind: "project_ended" }, now), code("FACTS_INVALID"));
  f.quota.identities[0]!.projectId = randomUUID(); assert.throws(() => classifyTaskImpact(f.s, { ...f.common, kind: "project_ended" }, now), code("FACTS_INVALID"));
});
test("resume deadline uses precise fractions/equivalent offsets; future-window tasks only request recheck", () => {
  const f = fixture(); f.s.tasks[0]!.window.endsAt = "2026-10-01T01:00:00.000002+01:00";
  assert.equal(classifyTaskImpact(f.s, { ...f.common, kind: "project_resumed" }, now).decisions[0]!.decision, "recheck_original_task");
  assert.equal(classifyTaskImpact(f.s, { ...f.common, kind: "project_resumed" }, "2026-10-01T00:00:00.000002Z").decisions[0]!.decision, "operator_attention");
  f.s.tasks[0]!.window = { startsAt: "2026-10-01T01:00:00Z", endsAt: "2026-10-02T00:00:00Z" };
  const result = classifyTaskImpact(f.s, { ...f.common, kind: "project_resumed" }, now); assert.equal(result.decisions[0]!.decision, "recheck_original_task"); assert.equal(result.executionAllowed, false);
  assert.throws(() => classifyTaskImpact(f.s, { ...f.common, kind: "project_resumed" }, "0000-01-01T00:00:00Z"), code("INPUT_INVALID"));
});
test("variant withdrawal does not expand to another language/platform of the same content", () => {
  const f = fixture(), unit = f.s.tasks[0]!.contentUnitId, ytIdentity = randomUUID();
  f.quota.identities.push({ identityId: ytIdentity, projectId: f.s.projectId, platform: "youtube" });
  Object.assign(f.s.tasks[1]!, { contentUnitId: unit, identityId: ytIdentity, platform: "youtube" });
  Object.assign(f.quota.slots[1]!, { contentUnitId: unit, identityId: ytIdentity, platform: "youtube" }); f.quota.variants[1]!.contentUnitId = unit;
  const result = classifyTaskImpact(f.s, { ...f.common, kind: "material_withdrawn", variantId: f.s.tasks[0]!.variantId, expectedMaterialVersion: 3 }, now);
  assert.equal(result.decisions.length, 1); assert.equal(result.decisions[0]!.taskId, f.s.tasks[0]!.taskId); assert.deepEqual(result.unchangedQuota, f.quota);
});
