import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { projectLifecycleIntentViewSchema, updateProjectLifecycleIntentRequestSchema, updateProjectLifecycleIntentResponseSchema,
  withdrawMaterialRequestSchema, withdrawMaterialResponseSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { canonicalMaterial } from "./material-registry-core.js";
import { appendMaterialWithdrawn, appendProjectLifecycleIntentChanged } from "./business-plan-task-impact-writer.js";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const s = "socialgrowth_product";
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Project lifecycle facts are unavailable", true);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Project or material facts changed; read current facts before retrying");
const at = (field: string) => `to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface IntentRow { revision: string; intent: "pause_requested" | "resume_requested" | "end_requested"; request_id: string; recorded_at: string }
interface ProjectRow { fact_version: string }
interface ReceiptRow { payload_digest: Buffer; project_id: string; response: unknown }
interface TaskRow { task_id: string }

async function freshSession(c: PoolClient, context: OperatorSessionContext): Promise<void> {
  const row = await c.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND operator_id=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId, context.operator.operatorId]);
  if (row.rowCount !== 1) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
}

export class ProjectLifecycleService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}

  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, context: OperatorSessionContext) => Promise<T>): Promise<T> {
    let c: PoolClient;
    try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='15s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      const guards = ["material_registry_guard", "resource_reservation_guard", "business_plan_guard"];
      for (const guard of guards) if ((await c.query(`SELECT 1 FROM ${s}.${guard} WHERE singleton=true FOR UPDATE`)).rowCount !== 1) throw unavailable();
      const result = await fn(c, context);
      await freshSession(c, context);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof ProductTransactionError) throw error;
      throw unavailable();
    } finally { c.release(); }
  }

  private async project(c: PoolClient, projectId: string): Promise<ProjectRow> {
    const row = (await c.query<ProjectRow>(`SELECT fact_version::text FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
    if (!row) throw stale();
    return row;
  }

  private async latestIntent(c: PoolClient, projectId: string): Promise<IntentRow | null> {
    return (await c.query<IntentRow>(`SELECT revision::text,intent,request_id,${at("recorded_at")} recorded_at FROM ${s}.project_lifecycle_intents
      WHERE project_id=$1 ORDER BY revision DESC LIMIT 1`, [projectId])).rows[0] ?? null;
  }

  async read(token: string, projectInput: string) {
    const parsedId = uuidSchema.safeParse(projectInput);
    if (!parsedId.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project locator");
    return this.tx(token, null, async c => {
      const project = await c.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1`, [parsedId.data.toLowerCase()]);
      if (project.rowCount !== 1) throw stale();
      const row = await this.latestIntent(c, parsedId.data.toLowerCase());
      return projectLifecycleIntentViewSchema.parse({ projectId: parsedId.data.toLowerCase(), lifecycleRevision: row ? Number(row.revision) : 0,
        intent: row?.intent ?? null, requestId: row?.request_id ?? null, recordedAt: row?.recorded_at ?? null });
    });
  }

  async setIntent(token: string, csrf: string, projectInput: string, input: unknown) {
    const id = uuidSchema.safeParse(projectInput);
    const parsed = updateProjectLifecycleIntentRequestSchema.safeParse(input);
    if (!id.success || !parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project lifecycle command");
    const projectId = id.data.toLowerCase();
    const { metadata, expectedLifecycleRevision, intent } = parsed.data;
    const request = { contractVersion: metadata.contractVersion, projectId, expectedLifecycleRevision, intent };
    const digest = createHash("sha256").update(canonicalMaterial(request)).digest();

    return this.tx(token, csrf, async (c, context) => {
      const project = await this.project(c, projectId);
      const actorId = context.operator.operatorId;
      const existing = (await c.query<ReceiptRow>(`SELECT payload_digest,project_id,response FROM ${s}.business_plan_commands WHERE actor_id=$1 AND request_key=$2`,
        [actorId, metadata.idempotencyKey])).rows[0];
      if (existing) {
        if (existing.project_id !== projectId || !existing.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to different inputs");
        const receipt = updateProjectLifecycleIntentResponseSchema.parse(existing.response);
        return updateProjectLifecycleIntentResponseSchema.parse({ ...receipt, changed: false, replayed: true });
      }
      await this.assertNoForeignKey(c, actorId, metadata.idempotencyKey);

      const current = await this.latestIntent(c, projectId);
      const currentRevision = current ? Number(current.revision) : 0;
      if (currentRevision !== expectedLifecycleRevision || currentRevision >= Number.MAX_SAFE_INTEGER) throw stale();
      if (current?.intent === "end_requested" || (intent === "resume" && current?.intent !== "pause_requested")
        || (intent === "pause" && current?.intent === "pause_requested")) throw stale();

      const nextRevision = currentRevision + 1;
      const persistedIntent = `${intent}_requested` as IntentRow["intent"];
      const now = (await c.query<{ recorded_at: string }>(`SELECT ${at("clock_timestamp()")} recorded_at`)).rows[0]?.recorded_at;
      if (!now) throw unavailable();
      const inserted = await c.query(`INSERT INTO ${s}.project_lifecycle_intents(project_id,revision,intent,actor_id,request_id,request_key,payload_digest,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [projectId, nextRevision, persistedIntent, actorId, metadata.requestId, metadata.idempotencyKey, digest, now]);
      if (inserted.rowCount !== 1) throw unavailable();

      const impactedTaskCount = await appendProjectLifecycleIntentChanged(c, { projectId, lifecycleRevision: nextRevision, projectVersion: Number(project.fact_version) });
      const cancelledTaskCount = intent === "end"
        ? await this.cancelConfirmedNeverStarted(c, { projectId, reason: "project_end", requestId: metadata.requestId, sourceRevision: nextRevision, actorId })
        : 0;
      const response = updateProjectLifecycleIntentResponseSchema.parse({ projectId, lifecycleRevision: nextRevision, intent: persistedIntent,
        requestId: metadata.requestId, recordedAt: now, changed: true, replayed: false, impactedTaskCount, cancelledTaskCount });
      await c.query(`INSERT INTO ${s}.business_plan_commands(actor_id,request_key,payload_digest,project_id,response) VALUES($1,$2,$3,$4,$5)`,
        [actorId, metadata.idempotencyKey, digest, projectId, response]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'project.lifecycle_intent_changed','project',$3,$4,$5)`,
        [randomUUID(), actorId, projectId, metadata.requestId, { lifecycleRevision: nextRevision, intent: persistedIntent, impactedTaskCount, cancelledTaskCount }]);
      return response;
    });
  }

  async withdrawMaterial(token: string, csrf: string, projectInput: string, variantInput: string, input: unknown) {
    const project = uuidSchema.safeParse(projectInput), variant = uuidSchema.safeParse(variantInput);
    const parsed = withdrawMaterialRequestSchema.safeParse(input);
    if (!project.success || !variant.success || !parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid material withdrawal command");
    const projectId = project.data.toLowerCase(), variantId = variant.data.toLowerCase();
    const { metadata, expectedMaterialRevision } = parsed.data;
    const digest = createHash("sha256").update(canonicalMaterial({ contractVersion: metadata.contractVersion, projectId, variantId, expectedMaterialRevision })).digest();

    return this.tx(token, csrf, async (c, context) => {
      await this.project(c, projectId);
      const actorId = context.operator.operatorId;
      const existing = (await c.query<ReceiptRow>(`SELECT payload_digest,project_id,response FROM ${s}.business_plan_commands WHERE actor_id=$1 AND request_key=$2`,
        [actorId, metadata.idempotencyKey])).rows[0];
      if (existing) {
        if (existing.project_id !== projectId || !existing.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to different inputs");
        const receipt = withdrawMaterialResponseSchema.parse(existing.response);
        return withdrawMaterialResponseSchema.parse({ ...receipt, changed: false, replayed: true });
      }
      await this.assertNoForeignKey(c, actorId, metadata.idempotencyKey);
      const material = (await c.query<{ current_revision: string }>(`SELECT current_revision::text FROM ${s}.material_variants
        WHERE variant_id=$1 AND project_id=$2 FOR UPDATE`, [variantId, projectId])).rows[0];
      if (!material || Number(material.current_revision) !== expectedMaterialRevision) throw stale();
      const oldWithdrawal = await c.query(`SELECT 1 FROM ${s}.material_withdrawal_intents WHERE variant_id=$1`, [variantId]);
      if (oldWithdrawal.rowCount) throw stale();
      const now = (await c.query<{ recorded_at: string }>(`SELECT ${at("clock_timestamp()")} recorded_at`)).rows[0]?.recorded_at;
      if (!now) throw unavailable();
      const inserted = await c.query(`INSERT INTO ${s}.material_withdrawal_intents(variant_id,project_id,material_revision,actor_id,request_id,request_key,payload_digest,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [variantId, projectId, expectedMaterialRevision, actorId, metadata.requestId, metadata.idempotencyKey, digest, now]);
      if (inserted.rowCount !== 1) throw unavailable();
      const projectVersion = Number((await c.query<{ fact_version: string }>(`SELECT fact_version::text FROM ${s}.projects WHERE project_id=$1`, [projectId])).rows[0]?.fact_version);
      if (!Number.isSafeInteger(projectVersion) || projectVersion < 1) throw stale();
      const impactedTaskCount = await appendMaterialWithdrawn(c, { projectId, variantId, projectVersion, materialRevision: expectedMaterialRevision });
      const cancelledTaskCount = await this.cancelConfirmedNeverStarted(c, { projectId, variantId, reason: "material_withdrawal",
        requestId: metadata.requestId, sourceRevision: expectedMaterialRevision, actorId });
      const response = withdrawMaterialResponseSchema.parse({ projectId, variantId, materialRevision: expectedMaterialRevision, requestId: metadata.requestId,
        changed: true, replayed: false, impactedTaskCount, cancelledTaskCount });
      await c.query(`INSERT INTO ${s}.business_plan_commands(actor_id,request_key,payload_digest,project_id,response) VALUES($1,$2,$3,$4,$5)`,
        [actorId, metadata.idempotencyKey, digest, projectId, response]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'material.withdrawal_recorded','material_variant',$3,$4,$5)`,
        [randomUUID(), actorId, variantId, metadata.requestId, { projectId, materialRevision: expectedMaterialRevision, impactedTaskCount, cancelledTaskCount }]);
      return response;
    });
  }

  private async assertNoForeignKey(c: PoolClient, actorId: string, requestKey: string): Promise<void> {
    const metadata = await c.query(`SELECT 1 FROM ${s}.project_metadata_commands WHERE actor_id=$1 AND request_key=$2`, [actorId, requestKey]);
    const material = await c.query(`SELECT 1 FROM ${s}.material_registry_commands WHERE actor_id=$1 AND request_key=$2`, [actorId, requestKey]);
    if (metadata.rowCount || material.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another command");
  }

  private async cancelConfirmedNeverStarted(c: PoolClient, input: {
    projectId: string; variantId?: string; reason: "project_end" | "material_withdrawal"; requestId: string; sourceRevision: number; actorId: string;
  }): Promise<number> {
    const tasks = await c.query<TaskRow>(`SELECT t.task_id FROM ${s}.business_plan_tasks t
      JOIN ${s}.business_plan_outbox o ON o.task_id=t.task_id AND o.project_id=t.project_id
      WHERE t.project_id=$1 AND ($2::uuid IS NULL OR t.variant_id=$2)
        AND t.state='pending_current_checks' AND t.execution_allowed=false AND t.publication_allowed=false
        AND o.purpose='current_check_reference' AND o.state='pending_current_checks' AND o.execution_allowed=false AND o.publication_allowed=false
      ORDER BY t.task_id FOR UPDATE OF t,o`, [input.projectId, input.variantId ?? null]);
    let count = 0;
    for (const task of tasks.rows) {
      const old = await c.query(`SELECT 1 FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [task.task_id]);
      if (old.rowCount) continue;
      // Missing/unavailable attempt storage is an integrity failure. Do not
      // reinterpret unknown as a confirmed never-started task.
      const attempt = await c.query(`SELECT 1 FROM ${s}.business_plan_task_attempts WHERE task_id=$1`, [task.task_id]);
      if (attempt.rowCount) continue;
      const inserted = await c.query(`INSERT INTO ${s}.business_plan_task_cancellations(task_id,project_id,reason,source_request_id,source_revision,actor_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(task_id) DO NOTHING RETURNING task_id`,
        [task.task_id, input.projectId, input.reason, input.requestId, input.sourceRevision, input.actorId]);
      count += inserted.rowCount ?? 0;
    }
    return count;
  }
}
