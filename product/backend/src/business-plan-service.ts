import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { arrangeBusinessPlanRequestSchema, arrangeBusinessPlanResponseSchema, businessPlanCurrentViewSchema,
  directionApprovalSchema, uuidSchema, type ArrangeBusinessPlanRequest, type BusinessPlanCurrentView } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { canonicalMaterial, materialIdentitySchema } from "./material-registry-core.js";
import { MaterialRuntime } from "./material-runtime.js";
import { BusinessModelCoordinator, type BusinessModelPort } from "./business-model-coordinator.js";
import { parseContentQuota, type ContentQuotaSnapshot } from "./content-quota-core.js";
import { checkBusinessSuggestion, type BusinessSuggestion, type BusinessSuggestionContext } from "./business-suggestion-core.js";
import { businessPlanCurrentChecksResponseSchema, type BusinessPlanCurrentChecksResponse } from "@socialgrowth/product-contracts";
import { parsePhoneControlRecord } from "./action-permission-core.js";

const s = "socialgrowth_product";
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Business planning is unavailable", true);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Approved scope or plan changed; read current facts and retry explicitly");
type DiagnosticStage = "connection" | "idempotency_read" | "preflight" | "model_fact_read" | "persist_insufficient" | "persist_plan" | "model_describe" | "model_coordinator";
type DiagnosticCategory = "serialization_conflict" | "deadlock" | "lock_timeout" | "statement_timeout" | "integrity_constraint" | "other"
  | "database_unavailable" | "rollback_failed" | "application_internal" | "describe_timeout" | "describe_unavailable"
  | "configuration_missing" | "input_invalid" | "facts_unavailable" | "model_unavailable" | "deadline_exceeded" | "clock_invalid";
function databaseFailureCategory(error: unknown): DiagnosticCategory {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : null;
  if (typeof code !== "string") return "other";
  switch (code) {
    case "40001": return "serialization_conflict";
    case "40P01": return "deadlock";
    case "55P03": return "lock_timeout";
    case "57014": return "statement_timeout";
    case "23502": case "23503": case "23505": case "23514": return "integrity_constraint";
    default: return "other";
  }
}
function recordPlanDiagnostic(stage: DiagnosticStage, category: DiagnosticCategory, requestId: string, projectId: string, attemptId?: string): void {
  console.warn(JSON.stringify({ event: "business_plan_failure", stage, category, requestId, projectId, ...(attemptId ? { attemptId } : {}) }));
}
interface BusinessPlanModel extends BusinessModelPort { describe(signal: AbortSignal): Promise<{ providerKey: string; modelKey: string }> }
type CurrentScope = BusinessPlanCurrentView["currentScope"];
interface Snapshot {
  context: BusinessSuggestionContext;
  descriptions: Array<{ factId: string; version: number; text: string }>;
  projectVersion: number;
  approvalId: string;
  expectedPlanRevision: number;
}
function comparableSnapshot(value: Snapshot) {
  const context = { ...value.context, observedAt: "" };
  return canonicalMaterial({ context, descriptions: value.descriptions, projectVersion: value.projectVersion, approvalId: value.approvalId, expectedPlanRevision: value.expectedPlanRevision });
}

