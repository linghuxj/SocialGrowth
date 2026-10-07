import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { admissionGenerationSchema, artemisPreparationAssignmentSchema, accountPreparationIntentSchema } from "@socialgrowth/product-contracts";
import type { MediaInputActionScope } from "./media-input-envelope.js";
import type { AuthenticatedInstallation, InstallationAuthService } from "./installation-auth-service.js";
import { loadCurrentLocalParticipation } from "./local-participation-service.js";
import { parsePhoneControlRecord } from "./action-permission-core.js";
import { parseAdmissionRecord } from "./network-admission-record.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const s = "socialgrowth_product";
const uuid = z.string().uuid().refine(v => v === v.toLowerCase());
const inputScopeSchema = z.strictObject({
  accountId: uuid, platform: z.enum(["facebook", "youtube"]), credentialId: uuid,
  expectedRevision: z.bigint().positive().max(BigInt(Number.MAX_SAFE_INTEGER)), projectId: uuid, deviceId: uuid,
  taskId: uuid, taskAttemptId: uuid, operationKind: z.literal("assist_existing_login"), actionId: uuid,
  fieldRef: z.enum(["login", "password", "submit_login"]), authorizationId: uuid, holderId: uuid,
  controlGeneration: z.bigint().positive().max(BigInt(Number.MAX_SAFE_INTEGER)), serial: z.string().min(1).max(128),
  targetViewIdResourceName: z.string().min(1).max(256).optional(),
}).superRefine((v, c) => {
  if ((v.fieldRef === "submit_login") !== (v.targetViewIdResourceName !== undefined)) c.addIssue({ code: "custom", path: ["targetViewIdResourceName"] });
  for (const key of ["accountId", "credentialId", "projectId", "deviceId", "taskId", "taskAttemptId", "actionId", "authorizationId", "holderId"] as const) {
    if (v[key] !== v[key].toLowerCase()) c.addIssue({ code: "custom", path: [key] });
  }
  if (v.targetViewIdResourceName && !/^[A-Za-z0-9_.]+:id\/[A-Za-z0-9_]+$/.test(v.targetViewIdResourceName)) {
    c.addIssue({ code: "custom", path: ["targetViewIdResourceName"] });
  }
});
export type MediaInputScope = z.infer<typeof inputScopeSchema>;
export interface EnrolledMediaInputKey { readonly keyId: string; readonly publicKeySpki: Buffer; readonly publicKey: KeyObject }
export interface CurrentMediaInputAuthority {
  readonly scope: MediaInputScope;
  readonly installationId: string;
  readonly installationGeneration: bigint;
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
  readonly leaseUntilMillis: bigint;
  readonly holderGrantValidUntilMillis: bigint;
  readonly participationValidUntil: Date;
  readonly databaseNow: Date;
  readonly enrolledKey: EnrolledMediaInputKey;
  readonly snapshot: string;
}
export interface PendingMediaInputGrant {
  readonly envelopeSha256: Buffer;
  readonly requestSha256: Buffer;
  readonly sessionNonce: Buffer;
  readonly helloProofSha256: Buffer;
  readonly devicePublicKeySha256: Buffer;
  readonly expiresAtMillis: bigint;
  readonly helloProofFrame: Buffer;
}
export interface AuthenticatedMediaInputSession extends AuthenticatedInstallation { readonly sessionId: string; readonly expiresAt: Date }
export interface MediaInputEnrollmentRequest {
  readonly installationId: string; readonly installationGeneration: number; readonly publicKeySpki: string;
}
export interface MediaInputEnrollmentCompleteRequest extends MediaInputEnrollmentRequest {
  readonly challengeId: string; readonly proof: string;
}
export interface MediaInputConsumeRequest { readonly requestId: string; readonly envelopeSha256: string }
export interface MediaInputStatusRequest { readonly requestId: string; readonly actionId: string; readonly statusFrameBase64Url: string }

