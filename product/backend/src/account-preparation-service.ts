import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { accountPreparationIntentSchema, accountPreparationTaskViewSchema, accountPreparationWorkspaceSchema,
  requestAccountPreparationSchema, recheckAccountPreparationSchema, executionLibraryVersion, planAccountPreparation,
  reviewAccountPreparationExecutionSchema, accountPreparationExecutionReviewSchema, accountPreparationOriginalOperationSchema,
  artemisPreparationObservationSchema,
  uuidSchema, type AccountPreparationIntent, type AccountPreparationTaskView } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { canonicalMaterial } from "./material-registry-core.js";
import { parsePhoneControlRecord } from "./action-permission-core.js";
import { loadCurrentLocalParticipation } from "./local-participation-service.js";
import { parseAdmissionRecord } from "./network-admission-record.js";
import { readArtemisPreparationHistory } from "./artemis-preparation-history.js";
const s = "socialgrowth_product";
const digest = (v: unknown) => createHash("sha256").update(canonicalMaterial(v)).digest("hex");
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Preparation service unavailable", true);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Preparation facts changed; read the original task before continuing");
interface Row { task_id: string; project_id: string; intent: unknown; intent_digest: string; task_version: string;
  selected_account_id: string | null; selected_device_id: string | null;
  state: string; next_operation_id: string | null; blockers: unknown; requested_by: string; requested_at: Date; checked_at: Date }
