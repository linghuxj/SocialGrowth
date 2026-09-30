import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { requestMetadataSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { TrackingLinkError, TrackingLinkPolicy, trackingTokenSchema } from "./tracking-link-policy.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const createSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: id, expectedProjectVersion: z.int().min(0), identityId: id,
  configuredContentUnitId: id.nullable(), targetUrl: z.string().min(1).max(2048) });
const revokeSchema = z.strictObject({ metadata: requestMetadataSchema, linkId: id });
const requestSchema = z.strictObject({ recordId: id, token: trackingTokenSchema, method: z.enum(["GET", "HEAD"]), recognizedPrefetch: z.boolean() });
const s = "socialgrowth_product";
interface LinkRow { link_id: string; public_token: string; project_id: string; identity_id: string; configured_content_unit_id: string | null; target_url: string; policy_revision: string; status: "active" | "revoked" }
const safeLink = (r: LinkRow) => ({ linkId: r.link_id, path: `/r/${r.public_token}`, projectId: r.project_id, identityId: r.identity_id,
  configuredContentUnitId: r.configured_content_unit_id, targetUrl: r.target_url, policyRevision: r.policy_revision, status: r.status });
async function fresh(c: PoolClient, a: OperatorSessionContext): Promise<void> {
  if (!(await c.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [a.sessionId])).rowCount)
    throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session is invalid or expired");
}
// Internal authenticated configuration API, not yet an operator HTTP contract
// or Web consumer. Generated path is not a platform-path verification/approval.
export class TrackingLinkService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService, private readonly policy: TrackingLinkPolicy | null) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    let c: PoolClient;
    try { c = await this.pool.connect(); } catch { throw new TrackingLinkError("UNAVAILABLE", true); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      const result = await fn(c); await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { throw new TrackingLinkError("UNAVAILABLE", true); }
      if (e instanceof TrackingLinkError || e instanceof ProductTransactionError) throw e;
      throw new TrackingLinkError("UNAVAILABLE", true);
    } finally { c.release(); }
  }
  async create(token: string, csrf: string, input: unknown) {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw new TrackingLinkError("INPUT_INVALID");
    if (!this.policy) throw new TrackingLinkError("CONFIGURATION_REQUIRED");
    const r = parsed.data, target = this.policy.target(r.targetUrl), policy = this.policy;
    const digest = createHash("sha256").update(JSON.stringify({ ...r, metadata: { ...r.metadata, requestId: null }, targetUrl: target, policyRevision: policy.revision })).digest();
    return this.tx(async c => {
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const a = await this.auth.authenticateSessionInTransaction(c, token, csrf, true);
      const old = (await c.query<{ kind: string; payload_digest: Buffer; link_id: string }>(`SELECT * FROM ${s}.tracking_link_commands WHERE actor_id=$1 AND request_key=$2`, [a.operator.operatorId, r.metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.kind !== "create" || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Link request key belongs to different inputs");
        const saved = (await c.query<LinkRow>(`SELECT * FROM ${s}.tracking_links WHERE link_id=$1 FOR SHARE`, [old.link_id])).rows[0];
        if (!saved) throw new TrackingLinkError("UNAVAILABLE", true);
        await fresh(c, a); return safeLink(saved);
      }
      const p = (await c.query<{ fact_version: string }>(`SELECT fact_version FROM ${s}.projects WHERE project_id=$1 FOR SHARE`, [r.projectId])).rows[0];
      if (!p || Number(p.fact_version) !== r.expectedProjectVersion) throw new ProductTransactionError("FACT_VERSION_STALE", "Project configuration changed");
      // Existing central account reservation only. Initialization, verified
      // publication/content and real clicked source remain separate facts.
      if (!(await c.query(`SELECT i.identity_id FROM ${s}.publishing_identities i JOIN ${s}.project_account_reservations a ON a.account_id=i.account_id
        WHERE i.identity_id=$1 AND a.project_id=$2 FOR SHARE OF i,a`, [r.identityId, r.projectId])).rowCount)
        throw new ProductTransactionError("AUTHORIZATION_DENIED", "Link identity is not reserved for this project");
      await fresh(c, a);
      const row = (await c.query<LinkRow>(`INSERT INTO ${s}.tracking_links(link_id,public_token,project_id,identity_id,configured_content_unit_id,target_url,policy_revision,created_by_operator_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [randomUUID(), randomBytes(24).toString("base64url"), r.projectId, r.identityId, r.configuredContentUnitId, target, policy.revision, a.operator.operatorId])).rows[0]!;
      await c.query(`INSERT INTO ${s}.tracking_link_commands(actor_id,request_key,kind,payload_digest,link_id) VALUES($1,$2,'create',$3,$4)`, [a.operator.operatorId, r.metadata.idempotencyKey, digest, row.link_id]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'tracking_link.configured','tracking_link',$3,$4,$5)`, [randomUUID(), a.operator.operatorId, row.link_id, r.metadata.requestId, { projectId: r.projectId, policyRevision: policy.revision }]);
      await fresh(c, a); return safeLink(row);
    });
  }
  async revoke(token: string, csrf: string, input: unknown) {
    const parsed = revokeSchema.safeParse(input); if (!parsed.success) throw new TrackingLinkError("INPUT_INVALID");
    const r = parsed.data, digest = createHash("sha256").update(r.linkId).digest();
    return this.tx(async c => {
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const a = await this.auth.authenticateSessionInTransaction(c, token, csrf, true);
      const old = (await c.query<{ kind: string; payload_digest: Buffer }>(`SELECT * FROM ${s}.tracking_link_commands WHERE actor_id=$1 AND request_key=$2`, [a.operator.operatorId, r.metadata.idempotencyKey])).rows[0];
      if (old && (old.kind !== "revoke" || !old.payload_digest.equals(digest))) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Link request key belongs to different inputs");
      const row = (await c.query<LinkRow>(`SELECT * FROM ${s}.tracking_links WHERE link_id=$1 FOR UPDATE`, [r.linkId])).rows[0];
      if (!row) throw new TrackingLinkError("NOT_FOUND");
      await fresh(c, a);
      if (row.status !== "revoked") {
        await c.query(`UPDATE ${s}.tracking_links SET status='revoked',revoked_at=clock_timestamp() WHERE link_id=$1`, [r.linkId]);
        await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,'tracking_link.revoked','tracking_link',$3,$4,'{}')`, [randomUUID(), a.operator.operatorId, row.link_id, r.metadata.requestId]);
      }
      if (!old) await c.query(`INSERT INTO ${s}.tracking_link_commands(actor_id,request_key,kind,payload_digest,link_id) VALUES($1,$2,'revoke',$3,$4)`, [a.operator.operatorId, r.metadata.idempotencyKey, digest, row.link_id]);
      await fresh(c, a); return { linkId: row.link_id, status: "revoked" as const };
    });
  }
  async redirect(input: unknown): Promise<string> {
    const parsed = requestSchema.safeParse(input); if (!parsed.success) throw new TrackingLinkError("NOT_FOUND");
    if (!this.policy) throw new TrackingLinkError("NOT_FOUND");
    const r = parsed.data, policy = this.policy;
    return this.tx(async c => {
      const row = (await c.query<LinkRow>(`SELECT * FROM ${s}.tracking_links WHERE public_token=$1 FOR SHARE`, [r.token])).rows[0];
      if (!row || row.status !== "active" || row.policy_revision !== policy.revision) throw new TrackingLinkError("NOT_FOUND");
      let target: string;
      try { target = policy.target(row.target_url); } catch { throw new TrackingLinkError("NOT_FOUND"); }
      if (r.method === "GET") {
        const classification = r.recognizedPrefetch ? "recognized_prefetch" : "request";
        await c.query(`INSERT INTO ${s}.tracking_link_requests(record_id,link_id,classification,definition) VALUES($1,$2,$3,'request_records_prefetch_v1') ON CONFLICT(record_id) DO NOTHING`, [r.recordId, row.link_id, classification]);
        const saved = (await c.query<{ link_id: string; classification: string; definition: string; actual_content_source: string }>(`SELECT * FROM ${s}.tracking_link_requests WHERE record_id=$1`, [r.recordId])).rows[0];
        if (!saved || saved.link_id !== row.link_id || saved.classification !== classification || saved.definition !== "request_records_prefetch_v1" || saved.actual_content_source !== "unknown") throw new TrackingLinkError("RECORD_ID_REUSED");
      }
      return target; // Commit acknowledgement precedes disclosure of Location.
    });
  }
}
