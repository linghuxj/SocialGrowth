import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  beginConnectionMaintenance, completeConnectionMaintenance, ConnectionMaintenanceError,
  createConnectionMaintenanceRound, evaluateJointRecoveryBudgets, observeConnectionMaintenance,
  parseConnectionMaintenanceRound, requireConnectionMaintenanceHuman, type ConnectionMaintenanceRound,
} from "./connection-maintenance-budget.js";
import { beginTaskRecovery, completeTaskRecovery, createTaskRecoveryRound } from "./task-recovery-budget.js";
const now = "2026-10-01T01:00:00Z";
const at = (ms: number) => new Date(Date.parse(now) + ms).toISOString();
const scope = () => ({ deviceId: randomUUID(), installationId: randomUUID(), installationGeneration: "9007199254740993", enrollmentId: randomUUID(),
  enrollmentGeneration: "1", ownershipVersion: "1", roundId: randomUUID() });
const endpoint = () => ({ sourceEpoch: randomUUID(), reportId: randomUUID(), sequence: "9007199254740993", endpointRevision: 1 });
const create = () => createConnectionMaintenanceRound(scope(), { maxAttempts: 3, maxElapsedMs: 120_000 }, now);
const begin = (r = create(), t = now) => beginConnectionMaintenance(r, r.scope, randomUUID(), endpoint(), t);
const finish = (r: ConnectionMaintenanceRound, t: string, outcome: "failed" | "unknown" | "verified_connected" = "failed") => {
  const a = r.attempts.at(-1)!; return completeConnectionMaintenance(r, { scope: r.scope, recoveryId: a.recoveryId, endpoint: a.endpoint, outcome }, t);
};
function rejects(fn: () => unknown, code: ConnectionMaintenanceError["code"]) {
  assert.throws(fn, (e: unknown) => e instanceof ConnectionMaintenanceError && e.code === code && e.message === code && !e.cause);
}

test("maintenance has explicit limits and no fictional task/default production policy", () => {
  const r = create(); assert.equal("taskId" in r.scope, false); assert.equal("taskAttemptId" in r.scope, false);
  for (const limits of [undefined, null, { maxAttempts: 0, maxElapsedMs: 1 }, { maxAttempts: 101, maxElapsedMs: 1 },
    { maxAttempts: 3, maxElapsedMs: 0 }, { maxAttempts: 3, maxElapsedMs: 120_000, resetTaskBudget: true }]) {
    rejects(() => createConnectionMaintenanceRound(scope(), limits, now), "INPUT_INVALID");
  }
  rejects(() => createConnectionMaintenanceRound({ ...scope(), taskId: randomUUID() }, r.limits, now), "INPUT_INVALID");
  const result = evaluateJointRecoveryBudgets(r, null, now);
  assert.equal(result.task, null); assert.equal(result.taskBudgetAvailable, null); assert.equal(result.budgetsAvailable, true);
  assert.equal("actionPermission" in result, false); assert.equal("resumeTask" in result, false);
});

test("changing endpoints/source epochs and serialized restart cannot reset maintenance attempts", () => {
  let r = finish(begin(), at(10));
  r = parseConnectionMaintenanceRound(JSON.parse(JSON.stringify(r)));
  r = finish(begin(r, at(20)), at(30)); r = finish(begin(r, at(40)), at(50));
  assert.equal(r.attemptsUsed, 3); assert.equal(r.elapsedMs, 30); assert.equal(r.phase, "human_required"); assert.equal(r.reason, "attempt_limit");
  assert.equal(new Set(r.attempts.map(a => a.endpoint.sourceEpoch)).size, 3);
  rejects(() => begin(r, at(60)), "AUTOMATIC_RECOVERY_BLOCKED");
});

test("success preserves attempts/time; exhausted after success refuses another recovery without reset", () => {
  let r = begin(); r = finish(r, at(10), "verified_connected");
  assert.equal(r.phase, "available"); assert.equal(r.attemptsUsed, 1); assert.equal(r.elapsedMs, 10);
  r = finish(begin(r, at(20)), at(30), "verified_connected");
  r = finish(begin(r, at(40)), at(50), "verified_connected");
  assert.equal(r.phase, "available"); assert.equal(evaluateJointRecoveryBudgets(r, null, at(60)).budgetsAvailable, false);
  const blocked = begin(r, at(60)); assert.equal(blocked.phase, "human_required"); assert.equal(blocked.reason, "attempt_limit");
  assert.equal(blocked.attemptsUsed, 3);
});

