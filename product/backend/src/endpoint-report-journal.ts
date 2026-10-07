import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { parseAdmissionRecord } from "./network-admission-record.js";
import {
  acceptEndpointReport, beginEndpointSourceEpoch, createEndpointReportState, EndpointReportError,
  endpointReportTimeIsFresh, parseEndpointReportState, readEndpointCandidates,
  type EndpointAuthority, type EndpointReportState,
} from "./endpoint-report-core.js";

const schema = "socialgrowth_product";
const id = uuidSchema.transform(v => v.toLowerCase());
const boundary = z.strictObject({ enrollmentId: id });
const beginSchema = boundary.extend({ epochId: id, expectedRevision: z.int().min(0) });
const querySchema = boundary.extend({ reportId: id.nullable(), maximumAgeMs: z.int().min(1) });
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (v: string) => createHash("sha256").update(v).digest();
export class EndpointJournalError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "AUTHENTICATION_REQUIRED" | "AUTHORITY_CHANGED" | "SOURCE_UNAVAILABLE" | "SOURCE_MISMATCH" | "SOURCE_STALE" | "NOT_FOUND" | "DATABASE_UNAVAILABLE") { super(code); }
}
function fail(code: EndpointJournalError["code"]): never { throw new EndpointJournalError(code); }
export interface EndpointReportSourceEvidence { scope: EndpointAuthority["scope"]; observedAt: string }
export interface EndpointReportSourceVerifier {
  // Transport is a server-owned channel object, NEVER headers/body/claimed peer.
  // A real implementation must observe the trusted network source itself.
  observe(transport: object, expected: EndpointAuthority["scope"], signal: AbortSignal): Promise<EndpointReportSourceEvidence | null>;
}
interface Session { session_id: string; installation_id: string }
interface Enrollment { enrollment_id: string; installation_id: string; device_id: string; provider_id: string; association_id: string; generation: string; version: string; phase: string; key_digest: Buffer; record: unknown }
async function clock(c: PoolClient): Promise<string> {
  const row = (await c.query<{ now: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)).rows[0];
  if (!row) return fail("DATABASE_UNAVAILABLE"); return row.now;
}
async function freshSession(c: PoolClient, session: Session): Promise<string> {
  const row = (await c.query<{ now: string }>(`WITH verification_clock AS MATERIALIZED (SELECT clock_timestamp() AS t)
    SELECT to_char(v.t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now
    FROM ${schema}.installation_sessions s CROSS JOIN verification_clock v
    WHERE s.session_id=$1 AND s.installation_id=$2 AND s.revoked_at IS NULL AND s.expires_at>v.t`, [session.session_id, session.installation_id])).rows[0];
  if (!row) return fail("AUTHENTICATION_REQUIRED"); return row.now;
}
async function lockBinding(c: PoolClient, token: string, enrollmentId: string): Promise<{ session: Session; authority: EndpointAuthority }> {
  // Unlocked immutable locators only; shared mutation order is provider ->
  // installation -> session -> association/device -> enrollment -> journal.
  const locator = (await c.query<Enrollment>(`SELECT * FROM ${schema}.network_enrollments WHERE enrollment_id=$1`, [enrollmentId])).rows[0];
  const sessionLocator = (await c.query<Session>(`SELECT session_id,installation_id FROM ${schema}.installation_sessions WHERE token_digest=$1`, [digest(token)])).rows[0];
  if (!locator || !sessionLocator || locator.installation_id !== sessionLocator.installation_id) return fail("AUTHENTICATION_REQUIRED");
  const provider = (await c.query<{ status: string }>(`SELECT status FROM ${schema}.providers WHERE provider_id=$1 FOR UPDATE`, [locator.provider_id])).rows[0];
  const install = (await c.query<{ generation: string; status: string }>(`SELECT generation::text,status FROM ${schema}.installations WHERE installation_id=$1 FOR UPDATE`, [locator.installation_id])).rows[0];
  const session = (await c.query<Session>(`SELECT session_id,installation_id FROM ${schema}.installation_sessions WHERE session_id=$1 AND token_digest=$2 FOR UPDATE`, [sessionLocator.session_id, digest(token)])).rows[0];
  if (!install || install.status !== "active" || !session) return fail("AUTHENTICATION_REQUIRED");
  await freshSession(c, session);
  const association = (await c.query<{ association_id: string; fact_version: string; state: string }>(`SELECT a.association_id,d.fact_version::text,d.state
    FROM ${schema}.device_associations a JOIN ${schema}.devices d ON d.device_id=a.device_id
    WHERE a.installation_id=$1 AND a.device_id=$2 AND a.provider_id=$3 AND a.ended_at IS NULL FOR UPDATE OF a,d`, [locator.installation_id, locator.device_id, locator.provider_id])).rows[0];
  const row = (await c.query<Enrollment>(`SELECT * FROM ${schema}.network_enrollments WHERE enrollment_id=$1 FOR UPDATE`, [enrollmentId])).rows[0];
  if (!row || row.installation_id !== session.installation_id || row.installation_id !== locator.installation_id
    || row.provider_id !== locator.provider_id || row.device_id !== locator.device_id || row.association_id !== locator.association_id
    || provider?.status !== "active" || !association || association.association_id !== row.association_id
    || ["unassociated", "exit_pending", "exited"].includes(association.state)) return fail("AUTHORITY_CHANGED");
  const record = parseAdmissionRecord(row.record), a = record.authority;
  if (row.phase !== "admitted" || record.phase !== row.phase || String(record.version) !== row.version || !record.node
    || record.enrollmentId !== row.enrollment_id || a.deviceId !== row.device_id || a.installationId !== row.installation_id
    || !a.eligible || a.installationGeneration !== install.generation || a.enrollmentGeneration !== row.generation
    || a.ownershipVersion !== association.fact_version || !row.key_digest.equals(digest(record.publicKeySpki))) return fail("AUTHORITY_CHANGED");
  return { session, authority: { scope: { enrollmentId: row.enrollment_id, deviceId: row.device_id, installationId: row.installation_id,
    installationGeneration: a.installationGeneration, enrollmentGeneration: a.enrollmentGeneration, ownershipVersion: a.ownershipVersion, node: record.node },
    publicKeySpki: record.publicKeySpki, mayReport: true, pairingSessionId: null, pairingExpiresAt: null } };
}
async function load(c: PoolClient, a: EndpointAuthority): Promise<EndpointReportState | null> {
  const row = (await c.query<{ record: unknown; endpoint_revision: string }>(`SELECT record,endpoint_revision::text FROM ${schema}.endpoint_report_journals WHERE enrollment_id=$1 FOR UPDATE`, [a.scope.enrollmentId])).rows[0];
  if (!row) return null;
  const state = parseEndpointReportState(row.record);
  if (String(state.endpointRevision) !== row.endpoint_revision || JSON.stringify(state.scope) !== JSON.stringify(a.scope) || state.publicKeySpki !== a.publicKeySpki) return fail("AUTHORITY_CHANGED");
  const acknowledgements = (await c.query<{ report_id: string; source_epoch: string; source_sequence: string; payload_digest: Buffer; endpoint_revision: string; received_at: string }>(`SELECT report_id,source_epoch,source_sequence,payload_digest,endpoint_revision::text,
    to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') received_at
    FROM ${schema}.endpoint_report_receipts WHERE enrollment_id=$1`, [a.scope.enrollmentId])).rows;
  const byId = new Map(acknowledgements.map(r => [r.report_id, r]));
  if (acknowledgements.length !== state.receipts.length) throw new EndpointReportError("CORRUPT_STATE");
  for (const r of state.receipts) {
    const ack = byId.get(r.reportId);
    if (!ack || ack.source_epoch !== r.sourceEpoch || ack.source_sequence !== r.sequence || ack.endpoint_revision !== String(r.endpointRevision)
      || ack.received_at !== r.receivedAt || !ack.payload_digest.equals(Buffer.from(r.payloadDigest, "hex"))) throw new EndpointReportError("CORRUPT_STATE");
  }
  return state;
}
async function save(c: PoolClient, s: EndpointReportState, exists: boolean): Promise<void> {
  const result = exists
    ? await c.query(`UPDATE ${schema}.endpoint_report_journals SET endpoint_revision=$2,record=$3 WHERE enrollment_id=$1 RETURNING enrollment_id`, [s.scope.enrollmentId, s.endpointRevision, s])
    : await c.query(`INSERT INTO ${schema}.endpoint_report_journals(enrollment_id,installation_id,device_id,endpoint_revision,record) VALUES($1,$2,$3,$4,$5) RETURNING enrollment_id`, [s.scope.enrollmentId, s.scope.installationId, s.scope.deviceId, s.endpointRevision, s]);
  if (result.rowCount !== 1) fail("DATABASE_UNAVAILABLE");
}
async function audit(c: PoolClient, s: EndpointReportState, action: string, requestId: string): Promise<void> {
  const result = await c.query(`INSERT INTO ${schema}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
    VALUES($1,'installation',$2,$3,'endpoint_report',$4,$5,$6) RETURNING audit_record_id`, [randomUUID(), s.scope.installationId, action, s.scope.enrollmentId, requestId,
    { endpointRevision: s.endpointRevision, sourceEpoch: s.epochs.at(-1)!.epochId, sequence: s.sequence }]);
  if (result.rowCount !== 1) fail("DATABASE_UNAVAILABLE");
}