function denied(): never { throw new ProductTransactionError("AUTHORIZATION_DENIED", "Controlled input authority is unavailable"); }
function invalid(): never { throw new ProductTransactionError("INPUT_INVALID", "Controlled input request is invalid"); }
function unavailable(): never { throw new ProductTransactionError("INTERNAL_ERROR", "Controlled input service unavailable", true); }
function stale(): never { throw new ProductTransactionError("FACT_VERSION_STALE", "Controlled input facts changed"); }
function hash(bytes: Buffer | string): Buffer { return createHash("sha256").update(bytes).digest(); }
function b64url(bytes: Buffer): string { return bytes.toString("base64url"); }
function decodeBase64Url(value: string, min: number, max: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  const result = Buffer.from(value, "base64url");
  if (result.length < min || result.length > max || result.toString("base64url") !== value) invalid();
  return result;
}
function keyFromSpki(bytes: Buffer): KeyObject {
  const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    || !Buffer.from(key.export({ type: "spki", format: "der" })).equals(bytes)) invalid();
  return key;
}
function canonicalP256Der(signature: Buffer): boolean {
  if (signature.length < 8 || signature.length > 72 || signature[0] !== 0x30 || signature[1] !== signature.length - 2) return false;
  let i = 2;
  const readInt = (): bigint | null => {
    if (signature[i++] !== 0x02) return null;
    const length = signature[i++];
    if (length === undefined || length < 1 || i + length > signature.length) return null;
    const bytes = signature.subarray(i, i + length); i += length;
    if ((bytes[0]! & 0x80) !== 0 || (length > 1 && bytes[0] === 0 && (bytes[1]! & 0x80) === 0)) return null;
    let n = 0n; for (const byte of bytes) n = (n << 8n) | BigInt(byte);
    return n > 0n ? n : null;
  };
  const r = readInt(), ss = readInt();
  const order = 0xffff_ffff_0000_0000_ffff_ffff_ffff_ffff_bce6_faada7179e84f3b9cac2fc632551n;
  return i === signature.length && r !== null && ss !== null && r < order && ss <= order / 2n;
}
function uuidBytes(value: string): Buffer { return Buffer.from(value.replaceAll("-", ""), "hex"); }
function u64(value: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64BE(value); return b; }
function enrollmentProofInput(installationId: string, generation: bigint, challengeId: string, challenge: Buffer, spki: Buffer): Buffer {
  return Buffer.concat([Buffer.from("SGMI-ENROLL-PROOF-v1\0", "ascii"), uuidBytes(installationId), u64(generation),
    uuidBytes(challengeId), challenge, hash(spki)]);
}

