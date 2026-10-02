import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { participationChallengeRequestSchema, participationConfirmRequestSchema, participationWithdrawRequestSchema,
  participationChallengeSchema, participationReceiptSchema, participationScopeSchema, participationProtocolVersion, participationRunRequestSchema, participationRunSchema,
  admissionGenerationSchema, type ParticipationScope, type ParticipationChallenge, type ParticipationReceipt, type ParticipationRun } from "@socialgrowth/product-contracts";
import { InstallationAuthService } from "./installation-auth-service.js";
import { PhoneControlJournal } from "./phone-control-journal.js";
import { parsePhoneControlRecord } from "./action-permission-core.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const s = "socialgrowth_product";
const denied = () => new ProductTransactionError("AUTHORIZATION_DENIED", "Current installation participation is unavailable");
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Participation challenge is stale; inspect current scope");
const unavailable = () => new ProductTransactionError("AUTHORIZATION_DENIED", "Participation storage is unavailable", true);
const clock = async (c: PoolClient) => (await c.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now;
interface Context { scope: ParticipationScope; sessionId: string; deviceState: string }
interface Slot { sequence: string; request_key: string; command_kind: string; session_id: string;
  challenge: unknown; receipt: unknown; receipt_session_id: string | null; stop_request_id: string | null }
const sameScope = (a: ParticipationScope, b: ParticipationScope) => Object.entries(a).every(([k, v]) => b[k as keyof ParticipationScope] === v);
function sequence(slot: Slot | null): string {
  if (slot && !admissionGenerationSchema.safeParse(slot.sequence).success) throw unavailable();
  const next = slot ? (BigInt(slot.sequence) + 1n).toString() : "1";
  if (!admissionGenerationSchema.safeParse(next).success) throw unavailable(); return next;
}
async function loadSlot(c: PoolClient, id: string): Promise<Slot | null> {
  return (await c.query<Slot>(`SELECT * FROM ${s}.local_participation WHERE device_id=$1 FOR UPDATE`, [id])).rows[0] ?? null;
}

// Installed-client confirmation only. This service never grants a phone action,
// starts Artemis, admits a network, registers a platform login or confirms stop.
export class LocalParticipationService {
  private readonly journal: PhoneControlJournal;
  constructor(private readonly pool: Pool, private readonly auth: InstallationAuthService) { this.journal = new PhoneControlJournal(pool); }
  private async tx<T>(token: string, allowDisabledProvider: boolean, work: (c: PoolClient, context: Context) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      const initial = await this.auth.authenticate(token, c);
      const association = (await c.query<{ association_id: string; device_id: string; provider_id: string }>(
        `SELECT association_id,device_id,provider_id FROM ${s}.device_associations WHERE installation_id=$1 AND ended_at IS NULL`, [initial.installationId])).rows[0];
      if (!association) throw denied();
      // Same provider -> installation -> association -> device order as identity
      // association. No authority loading takes these locks after a device lock.
      const provider = (await c.query<{ status: string }>(`SELECT status FROM ${s}.providers WHERE provider_id=$1 FOR UPDATE`, [association.provider_id])).rows[0];
      if (!provider || (!allowDisabledProvider && provider.status !== "active")) throw denied();
      await c.query(`SELECT installation_id FROM ${s}.installations WHERE installation_id=$1 FOR UPDATE`, [initial.installationId]);
      const current = await this.auth.authenticate(token, c); // Revalidate after lock waits; no expired/revoked session shortcut.
      if (current.installationId !== initial.installationId || current.installationGeneration !== initial.installationGeneration) throw denied();
      const assoc = (await c.query<{ association_id: string; device_id: string; provider_id: string }>(
        `SELECT association_id,device_id,provider_id FROM ${s}.device_associations WHERE installation_id=$1 AND ended_at IS NULL FOR UPDATE`, [current.installationId])).rows[0];
      if (!assoc || assoc.association_id !== association.association_id || assoc.device_id !== association.device_id || assoc.provider_id !== association.provider_id) throw stale();
      const device = (await c.query<{ state: string; fact_version: string }>(`SELECT state,fact_version::text FROM ${s}.devices WHERE device_id=$1 FOR UPDATE`, [assoc.device_id])).rows[0];
      if (!device) throw denied();
      const control = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR UPDATE`, [assoc.device_id])).rows[0];
      const record = control ? parsePhoneControlRecord(control.record) : null;
      if (record && record.deviceId !== assoc.device_id) throw unavailable();
      const session = (await c.query<{ session_id: string; expires_at: Date; revoked_at: Date | null }>(
        `SELECT session_id,expires_at,revoked_at FROM ${s}.installation_sessions WHERE installation_id=$1 AND token_digest=$2 FOR SHARE`,
        [current.installationId, createHash("sha256").update(token).digest()])).rows[0];
      const now = await clock(c);
      if (!session || session.revoked_at || session.expires_at <= now) throw denied();
      const scope = participationScopeSchema.parse({ deviceId: assoc.device_id, associationId: assoc.association_id,
        installationId: current.installationId, installationGeneration: current.installationGeneration.toString(),
        deviceFactVersion: Number(device.fact_version), controlGeneration: record?.controlGeneration ?? null });
      const result = await work(c, { scope, sessionId: session.session_id, deviceState: device.state });
      await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
      if (e instanceof ProductTransactionError) throw e; throw unavailable();
    } finally { c.release(); }
  }
  private async run(c: PoolClient, ctx: Context, runId: string, allowRevoked = false) {
    const row = (await c.query<{ record: unknown; revoked_at: Date | null; withdrawal: unknown; session_id: string }>(
      `SELECT record,revoked_at,withdrawal,session_id FROM ${s}.local_participation_runs WHERE run_id=$1 AND device_id=$2 AND installation_id=$3 AND association_id=$4 AND installation_generation=$5 FOR UPDATE`,
      [runId, ctx.scope.deviceId, ctx.scope.installationId, ctx.scope.associationId, ctx.scope.installationGeneration])).rows[0];
    if (!row || row.session_id !== ctx.sessionId || (!allowRevoked && row.revoked_at !== null)) throw stale();
    if (!allowRevoked && !sameScope(participationRunSchema.parse(row.record).scope, ctx.scope)) throw stale();
    return row;
  }
  async start(token: string, raw: unknown): Promise<ParticipationRun> {
    const r = participationRunRequestSchema.parse(raw);
    return this.tx(token, false, async (c, ctx) => {
      if (!["associated_pending_access", "access_ready"].includes(ctx.deviceState)) throw denied();
      const exists = (await c.query(`SELECT 1 FROM ${s}.local_participation_runs WHERE run_id=$1`, [r.runId])).rowCount;
      if (exists) return participationRunSchema.parse((await this.run(c, ctx, r.runId)).record);
      const now = await clock(c);
      const previous = (await c.query(`UPDATE ${s}.local_participation_runs SET revoked_at=$2 WHERE device_id=$1 AND revoked_at IS NULL RETURNING run_id`, [ctx.scope.deviceId, now])).rowCount;
      if (previous) await this.journal.revokeInTransaction(c, ctx.scope.deviceId, `participation_start_${r.runId.replaceAll("-", "")}`, r.runId);
      const control = (await c.query<{record: unknown}>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1`, [ctx.scope.deviceId])).rows[0];
      const scope = { ...ctx.scope, controlGeneration: control ? parsePhoneControlRecord(control.record).controlGeneration : null };
      const record = participationRunSchema.parse({ protocolVersion: participationProtocolVersion, runId: r.runId, scope,
        startedAt: now.toISOString(), actionPermissionGranted: false, stopConfirmed: false });
      const inserted = await c.query(`INSERT INTO ${s}.local_participation_runs(run_id,device_id,installation_id,association_id,session_id,installation_generation,started_at,record)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(run_id) DO NOTHING`,
        [r.runId,scope.deviceId,scope.installationId,scope.associationId,ctx.sessionId,scope.installationGeneration,now,record]);
      if (inserted.rowCount!==1) throw stale();
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'installation',$2,'local_participation.start','device',$3,$4,$5)`, [randomUUID(),scope.installationId,scope.deviceId,r.requestId,{runId:r.runId,actionPermissionGranted:false}]);
      return record;
    });
  }
  async challenge(token: string, raw: unknown): Promise<ParticipationChallenge> {
    const r = participationChallengeRequestSchema.parse(raw);
    return this.tx(token, false, async (c, ctx) => {
      if (!["associated_pending_access", "access_ready"].includes(ctx.deviceState)) throw denied();
      await this.run(c, ctx, r.runId);
      const old = await loadSlot(c, ctx.scope.deviceId);
      if (old?.request_key === r.requestKey) {
        if (old.command_kind !== "challenge" || old.session_id !== ctx.sessionId) throw stale();
        const original = participationChallengeSchema.parse(old.challenge);
        if (original.runId !== r.runId || !sameScope(original.scope, ctx.scope)) throw stale(); return original; // Never renew original expiry.
      }
      const now = await clock(c), seq = sequence(old);
      const challenge = participationChallengeSchema.parse({ protocolVersion: participationProtocolVersion, challengeId: randomUUID(),
        sequence: seq, runId: r.runId, scope: ctx.scope, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6000).toISOString() });
      // Keep the previous pulse until the new one is confirmed or expires. A
      // challenge is no new confirmation and must not create five-second gaps.
      if (old?.receipt) participationReceiptSchema.parse(old.receipt);
      await c.query(`INSERT INTO ${s}.local_participation(device_id,sequence,request_key,command_kind,session_id,challenge,receipt,receipt_session_id,stop_request_id)
        VALUES($1,$2,$3,'challenge',$4,$5,$6,$7,NULL) ON CONFLICT(device_id) DO UPDATE SET sequence=$2,request_key=$3,command_kind='challenge',session_id=$4,challenge=$5,receipt=$6,receipt_session_id=$7,stop_request_id=NULL`,
        [ctx.scope.deviceId, seq, r.requestKey, ctx.sessionId, challenge, old?.receipt ?? null, old?.receipt_session_id ?? null]);
      return challenge;
    });
  }
  async confirm(token: string, raw: unknown): Promise<ParticipationReceipt> {
    const r = participationConfirmRequestSchema.parse(raw);
    return this.tx(token, false, async (c, ctx) => {
      if (!["associated_pending_access", "access_ready"].includes(ctx.deviceState)) throw denied();
      await this.run(c, ctx, r.runId);
      const slot = await loadSlot(c, ctx.scope.deviceId);
      if (!slot || slot.command_kind !== "challenge" || slot.session_id !== ctx.sessionId) throw stale();
      const challenge = participationChallengeSchema.parse(slot.challenge);
      if (challenge.runId !== r.runId || challenge.challengeId !== r.challengeId || challenge.sequence !== slot.sequence || !sameScope(challenge.scope, ctx.scope)) throw stale();
      if (slot.receipt !== null) {
        const original = participationReceiptSchema.parse(slot.receipt);
        if (original.sequence === slot.sequence) return original; // Original checkedAt, no replay renewal.
      }
      const now = await clock(c);
      if (Date.parse(challenge.issuedAt) > now.getTime() || Date.parse(challenge.expiresAt) <= now.getTime()) throw stale();
      const receipt = participationReceiptSchema.parse({ protocolVersion: participationProtocolVersion, receiptId: randomUUID(),
        scope: ctx.scope, runId: r.runId, sequence: slot.sequence, state: "active", checkedAt: now.toISOString(), validUntil: new Date(now.getTime() + 10_000).toISOString(),
        actionPermissionGranted: false, stopConfirmed: false });
      await c.query(`UPDATE ${s}.local_participation SET receipt=$2,receipt_session_id=$3 WHERE device_id=$1`, [ctx.scope.deviceId, receipt, ctx.sessionId]); return receipt;
    });
  }
  async withdraw(token: string, raw: unknown): Promise<ParticipationReceipt> {
    const r = participationWithdrawRequestSchema.parse(raw);
    return this.tx(token, true, async (c, ctx) => {
      const run = await this.run(c, ctx, r.runId, true);
      if (run.revoked_at !== null) {
        if (run.withdrawal === null) throw stale();
        return participationReceiptSchema.parse(run.withdrawal); // Old withdrawal never stops a successor run.
      }
      const old = await loadSlot(c, ctx.scope.deviceId);
      if (old?.request_key === r.requestKey && old.command_kind === "withdraw" && old.session_id === ctx.sessionId) {
        const historical = participationReceiptSchema.parse(old.receipt);
        if (historical.runId !== r.runId) throw stale();
        return historical; // Historical withdrawal, never a resumed grant.
      }
      const stopId = randomUUID(), seq = sequence(old);
      await this.journal.revokeInTransaction(c, ctx.scope.deviceId, `participation_${createHash("sha256").update(`${r.runId}:${r.requestKey}`).digest("hex")}`, stopId);
      const control = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1`, [ctx.scope.deviceId])).rows[0];
      const scope = { ...ctx.scope, controlGeneration: control ? parsePhoneControlRecord(control.record).controlGeneration : null };
      const now = await clock(c);
      const receipt = participationReceiptSchema.parse({ protocolVersion: participationProtocolVersion, receiptId: randomUUID(), scope, runId: r.runId, sequence: seq,
        state: "withdrawn", checkedAt: now.toISOString(), validUntil: now.toISOString(), actionPermissionGranted: false, stopConfirmed: false });
      await c.query(`UPDATE ${s}.local_participation_runs SET revoked_at=$2,withdrawal=$3 WHERE run_id=$1`, [r.runId,now,receipt]);
      await c.query(`INSERT INTO ${s}.local_participation(device_id,sequence,request_key,command_kind,session_id,challenge,receipt,receipt_session_id,stop_request_id)
        VALUES($1,$2,$3,'withdraw',$4,NULL,$5,$4,$6) ON CONFLICT(device_id) DO UPDATE SET sequence=$2,request_key=$3,command_kind='withdraw',session_id=$4,challenge=NULL,receipt=$5,receipt_session_id=$4,stop_request_id=$6`,
        [scope.deviceId, seq, r.requestKey, ctx.sessionId, receipt, stopId]);
      await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
        VALUES($1,'installation',$2,'local_participation.withdraw','device',$3,$4,$5)`,
        [randomUUID(), scope.installationId, scope.deviceId, r.requestId, { receiptId: receipt.receiptId, stopRequestId: stopId, stopConfirmed: false }]);
      return receipt;
    });
  }
}

// Read-only fact loading, not a permit. Current session/association/installation,
// device version and control generation all have to match the stored pulse.
export async function loadCurrentLocalParticipation(c: PoolClient, deviceId: string, now: Date): Promise<ParticipationReceipt | null> {
  const row = (await c.query<{ receipt: unknown; sequence: string; association_id: string; installation_id: string;
    generation: string; fact_version: string; control: unknown }>(
    `SELECT p.receipt,p.sequence,a.association_id,i.installation_id,i.generation::text,d.fact_version::text,j.record control
       FROM ${s}.local_participation p JOIN ${s}.devices d ON d.device_id=p.device_id
       JOIN ${s}.device_associations a ON a.device_id=d.device_id AND a.ended_at IS NULL
       JOIN ${s}.local_participation_runs run ON run.run_id=(p.receipt->>'runId')::uuid AND run.device_id=d.device_id
         AND run.association_id=a.association_id AND run.revoked_at IS NULL AND run.session_id=p.receipt_session_id
       JOIN ${s}.installations i ON i.installation_id=a.installation_id AND i.status='active' AND run.installation_id=i.installation_id AND run.installation_generation=i.generation::text
       JOIN ${s}.providers owner ON owner.provider_id=a.provider_id AND owner.status='active'
       JOIN ${s}.installation_sessions session ON session.session_id=p.receipt_session_id AND session.installation_id=i.installation_id
         AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
       JOIN ${s}.phone_control_journals j ON j.device_id=d.device_id
      WHERE p.device_id=$1 AND p.command_kind='challenge' AND d.state IN ('associated_pending_access','access_ready')`, [deviceId])).rows[0];
  if (!row || row.receipt === null) return null;
  const parsed = participationReceiptSchema.safeParse(row.receipt);
  if (!parsed.success) throw unavailable();
  const r = parsed.data, control = parsePhoneControlRecord(row.control);
  if (control.deviceId !== deviceId || r.state !== "active" || r.scope.deviceId !== deviceId
    || r.scope.associationId !== row.association_id || r.scope.installationId !== row.installation_id
    || r.scope.installationGeneration !== row.generation || String(r.scope.deviceFactVersion) !== row.fact_version
    || r.scope.controlGeneration === null || r.scope.controlGeneration !== control.controlGeneration
    || !admissionGenerationSchema.safeParse(row.sequence).success || BigInt(r.sequence) > BigInt(row.sequence)
    || Date.parse(r.checkedAt) > now.getTime() || now.getTime() >= Date.parse(r.validUntil)
    || Date.parse(r.validUntil) - Date.parse(r.checkedAt) !== 10_000) return null;
  return r;
}
