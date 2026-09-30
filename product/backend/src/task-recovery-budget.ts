import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";

export class RecoveryBudgetError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "STALE_SCOPE" | "BUSY" | "AUTOMATIC_RECOVERY_BLOCKED") {
    super(`Task recovery rejected: ${code}`);
  }
}
const scopeSchema = z.strictObject({ taskId: uuidSchema, taskAttemptId: uuidSchema, deviceId: uuidSchema, roundId: uuidSchema });
export type TaskRecoveryScope = z.infer<typeof scopeSchema>;
const limitsSchema = z.strictObject({ maxAttempts: z.int().min(1).max(100), maxElapsedMs: z.int().min(1).max(3_600_000) });
export type TaskRecoveryLimits = z.infer<typeof limitsSchema>;
export const defaultTaskRecoveryLimits: Readonly<TaskRecoveryLimits> = Object.freeze({ maxAttempts: 2, maxElapsedMs: 300_000 });
const faultSchema = z.enum(["network", "page_load", "account_restricted", "human_verification", "identity_mismatch", "permission_changed"]);
export type TaskRecoveryFault = z.infer<typeof faultSchema>;
const recoverySchema = z.strictObject({
  recoveryId: uuidSchema, fault: z.enum(["network", "page_load"]), startedAt: timestampSchema, accountedAt: timestampSchema,
  endedAt: timestampSchema.nullable(), outcome: z.enum(["running", "unknown", "failed", "verified_recovered"]),
});
const roundSchema = z.strictObject({
  scope: scopeSchema, version: z.int().min(0), limits: limitsSchema, attemptsUsed: z.int().min(0), elapsedMs: z.int().min(0),
  phase: z.enum(["available", "recovering", "human_required", "verification_required"]),
  reason: z.enum(["attempt_limit", "time_limit", "call_unknown", "account_restricted", "human_verification", "identity_mismatch", "permission_changed", "publication_unknown"]).nullable(),
  createdAt: timestampSchema, observedAt: timestampSchema, recoveries: z.array(recoverySchema).max(100),
});
export type TaskRecoveryRound = z.infer<typeof roundSchema>;
const receiptSchema = z.strictObject({ scope: scopeSchema, recoveryId: uuidSchema, outcome: z.enum(["failed", "verified_recovered", "unknown"]) });
export type TaskRecoveryReceipt = z.infer<typeof receiptSchema>;
function fail(code: RecoveryBudgetError["code"]): never { throw new RecoveryBudgetError(code); }
function earlier(a: string, b: string): boolean { return compareTimestamps(a, b) === -1; }