// Internal only; no Nest provider/route/client/executor. Null verifier closes
// BEFORE database access. Source fixtures are not a real LocalAPI adapter.
export class EndpointReportJournal {
  constructor(private readonly pool: Pool, private readonly verifier: EndpointReportSourceVerifier | null = null,
    private readonly sourceMaximumAgeMs = 0) {
    if (verifier && (!Number.isSafeInteger(sourceMaximumAgeMs) || sourceMaximumAgeMs < 1)) fail("INPUT_INVALID");
  }
  private async tx<T>(token: string, enrollmentId: string, transport: object,
    fn: (c: PoolClient, a: EndpointAuthority, s: EndpointReportState | null, now: string) => Promise<T>): Promise<T> {
    if (!this.verifier) return fail("SOURCE_UNAVAILABLE");
    if (!tokenPattern.test(token)) return fail("AUTHENTICATION_REQUIRED");
    if (typeof transport !== "object" || transport === null || Array.isArray(transport)) return fail("INPUT_INVALID");
    let c: PoolClient;
    try { c = await this.pool.connect(); } catch { return fail("DATABASE_UNAVAILABLE"); }
    try {
      // Observe the actual transport BEFORE taking a transaction/row locks.
      // This unlocked locator is only an observation target, never permission;
      // locked current binding/session and final freshness are checked below.
      const candidate = (await c.query<{ record: unknown }>(`SELECT e.record FROM ${schema}.network_enrollments e
        JOIN ${schema}.installation_sessions s ON s.installation_id=e.installation_id
        WHERE e.enrollment_id=$1 AND s.token_digest=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`, [enrollmentId, digest(token)])).rows[0];
      if (!candidate) return fail("AUTHENTICATION_REQUIRED");
      const candidateRecord = parseAdmissionRecord(candidate.record), ca = candidateRecord.authority;
      if (candidateRecord.phase !== "admitted" || !candidateRecord.node) return fail("AUTHORITY_CHANGED");
      const target = createEndpointReportState({ scope: { enrollmentId: candidateRecord.enrollmentId, deviceId: ca.deviceId, installationId: ca.installationId,
        installationGeneration: ca.installationGeneration, enrollmentGeneration: ca.enrollmentGeneration, ownershipVersion: ca.ownershipVersion, node: candidateRecord.node },
        publicKeySpki: candidateRecord.publicKeySpki, mayReport: true, pairingSessionId: null, pairingExpiresAt: null }).scope;
      const abort = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined;
      let evidence: EndpointReportSourceEvidence | null;
      try {
        const returned = await Promise.race([this.verifier.observe(transport, structuredClone(target), abort.signal),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => { abort.abort(); reject(new EndpointJournalError("SOURCE_UNAVAILABLE")); }, 3000); })]);
        // Cancellation listeners run synchronously. Snapshot the winning value
        // BEFORE finally aborts, so cleanup cannot refresh time or repair scope.
        evidence = returned === null ? null : structuredClone(returned);
      } catch { return fail("SOURCE_UNAVAILABLE"); } finally { clearTimeout(timeout); abort.abort(); }
      if (!evidence) return fail("SOURCE_UNAVAILABLE");
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      const { session, authority } = await lockBinding(c, token, enrollmentId), state = await load(c, authority);
      if (JSON.stringify(evidence.scope) !== JSON.stringify(authority.scope)) return fail("SOURCE_MISMATCH");
      const now = await clock(c);
      if (!timestampSchema.safeParse(evidence.observedAt).success || !endpointReportTimeIsFresh(evidence.observedAt, now, this.sourceMaximumAgeMs)) return fail("SOURCE_STALE");
      const result = await fn(c, authority, state, now);
      if (!endpointReportTimeIsFresh(evidence.observedAt, await freshSession(c, session), this.sourceMaximumAgeMs)) return fail("SOURCE_STALE");
      await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { return fail("DATABASE_UNAVAILABLE"); }
      if (e instanceof EndpointJournalError || e instanceof EndpointReportError) throw e;
      return fail("DATABASE_UNAVAILABLE");
    } finally { c.release(); }
  }
  async begin(token: string, transport: object, input: unknown) {
    const p = beginSchema.safeParse(input); if (!p.success) return fail("INPUT_INVALID"); const r = p.data;
    return this.tx(token, r.enrollmentId, transport, async (c, a, s, now) => {
      const old = s?.epochs.find(e => e.epochId === r.epochId);
      if (old && old.endpointRevision - 1 !== r.expectedRevision) throw new EndpointReportError("STALE_VERSION");
      const state = beginEndpointSourceEpoch(s ?? createEndpointReportState(a), a, r.expectedRevision, r.epochId, now);
      if (!old) { await save(c, state, s !== null); await audit(c, state, "endpoint_report.epoch_started", r.epochId); }
      return { state, replayed: old !== undefined };
    });
  }
  async report(token: string, transport: object, enrollmentInput: unknown, signed: unknown) {
    const p = boundary.safeParse(enrollmentInput); if (!p.success) return fail("INPUT_INVALID");
    return this.tx(token, p.data.enrollmentId, transport, async (c, a, s, now) => {
      if (!s) return fail("NOT_FOUND");
      const result = acceptEndpointReport(s, a, signed, now);
      if (result.disposition === "accepted") {
        await save(c, result.state, true); const r = result.receipt;
        const inserted = await c.query(`INSERT INTO ${schema}.endpoint_report_receipts(enrollment_id,report_id,source_epoch,source_sequence,payload_digest,endpoint_revision,received_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING report_id`,
          [a.scope.enrollmentId, r.reportId, r.sourceEpoch, r.sequence, Buffer.from(r.payloadDigest, "hex"), r.endpointRevision, r.receivedAt]);
        if (inserted.rowCount !== 1) fail("DATABASE_UNAVAILABLE");
        await audit(c, result.state, "endpoint_report.accepted", r.reportId);
      }
      return { state: result.state, disposition: result.disposition, receipt: ack(result.receipt) };
    });
  }
  async query(token: string, transport: object, input: unknown) {
    const p = querySchema.safeParse(input); if (!p.success) return fail("INPUT_INVALID"); const r = p.data;
    return this.tx(token, r.enrollmentId, transport, async (_c, a, s, now) => {
      if (!s) return fail("NOT_FOUND");
      const previous = r.reportId ? s.receipts.find(p => p.reportId === r.reportId) : null;
      if (r.reportId && !previous) return fail("NOT_FOUND");
      return { endpointRevision: s.endpointRevision, currentEpoch: s.epochs.at(-1)!.epochId,
        sequence: s.sequence, candidates: readEndpointCandidates(s, a, now, r.maximumAgeMs), receipt: previous ? ack(previous) : null };
    });
  }
}
function ack(r: EndpointReportState["receipts"][number]) {
  return { reportId: r.reportId, sourceEpoch: r.sourceEpoch, sequence: r.sequence,
    endpointRevision: r.endpointRevision, receivedAt: r.receivedAt };
}
