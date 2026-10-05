import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { businessPlanWorkflowScopeSchema, type BusinessPlanWorkflowScope } from "@socialgrowth/product-contracts";

const schema = "socialgrowth_product";
const hashPattern = /^[a-f0-9]{64}$/;
const eventPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{15,199}$/;
export class BusinessPlanWorkflowError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "SCOPE_CHANGED" | "CLAIM_STALE" | "EVENT_CONFLICT" | "WORKFLOW_UNAVAILABLE") { super(code); }
}
export type WorkflowReadiness = { adapterState: "connected" | "unconnected"; businessState: "ready" | "blocked" | "unknown"; scopeFingerprint: string; blockers: string[] };
export interface TaskWorkflowReadinessPort { assess(scope: BusinessPlanWorkflowScope, ownOperationId?: string): Promise<WorkflowReadiness> }
export type WorkflowActionPermit = { permitId: string; scopeFingerprint: string; expiresAt: string };
export interface TaskWorkflowActionGatePort {
  authorizeAction(input: { scope: BusinessPlanWorkflowScope; operationId: string; stepId: string; scopeFingerprint: string }): Promise<WorkflowActionPermit | null>
}
export type WorkflowReportedObservation = { sourceEventId: string; payloadDigest: string; reportedState: "submitted" | "not_submitted" | "unknown" | "failed" };
export interface TaskWorkflowExecutorPort {
  execute(input: { scope: BusinessPlanWorkflowScope; operationId: string; claimId: string;
    authorizeAction(stepId: string): Promise<WorkflowActionPermit | null> }): Promise<WorkflowReportedObservation>
}
export type TrustedWorkflowVerification = { verificationEventId: string; payloadDigest: string;
  decision: "prepared" | "verified_published" | "verified_not_published" | "unknown"; resultId: string | null; verifiedAt: string | null; blockers?: string[] };
export interface TrustedPublicationVerifierPort {
  verifyOriginal(input: { scope: BusinessPlanWorkflowScope; operationId: string;
    observation: WorkflowReportedObservation | null }): Promise<TrustedWorkflowVerification>
}
export type OriginalAttemptReconciliation = { outcome: "found"; operationId: string; observation: WorkflowReportedObservation | null }
  | { outcome: "not_found" | "ambiguous" };
export interface OriginalAttemptReconcilerPort {
  /** Read-only lookup by the original durable claim/idempotency identity. Must never dispatch or recover. */
  reconcileOriginalAttempt(input: { scope: BusinessPlanWorkflowScope; claimId: string; scopeFingerprint: string }): Promise<OriginalAttemptReconciliation>
}
export type BusinessPlanWorkflowPorts = { readiness: TaskWorkflowReadinessPort | null; actionGate: TaskWorkflowActionGatePort | null;
  executor: TaskWorkflowExecutorPort | null; proofVerifier: TrustedPublicationVerifierPort | null; originalAttemptReconciler?: OriginalAttemptReconcilerPort | null };
export interface BusinessPlanWorkflowPortStatusReader {
  portStatus(): { executor: "connected" | "unconnected"; proofVerifier: "connected" | "unconnected" };
  refresh?(scope: unknown): Promise<WorkflowJob>;
  start?(scope: unknown, workerId: string): Promise<WorkflowJob>;
  queryOriginal?(projectId: string, taskId: string): Promise<WorkflowJob | null>;
}
export type WorkflowJob = { workflowId: string; projectId: string; taskId: string; taskAttemptId: string;
  scopeFingerprint: string; state: string; submissionState: string; operationId: string | null; operationState: string | null;
  claimId: string | null; originalClaimId: string | null; leaseUntil: string | null; blockers: string[]; verifiedResultId: string | null;
  verifiedAt: string | null; preparedAt: string | null; preparedResultId: string | null; scope: BusinessPlanWorkflowScope };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map(key => JSON.stringify(key) + ":" + stable(object[key])).join(",") + "}";
}
function fingerprint(scope: BusinessPlanWorkflowScope): string { return createHash("sha256").update(stable(scope)).digest("hex"); }
function digest(value: unknown): Buffer { return createHash("sha256").update(stable(value)).digest(); }
function blockers(values: string[]): string[] {
  return [...new Set(values.filter(value => typeof value === "string" && value.length > 0 && value.length <= 120 && value.trim() === value))].slice(0, 64);
}
function validObservation(value: WorkflowReportedObservation): boolean {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value.sourceEventId) && hashPattern.test(value.payloadDigest)
    && ["submitted", "not_submitted", "unknown", "failed"].includes(value.reportedState));
}
function unavailable(): BusinessPlanWorkflowError { return new BusinessPlanWorkflowError("WORKFLOW_UNAVAILABLE"); }