async function tx<T>(pool: Pool, f: (c: PoolClient) => Promise<T>): Promise<T> {
  let c: PoolClient;
  try { c = await pool.connect(); } catch { throw unavailable(); }
  try {
    await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
    const value = await f(c); await c.query("COMMIT"); return value;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { throw unavailable(); }
    if (e instanceof ProductTransactionError) throw e;
    throw unavailable();
  } finally { c.release(); }
}
function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export class MediaInputAuthorityStore {
  constructor(private readonly pool: Pool, private readonly auth: InstallationAuthService) {}

  async verifySession(token: string, context: AuthenticatedInstallation): Promise<void> {
    await tx(this.pool, async c => { await this.authenticatedSession(c, token, context); });
  }

  parseScope(input: unknown): MediaInputScope {
    if (typeof input !== "object" || input === null || Array.isArray(input)) invalid();
    const raw = input as Record<string, unknown>;
    let expectedRevision = raw.expectedRevision, controlGeneration = raw.controlGeneration;
    try {
      if (typeof expectedRevision === "string" && /^[1-9][0-9]{0,15}$/.test(expectedRevision)) expectedRevision = BigInt(expectedRevision);
      if (typeof controlGeneration === "string" && /^[1-9][0-9]{0,15}$/.test(controlGeneration)) controlGeneration = BigInt(controlGeneration);
    } catch { invalid(); }
    const parsed = inputScopeSchema.safeParse({ ...raw, expectedRevision, controlGeneration }); if (!parsed.success) invalid();
    if (parsed.data.accountId !== parsed.data.accountId.toLowerCase() || parsed.data.actionId !== parsed.data.actionId.toLowerCase()) invalid();
    return parsed.data;
  }

  async authenticatedSession(c: PoolClient, token: string, context?: AuthenticatedInstallation): Promise<AuthenticatedMediaInputSession> {
    const initial = await this.auth.authenticate(token, c);
    if (context && (initial.installationId !== context.installationId || initial.installationGeneration !== context.installationGeneration)) denied();
    const row = (await c.query<{ session_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT session_id,expires_at,revoked_at FROM ${s}.installation_sessions
       WHERE installation_id=$1 AND token_digest=$2 FOR SHARE`,
      [initial.installationId, hash(Buffer.from(token, "utf8"))])).rows[0];
    const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now;
    if (!row || row.revoked_at || !now || row.expires_at <= now) denied();
    const current = await this.auth.authenticate(token, c);
    if (current.installationId !== initial.installationId || current.installationGeneration !== initial.installationGeneration) denied();
    return { ...current, sessionId: row.session_id, expiresAt: row.expires_at };
  }

  async enrollmentChallenge(token: string, authContext: AuthenticatedInstallation, request: MediaInputEnrollmentRequest) {
    const spki = decodeBase64Url(request.publicKeySpki, 64, 256);
    try { keyFromSpki(spki); } catch { spki.fill(0); throw invalid(); }
    const keyId = hash(spki).toString("hex");
    try {
      return await tx(this.pool, async c => {
        const session = await this.authenticatedSession(c, token, authContext);
        if (request.installationId !== session.installationId || request.installationGeneration !== Number(session.installationGeneration)) denied();
        const existingKey = (await c.query<{ key_id: string; public_key_spki: Buffer }>(
          `SELECT key_id,public_key_spki FROM ${s}.media_input_installation_keys WHERE installation_id=$1 AND installation_generation=$2 FOR SHARE`,
          [session.installationId, session.installationGeneration.toString()])).rows[0];
        if (existingKey && (existingKey.key_id !== keyId || !existingKey.public_key_spki.equals(spki))) denied();
        const current = (await c.query<{ challenge_id: string; challenge: Buffer; expires_at: Date; key_id: string; public_key_spki: Buffer }>(
          `SELECT challenge_id,challenge,expires_at,key_id,public_key_spki FROM ${s}.media_input_enrollment_challenges
           WHERE installation_id=$1 AND installation_generation=$2 AND session_id=$3 AND consumed_at IS NULL FOR UPDATE`,
          [session.installationId, session.installationGeneration.toString(), session.sessionId])).rows[0];
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        if (current && current.expires_at > now) {
          if (current.key_id !== keyId || !current.public_key_spki.equals(spki)) denied();
          return { contractVersion: "media-credential-input-v1", challengeId: current.challenge_id, challenge: b64url(current.challenge) };
        }
        if (current) await c.query(`UPDATE ${s}.media_input_enrollment_challenges SET consumed_at=$2 WHERE challenge_id=$1 AND consumed_at IS NULL`,
          [current.challenge_id, current.expires_at]);
        const challengeId = cryptoRandomUuid(), challenge = randomBytes(32), expiresAt = new Date(now.getTime() + 120_000);
        await c.query(`INSERT INTO ${s}.media_input_enrollment_challenges
          (challenge_id,installation_id,installation_generation,session_id,key_id,public_key_spki,challenge,created_at,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [challengeId, session.installationId, session.installationGeneration.toString(), session.sessionId, keyId, spki, challenge, now, expiresAt]);
        return { contractVersion: "media-credential-input-v1", challengeId, challenge: b64url(challenge) };
      });
    } finally { spki.fill(0); }
  }

  async completeEnrollment(token: string, authContext: AuthenticatedInstallation, request: MediaInputEnrollmentCompleteRequest) {
    const spki = decodeBase64Url(request.publicKeySpki, 64, 256), proof = decodeBase64Url(request.proof, 8, 72);
    let publicKey: KeyObject;
    try { publicKey = keyFromSpki(spki); } catch { spki.fill(0); proof.fill(0); throw invalid(); }
    if (!canonicalP256Der(proof)) { spki.fill(0); proof.fill(0); throw invalid(); }
    const keyId = hash(spki).toString("hex");
    try {
      return await tx(this.pool, async c => {
        const session = await this.authenticatedSession(c, token, authContext);
        if (request.installationId !== session.installationId || request.installationGeneration !== Number(session.installationGeneration)) denied();
        const challenge = (await c.query<{ challenge_id: string; challenge: Buffer; key_id: string; public_key_spki: Buffer; expires_at: Date; consumed_at: Date | null }>(
          `SELECT challenge_id,challenge,key_id,public_key_spki,expires_at,consumed_at FROM ${s}.media_input_enrollment_challenges
           WHERE challenge_id=$1 AND installation_id=$2 AND installation_generation=$3 AND session_id=$4 FOR UPDATE`,
          [request.challengeId, session.installationId, session.installationGeneration.toString(), session.sessionId])).rows[0];
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        if (!challenge || challenge.consumed_at || challenge.expires_at <= now || challenge.key_id !== keyId || !challenge.public_key_spki.equals(spki)) denied();
        const signed = enrollmentProofInput(session.installationId, session.installationGeneration, request.challengeId, challenge.challenge, spki);
        let proofValid = false;
        try { proofValid = verify("sha256", signed, { key: publicKey, dsaEncoding: "der" }, proof); }
        finally { signed.fill(0); }
        if (!proofValid) denied();
        const existing = (await c.query<{ key_id: string; public_key_spki: Buffer }>(
          `SELECT key_id,public_key_spki FROM ${s}.media_input_installation_keys WHERE installation_id=$1 AND installation_generation=$2 FOR UPDATE`,
          [session.installationId, session.installationGeneration.toString()])).rows[0];
        if (existing && (existing.key_id !== keyId || !existing.public_key_spki.equals(spki))) denied();
        await c.query(`UPDATE ${s}.media_input_enrollment_challenges SET consumed_at=$2 WHERE challenge_id=$1 AND consumed_at IS NULL`, [request.challengeId, now]);
        if (existing) return { decision: "already_enrolled" as const, keyId };
        await c.query(`INSERT INTO ${s}.media_input_installation_keys(installation_id,installation_generation,key_id,public_key_spki,enrolled_session_id,enrolled_at)
          VALUES($1,$2,$3,$4,$5,$6)`, [session.installationId, session.installationGeneration.toString(), keyId, spki, session.sessionId, now]);
        return { decision: "enrolled" as const, keyId };
      });
    } finally { spki.fill(0); proof.fill(0); }
  }

  async enrolledKey(installationId: string, installationGeneration: bigint, c?: PoolClient): Promise<EnrolledMediaInputKey> {
    const result = await (c ?? this.pool).query<{ key_id: string; public_key_spki: Buffer }>(
      `SELECT k.key_id,k.public_key_spki FROM ${s}.media_input_installation_keys k
       JOIN ${s}.installations i ON i.installation_id=k.installation_id AND i.generation=k.installation_generation AND i.status='active'
       WHERE k.installation_id=$1 AND k.installation_generation=$2`, [installationId, installationGeneration.toString()]);
    const row = result.rows[0]; if (!row) denied();
    let key: KeyObject; try { key = keyFromSpki(row.public_key_spki); } catch { throw unavailable(); }
    if (hash(row.public_key_spki).toString("hex") !== row.key_id) unavailable();
    return { keyId: row.key_id, publicKeySpki: Buffer.from(row.public_key_spki), publicKey: key };
  }

  async persistPendingGrant(scopeInput: MediaInputActionScope, expectedSnapshot: string, grant: PendingMediaInputGrant): Promise<void> {
    const scope = this.parseScope(scopeInput);
    await tx(this.pool, async c => {
      const current = await this.loadCurrent(scope, c);
      if (current.snapshot !== expectedSnapshot || BigInt(current.databaseNow.getTime()) >= grant.expiresAtMillis
        || BigInt(current.sessionExpiresAt.getTime()) < grant.expiresAtMillis
        || BigInt(current.participationValidUntil.getTime()) < grant.expiresAtMillis) stale();
      const target = scope.fieldRef === "submit_login" ? scope.targetViewIdResourceName : null;
      const storedScope = { ...scope, expectedRevision: scope.expectedRevision.toString(), controlGeneration: scope.controlGeneration.toString() };
      await c.query(`INSERT INTO ${s}.media_input_pending_grants
        (action_id,request_id,account_id,platform,credential_id,credential_revision,project_id,task_id,task_attempt_id,device_id,
         installation_id,installation_generation,session_id,authorization_id,holder_id,control_generation,field_ref,target_view_id_resource_name,
         action_scope,hello_proof_frame,envelope_sha256,request_sha256,session_nonce,hello_proof_sha256,device_public_key_sha256,expires_at)
        VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,to_timestamp($25::double precision/1000))`,
        [scope.actionId, scope.accountId, scope.platform, scope.credentialId, scope.expectedRevision.toString(), scope.projectId, scope.taskId,
          scope.taskAttemptId, scope.deviceId, current.installationId, current.installationGeneration.toString(), current.sessionId,
          scope.authorizationId, scope.holderId, scope.controlGeneration.toString(), scope.fieldRef, target, storedScope, grant.helloProofFrame, grant.envelopeSha256,
          grant.requestSha256, grant.sessionNonce, grant.helloProofSha256, grant.devicePublicKeySha256,
          grant.expiresAtMillis.toString()]);
    });
  }

  async consumeOnce(token: string, authContext: AuthenticatedInstallation, request: MediaInputConsumeRequest) {
    const requestedDigest = decodeBase64Url(request.envelopeSha256, 32, 32);
    try {
      return await tx(this.pool, async c => {
        const session = await this.authenticatedSession(c, token, authContext);
        const row = (await c.query<{ action_scope: unknown; envelope_sha256: Buffer; installation_id: string; installation_generation: string;
          session_id: string; expires_at: Date; consumed_at: Date | null }>(
          `SELECT action_scope,envelope_sha256,installation_id,installation_generation::text,session_id,expires_at,consumed_at
           FROM ${s}.media_input_pending_grants WHERE action_id=$1 FOR UPDATE`, [request.requestId])).rows[0];
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        if (!row || row.consumed_at || row.expires_at <= now || row.installation_id !== session.installationId
          || row.installation_generation !== session.installationGeneration.toString() || row.session_id !== session.sessionId
          || row.envelope_sha256.length !== requestedDigest.length || !timingSafeEqual(row.envelope_sha256, requestedDigest)) denied();
        const scope = this.parseScope(row.action_scope);
        const current = await this.loadCurrent(scope, c);
        if (current.sessionId !== session.sessionId || current.installationId !== session.installationId
          || current.installationGeneration !== session.installationGeneration) denied();
        const changed = await c.query(`UPDATE ${s}.media_input_pending_grants SET consumed_at=$2
          WHERE action_id=$1 AND consumed_at IS NULL AND expires_at>$2`, [request.requestId, now]);
        if (changed.rowCount !== 1) denied();
        return { decision: "proceed_once" as const, requestId: request.requestId };
      });
    } finally { requestedDigest.fill(0); }
  }

  async recordStatus(token: string, authContext: AuthenticatedInstallation, request: MediaInputStatusRequest) {
    const frame = decodeBase64Url(request.statusFrameBase64Url, 1, 8192);
    try {
      return await tx(this.pool, async c => {
        const session = await this.authenticatedSession(c, token, authContext);
        const grant = (await c.query<{ action_scope: unknown; installation_id: string; installation_generation: string; session_id: string;
          session_nonce: Buffer; request_sha256: Buffer; expires_at: Date; consumed_at: Date | null; field_ref: string }>(
          `SELECT action_scope,installation_id,installation_generation::text,session_id,session_nonce,request_sha256,expires_at,consumed_at,field_ref
           FROM ${s}.media_input_pending_grants WHERE action_id=$1 FOR UPDATE`, [request.actionId])).rows[0];
        const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        if (!grant || !grant.consumed_at || grant.expires_at <= now || grant.installation_id !== session.installationId
          || grant.installation_generation !== session.installationGeneration.toString() || grant.session_id !== session.sessionId
          || request.requestId !== request.actionId) denied();
        const scope = this.parseScope(grant.action_scope);
        const current = await this.loadCurrent(scope, c);
        if (current.sessionId !== session.sessionId || current.installationId !== session.installationId
          || current.installationGeneration !== session.installationGeneration) denied();
        const enrolled = await this.enrolledKey(session.installationId, session.installationGeneration, c);
        const parsed = parseStatusFrame(frame);
        if ((parsed.phase === 3 && !["login", "password"].includes(grant.field_ref))
          || (parsed.phase === 4 && grant.field_ref !== "submit_login")
          || ([1, 2].includes(parsed.phase) && grant.field_ref === "submit_login")
          || parsed.deviceId !== scope.deviceId || parsed.installationId !== session.installationId
          || parsed.installationGeneration !== session.installationGeneration || parsed.sessionNonce.length !== grant.session_nonce.length
          || !timingSafeEqual(parsed.sessionNonce, grant.session_nonce) || parsed.requestId !== request.requestId || parsed.actionId !== request.actionId
          || parsed.requestDigest.length !== grant.request_sha256.length || !timingSafeEqual(parsed.requestDigest, grant.request_sha256)
          || !verifyStatus(enrolled.publicKey, parsed.prefix, parsed.signature)) denied();
        const frameDigest = hash(frame);
        const old = (await c.query<{ sequence: string; frame_sha256: Buffer; phase: number }>(
          `SELECT sequence::text,frame_sha256,phase FROM ${s}.media_input_status_receipts WHERE action_id=$1 AND sequence=$2`,
          [request.actionId, parsed.sequence.toString()])).rows[0];
        if (old) {
          if (old.phase !== parsed.phase || !old.frame_sha256.equals(frameDigest)) denied();
          return { decision: "accepted" as const, requestId: request.requestId, actionId: request.actionId, phase: parsed.phase };
        }
        const last = (await c.query<{ sequence: string }>(`SELECT sequence::text FROM ${s}.media_input_status_receipts WHERE action_id=$1 ORDER BY sequence DESC LIMIT 1`, [request.actionId])).rows[0];
        if (parsed.sequence !== BigInt(last?.sequence ?? "0") + 1n) denied();
        await c.query(`INSERT INTO ${s}.media_input_status_receipts(action_id,sequence,phase,status_frame,frame_sha256)
          VALUES($1,$2,$3,$4,$5)`, [request.actionId, parsed.sequence.toString(), parsed.phase, frame, frameDigest]);
        return { decision: "accepted" as const, requestId: request.requestId, actionId: request.actionId, phase: parsed.phase };
      });
    } finally { frame.fill(0); }
  }

  async priorPasswordReceipt(scope: MediaInputScope, current: CurrentMediaInputAuthority) {
    const query = this.pool;
    const row = (await query.query<{ action_scope: unknown; hello_proof_frame: Buffer; status_frame: Buffer }>(
      `SELECT g.action_scope,g.hello_proof_frame,r.status_frame FROM ${s}.media_input_pending_grants g
       JOIN ${s}.media_input_status_receipts r ON r.action_id=g.action_id AND r.phase=3
       WHERE g.field_ref='password' AND g.account_id=$1 AND g.platform=$2 AND g.credential_id=$3 AND g.credential_revision=$4
         AND g.project_id=$5 AND g.device_id=$6 AND g.task_id=$7 AND g.task_attempt_id=$8 AND g.authorization_id=$9
         AND g.holder_id=$10 AND g.control_generation=$11 AND g.installation_id=(SELECT installation_id FROM ${s}.device_associations WHERE device_id=$6 AND ended_at IS NULL)
         AND g.installation_id=$12 AND g.installation_generation=$13 AND g.session_id=$14
         AND g.consumed_at IS NOT NULL AND g.expires_at>clock_timestamp()
       ORDER BY r.sequence DESC LIMIT 2`, [scope.accountId, scope.platform, scope.credentialId, scope.expectedRevision.toString(), scope.projectId,
        scope.deviceId, scope.taskId, scope.taskAttemptId, scope.authorizationId, scope.holderId, scope.controlGeneration.toString(),
        current.installationId, current.installationGeneration.toString(), current.sessionId])).rows;
    if (row.length !== 1) denied();
    const passwordScope = this.parseScope(row[0]!.action_scope);
    if (passwordScope.fieldRef !== "password") denied();
    return { passwordScope: passwordScope as MediaInputScope & { fieldRef: "password" }, helloProofFrame: Buffer.from(row[0]!.hello_proof_frame), statusFrame: Buffer.from(row[0]!.status_frame) };
  }

  async loadCurrent(scopeInput: MediaInputActionScope, cInput?: PoolClient): Promise<CurrentMediaInputAuthority> {
    const scope = this.parseScope(scopeInput);
    const work = async (c: PoolClient): Promise<CurrentMediaInputAuthority> => {
      const locator = (await c.query<{ project_id: string; task_id: string }>(
        `SELECT task_id,project_id FROM ${s}.artemis_preparation_intents WHERE task_attempt_id=$1`, [scope.taskAttemptId])).rows[0];
      if (!locator || locator.task_id !== scope.taskId || locator.project_id !== scope.projectId) denied();
      await c.query(`LOCK TABLE ${s}.operators IN SHARE MODE`);
      const resourceVersion = (await c.query<{ version: string }>(`SELECT version::text FROM ${s}.resource_reservation_guard WHERE singleton=true FOR SHARE`)).rows[0]?.version;
      if (!resourceVersion) denied();
      const project = (await c.query<{ fact_version: string; phase: string }>(`SELECT fact_version::text,phase FROM ${s}.projects WHERE project_id=$1 FOR SHARE`, [scope.projectId])).rows[0];
      const task = (await c.query<{ task_version: string; selected_account_id: string | null; selected_device_id: string | null; intent: unknown;
        intent_digest: string; requested_by: string; state: string; next_operation_id: string | null }>(
        `SELECT task_version::text,selected_account_id,selected_device_id,intent,intent_digest,requested_by,state,next_operation_id
         FROM ${s}.account_preparation_tasks WHERE task_id=$1 AND project_id=$2 FOR SHARE`, [scope.taskId, scope.projectId])).rows[0];
      if (!project || project.phase !== "preparing" || !task || task.state !== "waiting_executor" || task.next_operation_id !== scope.operationKind
        || task.selected_account_id !== scope.accountId || task.selected_device_id !== scope.deviceId
        || scope.authorizationId !== scope.taskId) denied();
      if ((await c.query(`SELECT 1 FROM ${s}.operators WHERE operator_id=$1 AND status='active' FOR SHARE`, [task.requested_by])).rowCount !== 1) denied();
      const intent = accountPreparationIntentSchema.parse(task.intent);
      if (hash(Buffer.from(canonical(intent))).toString("hex") !== task.intent_digest) denied();
      const assignment = (await c.query<{ project_id: string; device_id: string; state: string; handover_requested: boolean; platform: string }>(
        `SELECT project_id,device_id,state,handover_requested,platform FROM ${s}.project_media_account_assignments
         WHERE account_id=$1 FOR SHARE`, [scope.accountId])).rows[0];
      const account = (await c.query<{ platform: string }>(
        `SELECT platform FROM ${s}.media_accounts WHERE account_id=$1 FOR SHARE`, [scope.accountId])).rows[0];
      if (!assignment || !account || assignment.project_id !== scope.projectId || assignment.device_id !== scope.deviceId
        || assignment.platform !== scope.platform || account.platform !== scope.platform || assignment.state !== "pending_initialization"
        || assignment.handover_requested || intent.target.platform !== scope.platform) denied();
      const credential = (await c.query<{ credential_id: string; revision: string; state: string }>(
        `SELECT h.credential_id,h.revision::text,r.state FROM ${s}.media_credentials h
         JOIN ${s}.media_credential_revisions r
           ON (h.credential_id,h.account_id,h.platform,h.revision)=(r.credential_id,r.account_id,r.platform,r.revision)
         WHERE h.account_id=$1 AND h.platform=$2 FOR SHARE OF h,r`, [scope.accountId, scope.platform])).rows[0];
      if (!credential || credential.credential_id !== scope.credentialId || BigInt(credential.revision) !== scope.expectedRevision
        || credential.state !== "stored_unverified") denied();
      const launch = (await c.query<{ assignment: unknown; fingerprint: string; task_version: string; operation_id: string }>(
        `SELECT assignment,fingerprint,task_version::text,operation_id FROM ${s}.artemis_preparation_intents
         WHERE task_attempt_id=$1 AND task_id=$2 FOR SHARE`, [scope.taskAttemptId, scope.taskId])).rows[0];
      if (!launch) denied();
      const artemis = artemisPreparationAssignmentSchema.parse(launch.assignment);
      if (hash(Buffer.from(JSON.stringify(artemis))).toString("hex") !== launch.fingerprint || launch.operation_id !== scope.operationKind
        || artemis.operationId !== scope.operationKind || artemis.taskAttemptId !== scope.taskAttemptId || artemis.taskId !== scope.taskId
        || String(artemis.taskVersion) !== task.task_version || launch.task_version !== task.task_version
        || artemis.input.accountId !== scope.accountId || artemis.input.deviceId !== scope.deviceId || artemis.input.projectId !== scope.projectId
        || artemis.serial !== scope.serial) denied();
      const association = (await c.query<{ association_id: string; provider_id: string; installation_id: string }>(
        `SELECT association_id,provider_id,installation_id FROM ${s}.device_associations WHERE device_id=$1 AND ended_at IS NULL FOR SHARE`, [scope.deviceId])).rows[0];
      if (!association || (await c.query(`SELECT 1 FROM ${s}.providers WHERE provider_id=$1 AND status='active' FOR SHARE`, [association.provider_id])).rowCount !== 1) denied();
      const installation = (await c.query<{ generation: string }>(`SELECT generation::text FROM ${s}.installations WHERE installation_id=$1 AND status='active' FOR SHARE`, [association.installation_id])).rows[0];
      const device = (await c.query<{ state: string; fact_version: string }>(`SELECT state,fact_version::text FROM ${s}.devices WHERE device_id=$1 FOR SHARE`, [scope.deviceId])).rows[0];
      if (!installation || !device || !["associated_pending_access", "access_ready"].includes(device.state)) denied();
      const enrollment = (await c.query<{ phase: string; record: unknown; generation: string; association_id: string; provider_id: string;
        version: string; candidate_node_id: string }>(
        `SELECT phase,record,generation::text,association_id,provider_id,version::text,candidate_node_id
         FROM ${s}.network_enrollments WHERE device_id=$1 AND phase='admitted' FOR SHARE`, [scope.deviceId])).rows[0];
      if (!enrollment) denied();
      const admitted = parseAdmissionRecord(enrollment.record);
      if (!admitted.authority.eligible || admitted.authority.deviceId !== scope.deviceId || admitted.authority.installationId !== association.installation_id
        || admitted.authority.installationGeneration !== installation.generation || admitted.authority.enrollmentGeneration !== enrollment.generation
        || admitted.authority.ownershipVersion !== device.fact_version
        || enrollment.association_id !== association.association_id || enrollment.provider_id !== association.provider_id
        || String(admitted.version) !== enrollment.version || !admitted.node || admitted.node.nodeId !== enrollment.candidate_node_id
        || admitted.credentialRevoked || admitted.nodeAccessRevoked) denied();
      const rawControl = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_journals WHERE device_id=$1 FOR SHARE`, [scope.deviceId])).rows[0];
      if (!rawControl) denied();
      const control = parsePhoneControlRecord(rawControl.record), call = control.calls.find(v => v.actionId === scope.actionId);
      if (control.deviceId !== scope.deviceId || control.disposition !== "enabled" || control.holderId !== scope.holderId
        || control.controlGeneration !== scope.controlGeneration.toString() || !call || call.status !== "running"
        || call.holderId !== scope.holderId || call.controlGeneration !== control.controlGeneration) denied();
      const grantRow = (await c.query<{ record: unknown }>(`SELECT record FROM ${s}.phone_control_holder_grants WHERE holder_id=$1 AND device_id=$2`, [scope.holderId, scope.deviceId])).rows[0];
      if (!grantRow) denied();
      const holder = z.strictObject({ holderId: uuid, deviceId: uuid, controlGeneration: admissionGenerationSchema,
        taskAttemptId: uuid, authorizationId: uuid, holderKind: z.literal("executor"), purpose: z.literal("business"), operation: z.literal("initialize"),
        allowedKinds: z.array(z.string()), leaseUntil: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }) }).passthrough().parse(grantRow.record);
      const expectedActionKind = scope.fieldRef === "submit_login" ? "submit_login" : "write_input";
      if (holder.taskAttemptId !== scope.taskAttemptId || holder.authorizationId !== scope.authorizationId || holder.allowedKinds.length === 0
        || !holder.allowedKinds.includes(expectedActionKind)) denied();
      const request = { protocolVersion: "2026-09-30.control-v1", deviceId: scope.deviceId, holderId: scope.holderId,
        controlGeneration: scope.controlGeneration.toString(), authorizationId: scope.authorizationId, taskAttemptId: scope.taskAttemptId,
        actionId: scope.actionId, purpose: "business", kind: expectedActionKind,
        ...(scope.fieldRef === "submit_login" ? { targetViewIdResourceName: scope.targetViewIdResourceName } : { fieldRef: scope.fieldRef }) };
      const commandDigest = hash(Buffer.from(canonical({ kind: "begin_call", request }), "utf8"));
      const command = (await c.query<{ kind: string; payload_digest: Buffer }>(`SELECT kind,payload_digest FROM ${s}.phone_control_commands WHERE device_id=$1 AND request_key=$2`,
        [scope.deviceId, `begin_${scope.actionId.replaceAll("-", "")}`])).rows[0];
      if (!command || command.kind !== "begin_call" || !command.payload_digest.equals(commandDigest)) denied();
      const sessionRow = (await c.query<{ session_id: string; expires_at: Date }>(
        `SELECT session.session_id,session.expires_at FROM ${s}.local_participation participation
         JOIN ${s}.installation_sessions session ON session.session_id=participation.receipt_session_id
         WHERE participation.device_id=$1 AND participation.receipt IS NOT NULL AND session.installation_id=$2
           AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()`, [scope.deviceId, association.installation_id])).rows[0];
      const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
      const participation = await loadCurrentLocalParticipation(c, scope.deviceId, now);
      if (Date.parse(admitted.expiresAt) <= now.getTime()) denied();
      if (!sessionRow || !participation || participation.scope.installationId !== association.installation_id
        || participation.scope.installationGeneration !== installation.generation || participation.scope.controlGeneration !== control.controlGeneration) denied();
      const currentSession = (await c.query<{ session_id: string; expires_at: Date; revoked_at: Date | null }>(
        `SELECT session_id,expires_at,revoked_at FROM ${s}.installation_sessions WHERE session_id=$1 AND installation_id=$2`,
        [sessionRow.session_id, association.installation_id])).rows[0];
      if (!currentSession || currentSession.revoked_at || currentSession.expires_at <= now) denied();
      const enrolledKey = await this.enrolledKey(association.installation_id, BigInt(installation.generation), c);
      const leaseUntilMillis = BigInt(Date.parse(holder.leaseUntil));
      const holderGrantValidUntilMillis = BigInt(Date.parse(holder.validUntil));
      if (leaseUntilMillis <= BigInt(now.getTime()) || holderGrantValidUntilMillis <= BigInt(now.getTime())) denied();
      const snapshot = hash(Buffer.from(canonical({ scope, credential, resourceVersion, projectVersion: project.fact_version, taskVersion: task.task_version,
        accountAssignment: assignment, launch: launch.fingerprint, association, installationGeneration: installation.generation,
        deviceState: device.state, enrollmentGeneration: enrollment.generation, enrollmentVersion: admitted.version,
        enrollmentExpiry: admitted.expiresAt, node: admitted.node, formalEvidenceId: admitted.formalEvidenceId,
        controlVersion: control.version,
        controlGeneration: control.controlGeneration, holder, actionDigest: commandDigest.toString("hex"),
        sessionId: currentSession.session_id, sessionExpiresAt: currentSession.expires_at.toISOString(),
        participationRunId: participation.runId, participationValidUntil: participation.validUntil }))).toString("hex");
      return { scope, installationId: association.installation_id, installationGeneration: BigInt(installation.generation),
        sessionId: currentSession.session_id, sessionExpiresAt: currentSession.expires_at, leaseUntilMillis, holderGrantValidUntilMillis,
        participationValidUntil: new Date(participation.validUntil), databaseNow: now, enrolledKey, snapshot };
    };
    if (cInput) return work(cInput);
    return tx(this.pool, work);
  }
}

function cryptoRandomUuid(): string { return randomUUID(); }

interface ParsedStatus { deviceId: string; installationId: string; installationGeneration: bigint; sessionNonce: Buffer; requestId: string;
  actionId: string; requestDigest: Buffer; sequence: bigint; phase: number; prefix: Buffer; signature: Buffer }
function readUuid(bytes: Buffer, offset: number): string {
  const h = bytes.subarray(offset, offset + 16).toString("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function parseStatusFrame(frame: Buffer): ParsedStatus {
  const prefixLength = 150;
  if (frame.length < prefixLength + 9 || frame.length > prefixLength + 73 || frame.toString("ascii", 0, 4) !== "SGMS" || frame[4] !== 1) invalid();
  const signatureLength = frame[prefixLength]!;
  if (signatureLength < 8 || signatureLength > 72 || frame.length !== prefixLength + 1 + signatureLength) invalid();
  const signature = frame.subarray(prefixLength + 1);
  if (!canonicalP256Der(signature)) invalid();
  const phase = frame[149]!; if (phase < 1 || phase > 6) invalid();
  const sequence = frame.readBigUInt64BE(141); if (sequence < 1n || sequence > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return { deviceId: readUuid(frame, 5), installationId: readUuid(frame, 21), installationGeneration: frame.readBigUInt64BE(37),
    sessionNonce: Buffer.from(frame.subarray(45, 77)), requestId: readUuid(frame, 77), actionId: readUuid(frame, 93),
    requestDigest: Buffer.from(frame.subarray(109, 141)), sequence, phase, prefix: frame.subarray(0, prefixLength), signature };
}
function verifyStatus(key: KeyObject, prefix: Buffer, signature: Buffer): boolean {
  return verify("sha256", Buffer.concat([Buffer.from("SG-MEDIA-CREDENTIAL-INPUT-STATUS-V1\0", "ascii"), prefix]),
    { key, dsaEncoding: "der" }, signature);
}
