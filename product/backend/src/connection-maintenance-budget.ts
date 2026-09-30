import { z } from "zod";
import { admissionGenerationSchema, compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { observeTaskRecovery, parseTaskRecoveryRound, recoveryDurationMilliseconds } from "./task-recovery-budget.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const time = timestampSchema.max(128).refine(v => !v.startsWith("0000-"));
const scopeSchema = z.strictObject({ deviceId: id, installationId: id, installationGeneration: admissionGenerationSchema,
  enrollmentId: id, enrollmentGeneration: admissionGenerationSchema, ownershipVersion: z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/), roundId: id });
const limitsSchema = z.strictObject({ maxAttempts: z.int().min(1).max(100), maxElapsedMs: z.int().min(1).max(3_600_000) });
const endpointSchema = z.strictObject({ sourceEpoch: id, reportId: id, sequence: admissionGenerationSchema, endpointRevision: z.int().min(1) });
const attemptSchema = z.strictObject({ recoveryId: id, endpoint: endpointSchema, startedAt: time, accountedAt: time, endedAt: time.nullable(),
  outcome: z.enum(["running", "unknown", "failed", "verified_connected"]) });
const stateSchema = z.strictObject({ scope: scopeSchema, limits: limitsSchema, version: z.int().min(0), createdAt: time, observedAt: time,
  attemptsUsed: z.int().min(0), elapsedMs: z.int().min(0), phase: z.enum(["available", "recovering", "human_required"]),
  reason: z.enum(["attempt_limit", "time_limit", "call_unknown", "target_mismatch", "authority_changed", "human_intervention"]).nullable(), attempts: z.array(attemptSchema).max(100) });