export class BusinessPlanService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService,
    private readonly materialRuntime: MaterialRuntime, private readonly model: BusinessPlanModel | null) {}

  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, actorId: string) => Promise<T>,
    diagnostic?: { stage: DiagnosticStage; requestId: string; projectId: string }): Promise<T> {
    let c: PoolClient;
    try { c = await this.pool.connect(); } catch {
      if (diagnostic) recordPlanDiagnostic("connection", "database_unavailable", diagnostic.requestId, diagnostic.projectId);
      throw unavailable();
    }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='12s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const actor = await this.auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      if ((await c.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`)).rowCount !== 1
        || (await c.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR UPDATE`)).rowCount !== 1
        || (await c.query(`SELECT 1 FROM ${s}.business_plan_guard FOR UPDATE`)).rowCount !== 1) throw unavailable();
      const result = await fn(c, actor.operator.operatorId);
      const valid = await c.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [actor.sessionId]);
      if (valid.rowCount !== 1) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await c.query("COMMIT"); return result;
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch {
        if (diagnostic) recordPlanDiagnostic(diagnostic.stage, "rollback_failed", diagnostic.requestId, diagnostic.projectId);
        throw unavailable();
      }
      if (error instanceof ProductTransactionError) {
        if (diagnostic && error.code === "INTERNAL_ERROR") recordPlanDiagnostic(diagnostic.stage, "application_internal", diagnostic.requestId, diagnostic.projectId);
        throw error;
      }
      if (diagnostic) recordPlanDiagnostic(diagnostic.stage, databaseFailureCategory(error), diagnostic.requestId, diagnostic.projectId);
      throw unavailable();
    } finally { c.release(); }
  }

  private async scope(c: PoolClient, projectId: string): Promise<{ current: CurrentScope; approval: ReturnType<typeof directionApprovalSchema.parse> | null; phase: string }> {
    const project = (await c.query<{ fact_version: string; phase: string }>(`SELECT fact_version::text,phase FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
    if (!project) throw stale();
    const raw = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.project_direction_approvals WHERE project_id=$1`, [projectId])).rows[0]?.record;
    const approval = raw ? directionApprovalSchema.parse(raw) : null;
    const draft = (await c.query<{ draft_version: string }>(`SELECT draft_version::text FROM ${s}.project_planning_drafts WHERE project_id=$1`, [projectId])).rows[0];
    const effective = approval && Number(project.fact_version) === approval.proposal.projectVersion + 1 && Number(draft?.draft_version ?? 0) === approval.proposal.draftVersion
      ? approval : null;
    const window = effective?.proposal.scope.inputs.publishingWindow ?? null;
    return { current: { projectVersion: Number(project.fact_version), approvalId: effective?.approvalId ?? null, window }, approval: effective, phase: project.phase };
  }

  private async view(c: PoolClient, projectId: string): Promise<BusinessPlanCurrentView> {
    const { current } = await this.scope(c, projectId);
    const record = (await c.query<{ current_revision: string; plan_id: string | null }>(`SELECT current_revision::text,plan_id FROM ${s}.business_plan_records WHERE project_id=$1`, [projectId])).rows[0];
    const revision = Number(record?.current_revision ?? 0);
    let plan: BusinessPlanCurrentView["plan"] = null;
    let tasks: BusinessPlanCurrentView["tasks"] = [];
    if (record?.plan_id && revision > 0) {
      const r = (await c.query<{ project_version: string; approval_id: string; window_start: string; window_end: string; recorded_at: Date }>(`SELECT project_version::text,approval_id,window_start,window_end,recorded_at FROM ${s}.business_plan_revisions WHERE project_id=$1 AND revision=$2 AND plan_id=$3`, [projectId, revision, record.plan_id])).rows[0];
      if (!r) throw unavailable();
      const window = { startsAt: r.window_start, endsAt: r.window_end };
      const currentPlan = current.approvalId === r.approval_id && current.projectVersion === Number(r.project_version)
        && current.window?.startsAt === window.startsAt && current.window?.endsAt === window.endsAt;
      plan = { planId: record.plan_id, revision, projectVersion: Number(r.project_version), approvalId: r.approval_id, window,
        scopeState: currentPlan ? "current" : "stale", recordedAt: r.recorded_at.toISOString() };
      const rows = await c.query<{ task_id: string; task_revision: string; content_unit_id: string; variant_id: string; material_revision: string; identity_id: string;
        platform: "facebook" | "youtube"; form: "facebook_video" | "facebook_image_text" | "youtube_shorts" | "youtube_video"; language_tag: string; scheduled_at: string }>(
        `SELECT task_id,task_revision::text,content_unit_id,variant_id,material_revision::text,identity_id,platform,form,language_tag,scheduled_at
           FROM ${s}.business_plan_tasks WHERE project_id=$1 ORDER BY recorded_at,task_id`, [projectId]);
      tasks = rows.rows.map(t => ({ taskId: t.task_id, revision: Number(t.task_revision), contentUnitId: t.content_unit_id, variantId: t.variant_id,
        materialRevision: Number(t.material_revision), identityId: t.identity_id, platform: t.platform, form: t.form, languageTag: t.language_tag,
        scheduledAt: t.scheduled_at, state: "pending_current_checks" as const }));
    }
    return businessPlanCurrentViewSchema.parse({ projectId, currentScope: current, plan, tasks, executionAllowed: false, publicationAllowed: false });
  }

  async read(token: string, projectInput: string) {
    const project = uuidSchema.safeParse(projectInput);
    if (!project.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project identifier");
    return this.tx(token, null, c => this.view(c, project.data.toLowerCase()));
  }

  async currentChecks(token: string, projectInput: string): Promise<BusinessPlanCurrentChecksResponse> {
    const project = uuidSchema.safeParse(projectInput);
    if (!project.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project identifier");
    return this.tx(token, null, async c => {
      const projectId = project.data.toLowerCase();
      const view = await this.view(c, projectId);
      const now = (await c.query<{ checked_at: Date }>("SELECT clock_timestamp() AS checked_at")).rows[0]?.checked_at;
      if (!now) throw unavailable();
      const record = (await c.query<{ plan_id: string | null; current_revision: string }>(
        `SELECT plan_id,current_revision::text FROM ${s}.business_plan_records WHERE project_id=$1`, [projectId])).rows[0];
      const plan = record?.plan_id && view.plan ? { planId: record.plan_id, revision: Number(record.current_revision),
        projectVersion: view.plan.projectVersion, approvalId: view.plan.approvalId } : null;
      const tasks = (await c.query<{ task_id: string; task_revision: string; plan_id: string; plan_revision: string; variant_id: string;
        material_revision: string; identity_id: string; platform: "facebook" | "youtube";
        form: "facebook_video" | "facebook_image_text" | "youtube_shorts" | "youtube_video"; scheduled_at: string }>(
        `SELECT task_id,task_revision::text,plan_id,plan_revision::text,variant_id,material_revision::text,identity_id,platform,form,scheduled_at
           FROM ${s}.business_plan_tasks WHERE project_id=$1 ORDER BY recorded_at,task_id LIMIT 1001`, [projectId])).rows;
      if (tasks.length > 1000) throw new ProductTransactionError("INPUT_INVALID", "Project task inventory exceeds the bounded current-check read");
      const materials = await this.materialRuntime.registry().listCurrentForBusinessPlan(c, projectId);
      const materialByVariant = new Map(materials.map(item => [item.variantId, item]));
      const deviceFacts = tasks.length ? (await c.query<{ task_id: string; reserved_device_id: string | null; device_state: string | null;
        association_id: string | null; association_generation: string | null; installation_id: string | null; installation_generation: string | null; installation_status: string | null;
        provider_status: string | null; network_phase: string | null; network_expires_at: Date | null;
        participation_run_id: string | null; phone_record: unknown; latest_control_action: string | null }>(
        `SELECT t.task_id,r.device_id AS reserved_device_id,d.state AS device_state,a.association_id,a.association_generation,a.installation_id,
          i.generation::text AS installation_generation,i.status AS installation_status,p.status AS provider_status,
          n.phase AS network_phase,n.expires_at AS network_expires_at,l.run_id AS participation_run_id,
          j.record AS phone_record,ctl.action AS latest_control_action
         FROM ${s}.business_plan_tasks t
         LEFT JOIN ${s}.project_identity_reservations r ON r.project_id=t.project_id AND r.identity_id=t.identity_id
         LEFT JOIN ${s}.devices d ON d.device_id=r.device_id
         LEFT JOIN LATERAL (SELECT a0.association_id,a0.installation_id,a0.provider_id,ass.expected_installation_generation::text association_generation FROM ${s}.device_associations a0
           JOIN ${s}.association_sessions ass USING(association_session_id)
           WHERE a0.device_id=d.device_id AND a0.ended_at IS NULL ORDER BY a0.confirmed_at DESC LIMIT 1) a ON true
         LEFT JOIN ${s}.installations i ON i.installation_id=a.installation_id
         LEFT JOIN ${s}.providers p ON p.provider_id=a.provider_id
         LEFT JOIN LATERAL (SELECT e.phase,e.expires_at FROM ${s}.network_enrollments e
           WHERE e.device_id=d.device_id AND e.installation_id=i.installation_id AND e.association_id=a.association_id
             AND e.generation=i.generation AND e.phase<>'reclaimed' ORDER BY e.generation DESC LIMIT 1) n ON true
         LEFT JOIN LATERAL (SELECT pr.run_id FROM ${s}.local_participation_runs pr JOIN ${s}.installation_sessions iss ON iss.session_id=pr.session_id
           WHERE pr.device_id=d.device_id AND pr.installation_id=i.installation_id AND pr.association_id=a.association_id
             AND pr.installation_generation=i.generation::text AND pr.revoked_at IS NULL AND iss.revoked_at IS NULL
             AND iss.expires_at>clock_timestamp() ORDER BY pr.started_at DESC LIMIT 1) l ON true
         LEFT JOIN ${s}.phone_control_journals j ON j.device_id=d.device_id
         LEFT JOIN LATERAL (SELECT ar.action FROM ${s}.audit_records ar WHERE ar.object_type='device' AND ar.object_id=d.device_id
           AND ar.action IN ('provider_device_control.pause_requested','provider_device_control.resume_requested','installation_device_control.pause_requested')
           ORDER BY ar.occurred_at DESC,ar.audit_record_id DESC LIMIT 1) ctl ON true
         WHERE t.project_id=$1 ORDER BY t.recorded_at,t.task_id`, [projectId])).rows : [];
      const factByTask = new Map(deviceFacts.map(item => [item.task_id, item]));
      const impactStoreAvailable = (await c.query<{ present: boolean }>(
        `SELECT to_regclass('socialgrowth_product.business_plan_outbox_impacts') IS NOT NULL AS present`)).rows[0]?.present === true;
      const impacts = tasks.length && impactStoreAvailable ? (await c.query<{ task_id: string; impact_revision: string; reason: "project_scope_changed" | "material_revision_changed";
        observed_project_version: string; observed_material_revision: string | null; recorded_at: Date }>(
        `SELECT i.task_id,i.impact_revision::text,i.reason,i.observed_project_version::text,i.observed_material_revision::text,i.recorded_at
         FROM ${s}.business_plan_outbox_impacts i JOIN ${s}.business_plan_tasks t USING(task_id)
         WHERE t.project_id=$1 ORDER BY i.task_id,i.impact_revision`, [projectId])).rows : [];
      const impactsByTask = new Map<string, typeof impacts>();
      for (const impact of impacts) impactsByTask.set(impact.task_id, [...(impactsByTask.get(impact.task_id) ?? []), impact]);
      const response = {
        projectId,
        checkedAt: now.toISOString(),
        plan,
        tasks: tasks.map(task => {
          const material = materialByVariant.get(task.variant_id) ?? null;
          const expectedRevision = material?.revisions.find(revision => revision.revision === Number(task.material_revision));
          const files = (objects: NonNullable<typeof expectedRevision>["objects"]) => objects
            .map(file => ({ objectId: file.objectId, sha256: file.sha256, bytes: file.bytes, contentType: file.contentType }))
            .sort((left, right) => left.objectId.localeCompare(right.objectId));
          const expectedFiles = expectedRevision ? files(expectedRevision.objects) : [];
          const currentFiles = material ? files(material.revisions.at(-1)?.objects ?? []) : null;
          const fact = factByTask.get(task.task_id);
          let controlIntent: "active" | "pause_requested" | "paused" | "resume_requested" | "exit_pending" | "exited" | null = null;
          let controlStop: "not_requested" | "requested" | "confirmed" | "unknown" | null = null;
          if (fact?.device_state) {
            let disposition: "enabled" | "stop_requested" | "stopped" | null = null;
            if (fact.phone_record !== null && fact.phone_record !== undefined) {
              try {
                const parsed = parsePhoneControlRecord(fact.phone_record);
                if (parsed.deviceId === fact.reserved_device_id) disposition = parsed.disposition;
              } catch { /* corrupt/unavailable journal becomes an explicit unknown blocker below */ }
            }
            controlIntent = fact.device_state === "exit_pending" || fact.device_state === "exited" ? fact.device_state
              : fact.latest_control_action?.endsWith("resume_requested") ? "resume_requested"
                : fact.latest_control_action?.endsWith("pause_requested") ? disposition === "stopped" ? "paused" : "pause_requested"
                  : fact.device_state === "paused" ? disposition === "stopped" ? "paused" : "pause_requested" : "active";
            controlStop = disposition === null ? "unknown" : disposition === "enabled" ? "not_requested"
              : disposition === "stopped" ? "confirmed" : "requested";
          }
          const associationCurrent = fact?.association_id !== null && fact?.association_id !== undefined
            && fact.installation_status === "active" && fact.provider_status === "active"
            && fact.association_generation === fact.installation_generation;
          const networkAdmitted = fact?.network_phase === "admitted" && fact.network_expires_at !== null
            && fact.network_expires_at !== undefined && fact.network_expires_at > now;
          const participationCurrent = Boolean(fact?.participation_run_id);
          const refs = impactsByTask.get(task.task_id) ?? [];
          const blockers = new Set<"plan_missing" | "plan_stale" | "project_scope_changed" | "material_missing" | "material_revision_changed"
            | "material_not_eligible" | "identity_reservation_missing" | "device_association_missing" | "installation_missing" | "device_paused"
            | "stop_unconfirmed" | "participation_missing" | "network_not_admitted" | "action_inspector_unavailable" | "current_fact_unknown">();
          if (!plan) blockers.add("plan_missing");
          if (view.plan?.scopeState === "stale") blockers.add("plan_stale");
          if (view.currentScope.projectVersion !== (plan?.projectVersion ?? view.currentScope.projectVersion)
            || refs.some(item => item.reason === "project_scope_changed")) blockers.add("project_scope_changed");
          if (!material) blockers.add("material_missing");
          else {
            if (material.currentRevision !== Number(task.material_revision)) blockers.add("material_revision_changed");
            if (material.status !== "candidate" || !material.candidateAllowed) blockers.add("material_not_eligible");
          }
          if (!expectedFiles.length || !currentFiles?.length) blockers.add("material_missing");
          if (currentFiles && canonicalMaterial(expectedFiles) !== canonicalMaterial(currentFiles)) blockers.add("material_revision_changed");
          if (!fact?.reserved_device_id) blockers.add("identity_reservation_missing");
          if (associationCurrent === false) blockers.add("device_association_missing");
          if (fact?.association_id && !fact.installation_generation) blockers.add("installation_missing");
          if (controlIntent && controlIntent !== "active") blockers.add("device_paused");
          if (controlStop === "requested" || controlStop === "unknown") blockers.add("stop_unconfirmed");
          if (!participationCurrent) blockers.add("participation_missing");
          if (!networkAdmitted) blockers.add("network_not_admitted");
          // The production executor is deliberately absent; this read cannot create authority.
          blockers.add("action_inspector_unavailable");
          if (!impactStoreAvailable || !fact || !fact.reserved_device_id || associationCurrent === null || !fact.installation_generation
            || controlIntent === null || controlStop === null || material === null || !expectedFiles.length || !currentFiles?.length) blockers.add("current_fact_unknown");
          return {
            taskId: task.task_id, taskRevision: Number(task.task_revision), planId: task.plan_id, planRevision: Number(task.plan_revision),
            variantId: task.variant_id, expectedMaterialRevision: Number(task.material_revision), identityId: task.identity_id,
            platform: task.platform, form: task.form, scheduledAt: task.scheduled_at, expectedFiles, currentFiles,
            current: { projectVersion: view.currentScope.projectVersion, approvalId: view.currentScope.approvalId,
              materialRevision: material?.currentRevision ?? null, materialStatus: material?.status ?? null,
              materialCandidateAllowed: material?.candidateAllowed ?? null, reservedDeviceId: fact?.reserved_device_id ?? null,
              associationCurrent: fact ? associationCurrent : null, installationGeneration: fact?.installation_generation ?? null,
              controlIntent, controlStop, participationCurrent: fact ? participationCurrent : null,
              networkAdmitted: fact ? networkAdmitted : null },
            impactReferences: refs.map(item => ({ impactRevision: Number(item.impact_revision), reason: item.reason,
              observedProjectVersion: Number(item.observed_project_version), observedMaterialRevision: item.observed_material_revision === null ? null : Number(item.observed_material_revision),
              recordedAt: item.recorded_at.toISOString() })),
            blockers: [...blockers],
          };
        }),
        executionAllowed: false as const,
        publicationAllowed: false as const,
      };
      return businessPlanCurrentChecksResponseSchema.parse(response);
    });
  }

  private async snapshot(c: PoolClient, projectId: string): Promise<Snapshot | null> {
    const { current, approval, phase } = await this.scope(c, projectId);
    if (!approval || phase !== "preparing" || !current.window) return null;
    const revision = Number((await c.query<{ current_revision: string }>(`SELECT current_revision::text FROM ${s}.business_plan_records WHERE project_id=$1`, [projectId])).rows[0]?.current_revision ?? 0);
    const materials = await this.materialRuntime.registry().listCurrentForBusinessPlan(c, projectId);
    const unitsRows = await c.query<{ content_unit_id: string; identity: unknown }>(`SELECT content_unit_id,identity FROM ${s}.material_content_units WHERE project_id=$1 ORDER BY content_unit_id`, [projectId]);
    const variantRows = await c.query<{ variant_id: string; content_unit_id: string }>(`SELECT variant_id,content_unit_id FROM ${s}.material_variants WHERE project_id=$1 ORDER BY variant_id`, [projectId]);
    const identityRows = await c.query<{ identity_id: string; platform: "facebook" | "youtube"; canonical_identity_ref: string }>(`SELECT i.identity_id,i.platform,i.canonical_identity_ref FROM ${s}.project_identity_reservations r JOIN ${s}.publishing_identities i USING(identity_id)
      WHERE r.project_id=$1 AND r.state='pending_initialization' ORDER BY i.identity_id`, [projectId]);
    const taskRows = await c.query<{ task_id: string; task_revision: string; content_unit_id: string; variant_id: string; material_revision: string; identity_id: string; platform: "facebook" | "youtube";
      form: "facebook_video" | "facebook_image_text" | "youtube_shorts" | "youtube_video"; language_tag: string; scheduled_at: string }>(`SELECT task_id,task_revision::text,content_unit_id,variant_id,material_revision::text,identity_id,platform,form,language_tag,scheduled_at FROM ${s}.business_plan_tasks WHERE project_id=$1 ORDER BY task_id`, [projectId]);
    const allUnits = unitsRows.rows.map(row => {
      const identity = materialIdentitySchema.parse(row.identity);
      return { contentUnitId: row.content_unit_id, projectId, mediaKind: identity.mediaKind, seriesId: identity.seriesId, episodeNumber: identity.episodeNumber };
    });
    const allVariants = variantRows.rows.map(row => ({ variantId: row.variant_id, contentUnitId: row.content_unit_id }));
    const identities = identityRows.rows.filter(row => approval.proposal.scope.identities.some(approved =>
      approved.platform === row.platform && approved.canonicalRef === row.canonical_identity_ref))
      .map(row => ({ identityId: row.identity_id, projectId, platform: row.platform }));
    const slots = taskRows.rows.map(row => ({ contentUnitId: row.content_unit_id, platform: row.platform, variantId: row.variant_id, identityId: row.identity_id,
      taskId: row.task_id, state: "reserved" as const, evidenceId: null }));
    const seriesBindings = slots.flatMap(slot => { const unit = allUnits.find(row => row.contentUnitId === slot.contentUnitId); return unit?.seriesId ? [{ seriesId: unit.seriesId, platform: slot.platform, identityId: slot.identityId, projectId }] : []; })
      .filter((v, i, a) => a.findIndex(x => x.seriesId === v.seriesId && x.platform === v.platform) === i);
    const quota: ContentQuotaSnapshot = parseContentQuota({ units: allUnits, variants: allVariants, identities, slots, seriesBindings });
    const approvalId = approval.approvalId, factSetId = approval.proposal.proposalId, projectVersion = current.projectVersion;
    // Keep fact observation and final eligibility checks on the same clock.
    // Comparing Node wall time here with PostgreSQL clock_timestamp() at commit
    // can reject every otherwise-current suggestion when runner clocks differ.
    const observedAt = (await c.query<{ observed_at: Date }>("SELECT clock_timestamp() AS observed_at")).rows[0]!.observed_at.toISOString();
    const factList = [
      { factId: approvalId, version: projectVersion, kind: "approval" as const, availability: "available" as const },
      ...materials.map(item => ({ factId: item.variantId, version: item.currentRevision, kind: "material" as const, availability: item.candidateAllowed ? "available" as const : "missing" as const })),
      ...taskRows.rows.map(task => ({ factId: task.task_id, version: Number(task.task_revision), kind: "task" as const, availability: "available" as const })),
    ];
    const descriptions = [
      { factId: approvalId, version: projectVersion, text: `Approved project scope: ${canonicalMaterial({ scope: approval.proposal.scope, window: current.window, reservedIdentityIds: identities.map(i => i.identityId) }).slice(0, 3900)}` },
      ...materials.map(item => {
        const declaration = item.revisions.at(-1)!.declaration;
        return { factId: item.variantId, version: item.currentRevision,
          text: canonicalMaterial({ contentUnitId: item.contentUnitId, variantId: item.variantId, languageTag: item.languageTag, status: item.status,
            eligibilityReason: item.eligibilityReason, name: declaration.name, description: declaration.description, businessFacts: declaration.businessFacts,
            sourceStatement: declaration.sourceStatement, externalRightsVerified: false }).slice(0, 3900) };
      }),
    ];
    const context: BusinessSuggestionContext = {
      projectId, factSetId, factSetVersion: projectVersion, observedAt, purpose: "plan_candidate", projectState: "preparing",
      approval: { approvalId, projectVersion, proposalId: factSetId }, approvedWindow: current.window,
      maxPublicationsPerDay: approval.proposal.scope.inputs.maxPublicationsPerDay,
      businessTimeZone: approval.proposal.scope.inputs.businessTimeZone,
      approvedForms: approval.proposal.scope.inputs.contentForms, approvedLanguages: approval.proposal.scope.inputs.targetLanguages,
      facts: factList, materials: materials.map(item => ({ contentUnitId: item.contentUnitId, variantId: item.variantId, materialVersion: item.currentRevision,
        language: item.languageTag, state: item.candidateAllowed ? "candidate" as const : "needs_correction" as const })),
      tasks: taskRows.rows.map(task => ({ taskId: task.task_id, version: Number(task.task_revision), state: "not_started" as const, contentUnitId: task.content_unit_id,
        variantId: task.variant_id, identityId: task.identity_id, form: task.form, scheduledAt: task.scheduled_at })), quota,
    };
    return { context, descriptions, projectVersion, approvalId, expectedPlanRevision: revision };
  }

  private async persistInsufficient(token: string, csrf: string, projectId: string, request: ArrangeBusinessPlanRequest,
    digest: Buffer, first: Snapshot) {
    const { requestId: _requestId, ...metadata } = request.metadata;
    return this.tx(token, csrf, async (c, actor) => {
      const old = (await c.query<{ payload_digest: Buffer; project_id: string; response: unknown }>(`SELECT payload_digest,project_id,response FROM ${s}.business_plan_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.project_id !== projectId || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Business plan key belongs to different inputs");
        return arrangeBusinessPlanResponseSchema.parse(old.response);
      }
      const current = await this.snapshot(c, projectId);
      if (!current || comparableSnapshot(current) !== comparableSnapshot(first)
        || current.projectVersion !== request.expectedProjectVersion || current.approvalId !== request.expectedApprovalId
        || current.expectedPlanRevision !== request.expectedPlanRevision) throw stale();
      const response = arrangeBusinessPlanResponseSchema.parse({ ...(await this.view(c, projectId)), outcome: "insufficient_data", requestId: request.metadata.requestId });
      await c.query(`INSERT INTO ${s}.business_plan_commands(actor_id,request_key,payload_digest,project_id,response) VALUES($1,$2,$3,$4,$5)`,
        [actor, metadata.idempotencyKey, digest, projectId, response]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'business.plan_candidate_blocked','business_plan',$3,$4,$5)`,
        [randomUUID(), actor, projectId, request.metadata.requestId, { reason: "insufficient_data", taskCount: 0, permissions: { executionAllowed: false, publicationAllowed: false } }]);
      return response;
    }, { stage: "persist_insufficient", requestId: request.metadata.requestId, projectId });
  }

  async arrange(token: string, csrf: string, projectInput: string, raw: unknown) {
    const parsed = arrangeBusinessPlanRequestSchema.safeParse(raw);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid business plan arrangement request");
    const request = parsed.data, projectId = uuidSchema.parse(projectInput).toLowerCase();
    request.expectedApprovalId = request.expectedApprovalId.toLowerCase();
    // The route path supplies project identity; the strict body intentionally
    // contains only operator metadata plus the expected current scope triple.
    const { requestId: _requestId, ...metadata } = request.metadata;
    // The route path is part of the command identity. A key replayed against
    // another project must never disclose or return the first project's result.
    const digest = createHash("sha256").update(canonicalMaterial({ projectId, ...request, metadata })).digest();
    // The idempotent POST replay is still a state-changing endpoint boundary;
    // authenticate its CSRF token before returning any saved response.
    const diagnostic = { requestId: request.metadata.requestId, projectId };
    const replay = await this.tx(token, csrf, async (c, actor) => {
      const old = (await c.query<{ payload_digest: Buffer; project_id: string; response: unknown }>(`SELECT payload_digest,project_id,response FROM ${s}.business_plan_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (!old) return null;
      if (old.project_id !== projectId || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Business plan key belongs to different inputs");
      return arrangeBusinessPlanResponseSchema.parse(old.response);
    }, { ...diagnostic, stage: "idempotency_read" });
    if (replay) return replay;
    let first: Snapshot | null = null;
    const preflight = await this.tx(token, null, c => this.snapshot(c, projectId), { ...diagnostic, stage: "preflight" });
    if (!preflight || preflight.projectVersion !== request.expectedProjectVersion || preflight.approvalId !== request.expectedApprovalId
      || preflight.expectedPlanRevision !== request.expectedPlanRevision) throw stale();
    first = preflight;
    // An approved daily cap without its approved business timezone cannot be
    // evaluated. Persist only the exact idempotent insufficient-data response.
    if (preflight.context.maxPublicationsPerDay !== null && preflight.context.businessTimeZone === null)
      return this.persistInsufficient(token, csrf, projectId, request, digest, preflight);
    const reader = { read: async (id: string, signal: AbortSignal) => this.tx(token, null, async c => {
      if (signal.aborted) throw unavailable();
      const current = await this.snapshot(c, id.toLowerCase());
      if (!current || current.projectVersion !== request.expectedProjectVersion || current.approvalId !== request.expectedApprovalId || current.expectedPlanRevision !== request.expectedPlanRevision) throw stale();
      first ??= current;
      return { context: current.context, descriptions: current.descriptions };
    }, { ...diagnostic, stage: "model_fact_read" }) };
    if (!this.model) throw unavailable();
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let configured: { providerKey: string; modelKey: string };
    let describeTimedOut = false;
    try {
      const described = await Promise.race([this.model.describe(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { describeTimedOut = true; controller.abort(); reject(unavailable()); }, 5000); })]);
      configured = { providerKey: described.providerKey, modelKey: described.modelKey };
    } catch {
      clearTimeout(timer); controller.abort();
      recordPlanDiagnostic("model_describe", describeTimedOut ? "describe_timeout" : "describe_unavailable", request.metadata.requestId, projectId);
      throw unavailable();
    }
    finally { clearTimeout(timer); }
    const coordinator = new BusinessModelCoordinator(reader, this.model, { ...configured, timeoutMs: 30_000 });
    const result = await coordinator.run(projectId);
    if (result.status === "unavailable") {
      recordPlanDiagnostic("model_coordinator", result.reason, request.metadata.requestId, projectId, result.provenance?.attemptId);
      throw unavailable();
    }
    if (result.status === "rejected" && result.reason === "DATA_INSUFFICIENT")
      return this.persistInsufficient(token, csrf, projectId, request, digest, first!);
    if (result.status === "rejected") throw stale();
    const suggestion = result.checked.suggestion as BusinessSuggestion;
    let outcome: "planned" | "unchanged" | "insufficient_data" | "direction_confirmation_required";
    if (suggestion.decision === "adjust") outcome = "planned";
    else if (suggestion.decision === "maintain") outcome = "unchanged";
    else if (suggestion.decision === "insufficient_data") outcome = "insufficient_data";
    else outcome = "direction_confirmation_required";
    const outputTasks = suggestion.decision === "adjust" ? suggestion.changes.filter(change => change.kind === "schedule").map(change => change.publication) : [];
    // Series ordering is verified by current quota facts; it remains a check
    // only and never creates a previous-publication fact.
    return this.tx(token, csrf, async (c, actor) => {
      const old = (await c.query<{ payload_digest: Buffer; project_id: string; response: unknown }>(`SELECT payload_digest,project_id,response FROM ${s}.business_plan_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.project_id !== projectId || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Business plan key belongs to different inputs");
        return arrangeBusinessPlanResponseSchema.parse(old.response);
      }
      const current = await this.snapshot(c, projectId.toLowerCase());
      if (!current || !first || comparableSnapshot(current) !== comparableSnapshot(first)
        || current.projectVersion !== request.expectedProjectVersion || current.approvalId !== request.expectedApprovalId || current.expectedPlanRevision !== request.expectedPlanRevision) throw stale();
      const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now;
      // The model check can age while waiting for the final transaction and
      // its locks. Re-run the same pure policy against the locked current
      // snapshot and database time before any plan, Task, or outbox write.
      let finalChecked: ReturnType<typeof checkBusinessSuggestion>;
      try { finalChecked = checkBusinessSuggestion(current.context, suggestion, now.toISOString()); }
      catch { throw stale(); }
      const oldPlan = (await c.query<{ current_revision: string; plan_id: string | null }>(`SELECT current_revision::text,plan_id FROM ${s}.business_plan_records WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
      const revision = Number(oldPlan?.current_revision ?? 0) + 1, planId = oldPlan?.plan_id ?? randomUUID();
      if (!Number.isSafeInteger(revision)) throw stale();
      if (!oldPlan) await c.query(`INSERT INTO ${s}.business_plan_records(project_id,current_revision,plan_id) VALUES($1,0,NULL) ON CONFLICT(project_id) DO NOTHING`, [projectId]);
      await c.query(`INSERT INTO ${s}.business_plan_revisions(project_id,revision,plan_id,project_version,approval_id,window_start,window_end,outcome,suggestion,quota_snapshot,recorded_by_operator_id,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [projectId, revision, planId, current.projectVersion, current.approvalId,
        current.context.approvedWindow!.startsAt, current.context.approvedWindow!.endsAt, outcome, suggestion, finalChecked.tentativeQuota, actor, now]);
      await c.query(`UPDATE ${s}.business_plan_records SET current_revision=$2,plan_id=$3 WHERE project_id=$1`, [projectId, revision, planId]);
      const materialByVariant = new Map((await this.materialRuntime.registry().listCurrentForBusinessPlan(c, projectId.toLowerCase())).map(m => [m.variantId, m]));
      for (const task of outputTasks) {
        const material = materialByVariant.get(task.variantId);
        if (!material || !material.candidateAllowed || material.contentUnitId !== task.contentUnitId) throw stale();
        const platform = task.form.startsWith("facebook_") ? "facebook" : "youtube";
        const slot = finalChecked.tentativeQuota.slots.find(q => q.taskId === task.taskId && q.contentUnitId === task.contentUnitId && q.platform === platform);
        if (!slot) throw stale();
        const taskRow = await c.query(`INSERT INTO ${s}.business_plan_tasks(task_id,project_id,plan_id,plan_revision,content_unit_id,variant_id,material_revision,identity_id,platform,form,language_tag,scheduled_at,title,caption,recorded_by_operator_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [task.taskId, projectId, planId, revision, task.contentUnitId, task.variantId, material.currentRevision,
          task.identityId, platform, task.form, material.languageTag, task.scheduledAt, task.title, task.caption, actor]);
        if (taskRow.rowCount !== 1) throw unavailable();
        await c.query(`INSERT INTO ${s}.business_plan_outbox(message_id,project_id,task_id) VALUES($1,$2,$3)`, [randomUUID(), projectId, task.taskId]);
      }
      const response = arrangeBusinessPlanResponseSchema.parse({ ...(await this.view(c, projectId)), outcome, requestId: request.metadata.requestId });
      await c.query(`INSERT INTO ${s}.business_plan_commands(actor_id,request_key,payload_digest,project_id,response) VALUES($1,$2,$3,$4,$5)`,
        [actor, metadata.idempotencyKey, digest, projectId, response]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'business.plan_candidate_recorded','business_plan',$3,$4,$5)`,
        [randomUUID(), actor, projectId, request.metadata.requestId, { revision, taskCount: outputTasks.length, outcome, permissions: { executionAllowed: false, publicationAllowed: false } }]);
      return response;
    }, { ...diagnostic, stage: "persist_plan" });
  }
}
