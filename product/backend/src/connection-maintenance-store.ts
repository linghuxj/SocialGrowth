import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import {
  beginConnectionMaintenance, completeConnectionMaintenance, ConnectionMaintenanceError,
  createConnectionMaintenanceRound, evaluateJointRecoveryBudgets, observeConnectionMaintenance,
  parseConnectionMaintenanceRound, requireConnectionMaintenanceHuman,
  type ConnectionMaintenanceRound, type ConnectionMaintenanceScope,
} from "./connection-maintenance-budget.js";
import { parseTaskRecoveryRound, parseTaskRecoveryScope, RecoveryBudgetError, type TaskRecoveryScope } from "./task-recovery-budget.js";

const s = "socialgrowth_product";
const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("begin"), recoveryId: uuidSchema, endpoint: z.unknown() }),
  z.strictObject({ kind: z.literal("observe") }),
  z.strictObject({ kind: z.literal("complete"), receipt: z.unknown() }),
  z.strictObject({ kind: z.literal("require_human"), reason: z.enum(["target_mismatch", "authority_changed", "human_intervention"]) }),
  z.strictObject({ kind: z.literal("observe_joint") }),
]);
export class MaintenanceStoreError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CURRENT_CONTEXT_UNAVAILABLE" | "STALE_SCOPE" | "STALE_VERSION" | "TASK_BUDGET_REQUIRED" | "CORRUPT_STATE" | "DATABASE_UNAVAILABLE") { super(code); }
}
const fail = (code: MaintenanceStoreError["code"]): never => { throw new MaintenanceStoreError(code); };
// Trusted DB-only broker seam, not client context, model flags or a live source
// proof. Resolve current locked binding AND actual task/absence. Default missing
// closes all methods before DB. No production resolver/HTTP/action registration.
export interface MaintenanceCurrentContext {
  resolve(client: PoolClient, expected: Readonly<ConnectionMaintenanceScope>): Promise<{ scope: ConnectionMaintenanceScope; currentTask: TaskRecoveryScope | null } | null>;
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

// Budget persistence ONLY, never actor permission/connection dispatch. Context
// must be supplied by the future current-fact broker; an enrollment FK is not
// admission/source proof. No reset/new-round, HTTP, queue or worker is exposed.
export class ConnectionMaintenanceStore {
  constructor(private readonly pool: Pool, private readonly context: MaintenanceCurrentContext | null = null) {}
  private async tx<T>(expected: ConnectionMaintenanceScope, fn: (c: PoolClient, currentTask: TaskRecoveryScope | null) => Promise<T>): Promise<T> {
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
      const p = z.strictObject({ scope: z.unknown(), currentTask: z.unknown().nullable() }).safeParse(current);
      if (!p.success) return fail("CURRENT_CONTEXT_UNAVAILABLE");
      if (canonical(scope(p.data.scope)) !== canonical(expected)) return fail("STALE_SCOPE");
      const currentTask = p.data.currentTask === null ? null : parseTaskRecoveryScope(p.data.currentTask);
      if (currentTask && currentTask.deviceId.toLowerCase() !== expected.deviceId) return fail("STALE_SCOPE");
      const result = await fn(c, currentTask); await c.query("COMMIT"); return result;
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
    return this.tx(expected, async (c, currentTask) => {
      const r = await load(c, expected); if (!r) return fail("STALE_SCOPE");
      // Current context precedes cache. A historical command is not a new
      // budget reservation and must never return an old executable decision.
      if (await replay(c, expected.deviceId, version, key, command.kind, hash)) return { record: r, replayed: true, joint: null };
      if (r.version !== version) return fail("STALE_VERSION");
      const now = await clock(c); let next: ConnectionMaintenanceRound, joint: ReturnType<typeof evaluateJointRecoveryBudgets> | null = null;
      switch (command.kind) {
        case "begin":
          // Atomic joint allocation is not implemented yet. Never use spare
          // maintenance budget to bypass a real current task's budget.
          if (currentTask !== null) return fail("TASK_BUDGET_REQUIRED");
          next = beginConnectionMaintenance(r, expected, command.recoveryId, command.endpoint, now); break;
        case "observe": next = observeConnectionMaintenance(r, now); break;
        case "complete": next = completeConnectionMaintenance(r, command.receipt, now); break;
        case "require_human": next = requireConnectionMaintenanceHuman(r, expected, command.reason, now); break;
        case "observe_joint": {
          const original = await task(c, currentTask, expected.deviceId);
          joint = evaluateJointRecoveryBudgets(r, original, await clock(c)); next = joint.maintenance;
          if (joint.task && original) {
            const saved = await c.query(`UPDATE ${s}.task_recovery_rounds SET version=$2,phase=$3,record=$4 WHERE task_attempt_id=$1 AND version=$5 RETURNING task_attempt_id`, [original.scope.taskAttemptId, joint.task.version, joint.task.phase, joint.task, original.version]);
            if (saved.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
            const ack = await c.query(`INSERT INTO ${s}.task_recovery_commands(task_attempt_id,request_key,expected_version,kind,payload_digest,applied_version) VALUES($1,$2,$3,'observe',$4,$5) RETURNING task_attempt_id`, [original.scope.taskAttemptId, `maint_${createHash("sha256").update(expected.deviceId + key).digest("hex")}`, original.version, digest({ maintenance: expected, key }), joint.task.version]);
            if (ack.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
            const audit = await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts)
              VALUES($1,'system','task_recovery.observe','task_recovery',$2,$3,$4) RETURNING audit_record_id`, [randomUUID(), original.scope.taskAttemptId, key,
              { version: joint.task.version, phase: joint.task.phase, attemptsUsed: joint.task.attemptsUsed, elapsedMs: joint.task.elapsedMs, maintenanceRoundId: expected.roundId }]);
            if (audit.rowCount !== 1) return fail("DATABASE_UNAVAILABLE");
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