export type ConnectionMaintenanceScope = z.infer<typeof scopeSchema>;
export type ConnectionMaintenanceRound = z.infer<typeof stateSchema>;
// Internal boundary reuse; exporting schemas does not expose a route/permission.
export { scopeSchema as connectionMaintenanceScopeSchema, endpointSchema as connectionMaintenanceEndpointSchema };
export class ConnectionMaintenanceError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CORRUPT_STATE" | "STALE_SCOPE" | "BUSY" | "AUTOMATIC_RECOVERY_BLOCKED" | "STALE_RECEIPT") { super(code); }
}
function fail(c: ConnectionMaintenanceError["code"]): never { throw new ConnectionMaintenanceError(c); }
const earlier = (a: string, b: string) => compareTimestamps(a, b) === -1;
function elapsed(r: ConnectionMaintenanceRound): number {
  let total = 0;
  try { total = r.attempts.reduce((sum, a) => sum + recoveryDurationMilliseconds(a.startedAt, a.endedAt ?? a.accountedAt), 0); }
  catch { return fail("CORRUPT_STATE"); }
  if (!Number.isSafeInteger(total)) return fail("CORRUPT_STATE"); return total;
}
export function parseConnectionMaintenanceRound(input: unknown): ConnectionMaintenanceRound {
  const p = stateSchema.safeParse(input); if (!p.success) return fail("CORRUPT_STATE"); const r = p.data;
  const active = r.attempts.filter(a => a.endedAt === null);
  if (r.attemptsUsed !== r.attempts.length || r.attemptsUsed > r.limits.maxAttempts || r.elapsedMs !== elapsed(r)
    || earlier(r.observedAt, r.createdAt) || new Set(r.attempts.map(a => a.recoveryId)).size !== r.attempts.length || active.length > 1
    || (r.phase === "available" && (active.length !== 0 || r.reason !== null))
    || (r.phase === "recovering" && (active.length !== 1 || active[0]!.outcome !== "running" || r.reason !== null))
    || (r.phase === "human_required" && r.reason === null)) return fail("CORRUPT_STATE");
  for (let i = 0; i < r.attempts.length; i++) {
    const a = r.attempts[i]!, previous = r.attempts[i - 1];
    if (earlier(a.startedAt, r.createdAt) || earlier(a.accountedAt, a.startedAt) || earlier(r.observedAt, a.accountedAt)
      || ((a.endedAt === null) !== (a.outcome === "running" || a.outcome === "unknown"))
      || (a.endedAt !== null && a.endedAt !== a.accountedAt) || (previous && (previous.endedAt === null || earlier(a.startedAt, previous.endedAt)))) return fail("CORRUPT_STATE");
  }
  return r;
}
function checkScope(r: ConnectionMaintenanceRound, input: unknown): void {
  const p = scopeSchema.safeParse(input); if (!p.success) return fail("INPUT_INVALID");
  if (JSON.stringify(p.data) !== JSON.stringify(r.scope)) return fail("STALE_SCOPE");
}
function next(input: unknown, now: string): ConnectionMaintenanceRound {
  const r = parseConnectionMaintenanceRound(input);
  if (!time.safeParse(now).success || earlier(now, r.observedAt) || r.version === Number.MAX_SAFE_INTEGER) return fail("INPUT_INVALID");
  r.version++; r.observedAt = now;
  r.attempts = r.attempts.map(a => a.endedAt === null ? { ...a, accountedAt: now } : a); r.elapsedMs = elapsed(r);
  return r;
}
// Explicit trusted limits only: draft 3/120s is NOT a production default, and
// task's 2/5min is not silently reused or represented by fake task UUIDs.
export function createConnectionMaintenanceRound(scope: unknown, limits: unknown, now: string): ConnectionMaintenanceRound {
  const p = scopeSchema.safeParse(scope), l = limitsSchema.safeParse(limits);
  if (!p.success || !l.success || !time.safeParse(now).success) return fail("INPUT_INVALID");
  return { scope: p.data, limits: l.data, version: 0, createdAt: now, observedAt: now, attemptsUsed: 0, elapsedMs: 0,
    phase: "available", reason: null, attempts: [] };
}
export function beginConnectionMaintenance(input: unknown, scope: unknown, recoveryId: string, endpoint: unknown, now: string): ConnectionMaintenanceRound {
  const r = next(input, now); checkScope(r, scope); const rid = id.safeParse(recoveryId), target = endpointSchema.safeParse(endpoint);
  if (!rid.success || !target.success) return fail("INPUT_INVALID");
  if (r.phase !== "available") return fail(r.attempts.some(a => a.endedAt === null) ? "BUSY" : "AUTOMATIC_RECOVERY_BLOCKED");
  if (r.attempts.some(a => a.recoveryId === rid.data)) return fail("STALE_RECEIPT");
  if (r.attemptsUsed >= r.limits.maxAttempts) return { ...r, phase: "human_required", reason: "attempt_limit" };
  if (r.elapsedMs >= r.limits.maxElapsedMs) return { ...r, phase: "human_required", reason: "time_limit" };
  r.attemptsUsed++; r.phase = "recovering";
  r.attempts.push({ recoveryId: rid.data, endpoint: target.data, startedAt: now, accountedAt: now, endedAt: null, outcome: "running" });
  return parseConnectionMaintenanceRound(r);
}
export function observeConnectionMaintenance(input: unknown, now: string): ConnectionMaintenanceRound {
  const r = next(input, now);
  if (r.phase === "recovering" && r.elapsedMs >= r.limits.maxElapsedMs) { r.phase = "human_required"; r.reason = "time_limit"; }
  return r;
}
const receiptSchema = z.strictObject({ scope: scopeSchema, recoveryId: id, endpoint: endpointSchema, outcome: z.enum(["unknown", "failed", "verified_connected"]) });
export function completeConnectionMaintenance(input: unknown, receipt: unknown, now: string): ConnectionMaintenanceRound {
  const previous = parseConnectionMaintenanceRound(input), p = receiptSchema.safeParse(receipt);
  if (!p.success) return fail("INPUT_INVALID"); const c = p.data; checkScope(previous, c.scope);
  const old = previous.attempts.find(a => a.recoveryId === c.recoveryId);
  if (!old || JSON.stringify(old.endpoint) !== JSON.stringify(c.endpoint)) return fail("STALE_RECEIPT");
  if (old.endedAt !== null) {
    if (!time.safeParse(now).success || earlier(now, previous.observedAt) || old.outcome !== c.outcome) return fail("STALE_RECEIPT");
    return previous;
  }
  const r = next(previous, now), attempt = r.attempts.find(a => a.recoveryId === c.recoveryId)!;
  attempt.outcome = c.outcome;
  if (c.outcome === "unknown") { r.phase = "human_required"; r.reason ??= "call_unknown"; }
  else {
    attempt.endedAt = now;
    if (r.phase === "recovering") {
      if (r.elapsedMs > r.limits.maxElapsedMs || (c.outcome === "failed" && r.elapsedMs >= r.limits.maxElapsedMs)) { r.phase = "human_required"; r.reason = "time_limit"; }
      else if (c.outcome === "failed" && r.attemptsUsed >= r.limits.maxAttempts) { r.phase = "human_required"; r.reason = "attempt_limit"; }
      else { r.phase = "available"; r.reason = null; }
    }
  }
  return parseConnectionMaintenanceRound(r);
}
export function requireConnectionMaintenanceHuman(input: unknown, scope: unknown, reason: "target_mismatch" | "authority_changed" | "human_intervention", now: string) {
  const r = next(input, now); checkScope(r, scope);
  if (!["target_mismatch", "authority_changed", "human_intervention"].includes(reason)) return fail("INPUT_INVALID");
  r.phase = "human_required"; r.reason = reason; return parseConnectionMaintenanceRound(r);
}
// Pure budget ceiling only, NEVER live action permission. Null means genuinely
// no task; caller must supply authoritative current task when one exists.
// Returned observation copies must be persisted jointly BEFORE any operation.
export function evaluateJointRecoveryBudgets(input: unknown, taskInput: unknown | null, now: string) {
  const maintenance = observeConnectionMaintenance(input, now);
  const maintenanceBudgetAvailable = maintenance.phase === "available" && maintenance.attemptsUsed < maintenance.limits.maxAttempts && maintenance.elapsedMs < maintenance.limits.maxElapsedMs;
  if (taskInput === null) return { maintenance, task: null, maintenanceBudgetAvailable, taskBudgetAvailable: null, budgetsAvailable: maintenanceBudgetAvailable };
  const source = parseTaskRecoveryRound(taskInput);
  if (source.scope.deviceId.toLowerCase() !== maintenance.scope.deviceId) return fail("STALE_SCOPE");
  const task = observeTaskRecovery(source, now);
  const taskBudgetAvailable = task.phase === "available" && task.attemptsUsed < task.limits.maxAttempts && task.elapsedMs < task.limits.maxElapsedMs;
  return { maintenance, task, maintenanceBudgetAvailable, taskBudgetAvailable, budgetsAvailable: maintenanceBudgetAvailable && taskBudgetAvailable };
}
