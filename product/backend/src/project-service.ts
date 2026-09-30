import { createHash, randomUUID } from "node:crypto";
import { createProjectRequestSchema, updateProjectRequestSchema, projectResponseSchema, listProjectsResponseSchema,
  type ProjectBasics, type ProjectView } from "@socialgrowth/product-contracts";
import type { Pool, PoolClient } from "pg";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const schema = "socialgrowth_product";
interface Row { project_id: string; name: string; kind: ProjectBasics["kind"]; customer_name: string | null; owner_operator_id: string | null;
  notification_email: string | null; phase: "preparing"; fact_version: string; created_by_operator_id: string; created_at: Date; updated_at: Date }
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Project facts have changed; read current facts before saving");
function view(r: Row): ProjectView {
  return projectResponseSchema.parse({ project: { projectId: r.project_id, name: r.name, kind: r.kind, customerName: r.customer_name,
    ownerOperatorId: r.owner_operator_id, notificationEmail: r.notification_email, phase: r.phase,
    factVersion: Number(r.fact_version), createdByOperatorId: r.created_by_operator_id, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() } }).project;
}
async function freshSession(client: PoolClient, context: OperatorSessionContext): Promise<void> {
  // Authentication already owns operator/session locks. Recheck expiry AFTER
  // every later metadata lock, rather than relying on transaction start time.
  const valid = await client.query(`SELECT 1 FROM ${schema}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId]);
  if (!valid.rowCount) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session is invalid or expired");
}
export class ProjectService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Project service is unavailable", true); }
    try { await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      const result = await fn(client); await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Project service is unavailable", true); }
      if (error instanceof ProductTransactionError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Project service could not complete the operation", true);
    } finally { client.release(); }
  }
  async list(sessionToken: string) {
    return this.tx(async client => {
      const context = await this.auth.authenticateSessionInTransaction(client, sessionToken);
      await freshSession(client, context);
      const result = await client.query<Row>(`SELECT * FROM ${schema}.projects ORDER BY created_at DESC,project_id DESC`);
      return listProjectsResponseSchema.parse({ projects: result.rows.map(view) });
    });
  }
  async save(sessionToken: string, csrfToken: string, input: unknown, kind: "create" | "update") {
    const update = kind === "update" ? updateProjectRequestSchema.parse(input) : null;
    const parsed = update ?? createProjectRequestSchema.parse(input);
    const { requestId: _requestId, ...metadata } = parsed.metadata;
    const hash = createHash("sha256").update(JSON.stringify({ ...parsed, metadata })).digest();
    return this.tx(async client => {
      // Same ordering as operator create/disable prevents cross-owner row-lock
      // deadlocks. This rare metadata write is NOT a global phone-control lock.
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(client, sessionToken, csrfToken, true);
      const actor = context.operator.operatorId;
      const previous = await client.query<{ kind: string; payload_digest: Buffer; project_id: string }>(
        `SELECT * FROM ${schema}.project_metadata_commands WHERE actor_id=$1 AND request_key=$2`, [actor, parsed.metadata.idempotencyKey]);
      const old = previous.rows[0];
      if (old) {
        if (old.kind !== kind || !old.payload_digest.equals(hash)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to different project metadata");
        await freshSession(client, context);
        const result = await client.query<Row>(`SELECT * FROM ${schema}.projects WHERE project_id=$1`, [old.project_id]);
        if (!result.rows[0]) throw stale();
        return projectResponseSchema.parse({ project: view(result.rows[0]) });
      }
      const basics = parsed.basics;
      let current: Row | undefined;
      let projectId: string;
      if (update) {
        projectId = update.projectId;
        const locked = await client.query<Row>(`SELECT * FROM ${schema}.projects WHERE project_id=$1 FOR UPDATE`, [projectId]);
        const r = locked.rows[0];
        if (!r || Number(r.fact_version) !== update.expectedFactVersion || Number(r.fact_version) >= Number.MAX_SAFE_INTEGER) throw stale();
        current = r;
      } else projectId = randomUUID();
      if (basics.ownerOperatorId !== null && basics.ownerOperatorId !== current?.owner_operator_id) {
        const owner = await client.query(`SELECT 1 FROM ${schema}.operators WHERE operator_id=$1 AND status='active' FOR UPDATE`, [basics.ownerOperatorId]);
        if (!owner.rowCount) throw new ProductTransactionError("INPUT_INVALID", "New responsible operator must be active");
      }
      await freshSession(client, context);
      const unchanged = current && current.name === basics.name && current.kind === basics.kind && current.customer_name === basics.customerName
        && current.owner_operator_id === basics.ownerOperatorId && current.notification_email === basics.notificationEmail;
      if (unchanged && current) {
        await client.query(`INSERT INTO ${schema}.project_metadata_commands(actor_id,request_key,kind,payload_digest,project_id) VALUES($1,$2,$3,$4,$5)`, [actor, parsed.metadata.idempotencyKey, kind, hash, projectId]);
        return projectResponseSchema.parse({ project: view(current) });
      }
      const values = [projectId, basics.name, basics.kind, basics.customerName, basics.ownerOperatorId, basics.notificationEmail];
      const result = kind === "create"
        ? await client.query<Row>(`INSERT INTO ${schema}.projects(project_id,name,kind,customer_name,owner_operator_id,notification_email,created_by_operator_id,created_at,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),clock_timestamp()) RETURNING *`, [...values, actor])
        : await client.query<Row>(`UPDATE ${schema}.projects SET name=$2,kind=$3,customer_name=$4,owner_operator_id=$5,notification_email=$6,
            fact_version=fact_version+1,updated_at=clock_timestamp() WHERE project_id=$1 RETURNING *`, values);
      if (!result.rows[0]) throw stale();
      const project = view(result.rows[0]);
      await client.query(`INSERT INTO ${schema}.project_metadata_commands(actor_id,request_key,kind,payload_digest,project_id) VALUES($1,$2,$3,$4,$5)`, [actor, parsed.metadata.idempotencyKey, kind, hash, projectId]);
      await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,$3,'project',$4,$5,$6)`, [randomUUID(), actor, `project.${kind}`, projectId, parsed.metadata.requestId,
        { factVersion: project.factVersion, phase: project.phase, ownerOperatorId: project.ownerOperatorId }]);
      return projectResponseSchema.parse({ project });
    });
  }
}
