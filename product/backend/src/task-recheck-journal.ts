import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { centralPublicationTaskSchema, compareTimestamps, requestMetadataSchema, taskDispatchNoticeSchema, timestampSchema, uuidSchema, type CentralPublicationTask, type TaskDispatchNotice } from "@socialgrowth/product-contracts";
import { canonicalMaterial } from "./material-registry-core.js";
import { createTaskRecheckNotice } from "./task-dispatch-core.js";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const s = "socialgrowth_product";
export class TaskRecheckJournalError extends Error {
  constructor(readonly code: "CORRUPT_HISTORY" | "TRANSPORT_REQUIRED" | "TRANSPORT_UNAVAILABLE") { super(code); }
}
const saveSchema = z.strictObject({ metadata: requestMetadataSchema, expectedCurrentRevision: z.int().min(0).max(999), task: centralPublicationTaskSchema })
  .refine(v => v.task.taskRevision === v.expectedCurrentRevision + 1);
function normalize(task: CentralPublicationTask): CentralPublicationTask {
  const copy = structuredClone(task);
  for (const key of ["taskId", "projectId", "taskAttemptId", "deviceId", "identityId", "assignmentId", "approvalId", "contentUnitId", "variantId"] as const) copy[key] = copy[key].toLowerCase();
  copy.recovery.roundId = copy.recovery.roundId.toLowerCase(); for (const object of copy.objects) object.objectId = object.objectId.toLowerCase(); return copy;
}
function corrupt(): never { throw new TaskRecheckJournalError("CORRUPT_HISTORY"); }
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Pending task reference changed");
async function fresh(c: PoolClient, a: OperatorSessionContext) {
  const row = (await c.query<{ now: string }>(`WITH t AS MATERIALIZED(SELECT clock_timestamp() now) SELECT to_char(t.now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') now FROM ${s}.operator_sessions x CROSS JOIN t
    WHERE x.session_id=$1 AND x.operator_id=$2 AND x.revoked_at IS NULL AND x.expires_at>t.now`, [a.sessionId, a.operator.operatorId])).rows[0];
  if (!row) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired"); return row.now;
}
interface RecordRow { task_id: string; project_id: string; current_revision: string; status: string; execution_allowed: boolean }
interface RevisionRow { revision: string; contract: unknown; notice: unknown; message_id: string; recorded_at: string; recorded_by_operator_id: string }
export interface TaskNoticeTransport { send(notice: unknown): Promise<unknown> }
const acceptance = z.strictObject({ messageId: uuidSchema, queueAcceptance: z.literal("observed"), executionAllowed: z.literal(false), publicationAllowed: z.literal(false) });
// Authenticated PENDING reference journal ONLY. No approved-fact producer,
// admitted Task/quota writer, HTTP or Worker. UUIDs are declarations, not truth.
export class TaskRecheckJournal {
  #pool: Pool; #auth: OperatorAuthService;
  constructor(pool: Pool, auth: OperatorAuthService) { this.#pool = pool; this.#auth = auth; }
  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, a: OperatorSessionContext) => Promise<T>) {
    let c: PoolClient; try { c = await this.#pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Task reference journal unavailable", true); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`); const a = await this.#auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      if ((await c.query(`SELECT 1 FROM ${s}.task_recheck_guard FOR UPDATE`)).rowCount !== 1) return corrupt();
      await fresh(c, a); const result = await fn(c, a); await fresh(c, a); await c.query("COMMIT"); return result;
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Task reference journal unavailable", true); }
      if (error instanceof ProductTransactionError || error instanceof TaskRecheckJournalError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Task reference journal unavailable", true);
    } finally { c.release(); }
  }
  private async affected(c: PoolClient, sql: string, values: unknown[]) { if ((await c.query(sql, values)).rowCount !== 1) throw new ProductTransactionError("INTERNAL_ERROR", "Task reference journal unavailable", true); }
  private async project(c: PoolClient, project: string) { if ((await c.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [project])).rowCount !== 1) throw stale(); }
  private async load(c: PoolClient, taskId: string) {
    const row = (await c.query<RecordRow>(`SELECT *,current_revision::text FROM ${s}.task_recheck_records WHERE task_id=$1`, [taskId])).rows[0]; if (!row) return null;
    if (row.status !== "pending_current_checks" || row.execution_allowed !== false) return corrupt();
    const rows = (await c.query<RevisionRow>(`SELECT r.*,r.revision::text FROM ${s}.task_recheck_revisions r WHERE r.task_id=$1 ORDER BY r.revision LIMIT 1001`, [taskId])).rows;
    if (!rows.length || rows.length > 1000 || String(rows.length) !== row.current_revision) return corrupt();
    let previous: string | null = null, binding: string | null = null;
    const revisions = [];
    for (const [index, r] of rows.entries()) {
      const p = centralPublicationTaskSchema.safeParse(r.contract), n = taskDispatchNoticeSchema.safeParse(r.notice);
      if (!p.success || !n.success || r.revision !== String(index + 1) || p.data.taskId !== taskId || p.data.taskRevision !== index + 1 || p.data.projectId !== row.project_id
        || n.data.messageId !== r.message_id || canonicalMaterial(n.data) !== canonicalMaterial(createTaskRecheckNotice(p.data, r.message_id))
        || canonicalMaterial(p.data) !== canonicalMaterial(normalize(p.data)) || !uuidSchema.safeParse(r.recorded_by_operator_id).success
        || !timestampSchema.safeParse(r.recorded_at).success || r.recorded_at.startsWith("0000-") || (previous && compareTimestamps(previous, r.recorded_at)! > 0)) return corrupt();
      const currentBinding = canonicalMaterial({ projectId: p.data.projectId, taskAttemptId: p.data.taskAttemptId, deviceId: p.data.deviceId, identityId: p.data.identityId,
        contentUnitId: p.data.contentUnitId, variantId: p.data.variantId, platform: p.data.platform, form: p.data.form, recovery: p.data.recovery });
      if (binding && binding !== currentBinding) return corrupt(); binding = currentBinding; previous = r.recorded_at;
      if ((await c.query(`SELECT 1 FROM ${s}.task_recheck_outbox WHERE message_id=$1 AND task_id=$2 AND revision=$3`, [r.message_id, taskId, index + 1])).rowCount !== 1) return corrupt();
      revisions.push({ contract: p.data, notice: n.data, recordedAt: r.recorded_at });
    }
    return { projectId: row.project_id, taskId, currentRevision: rows.length, status: "pending_current_checks" as const, executionAllowed: false as const, publicationAllowed: false as const, revisions };
  }
  async read(token: string, projectId: string, taskId: string) {
    if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(taskId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid pending task locator");
    return this.tx(token, null, async c => { await this.project(c, projectId.toLowerCase()); const record = await this.load(c, taskId.toLowerCase()); if (!record || record.projectId !== projectId.toLowerCase()) throw stale(); return record; });
  }
  async save(token: string, csrf: string, input: unknown) {
    const p = saveSchema.safeParse(input); if (!p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid pending task reference");
    const r = p.data, task = normalize(r.task), key = r.metadata.idempotencyKey, digest = createHash("sha256").update(canonicalMaterial({ task, expectedCurrentRevision: r.expectedCurrentRevision })).digest();
    return this.tx(token, csrf, async (c, a) => {
      await this.project(c, task.projectId); const old = (await c.query<{ payload_digest: Buffer; task_id: string }>(`SELECT payload_digest,task_id FROM ${s}.task_recheck_commands WHERE actor_id=$1 AND request_key=$2`, [a.operator.operatorId, key])).rows[0];
      const saved = await this.load(c, task.taskId);
      if (old) { if (old.task_id !== task.taskId || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Task request key belongs to different inputs"); if (!saved) return corrupt(); return { ...saved, changed: false, replayed: true }; }
      if ((saved?.currentRevision ?? 0) !== r.expectedCurrentRevision || (saved && saved.projectId !== task.projectId)) throw stale();
      const prior = saved?.revisions.at(-1)?.contract;
      if (prior && ["taskAttemptId", "deviceId", "identityId", "contentUnitId", "variantId", "platform", "form"].some(key => prior[key as keyof CentralPublicationTask] !== task[key as keyof CentralPublicationTask])) throw stale();
      if (prior && (prior.recovery.roundId !== task.recovery.roundId || canonicalMaterial(prior.recovery) !== canonicalMaterial(task.recovery))) throw stale();
      const messageId = randomUUID(), notice = createTaskRecheckNotice(task, messageId), now = await fresh(c, a);
      if (saved && compareTimestamps(saved.revisions.at(-1)!.recordedAt, now)! > 0) throw stale();
      if (!saved) await this.affected(c, `INSERT INTO ${s}.task_recheck_records(task_id,project_id,current_revision) VALUES($1,$2,1)`, [task.taskId, task.projectId]);
      else await this.affected(c, `UPDATE ${s}.task_recheck_records SET current_revision=$2 WHERE task_id=$1 AND current_revision=$3`, [task.taskId, task.taskRevision, r.expectedCurrentRevision]);
      await this.affected(c, `INSERT INTO ${s}.task_recheck_revisions(task_id,revision,contract,notice,message_id,recorded_by_operator_id,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [task.taskId, task.taskRevision, task, notice, messageId, a.operator.operatorId, now]);
      await this.affected(c, `INSERT INTO ${s}.task_recheck_outbox(message_id,task_id,revision) VALUES($1,$2,$3)`, [messageId, task.taskId, task.taskRevision]);
      await this.affected(c, `INSERT INTO ${s}.task_recheck_commands(actor_id,request_key,payload_digest,task_id) VALUES($1,$2,$3,$4)`, [a.operator.operatorId, key, digest, task.taskId]);
      await this.affected(c, `INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'task.pending_recheck_recorded','pending_task_reference',$3,$4,$5)`, [randomUUID(), a.operator.operatorId, task.taskId, r.metadata.requestId, { revision: task.taskRevision, status: "pending_current_checks", messageId }]);
      const current = await this.load(c, task.taskId); if (!current) return corrupt(); return { ...current, changed: true, replayed: false };
    });
  }
  async relayOne(transport: TaskNoticeTransport | null = null, claimLeaseMs = 5000) {
    if (!transport) throw new TaskRecheckJournalError("TRANSPORT_REQUIRED");
    if (!Number.isSafeInteger(claimLeaseMs) || claimLeaseMs < 100 || claimLeaseMs > 60000) throw new ProductTransactionError("INPUT_INVALID", "Invalid recheck transport boundary");
    let c: PoolClient; try { c = await this.#pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Task outbox unavailable", true); }
    let claim: { notice: TaskDispatchNotice; deliveryToken: string } | null = null;
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      if ((await c.query(`SELECT 1 FROM ${s}.task_recheck_guard FOR UPDATE`)).rowCount !== 1) return corrupt();
      const row = (await c.query<{ task_id: string; message_id: string; revision: string }>(`SELECT o.task_id,o.message_id,o.revision::text FROM ${s}.task_recheck_outbox o
        JOIN ${s}.task_recheck_records r ON r.task_id=o.task_id AND r.current_revision=o.revision
        WHERE o.next_attempt_at<=clock_timestamp() AND o.attempts<9007199254740991 ORDER BY o.next_attempt_at,o.message_id LIMIT 1 FOR UPDATE OF o`)).rows[0];
      if (row) {
        const record = await this.load(c, row.task_id), latest = record?.revisions.at(-1);
        if (!latest || String(record!.currentRevision) !== row.revision || latest.notice.messageId !== row.message_id) return corrupt();
        const deliveryToken = randomUUID();
        await this.affected(c, `UPDATE ${s}.task_recheck_outbox SET delivery_token=$2,attempts=attempts+1,next_attempt_at=clock_timestamp()+$3::int*interval '1 millisecond' WHERE message_id=$1`, [row.message_id, deliveryToken, claimLeaseMs]);
        claim = { notice: structuredClone(latest.notice), deliveryToken };
      }
      await c.query("COMMIT");
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Task outbox unavailable", true); }
      if (error instanceof TaskRecheckJournalError) throw error; throw new ProductTransactionError("INTERNAL_ERROR", "Task outbox unavailable", true);
    } finally { c.release(); }
    if (!claim) return { relayStatus: "idle" as const, executionAllowed: false as const, publicationAllowed: false as const };
    // Claim is committed, connection/guard/auth/project locks released BEFORE
    // Redis IO. A lease/timeout is NOT proof another process/phone has stopped.
    let response: z.infer<typeof acceptance>;
    try {
      response = acceptance.parse(await transport.send(structuredClone(claim.notice)));
      if (response.messageId.toLowerCase() !== claim.notice.messageId) throw new TaskRecheckJournalError("TRANSPORT_UNAVAILABLE");
    } catch { return { relayStatus: "delivery_unknown" as const, messageId: claim.notice.messageId, executionAllowed: false as const, publicationAllowed: false as const }; }
    let result;
    try { result = await this.#pool.query(`UPDATE ${s}.task_recheck_outbox SET queue_observed_at=clock_timestamp() WHERE message_id=$1 AND delivery_token=$2`, [claim.notice.messageId, claim.deliveryToken]); }
    catch { throw new ProductTransactionError("INTERNAL_ERROR", "Task outbox acknowledgement unavailable", true); }
    if (result.rowCount !== 0 && result.rowCount !== 1) return corrupt();
    return { relayStatus: result.rowCount === 1 ? "queue_observed" as const : "reconciliation_required" as const, messageId: claim.notice.messageId, executionAllowed: false as const, publicationAllowed: false as const };
    // Queue ACK is informational. Outbox is NOT deleted/completed; only future
    // centrally authenticated consumption can close it. Until then original-ID
    // reconciliation remains possible after lease expiry or Redis data loss.
  }
}
