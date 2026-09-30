import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { emptyProjectPlanningInputs, projectPlanningResponseSchema, saveProjectPlanningRequestSchema, uuidSchema,
  type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const schema = "socialgrowth_product";
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Project planning facts changed; read and compare current inputs");
interface ProjectRow { fact_version: string; phase: string }
interface DraftRow { draft_version: string; inputs: ProjectPlanningInputs; saved_at: Date; saved_by_operator_id: string; status: "unapproved_draft" }
export class ProjectPlanningService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  private async tx<T>(token: string, csrf: string | null, fn: (client: PoolClient, actor: string) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Planning service unavailable", true); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      // Same metadata ordering as project basics and initial reservations.
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(client, token, csrf ?? undefined, csrf !== null);
      const result = await fn(client, context.operator.operatorId);
      const valid = await client.query(`SELECT 1 FROM ${schema}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId]);
      if (!valid.rowCount) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Planning service unavailable", true); }
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Planning service unavailable", true);
    } finally { client.release(); }
  }
  private async load(client: PoolClient, projectId: string) {
    const p = (await client.query<ProjectRow>(`SELECT fact_version::text,phase FROM ${schema}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
    if (!p) throw stale();
    // Future running settings use next-cycle semantics; no draft endpoint may
    // mutate a running project merely because its body claims to be a draft.
    if (p.phase !== "preparing") throw new ProductTransactionError("INPUT_INVALID", "Only preparing project inputs are supported");
    const d = (await client.query<DraftRow>(`SELECT draft_version::text,inputs,status,saved_at,saved_by_operator_id FROM ${schema}.project_planning_drafts WHERE project_id=$1`, [projectId])).rows[0];
    return projectPlanningResponseSchema.parse({ draft: { projectId, projectFactVersion: Number(p.fact_version), draftVersion: d ? Number(d.draft_version) : 0,
      inputs: d?.inputs ?? emptyProjectPlanningInputs(), status: d?.status ?? "unapproved_draft", savedAt: d?.saved_at.toISOString() ?? null, savedByOperatorId: d?.saved_by_operator_id ?? null } });
  }
  async read(token: string, projectId: string) {
    if (!uuidSchema.safeParse(projectId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project identifier");
    return this.tx(token, null, client => this.load(client, projectId.toLowerCase()));
  }
  async save(token: string, csrf: string, input: unknown) {
    const parsed = saveProjectPlanningRequestSchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project planning inputs");
    const r = parsed.data, { requestId: _requestId, ...metadata } = r.metadata;
    // PostgreSQL emits canonical UUIDs; normalize before hash and command match
    // so a valid upper-case path/body cannot become an unrecoverable replay.
    r.projectId = r.projectId.toLowerCase();
    // These three lists are sets; request order never changes the intended scope.
    r.inputs.targetCountries.sort(); r.inputs.targetLanguages.sort(); r.inputs.contentForms.sort();
    const hash = createHash("sha256").update(JSON.stringify({ ...r, metadata })).digest();
    return this.tx(token, csrf, async (client, actor) => {
      const command = (await client.query<{ project_id: string; payload_digest: Buffer }>(`SELECT project_id,payload_digest FROM ${schema}.project_planning_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (command) {
        if (!command.payload_digest.equals(hash) || command.project_id !== r.projectId) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Planning request key belongs to different inputs");
        return this.load(client, r.projectId);
      }
      const current = (await this.load(client, r.projectId)).draft;
      if (current.projectFactVersion !== r.expectedProjectVersion || current.draftVersion !== r.expectedDraftVersion) throw stale();
      const unchanged = current.draftVersion > 0 && JSON.stringify(current.inputs) === JSON.stringify(r.inputs);
      if (!unchanged) {
        if (current.projectFactVersion === Number.MAX_SAFE_INTEGER || current.draftVersion === Number.MAX_SAFE_INTEGER) throw stale();
        await client.query(`INSERT INTO ${schema}.project_planning_drafts(project_id,draft_version,inputs,saved_by_operator_id,saved_at) VALUES($1,$2,$3,$4,clock_timestamp())
          ON CONFLICT(project_id) DO UPDATE SET draft_version=EXCLUDED.draft_version,inputs=EXCLUDED.inputs,saved_by_operator_id=EXCLUDED.saved_by_operator_id,saved_at=EXCLUDED.saved_at`, [r.projectId, current.draftVersion + 1, r.inputs, actor]);
        await client.query(`UPDATE ${schema}.projects SET fact_version=fact_version+1,updated_at=clock_timestamp() WHERE project_id=$1`, [r.projectId]);
        await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,'project.planning_draft_saved','project',$3,$4,$5)`, [randomUUID(), actor, r.projectId, r.metadata.requestId,
          { draftVersion: current.draftVersion + 1, projectFactVersion: current.projectFactVersion + 1, status: "unapproved_draft" }]);
      }
      await client.query(`INSERT INTO ${schema}.project_planning_commands(actor_id,request_key,project_id,payload_digest) VALUES($1,$2,$3,$4)`, [actor, metadata.idempotencyKey, r.projectId, hash]);
      return this.load(client, r.projectId);
    });
  }
}
