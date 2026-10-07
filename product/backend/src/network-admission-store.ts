import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { AuthenticatedInstallation, InstallationAuthService } from "./installation-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import {
  AdmissionError,
  confirmFormalPermission, confirmReclamation, confirmRestriction,
  consumeProof, createAdmissionRecord, issueChallenge,
  requestFormalPermission, requestReclamation,
  type AdmissionAuthority, type AdmissionRecord, type ObservedSource, type RestrictionEvidence,
} from "./network-admission-core.js";
import { parseAdmissionRecord } from "./network-admission-record.js";
import type { EnrollmentProof } from "@socialgrowth/product-contracts";

// Worker/internal-only API. HTTP adapters must authenticate and authorize their
// scope separately; client requests must NEVER provide source/evidence/authority.
export type AdmissionCommand =
  | { kind: "confirm_restriction"; evidence: RestrictionEvidence }
  | { kind: "issue_challenge"; source: ObservedSource }
  | { kind: "consume_proof"; source: ObservedSource; proof: EnrollmentProof }
  | { kind: "request_permission"; source: ObservedSource; policyRevision: number }
  | { kind: "confirm_permission"; source: ObservedSource; evidence: Parameters<typeof confirmFormalPermission>[4] }
  | { kind: "request_reclamation"; reason: string }
  | { kind: "confirm_reclamation"; evidence: Parameters<typeof confirmReclamation>[2] };

interface EnrollmentRow {
  enrollment_id: string; installation_id: string; device_id: string;
  association_id: string; provider_id: string; generation: string;
  key_digest: Buffer; record: unknown;
}
interface CurrentAssociation {
  association_id: string; device_id: string; provider_id: string;
  generation: string; fact_version: string; eligible: boolean;
}

const schema = "socialgrowth_product";
function key(value: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new Error("Invalid admission request key");
}
function digest(value: string): Buffer { return createHash("sha256").update(value).digest(); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

async function transact<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try { client = await pool.connect(); }
  catch { throw new Error("Admission database unavailable"); }
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { throw new Error("Admission transaction rollback failed"); }
    // Do not surface raw query bindings or driver diagnostic/detail strings.
    if (error instanceof AdmissionError || error instanceof ProductTransactionError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new AdmissionError("STALE_FACT");
    }
    throw new Error("Admission transaction failed");
  } finally { client.release(); }
}

interface InstallationRequest { context: AuthenticatedInstallation; auth: InstallationAuthService; token: string }
export interface AuthenticatedAdmissionState {
  scope: { deviceId: string; providerId: string; installationId: string; installationGeneration: string; ownershipVersion: string };
  record: AdmissionRecord | null;
}
async function requireSession(client: PoolClient, request: InstallationRequest): Promise<void> {
  const current = await request.auth.authenticate(request.token, client);
  if (current.installationId !== request.context.installationId || current.installationGeneration !== request.context.installationGeneration)
    throw new AdmissionError("AUTHORITY_CHANGED");
  // Same provider -> installation -> session order as local participation.
  // Hold session through commit, so a concurrent revocation cannot pass between
  // pre-authentication and consumption. Recheck expiry again before commit.
  const row = await client.query(
    `SELECT session_id FROM ${schema}.installation_sessions WHERE installation_id=$1 AND token_digest=$2
      AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`, [current.installationId, digest(request.token)]);
  if (row.rowCount !== 1) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Installation session unavailable");
}
function requireCurrent(row: EnrollmentRow, record: AdmissionRecord, current: CurrentAssociation) {
  const authority = currentAuthority(row, record, current);
  if (!authority.eligible || authority.installationGeneration !== record.authority.installationGeneration
    || authority.ownershipVersion !== record.authority.ownershipVersion) throw new AdmissionError("AUTHORITY_CHANGED");
}
function requireFreshSource(source: ObservedSource, now: number): void {
  const observed = Date.parse(source.observedAt);
  if (!Number.isFinite(observed) || observed > now || now - observed >= 10_000) throw new AdmissionError("INVALID_EVIDENCE");
}
async function dbNow(client: PoolClient): Promise<string> {
  const result = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  if (!result.rows[0]) throw new Error("Missing database clock");
  return result.rows[0].now.toISOString();
}