// Charge full active wall time across disconnect/restart, not only successful
// commands. Round fractional milliseconds UP once per attempt, not per poll.
// Date.parse supplies the whole millisecond; exact fractional residue supplies
// the ceiling, so sub-ms clock data cannot be truncated into free retries.
function duration(start: string, end: string): number {
  if (earlier(end, start)) fail("INVALID_BOUNDARY");
  const residue = (s: string) => (/\.(\d+)/.exec(s)?.[1] ?? "").slice(3);
  const a = residue(start), b = residue(end), width = Math.max(a.length, b.length);
  const extra = b.padEnd(width, "0").localeCompare(a.padEnd(width, "0")) > 0 ? 1 : 0;
  const value = Date.parse(end) - Date.parse(start) + extra;
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_BOUNDARY");
  return value;
}
function total(round: TaskRecoveryRound): number {
  const value = round.recoveries.reduce((sum, r) => sum + duration(r.startedAt, r.endedAt ?? r.accountedAt), 0);
  if (!Number.isSafeInteger(value)) fail("INVALID_BOUNDARY");
  return value;
}
function active(round: TaskRecoveryRound) { return round.recoveries.find(r => r.endedAt === null); }
export function parseTaskRecoveryRound(input: unknown): TaskRecoveryRound {
  const parsed = roundSchema.safeParse(input);
  if (!parsed.success) fail("INVALID_BOUNDARY");
  const r = parsed.data, pending = r.recoveries.filter(item => item.endedAt === null);
  if (r.attemptsUsed !== r.recoveries.length || r.attemptsUsed > r.limits.maxAttempts
    || new Set(r.recoveries.map(item => item.recoveryId)).size !== r.recoveries.length || pending.length > 1
    || earlier(r.observedAt, r.createdAt) || r.elapsedMs !== total(r)
    || (r.phase === "available" && (pending.length > 0 || r.reason !== null))
    || (r.phase === "recovering" && (pending.length !== 1 || pending[0]?.outcome !== "running" || r.reason !== null))
    || (r.phase === "human_required" && (r.reason === null || r.reason === "publication_unknown"))
    || (r.phase === "verification_required" && r.reason !== "publication_unknown")
    || r.recoveries.some(item => earlier(item.startedAt, r.createdAt) || earlier(item.accountedAt, item.startedAt)
      || earlier(r.observedAt, item.accountedAt) || (item.endedAt !== null && item.endedAt !== item.accountedAt)
      || ((item.endedAt === null) !== ["running", "unknown"].includes(item.outcome)))) fail("INVALID_BOUNDARY");
  for (let i = 1; i < r.recoveries.length; i++) {
    const previous = r.recoveries[i - 1]!;
    if (previous.endedAt === null || earlier(r.recoveries[i]!.startedAt, previous.endedAt)) fail("INVALID_BOUNDARY");
  }
  return r;
}
function next(r: TaskRecoveryRound, now: string): TaskRecoveryRound {
  parseTaskRecoveryRound(r);
  if (!timestampSchema.safeParse(now).success || earlier(now, r.observedAt) || r.version >= Number.MAX_SAFE_INTEGER) fail("INVALID_BOUNDARY");
  const result: TaskRecoveryRound = { ...r, version: r.version + 1, observedAt: now,
    recoveries: r.recoveries.map(item => item.endedAt === null ? { ...item, accountedAt: now } : { ...item }) };
  result.elapsedMs = total(result);
  return result;
}
function checkScope(expected: TaskRecoveryScope, input: unknown): TaskRecoveryScope {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) fail("INVALID_BOUNDARY");
  const actual = parsed.data;
  if (actual.taskId !== expected.taskId || actual.taskAttemptId !== expected.taskAttemptId
    || actual.deviceId !== expected.deviceId || actual.roundId !== expected.roundId) fail("STALE_SCOPE");
  return actual;
}

export function parseTaskRecoveryScope(input: unknown): TaskRecoveryScope {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) fail("INVALID_BOUNDARY");
  return parsed.data;
}

// Internal trusted creation, not an HTTP reset knob. Persistence must enforce one
// round per current attempt; human review/new-round creation is NOT implemented.
export function createTaskRecoveryRound(input: unknown, now: string, limits: unknown = defaultTaskRecoveryLimits): TaskRecoveryRound {
  const scope = scopeSchema.safeParse(input), config = limitsSchema.safeParse(limits);
  if (!scope.success || !config.success || !timestampSchema.safeParse(now).success) fail("INVALID_BOUNDARY");
  return { scope: scope.data, version: 0, limits: config.data, attemptsUsed: 0, elapsedMs: 0, phase: "available", reason: null,
    createdAt: now, observedAt: now, recoveries: [] };
}

