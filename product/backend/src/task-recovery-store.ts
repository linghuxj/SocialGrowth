import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import {
  RecoveryBudgetError, beginTaskRecovery, completeTaskRecovery, createTaskRecoveryRound, defaultTaskRecoveryLimits,
  observeTaskRecovery, parseTaskRecoveryRound, parseTaskRecoveryScope, requireRecoveryHuman,
  type TaskRecoveryRound, type TaskRecoveryScope,
} from "./task-recovery-budget.js";

export class RecoveryStoreError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "STALE_FACT" | "DATABASE_UNAVAILABLE") { super(`Recovery store rejected: ${code}`); }
}
const schema = "socialgrowth_product";
const scopeBoundary = z.strictObject({ taskId: uuidSchema, taskAttemptId: uuidSchema, deviceId: uuidSchema, roundId: uuidSchema });
const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("begin"), recoveryId: uuidSchema,
    fault: z.enum(["network", "page_load", "account_restricted", "human_verification", "identity_mismatch", "permission_changed"]),
    submission: z.enum(["pre_submission", "possible_submission", "verified_success"]) }),
  z.strictObject({ kind: z.literal("observe") }),
  z.strictObject({ kind: z.literal("complete"), receipt: z.strictObject({ scope: scopeBoundary, recoveryId: uuidSchema,
    outcome: z.enum(["failed", "verified_recovered", "unknown"]) }) }),
  z.strictObject({ kind: z.literal("require_human"), fault: z.enum(["account_restricted", "human_verification", "identity_mismatch", "permission_changed"]) }),
]);
export type TaskRecoveryCommand = z.infer<typeof commandSchema>;
export interface TaskRecoveryStoreResult { record: TaskRecoveryRound; replayed: boolean }
function fail(code: RecoveryStoreError["code"]): never { throw new RecoveryStoreError(code); }
function boundary(version: number, key: string): void {
  if (!Number.isSafeInteger(version) || version < 0 || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail("INVALID_BOUNDARY");
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest();
async function transact<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try { client = await pool.connect(); } catch { fail("DATABASE_UNAVAILABLE"); }
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { fail("DATABASE_UNAVAILABLE"); }
    if (error instanceof RecoveryBudgetError || error instanceof RecoveryStoreError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") fail("STALE_FACT");
    fail("DATABASE_UNAVAILABLE");
  } finally { client.release(); }
}
async function clock(client: PoolClient): Promise<string> {
  // Preserve PostgreSQL's fractional precision instead of pg Date's ms truncation.
  const result = await client.query<{ now: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`);
  if (!result.rows[0]) fail("DATABASE_UNAVAILABLE");
  return result.rows[0].now;
}
async function lockDevice(client: PoolClient, scope: TaskRecoveryScope): Promise<void> {
  const result = await client.query(`SELECT device_id FROM ${schema}.devices WHERE device_id=$1 FOR UPDATE`, [scope.deviceId]);
  if (!result.rowCount) fail("STALE_FACT");
}
async function load(client: PoolClient, scope: TaskRecoveryScope): Promise<TaskRecoveryRound> {
  const result = await client.query<{ record: unknown }>(`SELECT record FROM ${schema}.task_recovery_rounds WHERE task_attempt_id=$1 FOR UPDATE`, [scope.taskAttemptId]);
  if (!result.rows[0]) fail("STALE_FACT");
  const r = parseTaskRecoveryRound(result.rows[0].record);
  if (canonical(r.scope) !== canonical(scope)) fail("STALE_FACT");
  return r;
}
async function replay(client: PoolClient, scope: TaskRecoveryScope, version: number, key: string, kind: string, payload: Buffer): Promise<boolean> {
  const result = await client.query<{ expected_version: string; kind: string; payload_digest: Buffer }>(
    `SELECT expected_version::text,kind,payload_digest FROM ${schema}.task_recovery_commands WHERE task_attempt_id=$1 AND request_key=$2`, [scope.taskAttemptId, key],
  );
  const previous = result.rows[0];
  if (!previous) return false;
  if (previous.expected_version !== String(version) || previous.kind !== kind || !previous.payload_digest.equals(payload)) fail("STALE_FACT");
  return true;
}
async function saveCommand(client: PoolClient, r: TaskRecoveryRound, version: number, key: string, kind: string, payload: Buffer): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.task_recovery_commands(task_attempt_id,request_key,expected_version,kind,payload_digest,applied_version) VALUES($1,$2,$3,$4,$5,$6)`,
    [r.scope.taskAttemptId, key, version, kind, payload, r.version],
  );
  await client.query(
    `INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts)
      VALUES($1,'system',$2,'task_recovery',$3,$4,$5)`,
    [randomUUID(), `task_recovery.${kind}`, r.scope.taskAttemptId, key,
      { version: r.version, phase: r.phase, attemptsUsed: r.attemptsUsed, elapsedMs: r.elapsedMs, roundId: r.scope.roundId }],
  );
}

// Internal durable budget only. This is not phone permission, task creation,
// BullMQ dispatch or a new human-reviewed round. No HTTP/worker consumes it.
// Submission, faults and completion must be trusted factual adapter outputs,
// never a client's/model's request to bypass an unknown publication.
export class TaskRecoveryStore {
  constructor(private readonly pool: Pool) {}

  async initialize(inputScope: unknown, key: string, limits: unknown = defaultTaskRecoveryLimits): Promise<TaskRecoveryStoreResult> {
    boundary(0, key);
    const scope = parseTaskRecoveryScope(inputScope);
    // Validate and normalize trusted configuration BEFORE hashing or writing.
    const config = createTaskRecoveryRound(scope, "2026-09-30T00:00:00Z", limits).limits;
    const payload = digest({ scope, limits: config });
    return transact(this.pool, async client => {
      await lockDevice(client, scope);
      const existing = await client.query(`SELECT 1 FROM ${schema}.task_recovery_rounds WHERE task_attempt_id=$1`, [scope.taskAttemptId]);
      if (existing.rowCount) {
        const record = await load(client, scope);
        if (!await replay(client, scope, 0, key, "initialize", payload)) fail("STALE_FACT");
        return { record, replayed: true };
      }
      const record = createTaskRecoveryRound(scope, await clock(client), config);
      await client.query(
        `INSERT INTO ${schema}.task_recovery_rounds(task_attempt_id,task_id,device_id,round_id,version,phase,record) VALUES($1,$2,$3,$4,0,'available',$5)`,
        [scope.taskAttemptId, scope.taskId, scope.deviceId, scope.roundId, record],
      );
      await saveCommand(client, record, 0, key, "initialize", payload);
      return { record, replayed: false };
    });
  }

  async apply(inputScope: unknown, expectedVersion: number, key: string, input: unknown): Promise<TaskRecoveryStoreResult> {
    boundary(expectedVersion, key);
    const scope = parseTaskRecoveryScope(inputScope), parsed = commandSchema.safeParse(input);
    if (!parsed.success) fail("INVALID_BOUNDARY");
    const command = parsed.data, payload = digest(command);
    return transact(this.pool, async client => {
      await lockDevice(client, scope);
      const r = await load(client, scope);
      if (await replay(client, scope, expectedVersion, key, command.kind, payload)) return { record: r, replayed: true };
      if (r.version !== expectedVersion) fail("STALE_FACT");
      const now = await clock(client);
      let next: TaskRecoveryRound;
      switch (command.kind) {
        case "begin": next = beginTaskRecovery(r, scope, command.recoveryId, command.fault, now, command.submission); break;
        case "observe": next = observeTaskRecovery(r, now); break;
        case "complete": next = completeTaskRecovery(r, command.receipt, now); break;
        case "require_human": next = requireRecoveryHuman(r, scope, command.fault, now); break;
      }
      parseTaskRecoveryRound(next);
      // Config is pinned for this round. No executor/model command can raise it.
      if (canonical(next.limits) !== canonical(r.limits)) fail("INVALID_BOUNDARY");
      const result = await client.query(
        `UPDATE ${schema}.task_recovery_rounds SET version=$2,phase=$3,record=$4 WHERE task_attempt_id=$1 AND version=$5`,
        [scope.taskAttemptId, next.version, next.phase, next, expectedVersion],
      );
      if (result.rowCount !== 1) fail("STALE_FACT");
      await saveCommand(client, next, expectedVersion, key, command.kind, payload);
      return { record: next, replayed: false };
    });
  }

  async read(inputScope: unknown): Promise<TaskRecoveryRound> {
    const scope = parseTaskRecoveryScope(inputScope);
    try {
      const result = await this.pool.query<{ record: unknown }>(`SELECT record FROM ${schema}.task_recovery_rounds WHERE task_attempt_id=$1`, [scope.taskAttemptId]);
      if (!result.rows[0]) fail("STALE_FACT");
      const r = parseTaskRecoveryRound(result.rows[0].record);
      if (canonical(r.scope) !== canonical(scope)) fail("STALE_FACT");
      return r;
    } catch (error) {
      if (error instanceof RecoveryStoreError || error instanceof RecoveryBudgetError) throw error;
      fail("DATABASE_UNAVAILABLE");
    }
  }
}
