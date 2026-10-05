import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";

const schema = "socialgrowth_product";
const linkInputSchema = z.strictObject({ taskAttemptId: uuidSchema, taskId: uuidSchema, todoId: uuidSchema, deviceId: uuidSchema });
const stateSchema = z.enum(["not_requested", "pending", "claimed", "verified_recovered", "still_blocked", "unknown"]);
const blockersSchema = z.array(z.string().min(1).max(120)).max(32);
const finishSchema = z.strictObject({
  status: z.enum(["verified_recovered", "still_blocked", "unknown"]),
  blockers: blockersSchema,
  checkedAt: timestampSchema,
});
export type TaskAssistanceRecheckStatus = z.infer<typeof stateSchema>;
export interface TaskAssistanceRecheckView {
  status: Exclude<TaskAssistanceRecheckStatus, "claimed">;
  blockers: string[];
  checkedAt: string | null;
}
export interface TaskAssistanceRecheckClaim {
  taskAttemptId: string;
  taskId: string;
  todoId: string;
  deviceId: string;
  noteId: string;
  version: number;
  claimToken: string;
  idempotencyKey: string;
  reconcileOnly: boolean;
}
export type TaskAssistanceRecheckResult = z.infer<typeof finishSchema>;

export class TaskAssistanceRecheckStoreError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "STALE_FACT" | "DATABASE_UNAVAILABLE", readonly databaseCode?: string) {
    super(`Task assistance recheck rejected: ${code}`);
  }
}
function fail(code: TaskAssistanceRecheckStoreError["code"]): never { throw new TaskAssistanceRecheckStoreError(code); }
function mapStatus(value: unknown): TaskAssistanceRecheckView["status"] {
  const status = stateSchema.parse(value);
  return status === "claimed" ? "pending" : status;
}

export class TaskAssistanceRecheckStore {
  constructor(private readonly pool: Pool) {}