export class BusinessPlanWorkflowStore {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='12s'");
      const result = await fn(client); await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof BusinessPlanWorkflowError) throw error;
      throw unavailable();
    } finally { client.release(); }
  }
  private async event(client: PoolClient, id: string, scopeHash: string, key: string,
    kind: "materialized" | "blocked" | "claimed" | "claim_expired" | "operation_started" | "observation_received" | "verification_completed", value: unknown, recordNew = true) {
    if (!eventPattern.test(key)) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    const sum = digest(value);
    const old = (await client.query("SELECT payload_digest FROM " + schema + ".business_plan_workflow_events WHERE workflow_id=$1 AND event_key=$2", [id, key])).rows[0] as { payload_digest: Buffer } | undefined;
    if (old) { if (!old.payload_digest.equals(sum)) throw new BusinessPlanWorkflowError("EVENT_CONFLICT"); return; }
    if (!recordNew) return;
    await client.query("INSERT INTO " + schema + ".business_plan_workflow_events(event_id,workflow_id,event_key,event_type,scope_fingerprint,payload_digest) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, key, kind, Buffer.from(scopeHash, "hex"), sum]);
  }
  async materialize(input: unknown, readiness: WorkflowReadiness): Promise<WorkflowJob> {
    const parsed = businessPlanWorkflowScopeSchema.safeParse(input);
    if (!parsed.success || !hashPattern.test(readiness.scopeFingerprint) || !Array.isArray(readiness.blockers)
      || !["connected", "unconnected"].includes(readiness.adapterState)
      || !["ready", "blocked", "unknown"].includes(readiness.businessState)) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    const scope = parsed.data, sum = fingerprint(scope), matching = readiness.scopeFingerprint === sum;
    const ready = matching && readiness.adapterState === "connected" && readiness.businessState === "ready" && readiness.blockers.length === 0;
    const reasons = blockers([...readiness.blockers, ...(!matching ? ["scope_fingerprint_mismatch"] : []),
      ...(readiness.adapterState !== "connected" ? ["executor_unconnected"] : []),
      ...(readiness.businessState === "unknown" ? ["current_fact_unknown"] : readiness.businessState === "blocked" ? ["business_readiness_blocked"] : []),
      ...(readiness.businessState === "ready" && readiness.blockers.length > 0 ? ["readiness_blockers_present"] : [])]);
    return this.tx(async client => {
      const task = (await client.query("SELECT t.project_id,t.task_revision::text,t.plan_id,t.plan_revision::text,t.material_revision::text,t.identity_id,t.platform,t.form,t.scheduled_at,"
        + "a.project_id AS attempt_project_id,a.plan_id AS attempt_plan_id,a.plan_revision::text AS attempt_plan_revision,a.project_version::text AS attempt_project_version,"
        + "a.approval_id,a.task_revision::text AS attempt_task_revision,a.content_unit_id,a.variant_id,a.material_revision::text AS attempt_material_revision,"
        + "a.verifier_manifest,a.identity_id AS attempt_identity_id,a.platform AS attempt_platform,a.reserved_device_id "
        + "FROM " + schema + ".business_plan_tasks t JOIN " + schema + ".business_plan_task_attempts a USING(task_id) "
        + "WHERE t.task_id=$1 AND a.task_attempt_id=$2 FOR SHARE OF t,a", [scope.taskId, scope.taskAttemptId])).rows[0] as {
          project_id: string; task_revision: string; plan_id: string; plan_revision: string; material_revision: string;
          identity_id: string; platform: string; form: string; scheduled_at: string; attempt_project_id: string; attempt_plan_id: string;
          attempt_plan_revision: string; attempt_project_version: string; approval_id: string; attempt_task_revision: string;
          content_unit_id: string; variant_id: string; attempt_material_revision: string; verifier_manifest: unknown;
          attempt_identity_id: string; attempt_platform: string; reserved_device_id: string } | undefined;
      const manifest = Array.isArray(task?.verifier_manifest) ? task.verifier_manifest : null;
      const canonicalFiles = (files: unknown) => Array.isArray(files) ? stable(files) : "invalid";
      if (!task || task.project_id.toLowerCase() !== scope.projectId.toLowerCase() || Number(task.task_revision) !== scope.taskRevision
        || task.plan_id.toLowerCase() !== scope.planId.toLowerCase() || Number(task.plan_revision) !== scope.planRevision
        || Number(task.material_revision) !== scope.materialRevision || task.identity_id.toLowerCase() !== scope.identityId.toLowerCase()
        || task.platform !== scope.platform || task.form !== scope.form || task.scheduled_at !== scope.scheduledAt
        || task.attempt_project_id.toLowerCase() !== scope.projectId.toLowerCase() || task.attempt_plan_id.toLowerCase() !== scope.planId.toLowerCase()
        || Number(task.attempt_plan_revision) !== scope.planRevision || Number(task.attempt_project_version) !== scope.projectVersion
        || task.approval_id.toLowerCase() !== scope.approvalId.toLowerCase() || Number(task.attempt_task_revision) !== scope.taskRevision
        || task.content_unit_id.toLowerCase() !== scope.contentUnitId.toLowerCase() || task.variant_id.toLowerCase() !== scope.variantId.toLowerCase()
        || Number(task.attempt_material_revision) !== scope.materialRevision || task.attempt_identity_id.toLowerCase() !== scope.identityId.toLowerCase()
        || task.attempt_platform !== scope.platform || task.reserved_device_id.toLowerCase() !== scope.reservedDeviceId.toLowerCase()
        || !manifest || canonicalFiles(manifest) !== canonicalFiles(scope.expectedFiles)) throw new BusinessPlanWorkflowError("SCOPE_CHANGED");
      const id = randomUUID();
      await client.query("INSERT INTO " + schema + ".business_plan_workflow_jobs(workflow_id,project_id,task_id,task_attempt_id,scope_snapshot,scope_fingerprint,state,submission_state,blockers) "
        + "VALUES($1,$2,$3,$4,$5,$6,$7,'not_started',$8) ON CONFLICT(task_id) DO NOTHING",
        [id, scope.projectId, scope.taskId, scope.taskAttemptId, scope, Buffer.from(sum, "hex"), ready ? "queued" : "blocked", JSON.stringify(reasons)]);
      const current = await this.readOne(client, scope.taskId, true);
      if (!current || current.scopeFingerprint !== sum || current.taskAttemptId.toLowerCase() !== scope.taskAttemptId.toLowerCase()) throw new BusinessPlanWorkflowError("SCOPE_CHANGED");
      const readinessEvent = digest({ ready, blockers: reasons }).toString("hex");
      await this.event(client, current.workflowId, sum, "materialized:" + sum + ":" + readinessEvent, "materialized", { ready, blockers: reasons });
      if (ready && current.operationId === null && current.state === "blocked" && current.claimId === null && current.originalClaimId === null) {
        await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='queued',blockers='[]'::jsonb,updated_at=clock_timestamp() WHERE workflow_id=$1 AND operation_id IS NULL AND claim_id IS NULL",
          [current.workflowId]);
      }
      if (!ready && current.operationId === null && current.originalClaimId === null && current.state !== "verified" && current.state !== "not_published") {
        await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='blocked',blockers=$2,claim_id=NULL,claim_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workflow_id=$1 AND operation_id IS NULL",
          [current.workflowId, JSON.stringify(reasons)]);
        await this.event(client, current.workflowId, sum, "blocked:" + sum + ":" + digest(reasons).toString("hex"), "blocked", { blockers: reasons });
      }
      const result = await this.readOne(client, scope.taskId);
      if (!result) throw unavailable();
      return result;
    });
  }
  async claim(taskId: string, owner: string, leaseMs = 30_000): Promise<WorkflowJob | null> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId) || owner.trim() !== owner || owner.length < 1 || owner.length > 120
      || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 120000) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    return this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || job.operationId || job.blockers.length || ["submission_unknown","verified","not_published","failed"].includes(job.state)) return null;
      if (job.state !== "queued") return null;
      const id = randomUUID();
      const changed = await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='claimed',claim_id=$2,original_claim_id=$2,claim_owner=$3,"
        + "lease_until=clock_timestamp()+($4::int*interval '1 millisecond'),updated_at=clock_timestamp() WHERE workflow_id=$1 AND operation_id IS NULL",
        [job.workflowId, id, owner, leaseMs]);
      if (changed.rowCount !== 1) return null;
      await this.event(client, job.workflowId, job.scopeFingerprint, "claim:" + id, "claimed", { claimId: id, owner });
      return this.readOne(client, taskId);
    });
  }
  async readTask(taskId: string): Promise<WorkflowJob | null> {
    return this.tx(client => this.readOne(client, taskId));
  }
  async expireLease(taskId: string): Promise<WorkflowJob | null> {
    return this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || (job.state !== "claimed" && job.state !== "running") || !job.leaseUntil) return job;
      const expired = (await client.query<{ expired: boolean }>("SELECT $1::timestamptz <= clock_timestamp() AS expired", [job.leaseUntil])).rows[0]?.expired;
      if (!expired) return job;
      if (job.claimId) await this.event(client, job.workflowId, job.scopeFingerprint, "claim-expired:" + job.claimId,
        "claim_expired", { claimId: job.claimId, operationId: job.operationId });
      if (!job.operationId) {
        await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='blocked',claim_id=NULL,claim_owner=NULL,lease_until=NULL,"
          + "blockers='[\"claim_lease_expired_reconciliation_required\"]'::jsonb,updated_at=clock_timestamp() WHERE workflow_id=$1 AND operation_id IS NULL", [job.workflowId]);
      } else {
        await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='submission_unknown',submission_state='unknown',"
          + "operation_state='submission_unknown',claim_id=NULL,claim_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workflow_id=$1", [job.workflowId]);
      }
      return this.readOne(client, taskId);
    });
  }
  async renewLease(taskId: string, operationId: string, claimId: string, leaseMs = 120_000): Promise<WorkflowJob | null> {
    return this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || job.state !== "running" || job.operationId !== operationId || job.claimId !== claimId) return null;
      const changed = await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET lease_until=clock_timestamp()+($4::int*interval '1 millisecond'),updated_at=clock_timestamp() WHERE workflow_id=$1 AND operation_id=$2 AND claim_id=$3 AND state='running'",
        [job.workflowId, operationId, claimId, leaseMs]);
      return changed.rowCount === 1 ? this.readOne(client, taskId) : null;
    });
  }
  async startOperation(taskId: string, claimId: string, currentScopeHash: string): Promise<{ job: WorkflowJob; operationId: string } | null> {
    if (!hashPattern.test(currentScopeHash)) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    return this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || job.state !== "claimed" || job.claimId !== claimId || !job.leaseUntil
        || job.scopeFingerprint !== currentScopeHash || job.operationId) return null;
      const operationId = randomUUID();
      const updatedCount = await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='running',submission_state='in_progress',operation_id=$2,"
        + "operation_state='running',updated_at=clock_timestamp() WHERE workflow_id=$1 AND claim_id=$3 AND lease_until>clock_timestamp() AND operation_id IS NULL",
        [job.workflowId, operationId, claimId]);
      if (updatedCount.rowCount !== 1) return null;
      await this.event(client, job.workflowId, currentScopeHash, "operation:" + operationId, "operation_started", { operationId });
      const updated = await this.readOne(client, taskId);
      return updated ? { job: updated, operationId } : null;
    });
  }
  async recordObservation(taskId: string, operationId: string, observation: WorkflowReportedObservation): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId) || !operationId || operationId.length > 200 || !validObservation(observation))
      throw new BusinessPlanWorkflowError("INPUT_INVALID");
    await this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || job.operationId !== operationId || ["verified","not_published"].includes(job.state)) throw new BusinessPlanWorkflowError("CLAIM_STALE");
      await this.event(client, job.workflowId, job.scopeFingerprint, "observation:" + observation.sourceEventId, "observation_received", observation);
      await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='submission_unknown',submission_state='unknown',"
        + "operation_state='submission_unknown',claim_id=NULL,claim_owner=NULL,lease_until=NULL,blockers='[]'::jsonb,updated_at=clock_timestamp() "
        + "WHERE workflow_id=$1 AND operation_id=$2", [job.workflowId, operationId]);
    });
  }
  async recordReconciledOperation(taskId: string, originalClaimId: string, operationId: string,
    observation: WorkflowReportedObservation | null): Promise<WorkflowJob> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId) || !/^[0-9a-f-]{36}$/i.test(originalClaimId) || !operationId || operationId.length > 200)
      throw new BusinessPlanWorkflowError("INPUT_INVALID");
    if (observation !== null && !validObservation(observation)) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    return this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || job.originalClaimId !== originalClaimId || job.state !== "blocked" || job.operationId !== null
        || !job.blockers.includes("claim_lease_expired_reconciliation_required")) throw new BusinessPlanWorkflowError("CLAIM_STALE");
      const eventKey = "reconciled-operation:" + originalClaimId;
      await this.event(client, job.workflowId, job.scopeFingerprint, eventKey, "observation_received", { operationId, observation });
      await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state='submission_unknown',submission_state='unknown',"
        + "operation_id=$2,operation_state='submission_unknown',claim_id=NULL,claim_owner=NULL,lease_until=NULL,blockers='[]'::jsonb,updated_at=clock_timestamp() "
        + "WHERE workflow_id=$1 AND original_claim_id=$3 AND operation_id IS NULL",
        [job.workflowId, operationId, originalClaimId]);
      const updated = await this.readOne(client, taskId);
      if (!updated) throw unavailable();
      return updated;
    });
  }
  async applyTrustedVerification(taskId: string, operationId: string, result: TrustedWorkflowVerification): Promise<WorkflowJob> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId) || !operationId || operationId.length > 200
      || !/^[0-9a-f-]{36}$/i.test(result.verificationEventId) || !hashPattern.test(result.payloadDigest)
      || !["prepared", "verified_published", "verified_not_published", "unknown"].includes(result.decision)
      || (result.resultId !== null && (result.resultId.length < 1 || result.resultId.length > 200))
      || (result.verifiedAt !== null && !Number.isFinite(Date.parse(result.verifiedAt)))
      || (result.blockers !== undefined && (!Array.isArray(result.blockers) || result.blockers.some(value => typeof value !== "string")))) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    const complete = result.decision !== "unknown";
    if (complete !== Boolean(result.resultId && result.verifiedAt)) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    return this.tx(async client => {
      const job = await this.readOne(client, taskId, true);
      if (!job || job.operationId !== operationId) throw new BusinessPlanWorkflowError("CLAIM_STALE");
      const terminal = job.state === "prepared" || job.state === "verified" || job.state === "not_published";
      if (terminal) {
        await this.event(client, job.workflowId, job.scopeFingerprint, "verify:" + result.verificationEventId, "verification_completed", result);
        const sameOutcome = (job.state === "verified" && result.decision === "verified_published")
          || (job.state === "not_published" && result.decision === "verified_not_published")
          || (job.state === "prepared" && result.decision === "prepared");
        const sameTime = job.verifiedAt !== null && result.verifiedAt !== null
          && Date.parse(job.verifiedAt) === Date.parse(result.verifiedAt);
        if (sameOutcome && (job.state === "prepared" ? job.preparedResultId === result.resultId : job.verifiedResultId === result.resultId) && sameTime) return job;
        throw new BusinessPlanWorkflowError("EVENT_CONFLICT");
      }
      const nextBlockers = complete ? [] : blockers([...job.blockers, ...(result.blockers ?? [])]);
      if (job.state === "submission_unknown" && !complete && JSON.stringify(nextBlockers) === JSON.stringify(job.blockers)) {
        await this.event(client, job.workflowId, job.scopeFingerprint, "verify:" + result.verificationEventId, "verification_completed", result, false);
        return job;
      }
      await this.event(client, job.workflowId, job.scopeFingerprint, "verify:" + result.verificationEventId, "verification_completed", result);
      const state = result.decision === "prepared" ? "prepared" : result.decision === "verified_published" ? "verified" : result.decision === "verified_not_published" ? "not_published" : "submission_unknown";
      const submission = result.decision;
      const operationState = result.decision === "prepared" ? "prepared" : result.decision === "verified_published" ? "verified" : result.decision === "verified_not_published" ? "not_published" : "submission_unknown";
      await client.query("UPDATE " + schema + ".business_plan_workflow_jobs SET state=$2,submission_state=$3,operation_state=$4,verified_result_id=$5,verified_at=$6::timestamptz,prepared_at=CASE WHEN $2='prepared' THEN $6::timestamptz ELSE NULL END,prepared_result_id=CASE WHEN $2='prepared' THEN $7 ELSE NULL END,blockers=$9::jsonb,claim_id=NULL,claim_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workflow_id=$1 AND operation_id=$8 AND state NOT IN ('prepared','verified','not_published')",
        [job.workflowId, state, submission, operationState, result.decision === "prepared" ? null : result.resultId, result.verifiedAt, result.decision === "prepared" ? result.resultId : null, operationId, JSON.stringify(nextBlockers)]);
      const updated = await this.readOne(client, taskId);
      if (!updated) throw unavailable();
      return updated;
    });
  }
  async readProject(projectId: string): Promise<WorkflowJob[]> {
    return this.tx(async client => {
      const rows = (await client.query("SELECT task_id FROM " + schema + ".business_plan_tasks WHERE project_id=$1 ORDER BY task_id", [projectId])).rows as Array<{ task_id: string }>;
      const jobs: WorkflowJob[] = [];
      for (const row of rows) { const job = await this.readOne(client, row.task_id); if (job) jobs.push(job); }
      return jobs;
    });
  }
  private async readOne(client: PoolClient, taskId: string, lock = false): Promise<WorkflowJob | null> {
    const row = (await client.query("SELECT workflow_id,project_id,task_id,task_attempt_id,scope_snapshot,scope_fingerprint,state,submission_state,"
      + "operation_id,operation_state,claim_id,original_claim_id,lease_until,blockers,verified_result_id,verified_at,prepared_at,prepared_result_id FROM " + schema
      + ".business_plan_workflow_jobs WHERE task_id=$1 " + (lock ? "FOR UPDATE" : ""), [taskId])).rows[0] as {
        workflow_id: string; project_id: string; task_id: string; task_attempt_id: string; scope_snapshot: unknown; scope_fingerprint: Buffer;
        state: string; submission_state: string; operation_id: string | null; operation_state: string | null; claim_id: string | null; original_claim_id: string | null;
        lease_until: Date | null; blockers: unknown; verified_result_id: string | null; verified_at: Date | null; prepared_at: Date | null; prepared_result_id: string | null } | undefined;
    if (!row) return null;
    const scope = businessPlanWorkflowScopeSchema.safeParse(row.scope_snapshot);
    if (!scope.success || scope.data.taskId.toLowerCase() !== row.task_id.toLowerCase()
      || scope.data.projectId.toLowerCase() !== row.project_id.toLowerCase()
      || !Buffer.from(row.scope_fingerprint).equals(Buffer.from(fingerprint(scope.data), "hex"))) throw unavailable();
    const values = Array.isArray(row.blockers) ? row.blockers.filter((item): item is string => typeof item === "string") : [];
    return { workflowId: row.workflow_id, projectId: row.project_id, taskId: row.task_id, taskAttemptId: row.task_attempt_id,
      scopeFingerprint: row.scope_fingerprint.toString("hex"), state: row.state, submissionState: row.submission_state,
      operationId: row.operation_id, operationState: row.operation_state, claimId: row.claim_id, originalClaimId: row.original_claim_id,
      leaseUntil: row.lease_until?.toISOString() ?? null,
      blockers: blockers(values), verifiedResultId: row.verified_result_id, verifiedAt: row.verified_at?.toISOString() ?? null, preparedAt: row.prepared_at?.toISOString() ?? null, preparedResultId: row.prepared_result_id, scope: scope.data };
  }
}

