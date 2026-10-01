import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { contractVersion, registerMediaIdentityRequestSchema, registerMediaIdentityResponseSchema, requestMetadataSchema } from "@socialgrowth/product-contracts";
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
      if (version !== r.expectedResourceVersion) throw stale();
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
      if (version !== r.expectedResourceVersion) throw stale();
      // Guard -> project -> device. This primitive takes no provider, network,
      // install or control locks afterwards, so it cannot invert their ordering.
      const project = await client.query<{ fact_version: string }>(`SELECT fact_version::text FROM ${schema}.projects WHERE project_id=$1 FOR UPDATE`, [r.reservation.projectId]);
      const device = await client.query<{ fact_version: string; state: string }>(`SELECT fact_version::text,state FROM ${schema}.devices WHERE device_id=$1 FOR UPDATE`, [r.reservation.deviceId]);
      if (project.rows[0]?.fact_version !== String(r.expectedProjectVersion) || device.rows[0]?.fact_version !== String(r.expectedDeviceVersion)) throw stale();
      if (["unassociated", "exit_pending", "exited"].includes(device.rows[0].state)) throw new ProductTransactionError("INPUT_INVALID", "Device cannot be reserved in its current state");
      const next = reserveInitialResources(await load(client), r.reservation);
      if (next.changed && version === Number.MAX_SAFE_INTEGER) throw stale();
      if (next.changed) {
        await client.query(`INSERT INTO ${schema}.project_device_reservations(device_id,project_id) VALUES($1,$2) ON CONFLICT(device_id) DO NOTHING`, [r.reservation.deviceId, r.reservation.projectId]);
        for (const identityId of r.reservation.identityIds) {
          const identity = next.snapshot.identities.find(i => i.identityId === identityId)!;
          await client.query(`INSERT INTO ${schema}.project_account_reservations(account_id,project_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING`, [identity.accountId, r.reservation.projectId]);
          await client.query(`INSERT INTO ${schema}.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id) DO NOTHING`, [identityId, identity.accountId, identity.platform, r.reservation.deviceId, r.reservation.projectId, actor]);
        }
        await client.query(`UPDATE ${schema}.resource_reservation_guard SET version=version+1 WHERE singleton=true`);
        await client.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
          VALUES($1,'operator',$2,'resource.initial_reservation','device',$3,$4,$5)`, [randomUUID(), actor, r.reservation.deviceId, r.metadata.requestId,
          { projectId: r.reservation.projectId, identityIds: r.reservation.identityIds, resourceVersion: version + 1, state: "pending_initialization" }]);
      }
      const appliedVersion = version + (next.changed ? 1 : 0);
      await client.query(`INSERT INTO ${schema}.resource_reservation_commands(actor_id,request_key,payload_digest,applied_version) VALUES($1,$2,$3,$4)`, [actor, metadata.idempotencyKey, digest, appliedVersion]);
      return { version: appliedVersion, snapshot: await load(client), replayed: false };
    });
  }
}