  // INTERNAL ONLY: caller must be the producer that knows the exact task
  // attempt and exact todo occurrence. SQL independently checks reserved-device
  // equality and that the todo recorded an impact on that device.
  async linkExact(input: unknown): Promise<void> {
    const parsed = linkInputSchema.safeParse(input);
    if (!parsed.success) fail("INVALID_BOUNDARY");
    const value = parsed.data;
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { fail("DATABASE_UNAVAILABLE"); }
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      const attempt = await client.query<{ task_id: string; reserved_device_id: string }>(
        `SELECT task_id,reserved_device_id FROM ${schema}.business_plan_task_attempts WHERE task_attempt_id=$1 FOR SHARE`, [value.taskAttemptId]);
      const todo = await client.query(`SELECT todo_id FROM ${schema}.device_assistance_todos WHERE todo_id=$1 FOR SHARE`, [value.todoId]);
      const impact = await client.query(`SELECT 1 FROM ${schema}.device_assistance_impacts WHERE todo_id=$1 AND device_id=$2`, [value.todoId, value.deviceId]);
      if (attempt.rows[0]?.task_id !== value.taskId || attempt.rows[0]?.reserved_device_id !== value.deviceId || !todo.rowCount || !impact.rowCount) fail("STALE_FACT");
      const inserted = await client.query(`INSERT INTO ${schema}.task_assistance_recheck_links(task_attempt_id,task_id,todo_id,device_id,status,last_reported_note_id)
        SELECT $1,$2,$3,$4,CASE WHEN latest.note_id IS NULL THEN 'not_requested' ELSE 'pending' END,latest.note_id
        FROM (SELECT (SELECT note_id FROM ${schema}.device_assistance_notes WHERE todo_id=$3 AND kind='reported_processed'
          ORDER BY recorded_at DESC,note_id DESC LIMIT 1) AS note_id) latest
        ON CONFLICT DO NOTHING RETURNING task_attempt_id`, [value.taskAttemptId, value.taskId, value.todoId, value.deviceId]);
      if (!inserted.rowCount) {
        const existing = await client.query<{ task_id: string; todo_id: string; device_id: string }>(
          `SELECT task_id,todo_id,device_id FROM ${schema}.task_assistance_recheck_links WHERE task_attempt_id=$1 OR todo_id=$2 FOR SHARE`, [value.taskAttemptId, value.todoId]);
        const row = existing.rows[0];
        if (existing.rowCount !== 1 || row?.task_id !== value.taskId || row.todo_id !== value.todoId || row.device_id !== value.deviceId) fail("STALE_FACT");
      } else {
        await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,action,object_type,object_id,request_id,facts)
          VALUES($1,'system','task.assistance_linked','task_assistance_recheck',$2,$3,$4)`,
        [randomUUID(), value.taskAttemptId, value.taskAttemptId, { todoId: value.todoId, taskId: value.taskId, deviceId: value.deviceId }]);
      }
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { fail("DATABASE_UNAVAILABLE"); }
      if (error instanceof TaskAssistanceRecheckStoreError) throw error;
      const databaseCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
      if (databaseCode === "23503" || databaseCode === "23505" || databaseCode === "23514") fail("STALE_FACT");
      throw new TaskAssistanceRecheckStoreError("DATABASE_UNAVAILABLE", databaseCode);
    } finally { client.release(); }
  }

  // Called inside the same transaction that records the operator note. A
  // report requests new factual checking; it never writes a successful state.
  static async requestForReportedNote(client: PoolClient, todoId: string, noteId: string): Promise<void> {
    const current = await client.query<{ version: string; status: string }>(`SELECT version::text,status FROM ${schema}.task_assistance_recheck_links WHERE todo_id=$1 FOR UPDATE`, [todoId]);
    // Do not revoke/rebind a live claim when a second operator note arrives.
    // The in-flight trusted check already rereads current facts and owns its
    // stable note/idempotency key; its eventual receipt must remain attachable.
    if (current.rows[0]?.status === "claimed") return;
    if (current.rows[0] && Number(current.rows[0].version) >= Number.MAX_SAFE_INTEGER) fail("STALE_FACT");
    await client.query(`UPDATE ${schema}.task_assistance_recheck_links
      SET status='pending',blockers='[]'::jsonb,last_reported_note_id=$2,checked_at=NULL,
          claim_token=NULL,lease_until=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE todo_id=$1 AND version<9007199254740991`, [todoId, noteId]);
  }

  async read(todoId: string): Promise<TaskAssistanceRecheckView> {
    const parsedId = uuidSchema.safeParse(todoId);
    if (!parsedId.success) fail("INVALID_BOUNDARY");
    try {
      const result = await this.pool.query<{ status: string; blockers: unknown; checked_at: string | null }>(
        `SELECT status,blockers,to_char(checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at
        FROM ${schema}.task_assistance_recheck_links WHERE todo_id=$1`, [parsedId.data.toLowerCase()]);
      const row = result.rows[0];
      if (!row) return { status: "not_requested", blockers: [], checkedAt: null };
      return { status: mapStatus(row.status), blockers: blockersSchema.parse(row.blockers), checkedAt: row.checked_at };
    } catch (error) {
      if (error instanceof TaskAssistanceRecheckStoreError) throw error;
      fail("DATABASE_UNAVAILABLE");
    }
  }

  async readDisposition(taskId: string, taskAttemptId: string): Promise<{ status: TaskAssistanceRecheckStatus; blockers: string[] }> {
    const task = uuidSchema.safeParse(taskId), attempt = uuidSchema.safeParse(taskAttemptId);
    if (!task.success || !attempt.success) fail("INVALID_BOUNDARY");
    try {
      const result = await this.pool.query<{ task_id: string; status: string; blockers: unknown }>(
        `SELECT task_id,status,blockers FROM ${schema}.task_assistance_recheck_links WHERE task_attempt_id=$1`, [attempt.data.toLowerCase()]);
      const row = result.rows[0];
      if (!row) return { status: "not_requested", blockers: [] };
      if (row.task_id !== task.data.toLowerCase()) return { status: "unknown", blockers: ["task_attempt_scope_mismatch"] };
      return { status: stateSchema.parse(row.status), blockers: blockersSchema.parse(row.blockers) };
    } catch (error) {
      if (error instanceof TaskAssistanceRecheckStoreError) throw error;
      fail("DATABASE_UNAVAILABLE");
    }
  }

  async claimNext(leaseMs = 120_000): Promise<TaskAssistanceRecheckClaim | null> {
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) fail("INVALID_BOUNDARY");
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { fail("DATABASE_UNAVAILABLE"); }
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      const row = (await client.query<{ task_attempt_id: string; task_id: string; todo_id: string; device_id: string; note_id: string; version: string;
        status: "pending" | "claimed"; claim_token: string | null; lease_expired: boolean }>(
        `SELECT task_attempt_id,task_id,todo_id,device_id,last_reported_note_id AS note_id,version::text,status,claim_token,
          (status='claimed' AND lease_until<=clock_timestamp()) AS lease_expired
         FROM ${schema}.task_assistance_recheck_links
         WHERE (status='pending' OR (status='claimed' AND lease_until<=clock_timestamp())) AND last_reported_note_id IS NOT NULL
         ORDER BY updated_at,task_attempt_id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if (!row) { await client.query("COMMIT"); return null; }
      const reconcileOnly = row.status === "claimed";
      const claimToken = reconcileOnly ? row.claim_token : randomUUID();
      if (!claimToken || (reconcileOnly && row.lease_expired !== true)) fail("STALE_FACT");
      const version = Number(row.version);
      const idempotencyKey = `assistance_recheck_${row.task_attempt_id.replaceAll("-", "")}_${version}`;
      const updated = reconcileOnly
        ? await client.query(`UPDATE ${schema}.task_assistance_recheck_links SET lease_until=clock_timestamp()+($3::int * interval '1 millisecond'),updated_at=clock_timestamp()
          WHERE task_attempt_id=$1 AND version=$4 AND status='claimed' AND claim_token=$2 RETURNING task_attempt_id`,
        [row.task_attempt_id, claimToken, leaseMs, version])
        : await client.query(`UPDATE ${schema}.task_assistance_recheck_links SET status='claimed',claim_token=$2,
          lease_until=clock_timestamp()+($3::int * interval '1 millisecond'),updated_at=clock_timestamp()
          WHERE task_attempt_id=$1 AND version=$4 AND status='pending' RETURNING task_attempt_id`,
        [row.task_attempt_id, claimToken, leaseMs, version]);
      if (updated.rowCount !== 1) fail("STALE_FACT");
      await client.query("COMMIT");
      return { taskAttemptId: row.task_attempt_id, taskId: row.task_id, todoId: row.todo_id, deviceId: row.device_id,
        noteId: row.note_id, version, claimToken, idempotencyKey, reconcileOnly };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { fail("DATABASE_UNAVAILABLE"); }
      if (error instanceof TaskAssistanceRecheckStoreError) throw error;
      fail("DATABASE_UNAVAILABLE");
    } finally { client.release(); }
  }

