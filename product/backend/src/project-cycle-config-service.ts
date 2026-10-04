import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { compareTimestamps, contractVersion, idempotencyKeySchema, projectCycleConfigurationCommandReadResponseSchema,
  projectCycleConfigurationReadResponseSchema, projectCycleCurrentReadFactSchema, projectCycleNextConfigurationReadSchema,
  projectPlanningInputsSchema, saveProjectCycleConfigurationReceiptSchema,
  saveProjectCycleConfigurationRequestSchema, uuidSchema,
  type ProjectCycleConfigurationReadResponse } from "@socialgrowth/product-contracts";
import { nextCycleBoundary, resolveProjectCycleWindow } from "./project-cycle-store.js";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const s = "socialgrowth_product";
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Project cycle configuration is unavailable", true);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Project cycle configuration changed; read current facts before saving");
const at = (field: string) => `to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface CurrentCycleRow {
  cycle_id: string; cycle_number: string; config_version: string; business_time_zone: string;
  traffic_minimum: number; starts_at: string; ends_at: string; approved_inputs: unknown;
  approval_id: string; origin_kind: "initial_direction_approval" | "confirmed_next_configuration" | "carry_forward";
  source_configuration_revision: string | null; predecessor_cycle_id: string | null;
  predecessor_cycle_number: string | null; review_interval_days: number | null; recorded_at: string;
}
interface ConfigRow {
  configuration_revision: string; based_on_cycle_id: string; business_time_zone: string; review_interval_days: number;
  traffic_minimum_per_cycle: number; effective_starts_at: string; projected_ends_at: string;
  confirmed_by_operator_id: string; confirmed_at: string; request_id: string;
}
interface CommandRow { project_id: string; payload_digest: Buffer; response: unknown }

async function freshSession(c: PoolClient, context: OperatorSessionContext): Promise<void> {
  const valid = await c.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND operator_id=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId, context.operator.operatorId]);
  if (valid.rowCount !== 1) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
}

export class ProjectCycleConfigService {
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
      for (const guard of ["material_registry_guard", "resource_reservation_guard", "business_plan_guard"]) {
        if ((await c.query(`SELECT 1 FROM ${s}.${guard} WHERE singleton=true FOR UPDATE`)).rowCount !== 1) throw unavailable();
      }
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

  private async projectExists(c: PoolClient, projectId: string, lock = false): Promise<void> {
    const row = await c.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1${lock ? " FOR UPDATE" : ""}`, [projectId]);
    if (row.rowCount !== 1) throw stale();
  }

  private async cycleSnapshot(c: PoolClient, projectId: string): Promise<{ observedAt: string; current: CurrentCycleRow | null; latest: CurrentCycleRow | null }> {
    const observedAt = (await c.query<{ observed_at: string }>(`SELECT ${at("clock_timestamp()")} observed_at`)).rows[0]?.observed_at;
    if (!observedAt) throw unavailable();
    const active = await c.query<CurrentCycleRow>(`SELECT cycle_id,cycle_number::text,config_version::text,business_time_zone,traffic_minimum,
      starts_at,ends_at,approved_inputs,approval_id,origin_kind,source_configuration_revision::text,predecessor_cycle_id,
      predecessor_cycle_number::text,review_interval_days,${at("recorded_at")} recorded_at FROM ${s}.project_review_cycles
      WHERE project_id=$1 AND starts_at::timestamptz<=$2::timestamptz AND ends_at::timestamptz>$2::timestamptz
      ORDER BY cycle_number DESC LIMIT 2`, [projectId, observedAt]);
    const latest = await c.query<CurrentCycleRow>(`SELECT cycle_id,cycle_number::text,config_version::text,business_time_zone,traffic_minimum,
      starts_at,ends_at,approved_inputs,approval_id,origin_kind,source_configuration_revision::text,predecessor_cycle_id,
      predecessor_cycle_number::text,review_interval_days,${at("recorded_at")} recorded_at FROM ${s}.project_review_cycles
      WHERE project_id=$1 ORDER BY cycle_number DESC LIMIT 1`, [projectId]);
    if (active.rows.length > 1) throw unavailable();
    return { observedAt, current: active.rows[0] ?? null, latest: latest.rows[0] ?? null };
  }

  private async latestConfig(c: PoolClient, projectId: string): Promise<ConfigRow | null> {
    return (await c.query<ConfigRow>(`SELECT configuration_revision::text,based_on_cycle_id,business_time_zone,review_interval_days,
      traffic_minimum_per_cycle,effective_starts_at,projected_ends_at,confirmed_by_operator_id,
      ${at("confirmed_at")} confirmed_at,request_id FROM ${s}.project_review_cycle_configs
      WHERE project_id=$1 ORDER BY configuration_revision DESC LIMIT 1`, [projectId])).rows[0] ?? null;
  }

  private async configApplication(c: PoolClient, projectId: string, config: ConfigRow, latestCycle: CurrentCycleRow | null) {
    const revision = Number(config.configuration_revision);
    const applied = await c.query<{ cycle_id: string }>(`SELECT cycle_id FROM ${s}.project_review_cycles
      WHERE project_id=$1 AND origin_kind='confirmed_next_configuration' AND source_configuration_revision=$2
      ORDER BY cycle_number LIMIT 2`, [projectId, revision]);
    if (applied.rows.length > 1) throw unavailable();
    if (applied.rows[0]) return { state: "applied" as const, materializedCycleId: applied.rows[0].cycle_id, reason: null };

    const lifecycle = (await c.query<{ intent: string }>(`SELECT intent FROM ${s}.project_lifecycle_intents
      WHERE project_id=$1 ORDER BY revision DESC LIMIT 1`, [projectId])).rows[0]?.intent;
    if (lifecycle === "end_requested") return { state: "unresolved" as const, materializedCycleId: null, reason: "project_ended" as const };

    const source = (await c.query<CurrentCycleRow>(`SELECT cycle_id,cycle_number::text,config_version::text,business_time_zone,traffic_minimum,
      starts_at,ends_at,approved_inputs,approval_id,origin_kind,source_configuration_revision::text,predecessor_cycle_id,
      predecessor_cycle_number::text,review_interval_days,${at("recorded_at")} recorded_at
      FROM ${s}.project_review_cycles WHERE project_id=$1 AND cycle_id=$2`, [projectId, config.based_on_cycle_id])).rows[0];
    if (!source) return { state: "unresolved" as const, materializedCycleId: null, reason: "predecessor_missing" as const };
    if (!latestCycle || source.cycle_id !== latestCycle.cycle_id) {
      return { state: "unresolved" as const, materializedCycleId: null, reason: "source_missing" as const };
    }
    if (compareTimestamps(config.effective_starts_at, source.ends_at)! !== 0
      || compareTimestamps(config.confirmed_at, source.ends_at)! > 0) {
      return { state: "unresolved" as const, materializedCycleId: null, reason: "predecessor_missing" as const };
    }
    if (!process.versions.tz || !process.versions.icu) {
      return { state: "unresolved" as const, materializedCycleId: null, reason: "calendar_runtime_unavailable" as const };
    }
    const preview = resolveProjectCycleWindow(source.ends_at, config.review_interval_days, config.business_time_zone);
    if (!preview) {
      const year = new Date(source.ends_at).getUTCFullYear();
      const reason = year < 2000 || year > 2099 ? "outside_verified_calendar_range" as const : "civil_boundary_ambiguous" as const;
      return { state: "unresolved" as const, materializedCycleId: null, reason };
    }
    if (compareTimestamps(preview.startsAt, config.effective_starts_at)! !== 0
      || compareTimestamps(preview.endsAt, config.projected_ends_at)! !== 0) {
      return { state: "unresolved" as const, materializedCycleId: null, reason: "window_preview_mismatch" as const };
    }
    return { state: "pending" as const, materializedCycleId: null, reason: null };
  }

  private async readFacts(c: PoolClient, projectId: string): Promise<ProjectCycleConfigurationReadResponse> {
    await this.projectExists(c, projectId);
    const snapshot = await this.cycleSnapshot(c, projectId);
    const latest = await this.latestConfig(c, projectId);
    const revision = latest ? Number(latest.configuration_revision) : 0;
    let currentCycle: unknown = null;
    if (snapshot.current) {
      const inputs = projectPlanningInputsSchema.parse(snapshot.current.approved_inputs);
      const reviewIntervalDays = snapshot.current.review_interval_days ?? inputs.reviewIntervalDays;
      if (!reviewIntervalDays) throw unavailable();
      if (snapshot.current.origin_kind === "initial_direction_approval"
        && (inputs.businessTimeZone !== snapshot.current.business_time_zone || inputs.reviewIntervalDays !== reviewIntervalDays
          || inputs.trafficMinimumPerCycle !== snapshot.current.traffic_minimum)) throw unavailable();
      let origin: unknown;
      if (snapshot.current.origin_kind === "initial_direction_approval") {
        if (Number(snapshot.current.cycle_number) !== 1 || snapshot.current.source_configuration_revision !== null
          || snapshot.current.predecessor_cycle_id !== null) throw unavailable();
        origin = { kind: "initial_direction_approval", approvalId: snapshot.current.approval_id };
      } else if (snapshot.current.origin_kind === "confirmed_next_configuration") {
        if (!snapshot.current.source_configuration_revision || !snapshot.current.predecessor_cycle_id) throw unavailable();
        origin = { kind: "confirmed_next_configuration", configurationRevision: Number(snapshot.current.source_configuration_revision) };
      } else {
        if (!snapshot.current.predecessor_cycle_id || snapshot.current.source_configuration_revision !== null) throw unavailable();
        origin = { kind: "carry_forward", predecessorCycleId: snapshot.current.predecessor_cycle_id };
      }
      currentCycle = projectCycleCurrentReadFactSchema.parse({ cycleId: snapshot.current.cycle_id, cycleNumber: Number(snapshot.current.cycle_number),
        configVersion: Number(snapshot.current.config_version), businessTimeZone: snapshot.current.business_time_zone,
        reviewIntervalDays, trafficMinimumPerCycle: snapshot.current.traffic_minimum,
        startsAt: snapshot.current.starts_at, endsAt: snapshot.current.ends_at, recordedAt: snapshot.current.recorded_at, origin });
    }
    const nextConfiguration = latest ? projectCycleNextConfigurationReadSchema.parse({ configurationRevision: revision,
      basedOnCycleId: latest.based_on_cycle_id, businessTimeZone: latest.business_time_zone,
      reviewIntervalDays: latest.review_interval_days, trafficMinimumPerCycle: latest.traffic_minimum_per_cycle,
      effectiveStartsAt: latest.effective_starts_at, projectedEndsAt: latest.projected_ends_at,
      confirmedByOperatorId: latest.confirmed_by_operator_id, confirmedAt: latest.confirmed_at, requestId: latest.request_id,
      application: await this.configApplication(c, projectId, latest, snapshot.latest) }) : null;
    return projectCycleConfigurationReadResponseSchema.parse({ contractVersion, projectId, observedAt: snapshot.observedAt,
      configurationRevision: revision, currentCycle, nextConfiguration, nextCycle: null,
      executionAllowed: false, publicationAllowed: false });
  }

  async read(token: string, projectInput: string): Promise<ProjectCycleConfigurationReadResponse> {
    const parsed = uuidSchema.safeParse(projectInput);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project locator");
    return this.tx(token, null, c => this.readFacts(c, parsed.data.toLowerCase()));
  }

  async readCommand(token: string, projectInput: string, keyInput: string) {
    const project = uuidSchema.safeParse(projectInput), key = idempotencyKeySchema.safeParse(keyInput);
    if (!project.success || !key.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project cycle command locator");
    const projectId = project.data.toLowerCase();
    return this.tx(token, null, async (c, context) => {
      await this.projectExists(c, projectId);
      const row = (await c.query<CommandRow>(`SELECT project_id,payload_digest,response FROM ${s}.project_review_cycle_config_commands
        WHERE actor_id=$1 AND project_id=$2 AND request_key=$3`, [context.operator.operatorId, projectId, key.data])).rows[0];
      if (!row) return projectCycleConfigurationCommandReadResponseSchema.parse({ status: "not_found", projectId, requestId: null, receipt: null });
      const receipt = saveProjectCycleConfigurationReceiptSchema.parse(row.response);
      return projectCycleConfigurationCommandReadResponseSchema.parse({ status: "found", projectId, requestId: receipt.requestId,
        receipt: { ...receipt, replayed: false } });
    });
  }

  async save(token: string, csrf: string, projectInput: string, raw: unknown) {
    const project = uuidSchema.safeParse(projectInput), parsed = saveProjectCycleConfigurationRequestSchema.safeParse(raw);
    if (!project.success || !parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project cycle configuration");
    const projectId = project.data.toLowerCase(), request = parsed.data;
    const digest = createHash("sha256").update(JSON.stringify({ route: "POST /api/operator/projects/:projectId/review-cycle-config",
      projectId, contractVersion: request.metadata.contractVersion, expectedConfigurationRevision: request.expectedConfigurationRevision,
      businessTimeZone: request.businessTimeZone, reviewIntervalDays: request.reviewIntervalDays,
      trafficMinimumPerCycle: request.trafficMinimumPerCycle })).digest();
    return this.tx(token, csrf, async (c, context) => {
      await this.projectExists(c, projectId, true);
      const actorId = context.operator.operatorId;
      const old = (await c.query<CommandRow>(`SELECT project_id,payload_digest,response FROM ${s}.project_review_cycle_config_commands
        WHERE actor_id=$1 AND request_key=$2`, [actorId, request.metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.project_id !== projectId || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to different inputs");
        const receipt = saveProjectCycleConfigurationReceiptSchema.parse(old.response);
        return saveProjectCycleConfigurationReceiptSchema.parse({ ...receipt, replayed: true });
      }

      const previous = await this.latestConfig(c, projectId);
      const currentRevision = previous ? Number(previous.configuration_revision) : 0;
      if (currentRevision !== request.expectedConfigurationRevision || currentRevision >= Number.MAX_SAFE_INTEGER) throw stale();
      const snapshot = await this.cycleSnapshot(c, projectId);
      let outcome: "confirmed" | "unchanged" | "unresolved" = "unresolved";
      let reason: "current_cycle_missing" | "current_cycle_stale" | "previous_window_elapsed" | "calendar_runtime_unavailable" | "outside_verified_calendar_range" | "civil_boundary_ambiguous" | null = null;
      let config: ReturnType<typeof projectCycleNextConfigurationSchema.parse> | null = null;
      let confirmedAt: string | null = null;
      if (!snapshot.latest) reason = "current_cycle_missing";
      else if (!snapshot.current) reason = nextCycleBoundary(snapshot.latest.ends_at, snapshot.observedAt) ? "current_cycle_stale" : "previous_window_elapsed";
      else if (snapshot.latest.cycle_id !== snapshot.current.cycle_id) reason = "current_cycle_stale";
      else if (!process.versions.tz || !process.versions.icu) reason = "calendar_runtime_unavailable";
      else {
        const preview = resolveProjectCycleWindow(snapshot.current.ends_at, request.reviewIntervalDays, request.businessTimeZone);
        if (!preview) {
          const startYear = new Date(snapshot.current.ends_at).getUTCFullYear();
          reason = startYear < 2000 || startYear > 2099 ? "outside_verified_calendar_range" : "civil_boundary_ambiguous";
        } else {
          const dbTime = (await c.query<{ confirmed_at: string }>(`SELECT ${at("clock_timestamp()")} confirmed_at`)).rows[0]?.confirmed_at;
          if (!dbTime) throw unavailable();
          if (!nextCycleBoundary(snapshot.current.ends_at, dbTime)) reason = "previous_window_elapsed";
          else if (previous && previous.based_on_cycle_id === snapshot.current.cycle_id
            && previous.business_time_zone === request.businessTimeZone && previous.review_interval_days === request.reviewIntervalDays
            && previous.traffic_minimum_per_cycle === request.trafficMinimumPerCycle) outcome = "unchanged";
          else {
            outcome = "confirmed"; confirmedAt = dbTime;
            config = projectCycleNextConfigurationSchema.parse({ configurationRevision: currentRevision + 1,
              basedOnCycleId: snapshot.current.cycle_id, businessTimeZone: request.businessTimeZone,
              reviewIntervalDays: request.reviewIntervalDays, trafficMinimumPerCycle: request.trafficMinimumPerCycle,
              effectiveStartsAt: snapshot.current.ends_at, projectedEndsAt: preview.endsAt,
              confirmedByOperatorId: actorId, confirmedAt: dbTime, requestId: request.metadata.requestId });
          }
        }
      }
      const now = (await c.query<{ recorded_at: string }>(`SELECT ${at("clock_timestamp()")} recorded_at`)).rows[0]?.recorded_at;
      if (!now) throw unavailable();
      if (outcome === "unchanged" || outcome === "unresolved") config = previous ? projectCycleNextConfigurationSchema.parse({ configurationRevision: Number(previous.configuration_revision),
        basedOnCycleId: previous.based_on_cycle_id, businessTimeZone: previous.business_time_zone,
        reviewIntervalDays: previous.review_interval_days, trafficMinimumPerCycle: previous.traffic_minimum_per_cycle,
        effectiveStartsAt: previous.effective_starts_at, projectedEndsAt: previous.projected_ends_at,
        confirmedByOperatorId: previous.confirmed_by_operator_id, confirmedAt: previous.confirmed_at, requestId: previous.request_id }) : null;
      if (outcome === "unresolved" && reason === null) throw unavailable();
      const configRevision = outcome === "confirmed" ? currentRevision + 1 : currentRevision;
      const response = saveProjectCycleConfigurationReceiptSchema.parse({ projectId, outcome, configurationRevision: configRevision,
        nextConfiguration: config, reason, requestId: request.metadata.requestId, replayed: false, recordedAt: now,
        executionAllowed: false, publicationAllowed: false });
      if (outcome === "confirmed") {
        if (!config || !confirmedAt) throw unavailable();
        await c.query(`INSERT INTO ${s}.project_review_cycle_configs(project_id,configuration_revision,based_on_cycle_id,business_time_zone,
          review_interval_days,traffic_minimum_per_cycle,effective_starts_at,projected_ends_at,confirmed_by_operator_id,confirmed_at,
          request_id,request_key,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [projectId, config.configurationRevision, config.basedOnCycleId, config.businessTimeZone, config.reviewIntervalDays,
            config.trafficMinimumPerCycle, config.effectiveStartsAt, config.projectedEndsAt, actorId, confirmedAt,
            request.metadata.requestId, request.metadata.idempotencyKey, digest]);
      }
      await c.query(`INSERT INTO ${s}.project_review_cycle_config_commands(actor_id,request_key,project_id,payload_digest,response)
        VALUES($1,$2,$3,$4,$5)`, [actorId, request.metadata.idempotencyKey, projectId, digest, response]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,$3,'project',$4,$5,$6)`, [randomUUID(), actorId,
          outcome === "confirmed" ? "project.review_cycle_config_confirmed" : `project.review_cycle_config_${outcome}`,
          projectId, request.metadata.requestId, { outcome, reason, configurationRevision: configRevision,
            basedOnCycleId: config?.basedOnCycleId ?? null, effectiveStartsAt: config?.effectiveStartsAt ?? null }]);
      return response;
    });
  }
}
