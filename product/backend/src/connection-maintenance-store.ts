import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import {
  beginConnectionMaintenance, completeConnectionMaintenance, ConnectionMaintenanceError,
  createConnectionMaintenanceRound, evaluateJointRecoveryBudgets, observeConnectionMaintenance,
  connectionMaintenanceEndpointSchema, connectionMaintenanceScopeSchema,
  parseConnectionMaintenanceRound, requireConnectionMaintenanceHuman,
  type ConnectionMaintenanceRound, type ConnectionMaintenanceScope,
} from "./connection-maintenance-budget.js";
import { beginTaskRecovery, completeTaskRecovery, parseTaskRecoveryRound, parseTaskRecoveryScope, RecoveryBudgetError, type TaskRecoveryScope, type TaskRecoveryRound } from "./task-recovery-budget.js";

const s = "socialgrowth_product";
const normalizedId = uuidSchema.transform(v => v.toLowerCase());
const submissionSchema = z.enum(["pre_submission", "possible_submission", "verified_success"]);
const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("begin"), recoveryId: uuidSchema, endpoint: z.unknown() }),
  z.strictObject({ kind: z.literal("observe") }),
  z.strictObject({ kind: z.literal("complete"), receipt: z.unknown() }),
  z.strictObject({ kind: z.literal("require_human"), reason: z.enum(["target_mismatch", "authority_changed", "human_intervention"]) }),
  z.strictObject({ kind: z.literal("observe_joint") }),
  z.strictObject({ kind: z.literal("reserve_joint"), recoveryId: normalizedId, endpoint: connectionMaintenanceEndpointSchema }),
  z.strictObject({ kind: z.literal("complete_joint"), receipt: z.strictObject({ scope: connectionMaintenanceScopeSchema, recoveryId: normalizedId, endpoint: connectionMaintenanceEndpointSchema,
    outcome: z.enum(["unknown", "failed", "verified_connected"]), taskOutcome: z.enum(["unknown", "failed", "verified_recovered"]).nullable() }) }),
]);
export class MaintenanceStoreError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CURRENT_CONTEXT_UNAVAILABLE" | "STALE_SCOPE" | "STALE_VERSION" | "TASK_BUDGET_REQUIRED" | "CORRUPT_STATE" | "DATABASE_UNAVAILABLE") { super(code); }
}
const fail = (code: MaintenanceStoreError["code"]): never => { throw new MaintenanceStoreError(code); };
// Trusted DB-only broker seam, not client context, model flags or a live source
// proof. Resolve current locked binding AND actual task/absence. Default missing
// closes all methods before DB. No production resolver/HTTP/action registration.
export interface MaintenanceCurrentContext {
  resolve(client: PoolClient, expected: Readonly<ConnectionMaintenanceScope>): Promise<{ scope: ConnectionMaintenanceScope; currentTask: TaskRecoveryScope | null;
    taskSubmission?: z.infer<typeof submissionSchema> | null } | null>;
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}
const digest = (v: unknown) => createHash("sha256").update(canonical(v)).digest();
function scope(input: unknown): ConnectionMaintenanceScope {
  return createConnectionMaintenanceRound(input, { maxAttempts: 1, maxElapsedMs: 1 }, "2026-10-01T00:00:00Z").scope; // Boundary only, never persisted/configured limits.
}
function boundary(version: number, key: string): void {
  if (!Number.isSafeInteger(version) || version < 0 || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail("INPUT_INVALID");
}
async function clock(c: PoolClient): Promise<string> {
  const row = (await c.query<{ now: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') now`)).rows[0];
  if (!row) return fail("DATABASE_UNAVAILABLE"); return row.now;
}
async function load(c: PoolClient, expected: ConnectionMaintenanceScope): Promise<ConnectionMaintenanceRound | null> {
  const row = (await c.query<{ record: unknown; version: string; phase: string }>(`SELECT record,version::text,phase FROM ${s}.connection_maintenance_rounds WHERE device_id=$1 FOR UPDATE`, [expected.deviceId])).rows[0];
  if (!row) return null;
  const r = parseConnectionMaintenanceRound(row.record);
  if (canonical(r.scope) !== canonical(expected)) return fail("STALE_SCOPE");
  if (String(r.version) !== row.version || r.phase !== row.phase) return fail("CORRUPT_STATE");
  const commands = (await c.query<{ applied_version: string }>(`SELECT applied_version::text FROM ${s}.connection_maintenance_commands WHERE device_id=$1`, [expected.deviceId])).rows;
  // Every persisted state version needs an acknowledged command; no silent
  // administrative deletion may be hidden by accepting a fresh replacement.
  const versions = new Set(commands.map(v => v.applied_version));
  if (!versions.has("0") || versions.size !== r.version + 1 || [...versions].some(v => BigInt(v) > BigInt(r.version))) return fail("CORRUPT_STATE");
  const reservations = (await c.query<{ recovery_id: string; maintenance_scope: unknown; endpoint_ref: unknown }>(`SELECT recovery_id,maintenance_scope,endpoint_ref FROM ${s}.joint_recovery_reservations WHERE device_id=$1`, [expected.deviceId])).rows;
  if (reservations.length !== r.attempts.length) return fail("CORRUPT_STATE");
  for (const a of r.attempts) {
    const reservation = reservations.find(v => v.recovery_id === a.recoveryId);
    if (!reservation || canonical(reservation.maintenance_scope) !== canonical(r.scope) || canonical(reservation.endpoint_ref) !== canonical(a.endpoint)) return fail("CORRUPT_STATE");
  }
  return r;
}
async function task(c: PoolClient, current: TaskRecoveryScope | null, deviceId: string) {
  if (current === null) return null;
  const expected = parseTaskRecoveryScope(current);
  if (expected.deviceId.toLowerCase() !== deviceId) return fail("STALE_SCOPE");
  const row = (await c.query<{ record: unknown; version: string; phase: string }>(`SELECT record,version::text,phase FROM ${s}.task_recovery_rounds WHERE task_attempt_id=$1 FOR UPDATE`, [expected.taskAttemptId])).rows[0];
  if (!row) return fail("CURRENT_CONTEXT_UNAVAILABLE");
  const r = parseTaskRecoveryRound(row.record);
  if (canonical(r.scope) !== canonical(expected) || String(r.version) !== row.version || r.phase !== row.phase) return fail("CORRUPT_STATE");
  return r;
}
async function save(c: PoolClient, r: ConnectionMaintenanceRound, exists: boolean): Promise<void> {
  const q = exists
    ? await c.query(`UPDATE ${s}.connection_maintenance_rounds SET version=$2,phase=$3,record=$4 WHERE device_id=$1 RETURNING device_id`, [r.scope.deviceId, r.version, r.phase, r])
    : await c.query(`INSERT INTO ${s}.connection_maintenance_rounds(device_id,installation_id,enrollment_id,round_id,version,phase,record) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING device_id`, [r.scope.deviceId, r.scope.installationId, r.scope.enrollmentId, r.scope.roundId, r.version, r.phase, r]);
  if (q.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
}
async function acknowledge(c: PoolClient, r: ConnectionMaintenanceRound, version: number, key: string, kind: string, hash: Buffer): Promise<void> {
  const q = await c.query(`INSERT INTO ${s}.connection_maintenance_commands(device_id,request_key,expected_version,kind,payload_digest,applied_version)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING device_id`, [r.scope.deviceId, key, version, kind, hash, r.version]);
  if (q.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
  const a = await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts)
    VALUES($1,'system',$2,'connection_maintenance',$3,$4,$5) RETURNING audit_record_id`, [randomUUID(), `connection_maintenance.${kind}`, r.scope.deviceId, key,
    { version: r.version, phase: r.phase, attemptsUsed: r.attemptsUsed, elapsedMs: r.elapsedMs }]);
  if (a.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
}
async function replay(c: PoolClient, deviceId: string, version: number, key: string, kind: string, hash: Buffer): Promise<boolean> {
  const p = (await c.query<{ expected_version: string; kind: string; payload_digest: Buffer }>(`SELECT expected_version::text,kind,payload_digest FROM ${s}.connection_maintenance_commands WHERE device_id=$1 AND request_key=$2`, [deviceId, key])).rows[0];
  if (!p) return false;
  if (p.expected_version !== String(version) || p.kind !== kind || !p.payload_digest.equals(hash)) return fail("STALE_VERSION"); return true;
}

async function saveTask(c: PoolClient, old: TaskRecoveryRound, next: TaskRecoveryRound, key: string, kind: "begin" | "observe" | "complete", maintenance: ConnectionMaintenanceScope) {
  parseTaskRecoveryRound(next);
  const saved = await c.query(`UPDATE ${s}.task_recovery_rounds SET version=$2,phase=$3,record=$4 WHERE task_attempt_id=$1 AND version=$5 RETURNING task_attempt_id`, [old.scope.taskAttemptId, next.version, next.phase, next, old.version]);
  if (saved.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
  const ack = await c.query(`INSERT INTO ${s}.task_recovery_commands(task_attempt_id,request_key,expected_version,kind,payload_digest,applied_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING task_attempt_id`, [old.scope.taskAttemptId, `maint_${createHash("sha256").update(maintenance.deviceId + key).digest("hex")}`, old.version, kind, digest({ maintenance, key, kind }), next.version]);
  if (ack.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
  const audit = await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts)
    VALUES($1,'system',$2,'task_recovery',$3,$4,$5) RETURNING audit_record_id`, [randomUUID(), `task_recovery.${kind}`, old.scope.taskAttemptId, key,
    { version: next.version, phase: next.phase, attemptsUsed: next.attemptsUsed, elapsedMs: next.elapsedMs, maintenanceRoundId: maintenance.roundId }]);
  if (audit.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
}
async function reserve(c: PoolClient, r: ConnectionMaintenanceRound, currentTask: TaskRecoveryScope | null) {
  const a = r.attempts.at(-1)!;
  const row = await c.query(`INSERT INTO ${s}.joint_recovery_reservations(device_id,recovery_id,maintenance_scope,endpoint_ref,task_attempt_id,task_scope)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING recovery_id`, [r.scope.deviceId, a.recoveryId, r.scope, a.endpoint, currentTask?.taskAttemptId ?? null, currentTask]);
  if (row.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
}
async function reservedTask(c: PoolClient, r: ConnectionMaintenanceRound, recoveryId: string) {
  const row = (await c.query<{ task_scope: unknown; task_attempt_id: string | null }>(`SELECT task_scope,task_attempt_id FROM ${s}.joint_recovery_reservations WHERE device_id=$1 AND recovery_id=$2`, [r.scope.deviceId, recoveryId.toLowerCase()])).rows[0];
  if (!row) return fail("CORRUPT_STATE");
  if (row.task_attempt_id === null) { if (row.task_scope !== null) return fail("CORRUPT_STATE"); return null; }
  const expected = parseTaskRecoveryScope(row.task_scope);
  if (expected.taskAttemptId !== row.task_attempt_id) return fail("CORRUPT_STATE");
  return expected;
}

// Budget persistence ONLY, never actor permission/connection dispatch. Context
// must be supplied by the future current-fact broker; an enrollment FK is not
// admission/source proof. No reset/new-round, HTTP, queue or worker is exposed.
export class ConnectionMaintenanceStore {
  constructor(private readonly pool: Pool, private readonly context: MaintenanceCurrentContext | null = null) {}
  private async tx<T>(expected: ConnectionMaintenanceScope, fn: (c: PoolClient, currentTask: TaskRecoveryScope | null, submission: z.infer<typeof submissionSchema> | null | undefined) => Promise<T>): Promise<T> {
    if (!this.context) return fail("CURRENT_CONTEXT_UNAVAILABLE");
    let c: PoolClient; try { c = await this.pool.connect(); } catch { return fail("DATABASE_UNAVAILABLE"); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      if ((await c.query(`SELECT device_id FROM ${s}.devices WHERE device_id=$1 FOR UPDATE`, [expected.deviceId])).rowCount !== 1) return fail("STALE_SCOPE");
      // Shared order: device -> maintenance -> task. Resolver is DB-only and
      // must not acquire upstream provider/install locks or call remote I/O.
      let current: Awaited<ReturnType<MaintenanceCurrentContext["resolve"]>>;
      try { current = await this.context.resolve(c, Object.freeze(structuredClone(expected))); } catch { return fail("CURRENT_CONTEXT_UNAVAILABLE"); }
      if (!current) return fail("CURRENT_CONTEXT_UNAVAILABLE");
      const p = z.strictObject({ scope: z.unknown(), currentTask: z.unknown().nullable(), taskSubmission: submissionSchema.nullable().optional() }).safeParse(current);
      if (!p.success) return fail("CURRENT_CONTEXT_UNAVAILABLE");
      if (canonical(scope(p.data.scope)) !== canonical(expected)) return fail("STALE_SCOPE");
      const currentTask = p.data.currentTask === null ? null : parseTaskRecoveryScope(p.data.currentTask);
      if (currentTask && currentTask.deviceId.toLowerCase() !== expected.deviceId) return fail("STALE_SCOPE");
      if (currentTask === null && p.data.taskSubmission != null) return fail("CURRENT_CONTEXT_UNAVAILABLE");
      const result = await fn(c, currentTask, p.data.taskSubmission); await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { return fail("DATABASE_UNAVAILABLE"); }
      if (e instanceof MaintenanceStoreError || e instanceof ConnectionMaintenanceError || e instanceof RecoveryBudgetError) throw e;
      return fail("DATABASE_UNAVAILABLE");
    } finally { c.release(); }
  }
  async initialize(input: unknown, key: string, limits: unknown) {
    boundary(0, key); const expected = scope(input), config = createConnectionMaintenanceRound(expected, limits, "2026-10-01T00:00:00Z").limits, hash = digest({ scope: expected, limits: config });
    return this.tx(expected, async c => {
      const old = await load(c, expected);
      if (old) {
        if (!await replay(c, expected.deviceId, 0, key, "initialize", hash)) return fail("STALE_VERSION");
        return { record: old, replayed: true };
      }
      const r = createConnectionMaintenanceRound(expected, config, await clock(c));
      await save(c, r, false); await acknowledge(c, r, 0, key, "initialize", hash); return { record: r, replayed: false };
    });
  }
  async apply(input: unknown, version: number, key: string, commandInput: unknown) {
    boundary(version, key); const expected = scope(input), p = commandSchema.safeParse(commandInput);
    if (!p.success) return fail("INPUT_INVALID"); const command = p.data, hash = digest(command);
    return this.tx(expected, async (c, currentTask, submission) => {
      const r = await load(c, expected); if (!r) return fail("STALE_SCOPE");
      // Current context precedes cache. A historical command is not a new
      // budget reservation and must never return an old executable decision.
      if (await replay(c, expected.deviceId, version, key, command.kind, hash)) return { record: r, replayed: true, joint: null };
      if (r.version !== version) return fail("STALE_VERSION");
      const now = await clock(c); let next: ConnectionMaintenanceRound, joint: ReturnType<typeof evaluateJointRecoveryBudgets> | null = null;
      switch (command.kind) {
        case "begin":
          // This legacy maintenance-only command never bypasses task budget.
          if (currentTask !== null) return fail("TASK_BUDGET_REQUIRED");
          next = beginConnectionMaintenance(r, expected, command.recoveryId, command.endpoint, now);
          if (next.attemptsUsed > r.attemptsUsed) await reserve(c, next, null); break;
        case "observe": next = observeConnectionMaintenance(r, now); break;
        case "complete": {
          const nextRecord = completeConnectionMaintenance(r, command.receipt, now);
          const receiptId = z.strictObject({ scope: z.unknown(), recoveryId: normalizedId, endpoint: z.unknown(), outcome: z.unknown() }).parse(command.receipt).recoveryId;
          if (await reservedTask(c, r, receiptId)) return fail("TASK_BUDGET_REQUIRED");
          next = nextRecord; break;
        }
        case "require_human": next = requireConnectionMaintenanceHuman(r, expected, command.reason, now); break;
        case "observe_joint": {
          const original = await task(c, currentTask, expected.deviceId);
          joint = evaluateJointRecoveryBudgets(r, original, await clock(c)); next = joint.maintenance;
          if (joint.task && original) await saveTask(c, original, joint.task, key, "observe", expected);
          break;
        }
        case "reserve_joint": {
          const original = await task(c, currentTask, expected.deviceId), lockedNow = await clock(c);
          if (original && submission == null) return fail("CURRENT_CONTEXT_UNAVAILABLE");
          joint = evaluateJointRecoveryBudgets(r, original, lockedNow); next = joint.maintenance;
          let nextTask = joint.task, taskKind: "begin" | "observe" = "observe";
          if (original && submission === "possible_submission" && original.phase === "available") {
            nextTask = beginTaskRecovery(original, original.scope, command.recoveryId, "network", lockedNow, submission); taskKind = "begin";
          } else if ((!original || submission === "pre_submission") && joint.budgetsAvailable) {
            next = beginConnectionMaintenance(r, expected, command.recoveryId, command.endpoint, lockedNow);
            if (original) { nextTask = beginTaskRecovery(original, original.scope, command.recoveryId, "network", lockedNow, "pre_submission"); taskKind = "begin"; }
            await reserve(c, next, original?.scope ?? null);
          } else {
            if (r.phase === "available" && (r.attemptsUsed >= r.limits.maxAttempts || r.elapsedMs >= r.limits.maxElapsedMs)) {
              next = beginConnectionMaintenance(r, expected, command.recoveryId, command.endpoint, lockedNow);
            }
            if (original && submission === "pre_submission" && original.phase === "available"
              && (original.attemptsUsed >= original.limits.maxAttempts || original.elapsedMs >= original.limits.maxElapsedMs)) {
              nextTask = beginTaskRecovery(original, original.scope, command.recoveryId, "network", lockedNow, submission); taskKind = "begin";
            }
          }
          if (original && nextTask) await saveTask(c, original, nextTask, key, taskKind, expected);
          // Reservation acknowledgement ONLY: no historical/live eligibility
          // result, action token, side effect, task resume or budget reset.
          joint = null;
          break;
        }
        case "complete_joint": {
          const receipt = command.receipt, linked = await reservedTask(c, r, receipt.recoveryId), original = await task(c, linked, expected.deviceId), lockedNow = await clock(c);
          if ((linked === null) !== (receipt.taskOutcome === null)) return fail("INPUT_INVALID");
          const expectedOutcome = receipt.outcome === "verified_connected" ? "verified_recovered" : receipt.outcome;
          if (original && receipt.taskOutcome !== expectedOutcome) return fail("INPUT_INVALID");
          next = completeConnectionMaintenance(r, { scope: receipt.scope, recoveryId: receipt.recoveryId, endpoint: receipt.endpoint, outcome: receipt.outcome }, lockedNow);
          if (original) {
            const completed = completeTaskRecovery(original, { scope: original.scope, recoveryId: receipt.recoveryId, outcome: receipt.taskOutcome }, lockedNow);
            await saveTask(c, original, completed, key, "complete", expected);
          }
          break;
        }
      }
      parseConnectionMaintenanceRound(next);
      await save(c, next, true); await acknowledge(c, next, version, key, command.kind, hash);
      return { record: next, replayed: false, joint };
    });
  }
  async read(input: unknown) {
    const expected = scope(input);
    return this.tx(expected, async c => { const r = await load(c, expected); if (!r) return fail("STALE_SCOPE"); return r; });
  }
}