async function lockAuthority(client: PoolClient, installationId: string): Promise<CurrentAssociation | null> {
  // Existing confirmation takes provider -> installation. Never take provider
  // after installation: that would deadlock against a confirmation/replay.
  const locator = await client.query<{ provider_id: string }>(
    `SELECT provider_id FROM ${schema}.device_associations WHERE installation_id=$1 AND ended_at IS NULL`, [installationId],
  );
  const expectedProvider = locator.rows[0]?.provider_id;
  if (expectedProvider) await client.query(
    `SELECT provider_id FROM ${schema}.providers WHERE provider_id=$1 FOR UPDATE`, [expectedProvider],
  );
  const installation = await client.query(
    `SELECT installation_id FROM ${schema}.installations WHERE installation_id=$1 FOR UPDATE`, [installationId],
  );
  if (!installation.rowCount) return null;
  const association = await client.query<CurrentAssociation>(
    `SELECT a.association_id,a.device_id,a.provider_id,i.generation::text,d.fact_version::text,
       (i.status='active' AND p.status='active' AND d.state NOT IN ('unassociated','exit_pending','exited')) AS eligible
     FROM ${schema}.device_associations a
     JOIN ${schema}.installations i ON i.installation_id=a.installation_id
     JOIN ${schema}.devices d ON d.device_id=a.device_id
     JOIN ${schema}.providers p ON p.provider_id=a.provider_id
     WHERE a.installation_id=$1 AND a.provider_id=$2 AND a.ended_at IS NULL
     FOR UPDATE OF a,d`, [installationId, expectedProvider ?? null],
  );
  return association.rows[0] ?? null;
}

async function intent(client: PoolClient, r: AdmissionRecord, kind: string): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.network_operation_intents(operation_id,enrollment_id,expected_version,kind,reclamation_id)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(enrollment_id,expected_version,kind) DO NOTHING`,
    [randomUUID(), r.enrollmentId, r.version, kind,
      kind === "revoke_credential" || kind === "revoke_node_access" ? r.reclamationId : null],
  );
}

async function audit(client: PoolClient, r: AdmissionRecord, requestKey: string, action: string, installationActor = false): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
     VALUES($1,$2,$3,$4,'network_enrollment',$5,$6,$7)`,
    [randomUUID(), installationActor ? "installation" : "system", installationActor ? r.authority.installationId : null,
      action, r.enrollmentId, requestKey, { version: r.version, phase: r.phase, enrollmentGeneration: r.authority.enrollmentGeneration }],
  );
}

async function saveRecord(client: PoolClient, next: AdmissionRecord): Promise<void> {
  parseAdmissionRecord(next);
  await client.query(
    `UPDATE ${schema}.network_enrollments SET version=$2,phase=$3,record=$4,candidate_node_id=$5 WHERE enrollment_id=$1`,
    [next.enrollmentId, next.version, next.phase, next, next.node?.nodeId ?? next.challenge?.node.nodeId ?? null],
  );
}

async function scheduleReclamation(client: PoolClient, next: AdmissionRecord): Promise<void> {
  await client.query(
    `UPDATE ${schema}.network_operation_intents SET status='cancelled' WHERE enrollment_id=$1 AND status='pending'
       AND kind IN ('apply_restricted_policy','issue_restricted_credential','apply_formal_policy')`, [next.enrollmentId],
  );
  await intent(client, next, "revoke_credential");
  await intent(client, next, "revoke_node_access");
}

function currentAuthority(row: EnrollmentRow, record: AdmissionRecord, current: CurrentAssociation | null): AdmissionAuthority {
  return {
    ...record.authority, installationGeneration: current?.generation ?? record.authority.installationGeneration,
    ownershipVersion: current?.fact_version ?? record.authority.ownershipVersion,
    eligible: !!current?.eligible && current.association_id === row.association_id && current.provider_id === row.provider_id
      && current.device_id === row.device_id,
  };
}

export interface AdmissionReconciliationBatch {
  examined: number;
  reclamationRequested: number;
  unchanged: number;
  failures: { enrollmentId: string; code: string }[];
  nextCursor: string | null;
}

export class NetworkAdmissionStore {
  constructor(private readonly pool: Pool) {}

