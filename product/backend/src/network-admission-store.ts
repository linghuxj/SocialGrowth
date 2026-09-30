import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { AuthenticatedInstallation } from "./installation-auth-service.js";
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
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { throw new Error("Admission transaction rollback failed"); }
    // Do not surface raw query bindings or driver diagnostic/detail strings.
    if (error instanceof AdmissionError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new AdmissionError("STALE_FACT");
    }
    throw new Error("Admission transaction failed");
  } finally { client.release(); }
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
    `INSERT INTO ${schema}.network_operation_intents(operation_id,enrollment_id,expected_version,kind)
       VALUES($1,$2,$3,$4) ON CONFLICT(enrollment_id,expected_version,kind) DO NOTHING`,
    [randomUUID(), r.enrollmentId, r.version, kind],
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

export class NetworkAdmissionStore {
  constructor(private readonly pool: Pool) {}

  async begin(context: AuthenticatedInstallation, publicKeySpki: string, requestKey: string): Promise<AdmissionRecord> {
    key(requestKey);
    return transact(this.pool, async (client) => {
      const current = await lockAuthority(client, context.installationId);
      if (!current?.eligible || BigInt(current.generation) !== context.installationGeneration) throw new AdmissionError("AUTHORITY_CHANGED");
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
      return record;
    });
  }

  async apply(enrollmentId: string, expectedVersion: number, requestKey: string, command: AdmissionCommand): Promise<AdmissionRecord> {
    key(requestKey);
    const fingerprint = digest(canonical({ expectedVersion, command }));
    return transact(this.pool, async (client) => {
      // Read locator first without locking enrollment, then lock authority before
      // enrollment on ALL paths. Locator identities are immutable columns.
      const locator = await client.query<{ installation_id: string }>(
        `SELECT installation_id FROM ${schema}.network_enrollments WHERE enrollment_id=$1`, [enrollmentId],
      );
      if (!locator.rows[0]) throw new AdmissionError("AUTHORITY_CHANGED");
      const current = await lockAuthority(client, locator.rows[0].installation_id);
      const rows = await client.query<EnrollmentRow>(
        `SELECT * FROM ${schema}.network_enrollments WHERE enrollment_id=$1 FOR UPDATE`, [enrollmentId],
      );
      const row = rows.rows[0];
      if (!row) throw new AdmissionError("AUTHORITY_CHANGED");
      const record = parseAdmissionRecord(row.record);
      const cleanup = command.kind === "request_reclamation" || command.kind === "confirm_reclamation";
      const authority: AdmissionAuthority = {
        ...record.authority, installationGeneration: current?.generation ?? record.authority.installationGeneration,
        ownershipVersion: current?.fact_version ?? record.authority.ownershipVersion,
        eligible: !!current?.eligible && current.association_id === row.association_id && current.provider_id === row.provider_id
          && current.device_id === row.device_id,
      };
      if (!cleanup && (!authority.eligible
        || authority.installationGeneration !== record.authority.installationGeneration
        || authority.ownershipVersion !== record.authority.ownershipVersion)) throw new AdmissionError("AUTHORITY_CHANGED");
      const duplicate = await client.query<{ payload_digest: Buffer }>(
        `SELECT payload_digest FROM ${schema}.network_enrollment_commands WHERE enrollment_id=$1 AND request_key=$2`, [enrollmentId, requestKey],
      );
      if (duplicate.rows[0]) {
        if (!duplicate.rows[0].payload_digest.equals(fingerprint)) throw new AdmissionError("STALE_FACT");
        // Report current fact, not historical admitted state after later exit.
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
      parseAdmissionRecord(next);
      const candidateNode = next.node?.nodeId ?? next.challenge?.node.nodeId ?? null;
      await client.query(
        `UPDATE ${schema}.network_enrollments SET version=$2,phase=$3,record=$4,candidate_node_id=$5 WHERE enrollment_id=$1`,
        [enrollmentId, next.version, next.phase, next, candidateNode],
      );
      await client.query(
        `INSERT INTO ${schema}.network_enrollment_commands(enrollment_id,request_key,payload_digest,applied_version,command_kind)
           VALUES($1,$2,$3,$4,$5)`, [enrollmentId, requestKey, fingerprint, next.version, command.kind],
      );
      if (command.kind === "confirm_restriction") await intent(client, next, "issue_restricted_credential");
      if (command.kind === "request_permission") await intent(client, next, "apply_formal_policy");
      if (command.kind === "request_reclamation") {
        await client.query(
          `UPDATE ${schema}.network_operation_intents SET status='cancelled' WHERE enrollment_id=$1 AND status='pending'
             AND kind IN ('apply_restricted_policy','issue_restricted_credential','apply_formal_policy')`, [enrollmentId],
        );
        await intent(client, next, "revoke_credential");
        await intent(client, next, "revoke_node_access");
      }
      await audit(client, next, requestKey, `network_enrollment.${command.kind}`);
      return next;
    });
  }
}