  async complete(claim: TaskAssistanceRecheckClaim, input: unknown): Promise<void> {
    const result = finishSchema.safeParse(input);
    const token = uuidSchema.safeParse(claim.claimToken), attempt = uuidSchema.safeParse(claim.taskAttemptId);
    const task = uuidSchema.safeParse(claim.taskId), todo = uuidSchema.safeParse(claim.todoId), device = uuidSchema.safeParse(claim.deviceId);
    const note = uuidSchema.safeParse(claim.noteId);
    if (!result.success || !token.success || !attempt.success || !task.success || !todo.success || !device.success || !note.success
      || !Number.isSafeInteger(claim.version) || claim.version < 0) fail("INVALID_BOUNDARY");
    try {
      const updated = await this.pool.query(`UPDATE ${schema}.task_assistance_recheck_links SET status=$8,blockers=$9,checked_at=$10,
        claim_token=NULL,lease_until=NULL,version=version+1,updated_at=clock_timestamp()
        WHERE task_attempt_id=$1 AND task_id=$2 AND todo_id=$3 AND device_id=$4 AND last_reported_note_id=$5
          AND version=$6 AND status='claimed' AND claim_token=$7 RETURNING task_attempt_id`,
        [attempt.data, task.data, todo.data, device.data, note.data, claim.version, token.data, result.data.status, result.data.blockers, result.data.checkedAt]);
      if (updated.rowCount !== 1) fail("STALE_FACT");
    } catch (error) {
      if (error instanceof TaskAssistanceRecheckStoreError) throw error;
      fail("DATABASE_UNAVAILABLE");
    }
  }
}