  async authenticatedState(auth: InstallationAuthService, token: string): Promise<AuthenticatedAdmissionState> {
    const context = await auth.authenticate(token), request = { context, auth, token };
    return transact(this.pool, async client => {
      const current = await lockAuthority(client, context.installationId);
      if (!current?.eligible || BigInt(current.generation) !== context.installationGeneration) throw new AdmissionError("AUTHORITY_CHANGED");
      await requireSession(client, request);
      const rows = await client.query<EnrollmentRow>(
        `SELECT * FROM ${schema}.network_enrollments WHERE installation_id=$1 ORDER BY generation DESC LIMIT 1 FOR SHARE`, [context.installationId]);
      const row = rows.rows[0], record = row ? parseAdmissionRecord(row.record) : null;
      if (row && record) requireCurrent(row, record, current);
      await requireSession(client, request);
      return { scope: { deviceId: current.device_id, installationId: context.installationId,
        providerId: current.provider_id, installationGeneration: current.generation, ownershipVersion: current.fact_version }, record };
    });
  }
  async beginAuthenticated(auth: InstallationAuthService, token: string, publicKeySpki: string, requestKey: string) {
    const context = await auth.authenticate(token);
    return this.beginScoped(context, publicKeySpki, requestKey, { context, auth, token });
  }
  async applyAuthenticated(auth: InstallationAuthService, token: string, enrollmentId: string, expectedVersion: number,
    requestKey: string, command: Extract<AdmissionCommand, { kind: "issue_challenge" | "consume_proof" }>) {
    const context = await auth.authenticate(token);
    return this.applyScoped(enrollmentId, expectedVersion, requestKey, command, { context, auth, token });
  }