function view(r: Row): AccountPreparationTaskView {
  const intent = accountPreparationIntentSchema.parse(r.intent);
  if (digest(intent) !== r.intent_digest) throw unavailable();
  // Old operator-entered parent references remain part of the immutable
  // request digest, but are not repeated into the current account-preparation
  // UI projection. Their presence never authorizes account selection.
  const { parentLoginRef: _legacyReference, ...safeIntent } = intent;
  return accountPreparationTaskViewSchema.parse({ taskId: r.task_id, projectId: r.project_id, taskVersion: Number(r.task_version), intent: { ...safeIntent, parentLoginRef: null },
    selectedAccountId: r.selected_account_id, selectedDeviceId: r.selected_device_id,
    state: r.state, nextOperationId: r.next_operation_id, blockers: r.blockers, requestedBy: r.requested_by,
    requestedAt: r.requested_at.toISOString(), checkedAt: r.checked_at.toISOString(),
    actionPermissionGranted: false, publicationAllowed: false, acceptanceStarted: false });
}
// Authenticated CENTRAL requests and check history. No caller facts, no SDK call
// inside locks, and no automatic reset/relaunch by recheck or another request key.
export class AccountPreparationService {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, actor: string) => Promise<T>): Promise<T> {
    let c: PoolClient; try { c = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      if ((await c.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR UPDATE`)).rowCount !== 1) throw unavailable();
      const result = await fn(c, context.operator.operatorId);
      if ((await c.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId])).rowCount !== 1)
        throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await c.query("COMMIT"); return result;
    } catch (e) { try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
      if (e instanceof ProductTransactionError) throw e; throw unavailable();
    } finally { c.release(); }
  }
  private async project(c: PoolClient, id: string) {
    const p = (await c.query<{ fact_version: string; phase: string }>(`SELECT fact_version::text,phase FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [id])).rows[0];
    if (!p || p.phase !== "preparing") throw stale(); return Number(p.fact_version);
  }
  private async workspace(c: PoolClient, projectId: string) {
    const projectVersion = await this.project(c, projectId);
    const resourceVersion = Number((await c.query<{ version: string }>(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0]?.version);
    const rows = await c.query<Row>(`SELECT * FROM ${s}.account_preparation_tasks WHERE project_id=$1 ORDER BY requested_at DESC,task_id LIMIT 51`, [projectId]);
    // Bound this first surface honestly; never silently drop tasks/resources.
    const accounts = await c.query(`SELECT a.account_id AS "accountId",a.platform FROM ${s}.media_accounts a JOIN ${s}.project_account_reservations r ON r.account_id=a.account_id WHERE r.project_id=$1 ORDER BY a.account_id LIMIT 101`, [projectId]);
    const devices = await c.query(`SELECT device_id AS "deviceId" FROM ${s}.project_device_reservations WHERE project_id=$1 ORDER BY device_id LIMIT 101`, [projectId]);
    const reviews = await c.query<{ record: unknown }>(`SELECT DISTINCT ON (r.task_id) r.record FROM ${s}.account_preparation_execution_reviews r
      JOIN ${s}.account_preparation_tasks t ON t.task_id=r.task_id WHERE t.project_id=$1 ORDER BY r.task_id,r.review_sequence DESC`, [projectId]);
    const executionReviews = reviews.rows.map(r => accountPreparationExecutionReviewSchema.parse(r.record));
    if (executionReviews.some(r => r.projectId !== projectId || !rows.rows.some(t => t.task_id === r.taskId))) throw unavailable();
    const originalOperations = await this.originalOperations(c, projectId);
    return accountPreparationWorkspaceSchema.parse({ protocolVersion: executionLibraryVersion, projectId, projectVersion, resourceVersion,
      tasks: rows.rows.map(view), accounts: accounts.rows, devices: devices.rows, executionReviews, originalOperations });
  }
  private async originalOperations(c: PoolClient, projectId: string) {
    const rows = await c.query<{ task_id: string; task_version: string; task_attempt_id: string; operation_id: string;
      fingerprint: string; assignment: unknown; trace_id: string | null; claimed_at: Date; observation: unknown | null; received_at: Date | null; observation_fingerprint: string | null;
      intent: unknown; selected_account_id: string | null; selected_device_id: string | null }>(`SELECT i.*,t.intent,t.selected_account_id,t.selected_device_id,o.record AS observation,o.received_at,o.fingerprint AS observation_fingerprint
      FROM ${s}.artemis_preparation_intents i JOIN ${s}.account_preparation_tasks t ON t.task_id=i.task_id
      LEFT JOIN LATERAL (SELECT record,received_at,fingerprint FROM ${s}.artemis_preparation_observations
        WHERE task_attempt_id=i.task_attempt_id ORDER BY received_at DESC,observation_id DESC LIMIT 1) o ON true
      WHERE t.project_id=$1 ORDER BY i.claimed_at,i.task_attempt_id LIMIT 101`, [projectId]);
    return rows.rows.map(r => {
      const { assignment: a } = readArtemisPreparationHistory(r.assignment, r.fingerprint), intent = accountPreparationIntentSchema.parse(r.intent);
      if (a.taskId !== r.task_id
        || a.taskAttemptId !== r.task_attempt_id || a.taskVersion !== Number(r.task_version) || a.operationId !== r.operation_id
        || a.input.projectId !== projectId || a.input.accountId !== r.selected_account_id || a.input.deviceId !== r.selected_device_id
        || canonicalMaterial(a.input.target) !== canonicalMaterial(intent.target)
        || a.input.mode !== intent.mode || a.input.requestedScope.scopeRef !== intent.scopeRef
        || a.input.requestedScope.allowTrustedInstall !== intent.allowTrustedInstall || a.input.requestedScope.allowIdentityCreation !== intent.allowIdentityCreation) throw unavailable();
      const observation = r.observation === null ? null : artemisPreparationObservationSchema.parse(r.observation);
      if (observation !== null && r.observation_fingerprint !== r.fingerprint) throw unavailable();
      // A lost bind ACK may report null; it never erases an already-bound trace.
      if (observation?.traceId !== undefined && observation.traceId !== null && observation.traceId !== r.trace_id) throw unavailable();
      return accountPreparationOriginalOperationSchema.parse({ taskId: r.task_id, taskVersion: Number(r.task_version), taskAttemptId: r.task_attempt_id,
        operationId: r.operation_id, traceId: r.trace_id, claimedAt: r.claimed_at.toISOString(),
        latestObservation: observation === null ? null : { state: observation.state, receivedAt: r.received_at?.toISOString(), evidenceIds: observation.evidenceIds },
        identityVerified: false, publicationAllowed: false });
    });
  }
  async reviewExecution(token: string, csrf: string, raw: unknown) {
    const parsed = reviewAccountPreparationExecutionSchema.safeParse(raw);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid execution review");
    const r = { ...parsed.data, projectId: parsed.data.projectId.toLowerCase(), taskId: parsed.data.taskId.toLowerCase() };
    const { requestId: _requestId, ...metadata } = r.metadata, payload = digest({ ...r, metadata });
    return this.tx(token, csrf, async (c, actor) => {
      await this.project(c, r.projectId);
      const old = (await c.query<{ payload_digest: string; task_id: string; record: unknown }>(`SELECT payload_digest,task_id,record
        FROM ${s}.account_preparation_execution_reviews WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rows[0];
      const oldCommand = (await c.query(`SELECT 1 FROM ${s}.account_preparation_commands WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rowCount;
      if (oldCommand || (old && (old.payload_digest !== payload || old.task_id !== r.taskId))) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Preparation key belongs to different input");
      if (old) { accountPreparationExecutionReviewSchema.parse(old.record); return this.workspace(c, r.projectId); }
      const task = (await c.query<Row>(`SELECT * FROM ${s}.account_preparation_tasks WHERE task_id=$1 AND project_id=$2 FOR UPDATE`, [r.taskId, r.projectId])).rows[0];
      const resourceVersion = Number((await c.query<{ version: string }>(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0]?.version);
      if (!task || Number(task.task_version) !== r.expectedTaskVersion || resourceVersion !== r.expectedResourceVersion) throw stale();
      const current = view(task), intent = { ...current.intent, accountId: current.selectedAccountId, deviceId: current.selectedDeviceId };
      const checked = await this.check(c, r.projectId, intent), blockers = [...checked.blockers];
      let localParticipationCurrent = false;
      if (intent.deviceId !== null) {
        const network = (await c.query<{ record: unknown; phase: string }>(`SELECT record,phase FROM ${s}.network_enrollments WHERE device_id=$1 AND phase<>'reclaimed'`, [intent.deviceId])).rows;
        if (network.length > 1) throw unavailable();
        if (!network[0]) blockers.push("NETWORK_ADMISSION_REQUIRED");
        else {
          const record = parseAdmissionRecord(network[0].record);
          if (record.authority.deviceId !== intent.deviceId || record.phase !== network[0].phase) throw unavailable();
          blockers.push(record.phase === "admitted" && record.authority.eligible ? "CURRENT_NETWORK_PATH_RECHECK_REQUIRED" : "NETWORK_ADMISSION_REQUIRED");
        }
        const control = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR UPDATE`, [intent.deviceId])).rows[0];
        if (!control) blockers.push("PHONE_CONTROL_HOLDER_REQUIRED");
        else {
          const record = parsePhoneControlRecord(control.record);
          if (record.deviceId !== intent.deviceId) throw unavailable();
          if (record.disposition !== "enabled") blockers.push("PHONE_STOP_CONFIRMATION_REQUIRED");
          if (record.holderId === null) blockers.push("PHONE_CONTROL_HOLDER_REQUIRED");
          if (record.calls.some(call => call.status !== "ended")) blockers.push("VERIFY_ORIGINAL_DEVICE_CALL");
        }
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now;
        localParticipationCurrent = (await loadCurrentLocalParticipation(c, intent.deviceId, now)) !== null;
      }
      // No HTTP flags/config fallbacks can fill absent authoritative loaders or
      // every-action protection. This admission report creates no dispatch.
      if (!localParticipationCurrent) blockers.push("CURRENT_LOCAL_PARTICIPATION_CONFIRMATION_REQUIRED");
      blockers.push("CURRENT_ADB_TARGET_AUTHORIZATION_REQUIRED",
        "CURRENT_HOLDER_TASK_SCOPE_REQUIRED", "CURRENT_DEVICE_ACTION_FENCE_REQUIRED", "PREPARATION_EXECUTOR_NOT_CONNECTED",
        "TRUSTED_PLATFORM_EVIDENCE_CONSUMER_REQUIRED");
      const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
      const record = accountPreparationExecutionReviewSchema.parse({ reviewId: randomUUID(), projectId: r.projectId, taskId: r.taskId,
        taskVersion: current.taskVersion, resourceVersion, reviewedBy: actor, reviewedAt: now, state: "blocked", nextOperationId: checked.next,
        blockers: [...new Set(blockers)], actionPermissionGranted: false, dispatchCreated: false, publicationAllowed: false });
      await c.query(`INSERT INTO ${s}.account_preparation_execution_reviews(review_id,task_id,task_version,actor_id,request_key,payload_digest,reviewed_at,record)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [record.reviewId, r.taskId, current.taskVersion, actor, r.metadata.idempotencyKey, payload, now, record]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'operator',$2,'account_preparation.execution_review','account_preparation_task',$3,$4,$5)`,
        [randomUUID(), actor, r.taskId, r.metadata.requestId, { reviewId: record.reviewId, taskVersion: current.taskVersion, dispatchCreated: false }]);
      return this.workspace(c, r.projectId);
    });
  }
  async read(token: string, id: string) {
    const projectId = uuidSchema.safeParse(id); if (!projectId.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid project");
    return this.tx(token, null, c => this.workspace(c, projectId.data.toLowerCase()));
  }
  private async check(c: PoolClient, projectId: string, intent: AccountPreparationIntent) {
    const waiting = (reason: string) => ({ state: "waiting_resources" as const, next: null, blockers: [reason] });
    if (!intent.accountId || !intent.deviceId) return waiting("RESOURCE_ASSIGNMENT_REQUIRED");
    const account = (await c.query<{ platform: string }>(`SELECT a.platform FROM ${s}.media_accounts a JOIN ${s}.project_account_reservations r ON a.account_id=r.account_id WHERE a.account_id=$1 AND r.project_id=$2`, [intent.accountId, projectId])).rows[0];
    const device = (await c.query<{ state: string }>(`SELECT d.state FROM ${s}.devices d JOIN ${s}.project_device_reservations r ON d.device_id=r.device_id WHERE d.device_id=$1 AND r.project_id=$2 FOR UPDATE OF d`, [intent.deviceId, projectId])).rows[0];
    const assignment = await c.query(`SELECT 1 WHERE EXISTS (SELECT 1 FROM ${s}.project_media_account_assignments WHERE account_id=$1 AND project_id=$2 AND device_id=$3 AND handover_requested=false)
      OR (NOT EXISTS (SELECT 1 FROM ${s}.project_media_account_assignments WHERE account_id=$1)
        AND EXISTS (SELECT 1 FROM ${s}.project_identity_reservations WHERE account_id=$1 AND project_id=$2 AND device_id=$3))`, [intent.accountId, projectId, intent.deviceId]);
    if (!account || !device || assignment.rowCount !== 1) return waiting("RESOURCE_ASSIGNMENT_REQUIRED");
    if (account.platform !== intent.target.platform) return waiting("PARENT_ACCOUNT_SCOPE_MISMATCH");
    if (["paused", "restore_pending", "exit_pending", "exited"].includes(device.state)) return waiting("DEVICE_PARTICIPATION_RECHECK_REQUIRED");
    // SDK completion/report is not independent reconciliation. Until a trusted
    // consumer resolves the original operation, a new task version cannot
    // erase its launch intent and create another phone operation.
    if ((await c.query(`SELECT 1 FROM ${s}.artemis_preparation_intents WHERE assignment->'input'->>'deviceId'=$1 LIMIT 1`, [intent.deviceId])).rowCount)
      return { state: "needs_reconciliation" as const, next: null, blockers: ["VERIFY_ORIGINAL_DEVICE_CALL"] };
    const control = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR UPDATE`, [intent.deviceId])).rows[0];
    // Even when no phone holder exists we can record a check, but never launch.
    if (control) {
      const record = parsePhoneControlRecord(control.record);
      if (record.calls.some(call => call.status !== "ended")) return { state: "needs_reconciliation" as const, next: null, blockers: ["VERIFY_ORIGINAL_DEVICE_CALL"] };
    }
    const binding = (await c.query<{ canonical_identity_ref: string }>(`SELECT i.canonical_identity_ref FROM ${s}.project_identity_reservations r JOIN ${s}.publishing_identities i ON i.identity_id=r.identity_id WHERE r.device_id=$1 AND r.platform=$2`, [intent.deviceId, intent.target.platform])).rows[0];
    const p = planAccountPreparation({ protocolVersion: executionLibraryVersion, projectId, accountId: intent.accountId, deviceId: intent.deviceId,
      mode: intent.mode, target: intent.target,
      requestedScope: { scopeRef: intent.scopeRef, allowTrustedInstall: intent.allowTrustedInstall, allowIdentityCreation: intent.allowIdentityCreation },
      facts: { version: 1, currentScopeMatches: true, unresolvedDeviceTask: false, boundIdentityId: binding?.canonical_identity_ref ?? null, priorCreation: "none",
        app: { state: "unknown", evidenceRef: null }, login: { state: "unknown", evidenceRef: null },
        identity: { state: "unknown", observedId: null, observedName: null, kind: null, managementVerified: false, evidenceRef: null } } });
    return p.operationId === null ? waiting(p.reason) : { state: "waiting_executor" as const, next: p.operationId,
      blockers: ["CURRENT_DEVICE_ACTION_FENCE_REQUIRED", "PREPARATION_EXECUTOR_NOT_CONNECTED"] };
  }
  async write(token: string, csrf: string, raw: unknown, kind: "request" | "recheck") {
    const parsed = kind === "request" ? requestAccountPreparationSchema.safeParse(raw) : recheckAccountPreparationSchema.safeParse(raw);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid preparation request");
    const r = parsed.data; const { requestId: _requestId, ...metadata } = r.metadata;
    const payloadDigest = digest({ ...r, metadata });
    return this.tx(token, csrf, async (c, actor) => {
      const projectVersion = await this.project(c, r.projectId);
      if ((await c.query(`SELECT 1 FROM ${s}.account_preparation_execution_reviews WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rowCount)
        throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Preparation key belongs to an execution review");
      const old = (await c.query<{ payload_digest: string; task_id: string; kind: string }>(`SELECT * FROM ${s}.account_preparation_commands WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.payload_digest !== payloadDigest || old.kind !== kind) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Preparation key belongs to different input");
        const task = (await c.query<Row>(`SELECT * FROM ${s}.account_preparation_tasks WHERE task_id=$1 AND project_id=$2`, [old.task_id, r.projectId])).rows[0];
        if (!task) throw unavailable(); view(task);
        return this.workspace(c, r.projectId);
      }
      let task: Row;
      let isNew = false;
      if ("intent" in r) {
        const resourceVersion = Number((await c.query<{ version: string }>(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0]?.version);
        if (projectVersion !== r.expectedProjectVersion || resourceVersion !== r.expectedResourceVersion) throw stale();
        // Canonicalize the deprecated, nullable compatibility field once.
        // New stored intents always carry explicit null; original command
        // digests still cover the exact user request for idempotency.
        const intent = { ...r.intent, parentLoginRef: null }, intentDigest = digest(intent);
        const existing = (await c.query<Row>(`SELECT * FROM ${s}.account_preparation_tasks WHERE project_id=$1 AND selected_account_id=$2 AND platform=$3 FOR UPDATE`, [r.projectId, intent.accountId, intent.target.platform])).rows[0];
        if (existing) {
          view(existing); if (existing.intent_digest !== intentDigest) throw stale(); task = existing;
        } else {
          const count = (await c.query<{ count: number }>(`SELECT count(*)::int count FROM ${s}.account_preparation_tasks WHERE project_id=$1`, [r.projectId])).rows[0]!.count;
          if (count >= 50) throw new ProductTransactionError("INPUT_INVALID", "Preparation workspace limit reached");
          const checked = await this.check(c, r.projectId, intent);
          if (intent.accountId || intent.deviceId) await this.requireSelection(c, r.projectId, intent, intent.accountId, intent.deviceId);
          task = (await c.query<Row>(`INSERT INTO ${s}.account_preparation_tasks(task_id,project_id,parent_login_ref,platform,intent,intent_digest,state,next_operation_id,blockers,requested_by,selected_account_id,selected_device_id)
            VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [randomUUID(), r.projectId, intent.target.platform, intent, intentDigest, checked.state, checked.next, JSON.stringify(checked.blockers), actor, intent.accountId, intent.deviceId])).rows[0]!;
          isNew = true;
        }
      } else {
        const current = (await c.query<Row>(`SELECT * FROM ${s}.account_preparation_tasks WHERE task_id=$1 AND project_id=$2 FOR UPDATE`, [r.taskId, r.projectId])).rows[0];
        if (!current || Number(current.task_version) !== r.expectedTaskVersion || Number(current.task_version) >= Number.MAX_SAFE_INTEGER) throw stale();
        const oldView = view(current);
        const resourceVersion = Number((await c.query<{ version: string }>(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0]?.version);
        if (r.expectedResourceVersion !== resourceVersion) throw stale();
        const accountId = r.selectedAccountId ?? oldView.selectedAccountId, deviceId = r.selectedDeviceId ?? oldView.selectedDeviceId;
        if ((oldView.selectedAccountId !== null && accountId !== oldView.selectedAccountId) || (oldView.selectedDeviceId !== null && deviceId !== oldView.selectedDeviceId)) throw stale();
        if (accountId || deviceId) await this.requireSelection(c, r.projectId, oldView.intent, accountId, deviceId);
        const checked = await this.check(c, r.projectId, { ...oldView.intent, accountId, deviceId });
        task = (await c.query<Row>(`UPDATE ${s}.account_preparation_tasks SET task_version=task_version+1,state=$2,next_operation_id=$3,blockers=$4,checked_at=clock_timestamp(),selected_account_id=$5,selected_device_id=$6 WHERE task_id=$1 RETURNING *`, [r.taskId, checked.state, checked.next, JSON.stringify(checked.blockers), accountId, deviceId])).rows[0]!;
        isNew = true;
      }
      const taskView = view(task);
      if (isNew) {
        if ((await c.query(`INSERT INTO ${s}.account_preparation_checks(check_id,task_id,task_version,record) VALUES($1,$2,$3,$4)`, [randomUUID(), task.task_id, taskView.taskVersion, taskView])).rowCount !== 1) throw unavailable();
        if ((await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,$3,'account_preparation_task',$4,$5,$6)`, [randomUUID(), actor, `account_preparation.${kind}`, task.task_id, r.metadata.requestId,
          { projectId: r.projectId, taskVersion: taskView.taskVersion, state: taskView.state, actionPermissionGranted: false }])).rowCount !== 1) throw unavailable();
      }
      if ((await c.query(`INSERT INTO ${s}.account_preparation_commands(actor_id,request_key,payload_digest,task_id,kind) VALUES($1,$2,$3,$4,$5)`, [actor, r.metadata.idempotencyKey, payloadDigest, task.task_id, kind])).rowCount !== 1) throw unavailable();
      return this.workspace(c, r.projectId);
    });
  }
  private async requireSelection(c: PoolClient, projectId: string, intent: AccountPreparationIntent, accountId: string | null, deviceId: string | null) {
    if (!accountId || !deviceId || (intent.accountId !== null && accountId !== intent.accountId) || (intent.deviceId !== null && deviceId !== intent.deviceId)) throw stale();
    const a = (await c.query<{ platform: string }>(`SELECT a.platform FROM ${s}.media_accounts a JOIN ${s}.project_account_reservations r ON a.account_id=r.account_id WHERE a.account_id=$1 AND r.project_id=$2`, [accountId, projectId])).rows[0];
    const assignment = await c.query(`SELECT 1 WHERE EXISTS (SELECT 1 FROM ${s}.project_media_account_assignments WHERE account_id=$1 AND project_id=$2 AND device_id=$3 AND handover_requested=false)
      OR (NOT EXISTS (SELECT 1 FROM ${s}.project_media_account_assignments WHERE account_id=$1)
        AND EXISTS (SELECT 1 FROM ${s}.project_identity_reservations WHERE account_id=$1 AND project_id=$2 AND device_id=$3))`, [accountId, projectId, deviceId]);
    if (!a || assignment.rowCount !== 1 || a.platform !== intent.target.platform) throw stale();
  }
}