test("unknown connection call remains occupied across restart and late ended receipt never auto-reopens human gate", () => {
  const r = finish(begin(), at(10), "unknown"), saved = parseConnectionMaintenanceRound(JSON.parse(JSON.stringify(r)));
  const aged = observeConnectionMaintenance(saved, at(150_000));
  assert.equal(aged.elapsedMs, 150_000); assert.equal(aged.attempts[0]!.endedAt, null);
  rejects(() => begin(aged, at(150_001)), "BUSY");
  const ended = finish(aged, at(150_002), "verified_connected");
  assert.equal(ended.phase, "human_required"); assert.equal(ended.reason, "call_unknown");
  assert.equal(ended.attempts[0]!.endedAt, at(150_002));
});

test("cumulative active time charges waits/disconnection but not idle gap, either ceiling blocks", () => {
  const first = finish(begin(), at(60_000)), second = begin(first, at(180_000));
  assert.equal(second.elapsedMs, 60_000);
  const aged = observeConnectionMaintenance(second, at(240_000));
  assert.equal(aged.elapsedMs, 120_000); assert.equal(aged.phase, "human_required"); assert.equal(aged.reason, "time_limit");
  assert.equal(aged.attemptsUsed, 2); assert.equal(aged.attempts[1]!.endedAt, null);
  const exactSuccess = finish(begin(), at(120_000), "verified_connected");
  assert.equal(exactSuccess.phase, "available"); assert.equal(evaluateJointRecoveryBudgets(exactSuccess, null, at(120_000)).budgetsAvailable, false);
  assert.equal(finish(begin(), at(120_001), "verified_connected").phase, "human_required");
});

test("submillisecond ceiling is charged once per attempt, not per polling or JS truncated fraction", () => {
  const base = createConnectionMaintenanceRound(scope(), { maxAttempts: 3, maxElapsedMs: 100 }, "0099-01-01T00:00:00Z");
  const running = begin(base, "0099-01-01T00:00:00Z");
  const one = observeConnectionMaintenance(running, "0099-01-01T00:00:00.000000001Z");
  const two = observeConnectionMaintenance(one, "0099-01-01T00:00:00.000000002Z");
  assert.equal(one.elapsedMs, 1); assert.equal(two.elapsedMs, 1);
  assert.equal(finish(two, "0099-01-01T01:00:00.000000003+01:00", "verified_connected").elapsedMs, 1);
  const long = observeConnectionMaintenance(running, `0099-01-01T00:00:00.${"0".repeat(60)}1Z`);
  assert.equal(long.elapsedMs, 1);
});

test("current task remaining budget and independent maintenance budget must both allow a candidate", () => {
  const m = create(), taskScope = { deviceId: m.scope.deviceId, taskId: randomUUID(), taskAttemptId: randomUUID(), roundId: randomUUID() };
  let task = createTaskRecoveryRound(taskScope, now);
  assert.equal(evaluateJointRecoveryBudgets(m, task, now).budgetsAvailable, true);
  for (const [start, end] of [[0, 10], [20, 30]]) {
    task = beginTaskRecovery(task, task.scope, randomUUID(), "network", at(start!), "pre_submission");
    task = completeTaskRecovery(task, { scope: task.scope, recoveryId: task.recoveries.at(-1)!.recoveryId, outcome: "verified_recovered" }, at(end!));
  }
  const gated = evaluateJointRecoveryBudgets(m, task, at(40));
  assert.equal(gated.maintenanceBudgetAvailable, true); assert.equal(gated.taskBudgetAvailable, false); assert.equal(gated.budgetsAvailable, false);
  assert.equal(gated.task!.attemptsUsed, 2); assert.equal(gated.task!.elapsedMs, 20);
  const exhausted = finish(begin(create()), at(120_000));
  const remainingTask = createTaskRecoveryRound({ ...taskScope, deviceId: exhausted.scope.deviceId }, now);
  const joint = evaluateJointRecoveryBudgets(exhausted, remainingTask, at(120_000));
  assert.equal(joint.maintenanceBudgetAvailable, false); assert.equal(joint.taskBudgetAvailable, true); assert.equal(joint.budgetsAvailable, false);
});