/** Internal consumer: there is deliberately no HTTP entry point for any write method. */
export class BusinessPlanWorkflowConsumer implements BusinessPlanWorkflowPortStatusReader {
  constructor(private readonly store: BusinessPlanWorkflowStore, private ports: BusinessPlanWorkflowPorts) {}
  installPorts(ports: BusinessPlanWorkflowPorts) { this.ports = ports; }
  portStatus() { return { executor: this.ports.actionGate && this.ports.executor ? "connected" as const : "unconnected" as const,
    proofVerifier: this.ports.proofVerifier ? "connected" as const : "unconnected" as const }; }
  async authorizeCurrentAction(input: { scope: BusinessPlanWorkflowScope; operationId: string; claimId: string; scopeFingerprint: string; stepId: string }) {
    const job = await this.store.renewLease(input.scope.taskId, input.operationId, input.claimId);
    if (!job || job.operationId !== input.operationId || job.claimId !== input.claimId || job.scopeFingerprint !== input.scopeFingerprint
      || stable(job.scope) !== stable(input.scope) || job.state !== "running" || !this.ports.readiness || !this.ports.actionGate) return null;
    const ready = await this.ports.readiness.assess(job.scope, input.operationId);
    if (ready.adapterState !== "connected" || ready.businessState !== "ready" || ready.blockers.length || ready.scopeFingerprint !== input.scopeFingerprint) return null;
    const permit = await this.ports.actionGate.authorizeAction({ scope: job.scope, operationId: input.operationId,
      scopeFingerprint: input.scopeFingerprint, stepId: input.stepId });
    if (!permit || permit.scopeFingerprint !== input.scopeFingerprint || Date.parse(permit.expiresAt) <= Date.now()) return null;
    return permit;
  }
  async refresh(scopeInput: unknown): Promise<WorkflowJob> {
    const scope = businessPlanWorkflowScopeSchema.parse(scopeInput), sum = fingerprint(scope);
    const raw = this.ports.readiness ? await this.ports.readiness.assess(scope) : {
      adapterState: "unconnected" as const, businessState: "unknown" as const, scopeFingerprint: sum, blockers: ["readiness_port_unconnected"],
    };
    const status = this.portStatus();
    const connected = raw.adapterState === "connected" && status.executor === "connected" && status.proofVerifier === "connected";
    return this.store.materialize(scope, { ...raw, adapterState: connected ? "connected" : "unconnected",
      blockers: [...raw.blockers, ...(status.executor === "unconnected" ? ["executor_unconnected"] : []),
        ...(status.proofVerifier === "unconnected" ? ["proof_verifier_unconnected"] : [])] });
  }
  async queryOriginal(projectId: string, taskId: string): Promise<WorkflowJob | null> {
    const job = (await this.store.readProject(projectId)).find(item => item.taskId.toLowerCase() === taskId.toLowerCase()) ?? null;
    if (!job || !job.operationId || !["running", "submission_unknown"].includes(job.state) || !this.ports.proofVerifier) return job;
    const result = await this.ports.proofVerifier.verifyOriginal({ scope: job.scope, operationId: job.operationId, observation: null });
    // This is a GET-only reconciliation of the same operation. Unknown or still-running
    // responses stay frozen and are never converted into another dispatch.
    if (result.decision !== "prepared" && !(result.decision === "unknown" && result.blockers?.length)) return job;
    return this.store.applyTrustedVerification(job.taskId, job.operationId, result);
  }
  async start(scopeInput: unknown, workerId: string) {
    const job = await this.refresh(scopeInput);
    if (job.state === "queued") void this.runOnce(scopeInput, workerId).catch(() => undefined);
    return job;
  }
  async runOnce(scopeInput: unknown, workerId: string): Promise<WorkflowJob | null> {
    const scope = businessPlanWorkflowScopeSchema.parse(scopeInput), ports = this.ports, sum = fingerprint(scope);
    const job = await this.refresh(scope);
    if (job.state === "claimed") return this.store.expireLease(scope.taskId);
    if (job.state === "blocked" && job.blockers.includes("claim_lease_expired_reconciliation_required")) {
      const reconciler = ports.originalAttemptReconciler;
      if (!reconciler || !job.originalClaimId) return job;
      try {
        const reconciled = await reconciler.reconcileOriginalAttempt({ scope: job.scope, claimId: job.originalClaimId,
          scopeFingerprint: job.scopeFingerprint });
        if (reconciled.outcome !== "found") return job;
        const unknown = await this.store.recordReconciledOperation(scope.taskId, job.originalClaimId, reconciled.operationId, reconciled.observation);
        if (!ports.proofVerifier) return unknown;
        const verification = await ports.proofVerifier.verifyOriginal({ scope: job.scope, operationId: reconciled.operationId,
          observation: reconciled.observation });
        return this.store.applyTrustedVerification(scope.taskId, reconciled.operationId, verification);
      } catch { return job; }
    }
    if (job.state === "running" || job.state === "submission_unknown") {
      const original = await this.store.expireLease(scope.taskId);
      if (!original || original.state === "running") return original;
      if (original.state !== "submission_unknown" || !original.operationId || !ports.proofVerifier) return original;
      try {
        const result = await ports.proofVerifier.verifyOriginal({ scope: original.scope, operationId: original.operationId, observation: null });
        return this.store.applyTrustedVerification(scope.taskId, original.operationId, result);
      } catch { return original; }
    }
    if (!ports.readiness || !ports.actionGate || !ports.executor || !ports.proofVerifier || job.state !== "queued") return job;
    const readiness = await ports.readiness.assess(scope);
    if (!Array.isArray(readiness.blockers) || readiness.adapterState !== "connected" || readiness.businessState !== "ready"
      || readiness.blockers.length !== 0 || readiness.scopeFingerprint !== sum) {
      return this.store.materialize(scope, { ...readiness, adapterState: "unconnected", blockers: [...readiness.blockers, "workflow_readiness_not_ready"] });
    }
    const claim = await this.store.claim(scope.taskId, workerId, 120_000);
    if (!claim?.claimId) return claim;
    const started = await this.store.startOperation(scope.taskId, claim.claimId, sum);
    if (!started) return this.store.readProject(scope.projectId).then(rows => rows.find(row => row.taskId === scope.taskId) ?? null);
    const authorizeAction = async (stepId: string) => {
      const latest = await ports.readiness!.assess(scope, started.operationId);
      if (!Array.isArray(latest.blockers) || latest.adapterState !== "connected" || latest.businessState !== "ready"
        || latest.blockers.length !== 0 || latest.scopeFingerprint !== sum) return null;
      const permit = await ports.actionGate!.authorizeAction({ scope, operationId: started.operationId, stepId, scopeFingerprint: sum });
      if (!permit || !permit.permitId || permit.scopeFingerprint !== sum || !Number.isFinite(Date.parse(permit.expiresAt))
        || Date.parse(permit.expiresAt) <= Date.now()) return null;
      return permit;
    };
    let observation: WorkflowReportedObservation | null = null;
    try { observation = await ports.executor.execute({ scope, operationId: started.operationId, claimId: claim.claimId, authorizeAction });
      await this.store.recordObservation(scope.taskId, started.operationId, observation);
    } catch {
      const unknown: WorkflowReportedObservation = { sourceEventId: randomUUID(),
        payloadDigest: digest({ operationId: started.operationId, result: "unknown" }).toString("hex"), reportedState: "unknown" };
      try { await this.store.recordObservation(scope.taskId, started.operationId, unknown); } catch { /* durable running state remains a hold */ }
    }
    try { const verified = await ports.proofVerifier.verifyOriginal({ scope, operationId: started.operationId, observation });
      return await this.store.applyTrustedVerification(scope.taskId, started.operationId, verified);
    } catch { return (await this.store.readProject(scope.projectId)).find(row => row.taskId === scope.taskId) ?? null; }
  }

  /** Bounded, sequential sweep. It never redispatches expired claims or operations. */
  async sweep(scopes: readonly unknown[], workerId: string, limit = 20): Promise<WorkflowJob[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BusinessPlanWorkflowError("INPUT_INVALID");
    const results: WorkflowJob[] = [];
    for (const input of scopes.slice(0, limit)) {
      const result = await this.runOnce(input, workerId);
      if (result) results.push(result);
    }
    return results;
  }
}