// Pure budget decisions are NEVER permission for phone reads/actions. The live
// control/auth/material/version checks still belong to the execution broker.
export function beginTaskRecovery(record: TaskRecoveryRound, scope: unknown, recoveryId: string, faultInput: unknown,
  now: string, trustedSubmission: "pre_submission" | "possible_submission" | "verified_success"): TaskRecoveryRound {
  const r = next(record, now);
  checkScope(r.scope, scope);
  const fault = faultSchema.safeParse(faultInput);
  if (!fault.success || !uuidSchema.safeParse(recoveryId).success
    || !["pre_submission", "possible_submission", "verified_success"].includes(trustedSubmission)) fail("INVALID_BOUNDARY");
  if (r.phase !== "available") fail(active(r) ? "BUSY" : "AUTOMATIC_RECOVERY_BLOCKED");
  if (r.recoveries.some(item => item.recoveryId === recoveryId)) fail("STALE_SCOPE");
  // The authoritative submission state dominates the apparent network fault.
  // R-075's five minutes is NOT a publication-verification timeout.
  if (fault.data !== "network" && fault.data !== "page_load") return { ...r, phase: "human_required", reason: fault.data };
  if (trustedSubmission === "possible_submission") return { ...r, phase: "verification_required", reason: "publication_unknown" };
  if (trustedSubmission === "verified_success") fail("AUTOMATIC_RECOVERY_BLOCKED");
  if (r.attemptsUsed >= r.limits.maxAttempts) return { ...r, phase: "human_required", reason: "attempt_limit" };
  if (r.elapsedMs >= r.limits.maxElapsedMs) return { ...r, phase: "human_required", reason: "time_limit" };
  return { ...r, phase: "recovering", reason: null, attemptsUsed: r.attemptsUsed + 1,
    recoveries: [...r.recoveries, { recoveryId, fault: fault.data, startedAt: now, accountedAt: now, endedAt: null, outcome: "running" }] };
}

export function observeTaskRecovery(record: TaskRecoveryRound, now: string): TaskRecoveryRound {
  const r = next(record, now);
  if (r.phase === "recovering" && r.elapsedMs >= r.limits.maxElapsedMs) return { ...r, phase: "human_required", reason: "time_limit" };
  return r;
}

// Trusted underlying-call receipt, not engine cancellation or a client claim.
// Unknown leaves the active slot intact; a later real end can fill history but
// cannot undo an already accepted human/verification gate.
export function completeTaskRecovery(record: TaskRecoveryRound, input: unknown, now: string): TaskRecoveryRound {
  parseTaskRecoveryRound(record);
  const receipt = receiptSchema.safeParse(input);
  if (!receipt.success) fail("INVALID_BOUNDARY");
  checkScope(record.scope, receipt.data.scope);
  const original = record.recoveries.find(item => item.recoveryId === receipt.data.recoveryId);
  if (!original) fail("STALE_SCOPE");
  if (original.endedAt !== null) {
    if (original.outcome !== receipt.data.outcome || !timestampSchema.safeParse(now).success || earlier(now, record.observedAt)) fail("STALE_SCOPE");
    return record;
  }
  const r = next(record, now), outcome = receipt.data.outcome;
  if (outcome === "unknown") return { ...r, phase: r.phase === "verification_required" ? r.phase : "human_required", reason: r.reason ?? "call_unknown",
    recoveries: r.recoveries.map(item => item.recoveryId === original.recoveryId ? { ...item, outcome } : item) };
  const ended: TaskRecoveryRound = { ...r, recoveries: r.recoveries.map(item => item.recoveryId === original.recoveryId ? { ...item, endedAt: now, outcome } : item) };
  if (r.phase !== "recovering") return ended;
  if (r.elapsedMs > r.limits.maxElapsedMs || (outcome === "failed" && r.elapsedMs >= r.limits.maxElapsedMs)) return { ...ended, phase: "human_required", reason: "time_limit" };
  if (outcome === "failed" && r.attemptsUsed >= r.limits.maxAttempts) return { ...ended, phase: "human_required", reason: "attempt_limit" };
  return { ...ended, phase: "available", reason: null };
}

export function requireRecoveryHuman(record: TaskRecoveryRound, scope: unknown,
  fault: Exclude<TaskRecoveryFault, "network" | "page_load">, now: string): TaskRecoveryRound {
  const r = next(record, now);
  checkScope(r.scope, scope);
  if (!["account_restricted", "human_verification", "identity_mismatch", "permission_changed"].includes(fault)) fail("INVALID_BOUNDARY");
  return { ...r, phase: "human_required", reason: fault };
}
