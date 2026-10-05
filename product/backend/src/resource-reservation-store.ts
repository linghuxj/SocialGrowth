import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { contractVersion, registerMediaIdentityRequestSchema, registerMediaIdentityResponseSchema, requestMetadataSchema,
  accountAssignmentRequestSchema, accountAssignmentResponseSchema, accountAssignmentListResponseSchema,
  resourceCommandLookupResponseSchema, resourceHandoverRequestSchema, resourceHandoverResponseSchema, reusePreparingResourcesRequestSchema } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { initialReservationSchema, parseResourceReservations, reserveInitialResources, ResourceReservationError,
  type ResourceReservationSnapshot } from "./resource-reservation-core.js";

const schema = "socialgrowth_product";
const requestSchema = z.strictObject({ metadata: requestMetadataSchema, reservation: initialReservationSchema,
  expectedResourceVersion: z.int().min(0), expectedProjectVersion: z.int().min(0), expectedDeviceVersion: z.int().min(0) });
export interface ResourceReservationResult { version: number; snapshot: ResourceReservationSnapshot; replayed: boolean }
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Resource facts changed; read and check current facts");
async function load(client: PoolClient): Promise<ResourceReservationSnapshot> {
  // One pg client/transaction: intentionally sequential, not concurrent queries
  // on a busy client. The held guard preserves a coherent resource snapshot.
  const accounts = await client.query(`SELECT account_id AS "accountId",platform FROM ${schema}.media_accounts ORDER BY account_id`);
  const identities = await client.query(`SELECT identity_id AS "identityId",account_id AS "accountId",platform FROM ${schema}.publishing_identities ORDER BY identity_id`);
  const phones = await client.query(`SELECT device_id AS "deviceId",project_id AS "projectId" FROM ${schema}.project_device_reservations ORDER BY device_id`);
  const accountUses = await client.query(`SELECT account_id AS "accountId",project_id AS "projectId" FROM ${schema}.project_account_reservations ORDER BY account_id`);
  const bindings = await client.query(`SELECT identity_id AS "identityId",account_id AS "accountId",platform,device_id AS "deviceId",project_id AS "projectId",state FROM ${schema}.project_identity_reservations ORDER BY identity_id`);
  return parseResourceReservations({ accounts: accounts.rows, identities: identities.rows, phones: phones.rows, accountUses: accountUses.rows, bindings: bindings.rows });
}
// Authenticated preparation ledger. HTTP exposes declaration/reservation, not
// actual execution assignment. A broker must still load current ownership,
// network/control/identity facts before initialization or any phone operation.
export class ResourceReservationStore {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService) {}
  private async transaction<T>(token: string, csrf: string | null, fn: (client: PoolClient, actor: string, sessionId: string) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Resource ledger unavailable", true); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      // Project basics can lock another operator as the new responsible owner.
      // Take their SAME metadata table lock BEFORE any actor/session row, also
      // for reads that wait on the guard, or actor -> guard -> project can cycle
      // against project -> owner. Phone/executor paths do not use this lock.
      await client.query(`LOCK TABLE ${schema}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(client, token, csrf ?? undefined, csrf !== null);
      // One short metadata ledger guard, not a global phone-control lock. The
      // registry producer must also own this guard; snapshot loading then cannot
      // mix competing resource reservations. No network inside this transaction.
      await client.query(`SELECT version FROM ${schema}.resource_reservation_guard WHERE singleton=true FOR UPDATE`);
      const result = await fn(client, context.operator.operatorId, context.sessionId);
      const valid = await client.query(`SELECT 1 FROM ${schema}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId]);
      if (!valid.rowCount) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Resource ledger unavailable", true); }
      if (error instanceof ProductTransactionError || error instanceof ResourceReservationError) throw error;
      throw new ProductTransactionError("INTERNAL_ERROR", "Resource ledger unavailable", true);
    } finally { client.release(); }
  }
  private async version(client: PoolClient): Promise<number> {
    const result = await client.query<{ version: string }>(`SELECT version::text FROM ${schema}.resource_reservation_guard WHERE singleton=true`);
    const value = Number(result.rows[0]?.version); if (!Number.isSafeInteger(value) || value < 0) throw stale(); return value;
  }
  async read(token: string): Promise<ResourceReservationResult> {
    return this.transaction(token, null, async client => ({ version: await this.version(client), snapshot: await load(client), replayed: false }));
  }
  async readAccountAssignments(token: string, projectIdInput?: unknown) {
    const projectId = projectIdInput === undefined ? null : z.string().uuid().refine(v => v === v.toLowerCase()).safeParse(projectIdInput);
    if (projectIdInput !== undefined && (!projectId || !projectId.success)) throw new ProductTransactionError("INPUT_INVALID", "Invalid project");
    return this.transaction(token, null, async client => {
      const version = await this.version(client), id = projectId?.data ?? null;
      let projectVersion: number | null = null;
      if (id) {
        const project = (await client.query<{ fact_version: string }>(`SELECT fact_version::text FROM ${schema}.projects WHERE project_id=$1`, [id])).rows[0];
        if (!project) throw stale(); projectVersion = Number(project.fact_version);
      }
      const assignmentRows = await client.query(`SELECT a.account_id AS "accountId",m.platform,a.project_id AS "projectId",a.device_id AS "deviceId",
        a.state,a.handover_requested AS "handoverRequested" FROM ${schema}.project_media_account_assignments a
        JOIN ${schema}.media_accounts m USING(account_id,platform) ${id ? "WHERE a.project_id=$1" : ""} ORDER BY a.project_id,a.account_id LIMIT 1001`, id ? [id] : []);
      if (assignmentRows.rows.length > 1000) throw new ProductTransactionError("INPUT_INVALID", "Assignment result exceeds list bound");
      const legacyRows = await client.query(`SELECT DISTINCT ON (r.account_id) r.account_id AS "accountId",r.platform,r.project_id AS "projectId",r.device_id AS "deviceId",
        r.state,false AS "handoverRequested" FROM ${schema}.project_identity_reservations r
        LEFT JOIN ${schema}.project_media_account_assignments a ON a.account_id=r.account_id
        WHERE a.account_id IS NULL ${id ? "AND r.project_id=$1" : ""} ORDER BY r.account_id,r.reserved_at DESC LIMIT 1001`, id ? [id] : []);
      if (legacyRows.rows.length > 1000) throw new ProductTransactionError("INPUT_INVALID", "Assignment result exceeds list bound");
      const eligible = id ? await client.query(`SELECT d.device_id AS "deviceId",d.fact_version::text AS "deviceVersion",d.state
        FROM ${schema}.project_device_reservations r JOIN ${schema}.devices d USING(device_id)
        WHERE r.project_id=$1 ORDER BY d.device_id LIMIT 1001`, [id]) : { rows: [] as Array<Record<string, unknown>> };
      if (eligible.rows.length > 1000) throw new ProductTransactionError("INPUT_INVALID", "Eligible device result exceeds list bound");
      return accountAssignmentListResponseSchema.parse({ contractVersion, resourceVersion: version, projectId: id, projectVersion,
        assignments: [...assignmentRows.rows, ...legacyRows.rows], eligibleDevices: eligible.rows.map((row: any) => ({ ...row, deviceVersion: Number(row.deviceVersion) })) });
    });
  }
  async assignAccounts(token: string, csrf: string, input: unknown) {
    const parsed = accountAssignmentRequestSchema.safeParse(input); if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid media account assignment");
    const r = parsed.data, { requestId: _requestId, ...metadata } = r.metadata;
    r.accountIds.sort(); const digest = createHash("sha256").update(JSON.stringify({ ...r, metadata })).digest();
    return this.transaction(token, csrf, async (client, actor) => {
      const version = await this.version(client);
      const command = (await client.query<{ payload_digest: Buffer }>(`SELECT payload_digest FROM ${schema}.resource_account_assignment_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (command) {
        if (command.payload_digest.length !== digest.length || !command.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Assignment key belongs to different input");
        const assignments = await client.query(`SELECT a.account_id AS "accountId",m.platform,a.project_id AS "projectId",a.device_id AS "deviceId",a.state,a.handover_requested AS "handoverRequested"
          FROM ${schema}.project_media_account_assignments a JOIN ${schema}.media_accounts m USING(account_id,platform) WHERE a.project_id=$1 AND a.device_id=$2 ORDER BY a.account_id`, [r.projectId, r.deviceId]);
        return accountAssignmentResponseSchema.parse({ contractVersion, resourceVersion: version, assignments: assignments.rows, changed: false, replayed: true, actionPermissionGranted: false, publicationAllowed: false });
      }
      const collisions = await client.query(`SELECT 1 FROM ${schema}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.media_account_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.media_registry_commands WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, metadata.idempotencyKey]);
      if (collisions.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another resource command");
      if (version !== r.expectedResourceVersion || version === Number.MAX_SAFE_INTEGER) throw stale();
      const project = (await client.query<{ fact_version: string; phase: string }>(`SELECT fact_version::text,phase FROM ${schema}.projects WHERE project_id=$1 FOR UPDATE`, [r.projectId])).rows[0];
      const device = (await client.query<{ fact_version: string; state: string }>(`SELECT fact_version::text,state FROM ${schema}.devices WHERE device_id=$1 FOR UPDATE`, [r.deviceId])).rows[0];
      if (project?.fact_version !== String(r.expectedProjectVersion) || project.phase !== "preparing" || device?.fact_version !== String(r.expectedDeviceVersion)) throw stale();
      if (["unassociated", "exit_pending", "exited", "paused", "restore_pending"].includes(device.state)) throw new ProductTransactionError("INPUT_INVALID", "Device cannot be assigned in its current state");
      const reservedPhone = await client.query(`SELECT 1 FROM ${schema}.project_device_reservations WHERE device_id=$1 AND project_id=$2`, [r.deviceId, r.projectId]);
      if (!reservedPhone.rowCount) throw stale();
      const accounts = await client.query<{ account_id: string; platform: string; canonical_account_ref: string | null; login_identifier: string | null }>(
        `SELECT a.account_id,a.platform,a.canonical_account_ref,a.login_identifier FROM ${schema}.media_accounts a WHERE a.account_id=ANY($1::uuid[]) ORDER BY a.account_id`, [r.accountIds]);
      if (accounts.rows.length !== r.accountIds.length || new Set(accounts.rows.map(row => row.platform)).size !== accounts.rows.length) throw stale();
      for (const account of accounts.rows) {
        if (!account.login_identifier) throw stale();
        const credential = await client.query(`SELECT 1 FROM ${schema}.media_credentials c JOIN ${schema}.media_credential_revisions cr
          ON (c.credential_id,c.account_id,c.platform,c.revision)=(cr.credential_id,cr.account_id,cr.platform,cr.revision)
          WHERE c.account_id=$1 AND c.platform=$2 AND cr.state='stored_unverified'`, [account.account_id, account.platform]);
        if (!credential.rowCount) throw stale();
        const existing = await client.query<{ project_id: string; device_id: string; handover_requested: boolean }>(`SELECT project_id,device_id,handover_requested FROM ${schema}.project_media_account_assignments WHERE account_id=$1 FOR UPDATE`, [account.account_id]);
        if (existing.rowCount && (existing.rows[0]!.project_id !== r.projectId || existing.rows[0]!.device_id !== r.deviceId)) throw new ResourceReservationError("HANDOVER_REQUIRED");
        const accountReservation = await client.query<{ project_id: string }>(`SELECT project_id FROM ${schema}.project_account_reservations WHERE account_id=$1 FOR UPDATE`, [account.account_id]);
        if (accountReservation.rowCount && accountReservation.rows[0]!.project_id !== r.projectId) throw new ResourceReservationError("HANDOVER_REQUIRED");
        // A legacy project/account reservation without the migrated or current
        // account->device row has no safe phone fact. Do not infer a phone from
        // the new request and thereby turn an orphan reservation into a move.
        if (accountReservation.rowCount && !existing.rowCount) throw new ResourceReservationError("HANDOVER_REQUIRED");
        const platformPhone = await client.query<{ account_id: string; project_id: string }>(`SELECT account_id,project_id FROM ${schema}.project_media_account_assignments WHERE device_id=$1 AND platform=$2 FOR UPDATE`, [r.deviceId, account.platform]);
        if (platformPhone.rowCount && (platformPhone.rows[0]!.account_id !== account.account_id || platformPhone.rows[0]!.project_id !== r.projectId)) throw new ResourceReservationError("HANDOVER_REQUIRED");
        const oldIdentity = await client.query(`SELECT 1 FROM ${schema}.project_identity_reservations WHERE account_id=$1 AND (project_id<>$2 OR device_id<>$3)`, [account.account_id, r.projectId, r.deviceId]);
        if (oldIdentity.rowCount) throw new ResourceReservationError("HANDOVER_REQUIRED");
        if (account.canonical_account_ref !== null) {
          const duplicateCanonical = await client.query(`SELECT 1 FROM ${schema}.media_accounts WHERE platform=$1 AND canonical_account_ref=$2 AND account_id<>$3`, [account.platform, account.canonical_account_ref, account.account_id]);
          if (duplicateCanonical.rowCount) throw stale();
        }
      }
      let changed = false;
      for (const account of accounts.rows) {
        const insertedAccountReservation = await client.query(`INSERT INTO ${schema}.project_account_reservations(account_id,project_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING`, [account.account_id, r.projectId]);
        if (insertedAccountReservation.rowCount) changed = true;
        const insertedAssignment = await client.query(`INSERT INTO ${schema}.project_media_account_assignments(account_id,platform,project_id,device_id,reserved_by_operator_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id) DO NOTHING`, [account.account_id, account.platform, r.projectId, r.deviceId, actor]);
        if (insertedAssignment.rowCount) changed = true;
        const identity = await client.query<{ identity_id: string }>(`SELECT identity_id FROM ${schema}.publishing_identities WHERE account_id=$1 ORDER BY identity_id`, [account.account_id]);
        for (const row of identity.rows) {
          const child = await client.query(`INSERT INTO ${schema}.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id) DO NOTHING`, [row.identity_id, account.account_id, account.platform, r.deviceId, r.projectId, actor]);
          if (child.rowCount) changed = true;
        }
      }
      if (changed) {
        await client.query(`UPDATE ${schema}.resource_reservation_guard SET version=version+1 WHERE singleton=true`);
        await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'resource.media_account_assigned','project',$3,$4,$5)`,
          [randomUUID(), actor, r.projectId, r.metadata.requestId, { accountIds: r.accountIds, deviceId: r.deviceId, resourceVersion: version + 1 }]);
      }
      const appliedVersion = version + (changed ? 1 : 0);
      await client.query(`INSERT INTO ${schema}.resource_account_assignment_commands(actor_id,request_key,payload_digest,account_id,applied_version) VALUES($1,$2,$3,$4,$5)`, [actor, metadata.idempotencyKey, digest, accounts.rows[0]!.account_id, appliedVersion]);
      const assignments = await client.query(`SELECT a.account_id AS "accountId",m.platform,a.project_id AS "projectId",a.device_id AS "deviceId",a.state,a.handover_requested AS "handoverRequested"
        FROM ${schema}.project_media_account_assignments a JOIN ${schema}.media_accounts m USING(account_id,platform) WHERE a.project_id=$1 AND a.device_id=$2 ORDER BY a.account_id`, [r.projectId, r.deviceId]);
      return accountAssignmentResponseSchema.parse({ contractVersion, resourceVersion: appliedVersion, assignments: assignments.rows, changed, replayed: false, actionPermissionGranted: false, publicationAllowed: false });
    });
  }
  async reusePreparingResources(token: string, csrf: string, input: unknown): Promise<ResourceReservationResult> {
    const r = reusePreparingResourcesRequestSchema.parse(input);
    const { requestId: _requestId, ...metadata } = r.metadata;
    const digest = createHash("sha256").update(JSON.stringify({ operation: "reuse_preparing_resources", ...r, metadata })).digest();
    return this.transaction(token, csrf, async (c, actor) => {
      const version = await this.version(c);
      const old = (await c.query<{ payload_digest: Buffer }>(`SELECT payload_digest FROM ${schema}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (old) {
        if (!old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Resource request key belongs to other inputs");
        return { version, snapshot: await load(c), replayed: true };
      }
      const collision = await c.query(`SELECT 1 FROM ${schema}.resource_account_assignment_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.media_account_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.media_registry_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.resource_handover_requests WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, metadata.idempotencyKey]);
      if (collision.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Resource request key belongs to another operation");
      if (version !== r.expectedResourceVersion || version === Number.MAX_SAFE_INTEGER || r.sourceProjectId === r.targetProjectId) throw stale();
      const projects = (await c.query<{ project_id: string; phase: string }>(`SELECT project_id,phase FROM ${schema}.projects WHERE project_id=ANY($1::uuid[]) ORDER BY project_id FOR UPDATE`, [[r.sourceProjectId, r.targetProjectId]])).rows;
      if (projects.length !== 2 || projects.some(p => p.phase !== "preparing")) throw new ProductTransactionError("INPUT_INVALID", "只能复用尚未开始执行的筹备项目资源");
      const assignment = (await c.query<{ device_id: string; handover_requested: boolean }>(`SELECT device_id,handover_requested FROM ${schema}.project_media_account_assignments WHERE account_id=$1 AND project_id=$2 FOR UPDATE`, [r.accountId, r.sourceProjectId])).rows[0];
      if (!assignment || assignment.handover_requested) throw stale();
      const deviceId = assignment.device_id;
      await c.query(`SELECT device_id FROM ${schema}.devices WHERE device_id=$1 FOR UPDATE`, [deviceId]);
      const dispatched = await c.query(`SELECT 1 FROM ${schema}.business_plan_task_attempts WHERE project_id=$1
        UNION ALL SELECT 1 FROM ${schema}.artemis_preparation_intents a JOIN ${schema}.account_preparation_tasks t USING(task_id) WHERE t.project_id=$1
        UNION ALL SELECT 1 FROM ${schema}.project_media_account_assignments WHERE device_id=$2 AND account_id<>$3
        UNION ALL SELECT 1 FROM ${schema}.phone_control_journals WHERE device_id=$2 AND
          (record->>'disposition' IS DISTINCT FROM 'stopped' OR EXISTS(SELECT 1 FROM jsonb_array_elements(record->'calls') call WHERE call->>'status' IS DISTINCT FROM 'ended')) LIMIT 1`, [r.sourceProjectId, deviceId, r.accountId]);
      if (dispatched.rowCount) throw new ProductTransactionError("INPUT_INVALID", "旧项目已有执行尝试或手机操作未结束，请先核对原任务，不能移用资源");
      const identities = (await c.query<{ identity_id: string; account_id: string; platform: string; state: string }>(`SELECT identity_id,account_id,platform,state FROM ${schema}.project_identity_reservations WHERE account_id=$1 AND project_id=$2 AND device_id=$3 FOR UPDATE`, [r.accountId, r.sourceProjectId, deviceId])).rows;
      if ((await c.query(`SELECT 1 FROM ${schema}.project_identity_reservations WHERE device_id=$1 AND account_id<>$2`, [deviceId, r.accountId])).rowCount) throw stale();
      await c.query(`DELETE FROM ${schema}.project_identity_reservations WHERE account_id=$1 AND project_id=$2`, [r.accountId, r.sourceProjectId]);
      await c.query(`UPDATE ${schema}.project_account_reservations SET project_id=$2 WHERE account_id=$1 AND project_id=$3`, [r.accountId, r.targetProjectId, r.sourceProjectId]);
      await c.query(`UPDATE ${schema}.project_device_reservations SET project_id=$2 WHERE device_id=$1 AND project_id=$3`, [deviceId, r.targetProjectId, r.sourceProjectId]);
      await c.query(`UPDATE ${schema}.project_media_account_assignments SET project_id=$2 WHERE account_id=$1 AND project_id=$3`, [r.accountId, r.targetProjectId, r.sourceProjectId]);
      for (const identity of identities) await c.query(`INSERT INTO ${schema}.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id,state) VALUES($1,$2,$3,$4,$5,$6,$7)`, [identity.identity_id, identity.account_id, identity.platform, deviceId, r.targetProjectId, actor, identity.state]);
      await c.query(`UPDATE ${schema}.projects SET fact_version=fact_version+1 WHERE project_id=ANY($1::uuid[])`, [[r.sourceProjectId, r.targetProjectId]]);
      await c.query(`UPDATE ${schema}.resource_reservation_guard SET version=version+1 WHERE singleton=true`);
      await c.query(`INSERT INTO ${schema}.resource_reservation_commands(actor_id,request_key,payload_digest,applied_version) VALUES($1,$2,$3,$4)`, [actor, metadata.idempotencyKey, digest, version+1]);
      await c.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'resource.preparing_resources_reused','media_account',$3,$4,$5)`, [randomUUID(), actor, r.accountId, r.metadata.requestId, { idempotencyKey: metadata.idempotencyKey, sourceProjectId: r.sourceProjectId, targetProjectId: r.targetProjectId, deviceId, identityIds: identities.map(i => i.identity_id) }]);
      return { version: version+1, snapshot: await load(c), replayed: false };
    });
  }
  async lookupResourceCommand(token: string, rawKey: unknown) {
    const key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$(?![\s\S])/).safeParse(rawKey); if (!key.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid command key");
    return this.transaction(token, null, async (client, actor) => {
      const assignment = (await client.query<{ account_id: string }>(`SELECT account_id FROM ${schema}.resource_account_assignment_commands WHERE actor_id=$1 AND request_key=$2`, [actor, key.data])).rows[0];
      if (assignment) return resourceCommandLookupResponseSchema.parse({ contractVersion, state: "applied", commandKind: "account_assignment", accountId: assignment.account_id, resourceVersion: await this.version(client) });
      const reuse = (await client.query<{ object_id: string }>(`SELECT object_id FROM ${schema}.audit_records WHERE actor_id=$1 AND action='resource.preparing_resources_reused'
        AND facts->>'idempotencyKey'=$2 AND EXISTS(SELECT 1 FROM ${schema}.resource_reservation_commands c WHERE c.actor_id=$1 AND c.request_key=$2) LIMIT 1`, [actor, key.data])).rows[0];
      if (reuse) return resourceCommandLookupResponseSchema.parse({ contractVersion, state: "applied", commandKind: "preparing_resource_reuse", accountId: reuse.object_id, resourceVersion: await this.version(client) });
      const handover = (await client.query<{ handover_id: string; account_ids: string[]; source_project_id: string; source_device_id: string; target_project_id: string; target_device_id: string; reason: string }>(
        `SELECT handover_id,account_ids,source_project_id,source_device_id,target_project_id,target_device_id,reason FROM ${schema}.resource_handover_requests WHERE actor_id=$1 AND request_key=$2`, [actor, key.data])).rows[0];
      return handover ? resourceCommandLookupResponseSchema.parse({ contractVersion, state: "applied", commandKind: "handover_request", accountId: handover.account_ids[0] ?? null, resourceVersion: await this.version(client) })
        : resourceCommandLookupResponseSchema.parse({ contractVersion, state: "not_found" });
    });
  }
  async requestHandover(token: string, csrf: string, raw: unknown) {
    const parsed = resourceHandoverRequestSchema.safeParse(raw); if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid resource handover request");
    const r = parsed.data, { requestId: _requestId, ...metadata } = r.metadata;
    if (new Set(r.accountIds).size !== r.accountIds.length) throw new ProductTransactionError("INPUT_INVALID", "Duplicate accounts in handover request");
    r.accountIds.sort();
    const digest = createHash("sha256").update(JSON.stringify({ ...r, metadata })).digest();
    return this.transaction(token, csrf, async (client, actor) => {
      const version = await this.version(client);
      const old = (await client.query<{ handover_id: string; payload_digest: Buffer; account_ids: string[]; source_project_id: string; source_device_id: string; target_project_id: string; target_device_id: string; reason: string }>(
        `SELECT handover_id,payload_digest,account_ids,source_project_id,source_device_id,target_project_id,target_device_id,reason FROM ${schema}.resource_handover_requests WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey])).rows[0];
      if (old) {
        if (old.payload_digest.length !== digest.length || !old.payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Handover key belongs to different input");
        return this.handoverResponse(client, version, old.handover_id, r.accountIds, old.reason);
      }
      const collision = await client.query(`SELECT 1 FROM ${schema}.media_account_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.resource_account_assignment_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, metadata.idempotencyKey]);
      if (collision.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another resource command");
      if (version !== r.expectedResourceVersion || version === Number.MAX_SAFE_INTEGER) throw stale();
      const assignmentRows = await client.query(`SELECT 1 FROM ${schema}.project_media_account_assignments WHERE account_id=ANY($1::uuid[]) AND project_id=$2 AND device_id=$3`, [r.accountIds, r.sourceProjectId, r.sourceDeviceId]);
      if (assignmentRows.rowCount !== r.accountIds.length) throw stale();
      const handoverId = randomUUID(), reason = "trusted_old_stop_unavailable";
      await client.query(`INSERT INTO ${schema}.resource_handover_requests(handover_id,actor_id,request_key,payload_digest,account_ids,source_project_id,source_device_id,target_project_id,target_device_id,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [handoverId, actor, metadata.idempotencyKey, digest, r.accountIds, r.sourceProjectId, r.sourceDeviceId, r.targetProjectId, r.targetDeviceId, reason]);
      await client.query(`UPDATE ${schema}.project_media_account_assignments SET handover_requested=true WHERE account_id=ANY($1::uuid[]) AND project_id=$2 AND device_id=$3`, [r.accountIds, r.sourceProjectId, r.sourceDeviceId]);
      await client.query(`UPDATE ${schema}.resource_reservation_guard SET version=version+1 WHERE singleton=true`);
      await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'resource.handover_blocked','project',$3,$4,$5)`,
        [randomUUID(), actor, r.sourceProjectId, r.metadata.requestId, { handoverId, accountIds: r.accountIds, sourceDeviceId: r.sourceDeviceId, targetProjectId: r.targetProjectId, targetDeviceId: r.targetDeviceId, reason }]);
      return this.handoverResponse(client, version + 1, handoverId, r.accountIds, reason);
    });
  }
  private async handoverResponse(client: PoolClient, version: number, handoverId: string, accountIds: string[], reason: string) {
    const currentAssignments = await client.query(`SELECT a.account_id AS "accountId",m.platform,a.project_id AS "projectId",a.device_id AS "deviceId",a.state,a.handover_requested AS "handoverRequested"
      FROM ${schema}.project_media_account_assignments a JOIN ${schema}.media_accounts m USING(account_id,platform) WHERE a.account_id=ANY($1::uuid[]) ORDER BY a.account_id`, [accountIds]);
    return resourceHandoverResponseSchema.parse({ contractVersion, resourceVersion: version, handoverId, state: "blocked", reason,
      currentAssignments: currentAssignments.rows, actionPermissionGranted: false, publicationAllowed: false });
  }
  async registerIdentity(token: string, csrf: string, input: unknown) {
    const parsed = registerMediaIdentityRequestSchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid media reference registration");
    const r = parsed.data, { requestId: _requestId, ...metadata } = r.metadata;
    const digest = createHash("sha256").update(JSON.stringify({ ...r, metadata })).digest();
    return this.transaction(token, csrf, async (client, actor) => {
      const version = await this.version(client), g = r.registration;
      const command = await client.query<{ payload_digest: Buffer; identity_id: string }>(`SELECT payload_digest,identity_id FROM ${schema}.media_registry_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey]);
      const response = (changed: boolean, replayed: boolean, appliedVersion: number) => registerMediaIdentityResponseSchema.parse({ contractVersion,
        version: appliedVersion, registration: g, changed, replayed, state: "registered_unverified", actionPermissionGranted: false, acceptanceStarted: false });
      // Guard serializes registry writers and reservations. All four immutable
      // columns must match even on replay; missing/damaged rows fail closed.
      const accounts = await client.query<{ account_id: string; platform: string; canonical_account_ref: string }>(`SELECT account_id,platform,canonical_account_ref FROM ${schema}.media_accounts WHERE account_id=$1 OR (platform=$2 AND canonical_account_ref=$3)`, [g.accountId, g.platform, g.canonicalAccountRef]);
      const identities = await client.query<{ identity_id: string; account_id: string; platform: string; canonical_identity_ref: string }>(`SELECT identity_id,account_id,platform,canonical_identity_ref FROM ${schema}.publishing_identities WHERE identity_id=$1 OR (platform=$2 AND canonical_identity_ref=$3)`, [g.identityId, g.platform, g.canonicalIdentityRef]);
      const accountMatches = accounts.rows.length === 1 && accounts.rows[0]!.account_id === g.accountId
        && accounts.rows[0]!.platform === g.platform && accounts.rows[0]!.canonical_account_ref === g.canonicalAccountRef;
      const identityMatches = identities.rows.length === 1 && identities.rows[0]!.identity_id === g.identityId
        && identities.rows[0]!.account_id === g.accountId && identities.rows[0]!.platform === g.platform && identities.rows[0]!.canonical_identity_ref === g.canonicalIdentityRef;
      if (command.rows[0]) {
        if (!command.rows[0].payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Media reference request key already used");
        if (!accountMatches || !identityMatches || command.rows[0].identity_id !== g.identityId) throw stale();
        return response(false, true, version);
      }
      const accountCommand = await client.query(`SELECT 1 FROM ${schema}.media_account_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, metadata.idempotencyKey]);
      if (accountCommand.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another resource command");
      if (version !== r.expectedResourceVersion) throw stale();
      // This older endpoint can only add a child Page/channel to a parent
      // identity that already has a verified canonical ID and live credential.
      // It cannot create a passwordless parent login account.
      const verifiedParent = await client.query(`SELECT 1 FROM ${schema}.media_accounts a
        JOIN ${schema}.media_credentials c ON c.account_id=a.account_id AND c.platform=a.platform
        JOIN ${schema}.media_credential_revisions cr ON (cr.credential_id,cr.account_id,cr.platform,cr.revision)=(c.credential_id,c.account_id,c.platform,c.revision)
        WHERE a.account_id=$1 AND a.platform=$2 AND a.canonical_account_ref=$3 AND a.parent_login_verification='verified' AND cr.state='stored_unverified'`,
      [g.accountId, g.platform, g.canonicalAccountRef]);
      if (verifiedParent.rowCount !== 1) throw new ProductTransactionError("FACT_VERSION_STALE", "Register a verified credential-backed parent account before adding a publishing identity");
      if ((accounts.rowCount && !accountMatches) || (identities.rowCount && !identityMatches)) {
        throw new ProductTransactionError("FACT_VERSION_STALE", "Media references conflict; check current records without replacing an identity");
      }
      const changed = !accountMatches || !identityMatches;
      if (changed && version === Number.MAX_SAFE_INTEGER) throw stale();
      const write = async (sql: string, values: unknown[]) => {
        if ((await client.query(sql, values)).rowCount !== 1) throw new ProductTransactionError("INTERNAL_ERROR", "Media reference journal write was not confirmed", true);
      };
      if (!accountMatches) await write(`INSERT INTO ${schema}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,$2,$3)`, [g.accountId, g.platform, g.canonicalAccountRef]);
      if (!identityMatches) await write(`INSERT INTO ${schema}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,$3,$4)`, [g.identityId, g.accountId, g.platform, g.canonicalIdentityRef]);
      const appliedVersion = version + (changed ? 1 : 0);
      if (changed) {
        await write(`UPDATE ${schema}.resource_reservation_guard SET version=version+1 WHERE singleton=true`, []);
        await write(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,'resource.media_reference_registered','publishing_identity',$3,$4,$5)`, [randomUUID(), actor, g.identityId, r.metadata.requestId,
          { accountId: g.accountId, platform: g.platform, resourceVersion: appliedVersion, state: "registered_unverified" }]);
      }
      await write(`INSERT INTO ${schema}.media_registry_commands(actor_id,request_key,payload_digest,identity_id,applied_version) VALUES($1,$2,$3,$4,$5)`, [actor, metadata.idempotencyKey, digest, g.identityId, appliedVersion]);
      return response(changed, false, appliedVersion);
    });
  }
  async reserve(token: string, csrf: string, input: unknown): Promise<ResourceReservationResult> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid resource reservation");
    const r = parsed.data, { requestId: _requestId, ...metadata } = r.metadata;
    // Identity order is semantically a set, not an instruction sequence.
    r.reservation.identityIds.sort();
    const digest = createHash("sha256").update(JSON.stringify({ ...r, metadata })).digest();
    return this.transaction(token, csrf, async (client, actor) => {
      const version = await this.version(client);
      const command = await client.query<{ payload_digest: Buffer }>(`SELECT payload_digest FROM ${schema}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2`, [actor, metadata.idempotencyKey]);
      if (command.rows[0]) {
        if (!command.rows[0].payload_digest.equals(digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Resource request key already used");
        return { version, snapshot: await load(client), replayed: true };
      }
      const accountCommand = await client.query(`SELECT 1 FROM ${schema}.media_account_commands WHERE actor_id=$1 AND request_key=$2
        UNION ALL SELECT 1 FROM ${schema}.media_registry_commands WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, metadata.idempotencyKey]);
      if (accountCommand.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another resource command");
      if (version !== r.expectedResourceVersion) throw stale();
      // Guard -> project -> device. This primitive takes no provider, network,
      // install or control locks afterwards, so it cannot invert their ordering.
      const project = await client.query<{ fact_version: string }>(`SELECT fact_version::text FROM ${schema}.projects WHERE project_id=$1 FOR UPDATE`, [r.reservation.projectId]);
      const device = await client.query<{ fact_version: string; state: string }>(`SELECT fact_version::text,state FROM ${schema}.devices WHERE device_id=$1 FOR UPDATE`, [r.reservation.deviceId]);
      if (project.rows[0]?.fact_version !== String(r.expectedProjectVersion) || device.rows[0]?.fact_version !== String(r.expectedDeviceVersion)) throw stale();
      if (["unassociated", "exit_pending", "exited"].includes(device.rows[0].state)) throw new ProductTransactionError("INPUT_INVALID", "Device cannot be reserved in its current state");
      const requestedIdentityRows = await client.query<{ account_id: string; platform: string }>(`SELECT account_id,platform FROM ${schema}.publishing_identities WHERE identity_id=ANY($1::uuid[]) ORDER BY account_id`, [r.reservation.identityIds]);
      const requestedAccountIds = [...new Set(requestedIdentityRows.rows.map(row => row.account_id))];
      const assignedAccounts = await client.query<{ account_id: string; project_id: string; device_id: string; handover_requested: boolean }>(`SELECT account_id,project_id,device_id,handover_requested FROM ${schema}.project_media_account_assignments WHERE account_id=ANY($1::uuid[]) FOR UPDATE`, [requestedAccountIds]);
      if (assignedAccounts.rows.some(row => row.project_id !== r.reservation.projectId || row.device_id !== r.reservation.deviceId || row.handover_requested)) throw new ResourceReservationError("HANDOVER_REQUIRED");
      const phoneCollision = await client.query(`SELECT 1 FROM ${schema}.project_media_account_assignments a WHERE a.device_id=$1 AND a.platform=ANY($2::text[]) AND NOT (a.account_id=ANY($3::uuid[]))`, [r.reservation.deviceId, requestedIdentityRows.rows.map(row => row.platform), requestedAccountIds]);
      if (phoneCollision.rowCount) throw new ResourceReservationError("HANDOVER_REQUIRED");
      const legacyAccountOnly = await client.query(`SELECT 1 FROM ${schema}.project_account_reservations r WHERE r.account_id=ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM ${schema}.project_media_account_assignments a WHERE a.account_id=r.account_id)
        AND NOT EXISTS (SELECT 1 FROM ${schema}.project_identity_reservations i WHERE i.account_id=r.account_id AND i.project_id=r.project_id AND i.device_id=$2)`, [requestedAccountIds, r.reservation.deviceId]);
      if (legacyAccountOnly.rowCount) throw new ResourceReservationError("HANDOVER_REQUIRED");
      const oldBindings = await client.query(`SELECT 1 FROM ${schema}.project_identity_reservations WHERE account_id=ANY($1::uuid[]) AND (project_id<>$2 OR device_id<>$3)`, [requestedAccountIds, r.reservation.projectId, r.reservation.deviceId]);
      if (oldBindings.rowCount) throw new ResourceReservationError("HANDOVER_REQUIRED");
      const next = reserveInitialResources(await load(client), r.reservation);
      const parentAssignmentsMissing = requestedAccountIds.some(accountId => !assignedAccounts.rows.some(row => row.account_id === accountId));
      const changed = next.changed || parentAssignmentsMissing;
      if (changed && version === Number.MAX_SAFE_INTEGER) throw stale();
      if (changed) {
        await client.query(`INSERT INTO ${schema}.project_device_reservations(device_id,project_id) VALUES($1,$2) ON CONFLICT(device_id) DO NOTHING`, [r.reservation.deviceId, r.reservation.projectId]);
        for (const identityId of r.reservation.identityIds) {
          const identity = next.snapshot.identities.find(i => i.identityId === identityId)!;
          await client.query(`INSERT INTO ${schema}.project_account_reservations(account_id,project_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING`, [identity.accountId, r.reservation.projectId]);
          await client.query(`INSERT INTO ${schema}.project_media_account_assignments(account_id,platform,project_id,device_id,reserved_by_operator_id)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id) DO NOTHING`, [identity.accountId, identity.platform, r.reservation.projectId, r.reservation.deviceId, actor]);
          await client.query(`INSERT INTO ${schema}.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id) DO NOTHING`, [identityId, identity.accountId, identity.platform, r.reservation.deviceId, r.reservation.projectId, actor]);
        }
        await client.query(`UPDATE ${schema}.resource_reservation_guard SET version=version+1 WHERE singleton=true`);
        await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,'resource.initial_reservation','device',$3,$4,$5)`, [randomUUID(), actor, r.reservation.deviceId, r.metadata.requestId,
          { projectId: r.reservation.projectId, identityIds: r.reservation.identityIds, resourceVersion: version + 1, state: "pending_initialization" }]);
      }
      const appliedVersion = version + (changed ? 1 : 0);
      await client.query(`INSERT INTO ${schema}.resource_reservation_commands(actor_id,request_key,payload_digest,applied_version) VALUES($1,$2,$3,$4)`, [actor, metadata.idempotencyKey, digest, appliedVersion]);
      return { version: appliedVersion, snapshot: await load(client), replayed: false };
    });
  }
}
