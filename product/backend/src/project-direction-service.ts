import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { compareTimestamps, confirmProjectDirectionRequestSchema, directionApprovalSchema, directionProposalSchema, directionScopeSchema,
  generateProjectDirectionRequestSchema, initialDirectionAutonomy, directionIdentitiesSchema, missingDirectionScopeFields, projectDirectionResponseSchema, projectPlanningInputsSchema, uuidSchema,
  type DirectionProposal, type ProjectDirectionView } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { canonicalMaterial } from "./material-registry-core.js";
import type { InitialDirectionModel } from "./artemis-business-model.js";
const s = "socialgrowth_product";
const invalid = (message = "Direction scope is incomplete") => new ProductTransactionError("INPUT_INVALID", message);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Direction inputs changed; read and compare before confirming");
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Direction service unavailable", true);
const hash = (v: unknown) => createHash("sha256").update(canonicalMaterial(v)).digest("hex");
interface AttemptRow { attempt_id: string; project_id: string; payload_digest: Buffer; snapshot_digest: string; state: "requested" | "proposed" | "unavailable" | "facts_changed"; proposal_id: string | null; expired?: boolean }
interface ProjectRow { fact_version: string; phase: string }
export class ProjectDirectionService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService, private readonly model: InitialDirectionModel | null = null) {}
  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, actor: string) => Promise<T>): Promise<T> {
    let c: PoolClient; try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const actor = await this.auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      // Shared ordering with material and resource writers: global material
      // guard -> resource guard -> project. No network call while locked.
      if ((await c.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`)).rowCount !== 1) throw unavailable();
      if ((await c.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR UPDATE`)).rowCount !== 1) throw unavailable();
      const result = await fn(c, actor.operator.operatorId);
      const valid = await c.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId]);
      if (valid.rowCount !== 1) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
      if (e instanceof ProductTransactionError) throw e; throw unavailable();
    } finally { c.release(); }
  }
  private async project(c: PoolClient, id: string): Promise<ProjectRow> {
    const p = (await c.query<ProjectRow>(`SELECT fact_version::text,phase FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [id])).rows[0];
    if (!p) throw stale(); return p;
  }
  private async snapshot(c: PoolClient, projectId: string, rawIdentities: unknown) {
    const p = await this.project(c, projectId);
    if (p.phase !== "preparing") throw invalid("Initial direction requires a preparing project");
    const d = (await c.query<{ draft_version: string; inputs: unknown }>(`SELECT draft_version::text,inputs FROM ${s}.project_planning_drafts WHERE project_id=$1`, [projectId])).rows[0];
    if (!d) throw invalid("Save planning facts before generating direction");
    const inputs = projectPlanningInputsSchema.parse(d.inputs);
    const identities = directionIdentitiesSchema.parse(rawIdentities), missing = missingDirectionScopeFields(inputs, identities);
    if (missing.length) throw invalid(`Required planning fields: ${missing.join(", ")}`);
    const selectedScope = directionScopeSchema.safeParse({ inputs, identities, autonomy: initialDirectionAutonomy });
    if (!selectedScope.success) throw invalid("Content forms and declared identity stages must match the explicit planning scope");
    const scope = selectedScope.data;
    scope.identities.sort((a, b) => `${a.platform}/${a.canonicalRef}`.localeCompare(`${b.platform}/${b.canonicalRef}`));
    for (const key of ["targetCountries", "targetLanguages", "contentForms"] as const) scope.inputs[key].sort();
    if (inputs.contentForms.some(form => !scope.identities.some(i => i.platform === (form.startsWith("facebook_") ? "facebook" : "youtube")))) throw invalid("Every approved form needs an explicit Page/channel scope");
    const time = (await c.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now.toISOString();
    if (!inputs.publishingWindow || compareTimestamps(inputs.publishingWindow.endsAt, time)! <= 0) throw invalid("Publication window has expired");
    // Names and IDs are operator scope declarations, not a verified assignment.
    // Registry joins establish cross-project conflicts; missing registration is
    // a readiness blocker, not permission to invent a publishing identity.
    const refs = scope.identities.map(i => `${i.platform}/${i.canonicalRef}`);
    const resources = (await c.query(`SELECT i.identity_id,i.platform,i.canonical_identity_ref,r.project_id,r.device_id,r.state
      FROM ${s}.publishing_identities i LEFT JOIN ${s}.project_identity_reservations r USING(identity_id)
      WHERE i.platform || '/' || i.canonical_identity_ref=ANY($1::text[]) ORDER BY i.identity_id`, [refs])).rows;
    if (resources.some(r => r.project_id !== null && r.project_id !== projectId)) throw invalid("Publishing scope is reserved for another project");
    const materials = (await c.query(`SELECT v.variant_id,v.current_revision::text,u.source_id,u.source_record_id FROM ${s}.material_variants v
      JOIN ${s}.material_content_units u USING(content_unit_id) WHERE v.project_id=$1 ORDER BY v.variant_id`, [projectId])).rows;
    const record = { projectId, projectVersion: Number(p.fact_version), draftVersion: Number(d.draft_version), scope, resources, materials };
    return { ...record, digest: hash(record) };
  }
  private async view(c: PoolClient, projectId: string, attempt: AttemptRow | null = null): Promise<ProjectDirectionView> {
    const p = await this.project(c, projectId);
    // GET derives deadline expiry from stored facts without changing them.
    // A later explicit POST can retire the stale advisory claim; no phone or
    // publication action is inferred or retried by reading this projection.
    const currentAttempt = (await c.query<AttemptRow>(attempt
      ? `SELECT *,state='requested' AND result_deadline<=clock_timestamp() AS expired FROM ${s}.project_direction_attempts WHERE attempt_id=$1`
      : `SELECT *,state='requested' AND result_deadline<=clock_timestamp() AS expired FROM ${s}.project_direction_attempts WHERE project_id=$1 ORDER BY requested_at DESC,attempt_id DESC LIMIT 1`, [attempt?.attempt_id ?? projectId])).rows[0];
    const proposal = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.project_direction_proposals WHERE project_id=$1 ORDER BY created_at DESC,proposal_id DESC LIMIT 1`, [projectId])).rows[0];
    const approved = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.project_direction_approvals WHERE project_id=$1`, [projectId])).rows[0];
    return projectDirectionResponseSchema.parse({ projectId, projectVersion: Number(p.fact_version), proposal: proposal ? directionProposalSchema.parse(proposal.record) : null,
      approval: approved ? directionApprovalSchema.parse(approved.record) : null,
      attempt: currentAttempt ? { attemptId: currentAttempt.attempt_id, state: currentAttempt.expired ? "unavailable" : currentAttempt.state, proposalId: currentAttempt.proposal_id } : null,
      blockers: ["素材来源与首次发布准入未接入真实证据", "发布身份与手机初始化尚待真实核验", "持久排期、任务及实时动作许可尚待接入"], executionAllowed: false, publicationAllowed: false });
  }
  async read(token: string, projectId: string) {
    const parsed = uuidSchema.safeParse(projectId); if (!parsed.success) throw invalid("Invalid project identifier");
    return this.tx(token, null, c => this.view(c, parsed.data.toLowerCase()));
  }
  async generate(token: string, csrf: string, raw: unknown): Promise<ProjectDirectionView> {
    const parsed = generateProjectDirectionRequestSchema.safeParse(raw); if (!parsed.success) throw invalid("Invalid direction request");
    const r = parsed.data; r.projectId = r.projectId.toLowerCase();
    r.identities.sort((a, b) => `${a.platform}/${a.canonicalRef}`.localeCompare(`${b.platform}/${b.canonicalRef}`));
    const { requestId: _trace, ...metadata } = r.metadata, intent = Buffer.from(hash({ ...r, metadata }), "hex");
    const claim = await this.tx(token, csrf, async (c, actor) => {
      await this.view(c, r.projectId);
      await c.query(`UPDATE ${s}.project_direction_attempts SET state='unavailable' WHERE project_id=$1 AND state='requested' AND result_deadline<=clock_timestamp()`, [r.projectId]);
      const old = (await c.query<AttemptRow>(`SELECT * FROM ${s}.project_direction_attempts WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.project_id !== r.projectId || !old.payload_digest.equals(intent)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Original direction key has different inputs");
        return { existing: await this.view(c, r.projectId, old) };
      }
      if ((await c.query(`SELECT 1 FROM ${s}.project_direction_attempts WHERE project_id=$1 AND state='requested'`, [r.projectId])).rowCount) throw stale();
      const facts = await this.snapshot(c, r.projectId, r.identities);
      if (facts.projectVersion !== r.expectedProjectVersion || facts.draftVersion !== r.expectedDraftVersion) throw stale();
      if ((await c.query(`SELECT 1 FROM ${s}.project_direction_approvals WHERE project_id=$1`, [r.projectId])).rowCount) throw invalid("A confirmed direction needs a separate bounded change flow");
      const attemptId = randomUUID();
      await c.query(`INSERT INTO ${s}.project_direction_attempts(attempt_id,actor_id,request_key,project_id,payload_digest,snapshot_digest,state)
        VALUES($1,$2,$3,$4,$5,$6,'requested')`, [attemptId, actor, metadata.idempotencyKey, r.projectId, intent, facts.digest]);
      return { attemptId, facts };
    });
    if ("existing" in claim) return claim.existing!;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 45000); });
    let generated: Awaited<ReturnType<InitialDirectionModel["generateDirection"]>> | null = null;
    try { if (this.model) generated = await Promise.race([this.model.generateDirection(claim.facts, controller.signal), deadline]); }
    catch (error) {
      const category = error instanceof Error && /^BUSINESS_MODEL_[A-Z_]+$/.test(error.message) ? error.message
        : error instanceof SyntaxError ? "BUSINESS_MODEL_NON_JSON_RESPONSE"
        : error instanceof Error && error.name === "ZodError" ? "BUSINESS_MODEL_SCHEMA_INVALID" : "BUSINESS_MODEL_UNAVAILABLE";
      console.warn(JSON.stringify({ event: "project_direction_model_failed", category }));
      // No raw provider errors, inputs, credentials or synthetic strategy.
    }
    finally { clearTimeout(timer); controller.abort(); }
    return this.tx(token, csrf, async (c, actor) => {
      const a = (await c.query<AttemptRow>(`SELECT * FROM ${s}.project_direction_attempts WHERE attempt_id=$1 AND actor_id=$2 FOR UPDATE`, [claim.attemptId, actor])).rows[0];
      if (!a || a.state !== "requested") throw stale();
      const expired = (await c.query(`SELECT 1 FROM ${s}.project_direction_attempts WHERE attempt_id=$1 AND result_deadline<=clock_timestamp()`, [a.attempt_id])).rowCount === 1;
      let state: AttemptRow["state"] = generated && !expired ? "proposed" : "unavailable", proposal: DirectionProposal | null = null;
      if (generated && !expired) {
        try { if ((await this.snapshot(c, r.projectId, r.identities)).digest !== claim.facts.digest) state = "facts_changed"; }
        catch (error) { if (error instanceof ProductTransactionError) state = "facts_changed"; else throw error; }
        if (state === "proposed") {
          const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now.toISOString();
          proposal = directionProposalSchema.parse({ proposalId: randomUUID(), projectId: r.projectId, projectVersion: claim.facts.projectVersion,
            draftVersion: claim.facts.draftVersion, snapshotDigest: claim.facts.digest, scope: claim.facts.scope, output: generated.output,
            generatedAt: now, providerKey: generated.providerKey, modelKey: generated.modelKey, responseId: generated.responseId });
          await c.query(`INSERT INTO ${s}.project_direction_proposals(proposal_id,project_id,record) VALUES($1,$2,$3)`, [proposal.proposalId, r.projectId, proposal]);
        }
      }
      await c.query(`UPDATE ${s}.project_direction_attempts SET state=$2,proposal_id=$3 WHERE attempt_id=$1`, [a.attempt_id, state, proposal?.proposalId ?? null]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'project.direction_generated','project',$3,$4,$5)`, [randomUUID(), actor, r.projectId, r.metadata.requestId, { attemptId: a.attempt_id, state, proposalId: proposal?.proposalId ?? null }]);
      return this.view(c, r.projectId, { ...a, state, proposal_id: proposal?.proposalId ?? null });
    });
  }
  async confirm(token: string, csrf: string, raw: unknown): Promise<ProjectDirectionView> {
    const parsed = confirmProjectDirectionRequestSchema.safeParse(raw); if (!parsed.success) throw invalid("Invalid direction confirmation");
    const r = parsed.data; r.projectId = r.projectId.toLowerCase(); r.proposalId = r.proposalId.toLowerCase();
    const { requestId: _trace, ...metadata } = r.metadata, intent = Buffer.from(hash({ ...r, metadata }), "hex");
    return this.tx(token, csrf, async (c, actor) => {
      await this.project(c, r.projectId);
      const old = (await c.query<{ project_id: string; proposal_id: string; payload_digest: Buffer }>(`SELECT project_id,proposal_id,payload_digest FROM ${s}.project_direction_approvals WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.project_id !== r.projectId || old.proposal_id !== r.proposalId || !old.payload_digest.equals(intent)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Original confirmation key has different scope");
        return this.view(c, r.projectId);
      }
      if ((await c.query(`SELECT 1 FROM ${s}.project_direction_approvals WHERE project_id=$1`, [r.projectId])).rowCount) throw stale();
      if ((await c.query(`SELECT 1 FROM ${s}.project_direction_attempts WHERE project_id=$1 AND state='requested' AND result_deadline>clock_timestamp()`, [r.projectId])).rowCount) throw stale();
      const row = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.project_direction_proposals WHERE project_id=$1 AND proposal_id=$2`, [r.projectId, r.proposalId])).rows[0];
      if (!row) throw stale(); const proposal = directionProposalSchema.parse(row.record);
      const facts = await this.snapshot(c, r.projectId, proposal.scope.identities);
      if (facts.projectVersion !== r.expectedProjectVersion || proposal.projectVersion !== r.expectedProjectVersion || proposal.snapshotDigest !== r.snapshotDigest || facts.digest !== r.snapshotDigest) throw stale();
      const currentProposal = (await this.view(c, r.projectId)).proposal;
      if (currentProposal?.proposalId !== proposal.proposalId) throw stale();
      const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now.toISOString();
      const confirmedByOperatorName = (await c.query<{ display_name: string }>(`SELECT display_name FROM ${s}.operators WHERE operator_id=$1`, [actor])).rows[0]?.display_name;
      const approval = directionApprovalSchema.parse({ approvalId: randomUUID(), proposal, confirmedByOperatorId: actor, confirmedByOperatorName, confirmedAt: now, status: "approved_waiting_readiness" });
      await c.query(`INSERT INTO ${s}.project_direction_approvals(approval_id,project_id,proposal_id,actor_id,request_key,payload_digest,record) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [approval.approvalId, r.projectId, proposal.proposalId, actor, metadata.idempotencyKey, intent, approval]);
      if ((await c.query(`UPDATE ${s}.projects SET fact_version=fact_version+1,updated_at=clock_timestamp() WHERE project_id=$1 AND fact_version<9007199254740991`, [r.projectId])).rowCount !== 1) throw stale();
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'project.direction_confirmed','project',$3,$4,$5)`, [randomUUID(), actor, r.projectId, r.metadata.requestId, { approvalId: approval.approvalId, proposalId: proposal.proposalId, status: approval.status }]);
      return this.view(c, r.projectId);
    });
  }
}
