import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  RecoveryBudgetError, beginTaskRecovery, completeTaskRecovery, createTaskRecoveryRound,
  defaultTaskRecoveryLimits, observeTaskRecovery, parseTaskRecoveryRound, requireRecoveryHuman,
} from "./task-recovery-budget.js";
const now = "2026-09-30T10:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(now) + ms).toISOString();
const scope = () => ({ taskId: randomUUID(), taskAttemptId: randomUUID(), deviceId: randomUUID(), roundId: randomUUID() });
function begin(record = createTaskRecoveryRound(scope(), now), ms = 0, fault: "network" | "page_load" = "network") {
  return beginTaskRecovery(record, record.scope, randomUUID(), fault, at(ms), "pre_submission");
}
function end(record: ReturnType<typeof begin>, ms: number, outcome: "failed" | "verified_recovered" | "unknown" = "failed") {
  return completeTaskRecovery(record, { scope: record.scope, recoveryId: record.recoveries.at(-1)!.recoveryId, outcome }, at(ms));
}
function rejects(fn: () => unknown, code: RecoveryBudgetError["code"]) {
  assert.throws(fn, (error: unknown) => error instanceof RecoveryBudgetError && error.code === code && !error.cause);
}

test("default scope is one task attempt and round; model/config extra fields cannot raise budget", () => {
  const r = createTaskRecoveryRound(scope(), now);
  assert.deepEqual(r.limits, { maxAttempts: 2, maxElapsedMs: 300_000 });
  assert.ok(Object.isFrozen(defaultTaskRecoveryLimits));
  for (const limits of [{ maxAttempts: 0, maxElapsedMs: 1 }, { maxAttempts: 2.5, maxElapsedMs: 1 },
    { maxAttempts: 101, maxElapsedMs: 300_000 }, { maxAttempts: 2, maxElapsedMs: 300_000, modelOverride: true }]) {
    rejects(() => createTaskRecoveryRound(scope(), now, limits), "INVALID_BOUNDARY");
  }
  rejects(() => createTaskRecoveryRound({ ...scope(), reset: true }, now), "INVALID_BOUNDARY");
});
test("different fault kinds and serialized restart never reset the cumulative attempts", () => {
  let r = end(begin(), 10_000);
  r = parseTaskRecoveryRound(JSON.parse(JSON.stringify(r)));
  r = end(begin(r, 20_000, "page_load"), 30_000);
  assert.equal(r.attemptsUsed, 2);
  assert.equal(r.elapsedMs, 20_000);
  assert.equal(r.phase, "human_required");
  assert.equal(r.reason, "attempt_limit");
  rejects(() => begin(r, 40_000), "AUTOMATIC_RECOVERY_BLOCKED");
});
test("recovery time is active wall time, idle task gaps are not charged", () => {
  const first = end(begin(), 120_000);
  const second = begin(first, 600_000);
  assert.equal(second.elapsedMs, 120_000);
  const aged = observeTaskRecovery(second, at(780_000));
  assert.equal(aged.elapsedMs, 300_000);
  assert.equal(aged.phase, "human_required");
  assert.equal(aged.reason, "time_limit");
  assert.equal(aged.recoveries.at(-1)?.endedAt, null);
});
test("disconnect/restart continues the same active clock and unknown call remains occupied", () => {
  const initial = begin();
  const unknown = end(initial, 1_000, "unknown");
  const resumed = observeTaskRecovery(parseTaskRecoveryRound(JSON.parse(JSON.stringify(unknown))), at(400_000));
  assert.equal(resumed.elapsedMs, 400_000);
  assert.equal(resumed.attemptsUsed, 1);
  rejects(() => begin(resumed, 410_000), "BUSY");
  const ended = end(resumed, 420_000, "verified_recovered");
  assert.equal(ended.phase, "human_required");
  assert.equal(ended.reason, "call_unknown");
  assert.equal(ended.recoveries[0]?.endedAt, at(420_000));
});
test("exact time limit with failure escalates, verified success within the limit can continue original work", () => {
  assert.equal(end(begin(), 300_000).phase, "human_required");
  assert.equal(end(begin(), 300_000, "verified_recovered").phase, "available");
  assert.equal(end(begin(), 300_001, "verified_recovered").phase, "human_required");
  const exhaustedAfterSuccess = end(begin(end(begin(), 1_000), 2_000), 3_000, "verified_recovered");
  assert.equal(exhaustedAfterSuccess.phase, "available");
  const nextFailure = begin(exhaustedAfterSuccess, 4_000);
  assert.equal(nextFailure.phase, "human_required");
  assert.equal(nextFailure.attemptsUsed, 2);
});
test("fractional time uses exact residue ceiling once per attempt, never adds rounding per poll", () => {
  const s = scope(), r = createTaskRecoveryRound(s, "2026-09-30T10:00:00.0000000001Z", { maxAttempts: 2, maxElapsedMs: 1 });
  const started = beginTaskRecovery(r, s, randomUUID(), "network", r.createdAt, "pre_submission");
  const observed = observeTaskRecovery(started, "2026-09-30T10:00:00.0000000002Z");
  assert.equal(observed.elapsedMs, 1);
  assert.equal(observed.phase, "human_required");
  assert.equal(observeTaskRecovery(observed, "2026-09-30T10:00:00.0000000003Z").elapsedMs, 1);
  const offset = createTaskRecoveryRound(scope(), "2026-09-30T10:00:00.9999+00:00");
  const running = beginTaskRecovery(offset, offset.scope, randomUUID(), "network", offset.createdAt, "pre_submission");
  assert.equal(observeTaskRecovery(running, "2026-09-30T11:00:01.0000+01:00").elapsedMs, 1);
});
test("long leading-zero fractions cannot borrow time from Date.parse normalization", () => {
  const s = scope(), createdAt = "2026-09-30T10:00:00.00012345678901234567890Z";
  const r = createTaskRecoveryRound(s, createdAt);
  const running = beginTaskRecovery(r, s, randomUUID(), "network", createdAt, "pre_submission");
  const completed = completeTaskRecovery(running, { scope: s, recoveryId: running.recoveries[0]!.recoveryId,
    outcome: "verified_recovered" }, "2026-09-30T10:05:00.0002Z");
  assert.equal(completed.elapsedMs, 300_001);
  assert.equal(completed.phase, "human_required");
  assert.equal(completed.reason, "time_limit");
  rejects(() => parseTaskRecoveryRound({ ...completed, elapsedMs: 299_878 }), "INVALID_BOUNDARY");
  const parsed = parseTaskRecoveryRound(JSON.parse(JSON.stringify(completed)));
  assert.equal(parsed.elapsedMs, 300_001);
  for (const fraction of ["012345678901234567890", "004294967296", "0000999999999999999999999999999999999999"]) {
    const at = `2026-09-30T10:00:00.${fraction}Z`;
    const initial = createTaskRecoveryRound(scope(), at);
    const started = beginTaskRecovery(initial, initial.scope, randomUUID(), "network", at, "pre_submission");
    const delta = observeTaskRecovery(started, "2026-09-30T10:00:01Z");
    assert.equal(delta.elapsedMs, 1_000 - Number(fraction.slice(0, 3)));
  }
  const exactStart = "2026-09-30T10:00:00.094603526542Z";
  const exact = createTaskRecoveryRound(scope(), exactStart);
  const begun = beginTaskRecovery(exact, exact.scope, randomUUID(), "network", exactStart, "pre_submission");
  const failed = completeTaskRecovery(begun, { scope: exact.scope, recoveryId: begun.recoveries[0]!.recoveryId,
    outcome: "failed" }, "2026-09-30T10:05:00.880000Z");
  assert.equal(failed.elapsedMs, 300_786);
  assert.equal(failed.phase, "human_required");
  rejects(() => beginTaskRecovery(failed, failed.scope, randomUUID(), "network", failed.observedAt, "pre_submission"), "AUTOMATIC_RECOVERY_BLOCKED");
});
test("scope pins task, attempt, device and round on start and receipt", () => {
  const r = createTaskRecoveryRound(scope(), now);
  for (const field of ["taskId", "taskAttemptId", "deviceId", "roundId"] as const) {
    rejects(() => beginTaskRecovery(r, { ...r.scope, [field]: randomUUID() }, randomUUID(), "network", now, "pre_submission"), "STALE_SCOPE");
    const started = begin(r);
    rejects(() => completeTaskRecovery(started, { scope: { ...r.scope, [field]: randomUUID() }, recoveryId: started.recoveries[0]!.recoveryId, outcome: "failed" }, at(1)), "STALE_SCOPE");
  }
});
test("unknown publication enters verification without retry or a five-minute verification deadline", () => {
  const r = createTaskRecoveryRound(scope(), now);
  const verify = beginTaskRecovery(r, r.scope, randomUUID(), "network", now, "possible_submission");
  assert.equal(verify.phase, "verification_required");
  assert.equal(verify.attemptsUsed, 0);
  assert.equal(verify.elapsedMs, 0);
  const later = observeTaskRecovery(verify, at(600_000));
  assert.equal(later.phase, "verification_required");
  assert.equal(later.elapsedMs, 0);
  rejects(() => begin(later, 600_001), "AUTOMATIC_RECOVERY_BLOCKED");
  rejects(() => beginTaskRecovery(r, r.scope, randomUUID(), "network", now, "verified_success"), "AUTOMATIC_RECOVERY_BLOCKED");
});
test("restricted account, human verification and identity mismatch directly escalate without spending retries", () => {
  const r = createTaskRecoveryRound(scope(), now);
  for (const fault of ["account_restricted", "human_verification", "identity_mismatch", "permission_changed"] as const) {
    const human = beginTaskRecovery(r, r.scope, randomUUID(), fault, now, "pre_submission");
    assert.equal(human.phase, "human_required");
    assert.equal(human.attemptsUsed, 0);
    assert.equal(human.reason, fault);
    assert.equal(beginTaskRecovery(r, r.scope, randomUUID(), fault, now, "possible_submission").phase, "human_required");
  }
  const inFlight = requireRecoveryHuman(begin(r), r.scope, "identity_mismatch", at(1));
  assert.equal(inFlight.recoveries[0]?.endedAt, null);
  assert.equal(end(inFlight, 2, "verified_recovered").phase, "human_required");
});
test("duplicate receipt is historical only and recovery IDs cannot be reused", () => {
  const started = begin(), completed = end(started, 1_000);
  const receipt = { scope: completed.scope, recoveryId: completed.recoveries[0]!.recoveryId, outcome: "failed" };
  assert.equal(completeTaskRecovery(completed, receipt, at(2_000)), completed);
  rejects(() => completeTaskRecovery(completed, { ...receipt, outcome: "verified_recovered" }, at(2_000)), "STALE_SCOPE");
  rejects(() => beginTaskRecovery(completed, completed.scope, receipt.recoveryId, "network", at(2_000), "pre_submission"), "STALE_SCOPE");
  rejects(() => begin(started, 1_000), "BUSY");
});
test("malformed stored totals, overlaps, clocks and unknown fields fail closed without input echo", () => {
  const started = begin();
  for (const input of ["secret-marker", { ...started, elapsedMs: 100 }, { ...started, attemptsUsed: 0 },
    { ...started, phase: "available" }, { ...started, reset: true }, { ...started, recoveries: [...started.recoveries, started.recoveries[0]] }]) {
    rejects(() => parseTaskRecoveryRound(input), "INVALID_BOUNDARY");
  }
  rejects(() => observeTaskRecovery(started, at(-1)), "INVALID_BOUNDARY");
  rejects(() => observeTaskRecovery({ ...started, version: Number.MAX_SAFE_INTEGER }, at(1)), "INVALID_BOUNDARY");
  rejects(() => completeTaskRecovery(started, { scope: started.scope, recoveryId: started.recoveries[0]!.recoveryId, outcome: "failed", cancelled: true }, at(1)), "INVALID_BOUNDARY");
});
