import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { appendProjectCycle, evaluateProjectCycles, parseProjectCycles, ProjectCycleError, type CycleTaskFact, type ProjectCycle } from "./project-cycle-core.js";
const code = (c: string) => (e: unknown) => e instanceof ProjectCycleError && e.code === c;
function fixture() {
  const first: ProjectCycle = { cycleId: randomUUID(), projectId: randomUUID(), configVersion: 1, businessTimeZone: "UTC", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-08T00:00:00Z", trafficMinimum: 10 };
  const second: ProjectCycle = { ...first, cycleId: randomUUID(), configVersion: 2, businessTimeZone: "Asia/Shanghai", startsAt: "2026-09-08T08:00:00+08:00", endsAt: "2026-09-11T08:00:00+08:00" };
  const task = (patch: Partial<CycleTaskFact> = {}): CycleTaskFact => ({ taskId: randomUUID(), projectId: first.projectId, contentUnitId: randomUUID(), platform: "facebook", plannedCycleId: first.cycleId,
    trafficPath: "verified", trafficEvidenceId: randomUUID(), publicationState: "verified", publicationId: randomUUID(), publicationEvidenceId: randomUUID(), publishedAt: "2026-09-07T00:00:00Z", verifiedAt: "2026-09-09T00:00:00Z", ...patch });
  return { first, second, task };
}
test("next cycle connects the same instant under new configuration and never rewrites old minimum or boundaries", () => {
  const f = fixture(), input = [f.first], before = structuredClone(input), next = appendProjectCycle(input, f.second, f.first.cycleId.toUpperCase());
  assert.deepEqual(input, before); assert.equal(next.cycles[0]?.trafficMinimum, 10); assert.equal(next.cycles[1]?.businessTimeZone, "Asia/Shanghai");
  assert.deepEqual(appendProjectCycle(next.cycles, f.first, null), { cycles: next.cycles, changed: false });
  assert.throws(() => appendProjectCycle(next.cycles, { ...f.first, trafficMinimum: 8 }, null), code("CYCLE_ID_REUSED"));
});
test("runtime origin reset, gaps, overlaps, stale predecessor, wrong project and older config are rejected", () => {
  const f = fixture();
  for (const patch of [{ startsAt: "2026-09-09T00:00:00Z" }, { startsAt: "2026-09-07T00:00:00Z" }, { projectId: randomUUID() }, { configVersion: 0 }, { configVersion: 1 }]) assert.throws(() => appendProjectCycle([f.first], { ...f.second, ...patch }, f.first.cycleId), code(patch.configVersion === 0 ? "INPUT_INVALID" : "BOUNDARY_STALE"));
  assert.throws(() => appendProjectCycle([f.first], f.second, null), code("BOUNDARY_STALE"));
  assert.throws(() => parseProjectCycles([f.first, { ...f.second, startsAt: "2026-09-08T00:00:00.000001Z" }]), code("CORRUPT_CYCLES"));
});
test("late verification counts the original actual publication cycle, not the new verification cycle", () => {
  const f = fixture(), task = f.task(), old = evaluateProjectCycles([f.first, f.second], [task], "2026-09-08T00:00:00Z"), updated = evaluateProjectCycles([f.first, f.second], [task], "2026-09-10T00:00:00Z");
  assert.equal(old.reports[0]?.completedCount, 0); assert.equal(updated.reports[0]?.completedCount, 1); assert.equal(updated.reports[1]?.completedCount, 0);
  assert.deepEqual(old.pendingAttributionTaskIds, [task.taskId]); assert.equal(old.reports[0]?.deficit, 10); assert.equal(updated.reports[0]?.deficit, 9);
});
test("one FB and one YT task for the same content each count once; recovery/reorder duplicates never add", () => {
  const f = fixture(), fb = f.task(), yt = f.task({ contentUnitId: fb.contentUnitId, platform: "youtube" });
  const report = evaluateProjectCycles([f.first, f.second], [fb, { ...fb, taskId: fb.taskId.toUpperCase() }, yt, yt], "2026-09-10T00:00:00Z");
  assert.equal(report.reports[0]?.completedCount, 2); assert.equal(report.reports[0]?.plannedCount, 2); assert.equal(report.reports[0]?.deficit, 8);
  assert.equal(report.reports[1]?.trafficMinimum, 10); assert.equal(report.reports[1]?.deficit, 10);
});
test("left-closed right-open attribution preserves microseconds and equivalent offsets", () => {
  const f = fixture(), atStart = f.task({ publishedAt: f.first.startsAt }), beforeEnd = f.task({ publishedAt: "2026-09-07T23:59:59.999999999999Z" }), atEnd = f.task({ publishedAt: f.second.startsAt });
  const report = evaluateProjectCycles([f.first, f.second], [atStart, beforeEnd, atEnd], "2026-09-10T00:00:00Z");
  assert.equal(report.reports[0]?.completedCount, 2); assert.deepEqual(report.reports[1]?.completedTaskIds, [atEnd.taskId]);
});
test("planned quantity, failed/pending publication and unknown/invalid traffic path never imply completed traffic tasks", () => {
  const f = fixture(), pending = f.task({ publicationState: "pending", publicationEvidenceId: null, verifiedAt: null }), failed = f.task({ publicationState: "failed", publicationEvidenceId: null, verifiedAt: null }), unknownPath = f.task({ trafficPath: "unknown", trafficEvidenceId: null });
  const report = evaluateProjectCycles([f.first, f.second], [pending, failed, unknownPath], "2026-09-10T00:00:00Z");
  assert.equal(report.reports[0]?.plannedCount, 2); assert.equal(report.reports[0]?.completedCount, 0); assert.equal(report.reports[0]?.deficit, 10);
  assert.deepEqual(report.reports[0]?.failedTaskIds, [failed.taskId]); assert.deepEqual(report.reports[0]?.verificationPendingTaskIds, [pending.taskId]); assert.deepEqual(report.reports[0]?.trafficPathPendingTaskIds, [unknownPath.taskId]);
});
test("unknown actual publication time is pending attribution and cannot be guessed from planned cycle", () => {
  const f = fixture(), task = f.task({ publishedAt: null }), report = evaluateProjectCycles([f.first, f.second], [task], "2026-09-10T00:00:00Z");
  assert.equal(report.reports[0]?.plannedCount, 1); assert.equal(report.reports[0]?.completedCount, 0); assert.deepEqual(report.pendingAttributionTaskIds, [task.taskId]);
});
test("outside-known-cycle publications retain pending attribution; current/future deficits are provisional, not failed cycles", () => {
  const f = fixture(), before = f.task({ publishedAt: "2026-08-30T00:00:00Z" }), later = f.task({ publishedAt: "2026-09-12T00:00:00Z", verifiedAt: "2026-09-13T00:00:00Z" });
  const report = evaluateProjectCycles([f.first, f.second], [before, later], "2026-09-04T00:00:00Z");
  assert.equal(report.reports[0]?.evaluationStage, "in_progress"); assert.equal(report.reports[1]?.evaluationStage, "not_started");
  assert.deepEqual(report.pendingAttributionTaskIds, [before.taskId, later.taskId].sort()); assert.equal(report.reports[0]?.completedCount, 0);
});
test("corrupt task identities, reused publication or content quota and cross-project attribution fail closed", () => {
  const f = fixture(), row = f.task();
  for (const tasks of [[row, { ...row, publishedAt: "2026-09-06T00:00:00Z" }], [row, f.task({ publicationId: row.publicationId })], [row, f.task({ contentUnitId: row.contentUnitId })], [f.task({ projectId: randomUUID() })], [f.task({ plannedCycleId: randomUUID() })], [{ ...row, permissionGranted: true }]]) assert.throws(() => evaluateProjectCycles([f.first, f.second], tasks, "2026-09-10T00:00:00Z"), code("CORRUPT_TASKS"));
});
test("bad timestamps, missing proof shape or invented verified flags cannot be projected", () => {
  const f = fixture();
  for (const patch of [{ publicationEvidenceId: null }, { trafficEvidenceId: null }, { verifiedAt: null }, { publishedAt: "2026-09-10T00:00:00Z" }, { publishedAt: "0000-01-01T00:00:00Z" }]) assert.throws(() => evaluateProjectCycles([f.first], [f.task(patch)], "2026-09-10T00:00:00Z"), code("CORRUPT_TASKS"));
  assert.throws(() => evaluateProjectCycles([f.first], [], "0000-01-01T00:00:00Z"), code("INPUT_INVALID"));
});
test("report calculation does not mutate evidence, issue tasks, carry deficits or grant comparison/execution", () => {
  const f = fixture(), cycles = [f.first, f.second], tasks = [f.task()], before = structuredClone({ cycles, tasks });
  const report = evaluateProjectCycles(cycles, tasks, "2026-09-10T00:00:00Z"); assert.deepEqual({ cycles, tasks }, before);
  assert.equal(report.reports[1]?.trafficMinimum, 10); assert.ok(!("permissionGranted" in report)); assert.ok(!("comparable" in report));
});