  // Single bounded pass, no worker/HTTP or external effects. The scheduler must
  // resume nextCursor until null, then start a new sweep. Failed rows do not
  // silently stop other devices, and never lose their actual remaining access.
  async reconcileBatch(limit = 100, afterEnrollmentId: string | null = null): Promise<AdmissionReconciliationBatch> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000
      || (afterEnrollmentId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(afterEnrollmentId))) {
      throw new Error("Invalid admission reconciliation scope");
    }
    let candidates: { enrollment_id: string }[];
    try {
      const result = await this.pool.query<{ enrollment_id: string }>(
        `SELECT e.enrollment_id FROM ${schema}.network_enrollments e
         LEFT JOIN ${schema}.installations i ON i.installation_id=e.installation_id
         LEFT JOIN ${schema}.device_associations a ON a.association_id=e.association_id
         LEFT JOIN ${schema}.providers p ON p.provider_id=e.provider_id
         LEFT JOIN ${schema}.devices d ON d.device_id=e.device_id
         WHERE e.phase NOT IN ('reclaim_pending','reclaimed') AND ($2::uuid IS NULL OR e.enrollment_id>$2::uuid)
           AND ((e.phase<>'admitted' AND e.expires_at<=clock_timestamp())
             OR i.status<>'active' OR p.status<>'active' OR a.ended_at IS NOT NULL
             OR d.state IN ('unassociated','exit_pending','exited')
             OR i.generation::text<>e.record->'authority'->>'installationGeneration'
             OR d.fact_version::text<>e.record->'authority'->>'ownershipVersion')
         ORDER BY e.enrollment_id LIMIT $1`, [limit, afterEnrollmentId],
      );
      candidates = result.rows;
    } catch { throw new Error("Admission reconciliation scan unavailable"); }
    const batch: AdmissionReconciliationBatch = {
      examined: candidates.length, reclamationRequested: 0, unchanged: 0, failures: [],
      nextCursor: candidates.length === limit ? candidates.at(-1)!.enrollment_id : null,
    };
    for (const candidate of candidates) {
      try {
        const changed = await transact(this.pool, async (client) => {
          await client.query("SET LOCAL lock_timeout='5s'");
          const locator = await client.query<{ installation_id: string }>(
            `SELECT installation_id FROM ${schema}.network_enrollments WHERE enrollment_id=$1`, [candidate.enrollment_id],
          );
          if (!locator.rows[0]) return false;
          const current = await lockAuthority(client, locator.rows[0].installation_id);
          const result = await client.query<EnrollmentRow>(
            `SELECT * FROM ${schema}.network_enrollments WHERE enrollment_id=$1 FOR UPDATE`, [candidate.enrollment_id],
          );
          const row = result.rows[0];
          if (!row) return false;
          const record = parseAdmissionRecord(row.record);
          if (record.phase === "reclaim_pending" || record.phase === "reclaimed") return false;
          const authority = currentAuthority(row, record, current);
          // Re-evaluate under the same provider->installation->association/device
          // locks as upgrades. A scan observation cannot revoke a later success.
          const now = await dbNow(client);
          const invalid = !authority.eligible || authority.installationGeneration !== record.authority.installationGeneration
            || authority.ownershipVersion !== record.authority.ownershipVersion;
          const expired = record.phase !== "admitted" && Date.parse(now) >= Date.parse(record.expiresAt);
          if (!invalid && !expired) return false;
          const reason = invalid ? "authority_changed" : "enrollment_expired";
          const next = requestReclamation(record, record.version, reason);
          const requestKey = `maintenance_${randomUUID().replaceAll("-", "")}`;
          await saveRecord(client, next);
          await client.query(
            `INSERT INTO ${schema}.network_enrollment_commands(enrollment_id,request_key,payload_digest,applied_version,command_kind)
               VALUES($1,$2,$3,$4,'request_reclamation')`,
            [next.enrollmentId, requestKey, digest(canonical({ expectedVersion: record.version, command: { kind: "request_reclamation", reason } })), next.version],
          );
          await scheduleReclamation(client, next);
          await audit(client, next, requestKey, "network_enrollment.reconciled_reclamation");
          return true;
        });
        if (changed) batch.reclamationRequested++; else batch.unchanged++;
      } catch (error) {
        batch.failures.push({ enrollmentId: candidate.enrollment_id,
          code: error instanceof AdmissionError ? error.code : "RECONCILIATION_FAILED" });
      }
    }
    return batch;
  }

  async begin(context: AuthenticatedInstallation, publicKeySpki: string, requestKey: string): Promise<AdmissionRecord> {
    return this.beginScoped(context, publicKeySpki, requestKey);
  }
  private async beginScoped(context: AuthenticatedInstallation, publicKeySpki: string, requestKey: string, request?: InstallationRequest): Promise<AdmissionRecord> {
    key(requestKey);
    return transact(this.pool, async (client) => {
      const current = await lockAuthority(client, context.installationId);
      if (!current?.eligible || BigInt(current.generation) !== context.installationGeneration) throw new AdmissionError("AUTHORITY_CHANGED");
      if (request) await requireSession(client, request);
      const repeated = await client.query<EnrollmentRow>(
        `SELECT * FROM ${schema}.network_enrollments WHERE installation_id=$1 AND request_key=$2 FOR UPDATE`,
        [context.installationId, requestKey],
      );
      const existing = repeated.rows[0];
      if (existing) {
        const saved = parseAdmissionRecord(existing.record);
        if (existing.association_id !== current.association_id || existing.provider_id !== current.provider_id
          || saved.authority.installationGeneration !== current.generation || saved.authority.ownershipVersion !== current.fact_version
          || !existing.key_digest.equals(digest(publicKeySpki))) throw new AdmissionError("AUTHORITY_CHANGED");
        if (request) await requireSession(client, request);
        return saved;
      }
      const generationResult = await client.query<{ next: string }>(
        `SELECT (coalesce(max(generation),0)+1)::text AS next FROM ${schema}.network_enrollments WHERE device_id=$1`, [current.device_id],
      );
      const generation = generationResult.rows[0]?.next;
      if (!generation) throw new Error("Missing enrollment generation");
      const authority: AdmissionAuthority = {
        deviceId: current.device_id, installationId: context.installationId,
        installationGeneration: current.generation, enrollmentGeneration: generation,
        ownershipVersion: current.fact_version, eligible: current.eligible,
      };
      const record = parseAdmissionRecord(createAdmissionRecord(authority, publicKeySpki, await dbNow(client)));
      await client.query(
        `INSERT INTO ${schema}.network_enrollments(enrollment_id,installation_id,device_id,association_id,provider_id,
          generation,request_key,key_digest,version,phase,record,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12)`,
        [record.enrollmentId, context.installationId, current.device_id, current.association_id, current.provider_id,
          generation, requestKey, digest(publicKeySpki), record.phase, record, record.createdAt, record.expiresAt],
      );
      await intent(client, record, "apply_restricted_policy");
      await audit(client, record, requestKey, "network_enrollment.created", true);
      if (request) await requireSession(client, request);
      return record;
    });
  }

  async apply(enrollmentId: string, expectedVersion: number, requestKey: string, command: AdmissionCommand): Promise<AdmissionRecord> {
    return this.applyScoped(enrollmentId, expectedVersion, requestKey, command);
  }
  private async applyScoped(enrollmentId: string, expectedVersion: number, requestKey: string, command: AdmissionCommand, request?: InstallationRequest): Promise<AdmissionRecord> {
    key(requestKey);
    // Socket observation time is server transport metadata, not the client's
    // command content. A retried identical signed proof arrives on a new socket
    // observation; keep actual node identity in the digest, not its timestamp.
    const stableCommand = "source" in command
      ? { ...command, source: { node: command.source.node } }
      : command;
    const fingerprint = digest(canonical({ expectedVersion, command: stableCommand }));
    return transact(this.pool, async (client) => {
      // Read locator first without locking enrollment, then lock authority before
      // enrollment on ALL paths. Locator identities are immutable columns.
      const locator = await client.query<{ installation_id: string }>(
        `SELECT installation_id FROM ${schema}.network_enrollments WHERE enrollment_id=$1`, [enrollmentId],
      );
      if (!locator.rows[0]) throw new AdmissionError("AUTHORITY_CHANGED");
      if (request && locator.rows[0].installation_id !== request.context.installationId) throw new AdmissionError("AUTHORITY_CHANGED");
      const current = await lockAuthority(client, locator.rows[0].installation_id);
      if (request) await requireSession(client, request);
      const rows = await client.query<EnrollmentRow>(
        `SELECT * FROM ${schema}.network_enrollments WHERE enrollment_id=$1 FOR UPDATE`, [enrollmentId],
      );
      const row = rows.rows[0];
      if (!row) throw new AdmissionError("AUTHORITY_CHANGED");
      const record = parseAdmissionRecord(row.record);
      const cleanup = command.kind === "request_reclamation" || command.kind === "confirm_reclamation";
      const authority = currentAuthority(row, record, current);
      if (!cleanup && (!authority.eligible
        || authority.installationGeneration !== record.authority.installationGeneration
        || authority.ownershipVersion !== record.authority.ownershipVersion)) throw new AdmissionError("AUTHORITY_CHANGED");
      const duplicate = await client.query<{ payload_digest: Buffer }>(
        `SELECT payload_digest FROM ${schema}.network_enrollment_commands WHERE enrollment_id=$1 AND request_key=$2`, [enrollmentId, requestKey],
      );
      if (duplicate.rows[0]) {
        if (!duplicate.rows[0].payload_digest.equals(fingerprint)) throw new AdmissionError("STALE_FACT");
        // Report current fact, not historical admitted state after later exit.
        if (request) {
          await requireSession(client, request);
          if ("source" in command) requireFreshSource(command.source, Date.parse(await dbNow(client)));
        }
        return record;
      }
      const now = await dbNow(client);
      let next: AdmissionRecord;
      switch (command.kind) {
        case "confirm_restriction": next = confirmRestriction(record, expectedVersion, authority, command.evidence, now); break;
        case "issue_challenge": next = issueChallenge(record, expectedVersion, authority, command.source, now); break;
        case "consume_proof": next = consumeProof(record, expectedVersion, authority, command.source, command.proof, now); break;
        case "request_permission": next = requestFormalPermission(record, expectedVersion, authority, command.source, command.policyRevision, now); break;
        case "confirm_permission": next = confirmFormalPermission(record, expectedVersion, authority, command.source, command.evidence, now); break;
        case "request_reclamation": next = requestReclamation(record, expectedVersion, command.reason); break;
        case "confirm_reclamation": next = confirmReclamation(record, expectedVersion, command.evidence, now); break;
      }
      await saveRecord(client, next);
      await client.query(
        `INSERT INTO ${schema}.network_enrollment_commands(enrollment_id,request_key,payload_digest,applied_version,command_kind)
           VALUES($1,$2,$3,$4,$5)`, [enrollmentId, requestKey, fingerprint, next.version, command.kind],
      );
      if (command.kind === "confirm_restriction") await intent(client, next, "issue_restricted_credential");
      if (command.kind === "request_permission") await intent(client, next, "apply_formal_policy");
      if (command.kind === "request_reclamation" && next.reclamationId !== record.reclamationId) {
        await scheduleReclamation(client, next);
      }
      if (command.kind === "confirm_reclamation") {
        for (const [confirmed, kind] of [[next.credentialRevoked, "revoke_credential"], [next.nodeAccessRevoked, "revoke_node_access"]] as const) {
          if (confirmed) await client.query(
            `UPDATE ${schema}.network_operation_intents SET status='confirmed'
             WHERE enrollment_id=$1 AND reclamation_id=$2 AND kind=$3 AND status='pending'`,
            [enrollmentId, next.reclamationId, kind],
          );
        }
      }
      await audit(client, next, requestKey, `network_enrollment.${command.kind}`);
      if (request) {
        await requireSession(client, request);
        const finalNow = Date.parse(await dbNow(client));
        if ("source" in command) requireFreshSource(command.source, finalNow);
        if (finalNow >= Date.parse(record.expiresAt) || (command.kind === "consume_proof" && record.challenge && finalNow >= Date.parse(record.challenge.expiresAt)))
          throw new AdmissionError("EXPIRED");
      }
      return next;
    });
  }
}