test("unknown publication/current task in-flight cannot be bypassed by connection recovery eligibility", () => {
  const m = create(), taskScope = { deviceId: m.scope.deviceId, taskId: randomUUID(), taskAttemptId: randomUUID(), roundId: randomUUID() };
  const initial = createTaskRecoveryRound(taskScope, now);
  const unknown = beginTaskRecovery(initial, initial.scope, randomUUID(), "network", now, "possible_submission");
  const result = evaluateJointRecoveryBudgets(m, unknown, at(10));
  assert.equal(result.budgetsAvailable, false); assert.equal(result.task!.phase, "verification_required");
  const running = beginTaskRecovery(initial, initial.scope, randomUUID(), "network", now, "pre_submission");
  assert.equal(evaluateJointRecoveryBudgets(m, running, at(10)).taskBudgetAvailable, false);
  rejects(() => evaluateJointRecoveryBudgets(m, createTaskRecoveryRound({ ...taskScope, deviceId: randomUUID() }, now), now), "STALE_SCOPE");
});

test("wrong endpoint receipt/identity/generation/round cannot finish or allocate another call", () => {
  const r = begin(), a = r.attempts[0]!;
  for (const patch of [{ reportId: randomUUID() }, { sourceEpoch: randomUUID() }, { sequence: "9007199254740994" }, { endpointRevision: 2 }]) {
    rejects(() => completeConnectionMaintenance(r, { scope: r.scope, recoveryId: a.recoveryId, endpoint: { ...a.endpoint, ...patch }, outcome: "verified_connected" }, at(10)), "STALE_RECEIPT");
  }
  for (const patch of [{ deviceId: randomUUID() }, { installationGeneration: "2" }, { enrollmentGeneration: "2" }, { ownershipVersion: "2" }, { roundId: randomUUID() }]) {
    rejects(() => beginConnectionMaintenance(createConnectionMaintenanceRound(r.scope, r.limits, now), { ...r.scope, ...patch }, randomUUID(), endpoint(), at(10)), "STALE_SCOPE");
  }
  const ready = create();
  for (const target of [{ ...endpoint(), permission: true }, { ...endpoint(), endpointRevision: 0 }, { ...endpoint(), sequence: "01" }]) {
    rejects(() => beginConnectionMaintenance(ready, ready.scope, randomUUID(), target, now), "INPUT_INVALID");
  }
});

test("human identity/authorization errors are sticky; later success or spare budget cannot clear them", () => {
  for (const reason of ["target_mismatch", "authority_changed", "human_intervention"] as const) {
    const r = begin(), human = requireConnectionMaintenanceHuman(r, r.scope, reason, at(10)), ended = finish(human, at(20), "verified_connected");
    assert.equal(ended.phase, "human_required"); assert.equal(ended.reason, reason);
    assert.equal(evaluateJointRecoveryBudgets(ended, null, at(20)).budgetsAvailable, false);
    rejects(() => begin(ended, at(30)), "AUTOMATIC_RECOVERY_BLOCKED");
  }
});

test("strict state hydration rejects clock regression, changed counters/elapsed, overlapping calls and unsafe copies", () => {
  const r = begin(), snapshots = [
    { ...r, attemptsUsed: 0 }, { ...r, elapsedMs: 1 }, { ...r, phase: "available" },
    { ...r, observedAt: "2026-09-30T01:00:00Z" }, { ...r, reason: "override" }, { ...r, reset: true },
    { ...r, attemptsUsed: 2, attempts: [r.attempts[0], { ...r.attempts[0], recoveryId: randomUUID() }] },
  ];
  for (const input of snapshots) rejects(() => parseConnectionMaintenanceRound(input), "CORRUPT_STATE");
  rejects(() => observeConnectionMaintenance(r, "2026-09-30T01:00:00Z"), "INPUT_INVALID");
  const copy = parseConnectionMaintenanceRound(r); copy.limits.maxAttempts = 1;
  assert.equal(r.limits.maxAttempts, 3);
});

test("exact closed receipt replay does not refresh counter/version and conflicting reused receipt is rejected", () => {
  const r = begin(), done = finish(r, at(10), "verified_connected"), again = finish(done, at(20), "verified_connected");
  assert.deepEqual(again, done); assert.equal(done.attemptsUsed, 1);
  rejects(() => finish(done, at(20), "failed"), "STALE_RECEIPT");
  rejects(() => beginConnectionMaintenance(done, done.scope, done.attempts[0]!.recoveryId, endpoint(), at(20)), "STALE_RECEIPT");
});
