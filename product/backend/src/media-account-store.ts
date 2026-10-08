import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  contractVersion, createMediaAccountRequestSchema, mediaAccountCommandLookupResponseSchema,
  mediaAccountListResponseSchema, updateMediaAccountRequestSchema, type MediaAccount,
} from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { MediaCredentialKeyCustodian } from "./media-credential-key-custodian.js";
import type { MediaCredentialWriteKeys } from "./media-credential-store.js";
import { sealMediaCredentialPayload, type MediaCredentialKey } from "./media-credential-envelope.js";

const s = "socialgrowth_product", id = z.string().uuid().refine(v => v === v.toLowerCase());
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Controlled media account service unavailable", true);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Media account facts changed; read and check current facts");
const invalid = () => new ProductTransactionError("INPUT_INVALID", "Invalid media account request");
const copyKeys = (source: MediaCredentialWriteKeys): MediaCredentialWriteKeys => ({
  encryption: { keyId: source.encryption.keyId, key: Buffer.from(source.encryption.key) },
  currentDigestKeyId: source.currentDigestKeyId,
  digestKeys: source.digestKeys.map(key => ({ keyId: key.keyId, key: Buffer.from(key.key) })),
});
const keyBuffers = (keys: MediaCredentialWriteKeys) => [keys.encryption.key, ...keys.digestKeys.map(key => key.key)];
function commandDigest(kind: string, request: unknown, secret: Buffer | undefined, key: MediaCredentialKey): Buffer {
  const hmac = createHmac("sha256", key.key).update("SocialGrowth/media-account-command/v1\0").update(kind).update("\0");
  hmac.update(JSON.stringify(request)); hmac.update("\0"); if (secret) hmac.update(secret); return hmac.digest();
}
function snapshotKeys(source: MediaCredentialKeyCustodian | MediaCredentialWriteKeys | null): MediaCredentialWriteKeys | null {
  if (source instanceof MediaCredentialKeyCustodian) {
    let snapshot: MediaCredentialWriteKeys | null = null;
    try { source.withWriteKeys(keys => { snapshot = copyKeys(keys); }); } catch { return null; }
    return snapshot;
  }
  if (!source) return null;
  try { return copyKeys(source); } catch { return null; }
}
function metadata(value: unknown): MediaAccount {
  return value as MediaAccount;
}

export class MediaAccountStore {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService,
    private readonly keys: MediaCredentialKeyCustodian | MediaCredentialWriteKeys | null = null) {}
  private async tx<T>(token: string, csrf: string | null, fn: (client: PoolClient, actor: string, sessionId: string) => Promise<T>): Promise<T> {
    let client: PoolClient; try { client = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      await client.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(client, token, csrf ?? undefined, csrf !== null);
      if ((await client.query(`SELECT 1 FROM ${s}.resource_reservation_guard WHERE singleton=true FOR UPDATE`)).rowCount !== 1) throw unavailable();
      const value = await fn(client, context.operator.operatorId, context.sessionId);
      if ((await client.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId])).rowCount !== 1)
        throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await client.query("COMMIT"); return value;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof ProductTransactionError) throw error; throw unavailable();
    } finally { client.release(); }
  }
  private async version(c: PoolClient) {
    const version = Number((await c.query<{ version: string }>(`SELECT version::text FROM ${s}.resource_reservation_guard WHERE singleton=true`)).rows[0]?.version);
    if (!Number.isSafeInteger(version) || version < 0) throw unavailable(); return version;
  }
  private async readAccounts(c: PoolClient): Promise<MediaAccount[]> {
    const result = await c.query(`SELECT a.account_id AS "accountId",a.platform,a.display_name AS "displayName",
      a.login_identifier AS "loginIdentifier",a.canonical_account_ref AS "canonicalAccountRef",
      a.legacy_declared_canonical_account_ref AS "legacyDeclaredCanonicalAccountRef",a.persona,
      a.parent_login_verification AS "parentLoginVerification",c.credential_id AS "credentialId",
      c.revision::text AS "credentialRevision",cr.state AS "credentialState",
      i.identities,coalesce(x.assignment,y.assignment) AS reservation
      FROM ${s}.media_accounts a
      LEFT JOIN ${s}.media_credentials c ON c.account_id=a.account_id AND c.platform=a.platform
      LEFT JOIN ${s}.media_credential_revisions cr ON (cr.credential_id,cr.account_id,cr.platform,cr.revision)=(c.credential_id,c.account_id,c.platform,c.revision)
      LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('identityId',p.identity_id,'canonicalIdentityRef',p.canonical_identity_ref,
        'verificationState',CASE WHEN EXISTS (SELECT 1 FROM ${s}.account_identity_verifications v
          WHERE v.identity_id=p.identity_id AND v.credential_id=c.credential_id AND v.credential_revision=c.revision
            AND lower(v.login_identifier)=a.normalized_login_identifier AND cr.state='stored_unverified'
            AND a.parent_login_verification='verified') THEN 'verified' ELSE 'registered_unverified' END,
        'managementState',CASE WHEN EXISTS (SELECT 1 FROM ${s}.account_identity_verifications v
          WHERE v.identity_id=p.identity_id AND v.credential_id=c.credential_id AND v.credential_revision=c.revision
            AND lower(v.login_identifier)=a.normalized_login_identifier AND cr.state='stored_unverified'
            AND a.parent_login_verification='verified') THEN 'managed' ELSE 'unknown' END) ORDER BY p.identity_id) AS identities
        FROM ${s}.publishing_identities p WHERE p.account_id=a.account_id) i ON true
      LEFT JOIN LATERAL (SELECT jsonb_build_object('projectId',r.project_id,'deviceId',r.device_id,'state',r.state,
        'handoverRequested',r.handover_requested) AS assignment FROM ${s}.project_media_account_assignments r WHERE r.account_id=a.account_id) x ON true
      LEFT JOIN LATERAL (SELECT jsonb_build_object('projectId',r.project_id,'deviceId',ir.device_id,'state','pending_initialization',
        'handoverRequested',false) AS assignment FROM ${s}.project_account_reservations r JOIN ${s}.project_identity_reservations ir USING(account_id,project_id)
        WHERE r.account_id=a.account_id ORDER BY ir.reserved_at LIMIT 1) y ON true
      ORDER BY a.account_id LIMIT 1001`);
    if (result.rows.length > 1000) throw unavailable();
    return result.rows.map(row => metadata({ accountId: row.accountId, platform: row.platform, displayName: row.displayName ?? `历史账号 ${String(row.accountId).slice(0, 8)}`,
      loginIdentifier: row.loginIdentifier, canonicalAccountRef: row.canonicalAccountRef, legacyDeclaredCanonicalAccountRef: row.legacyDeclaredCanonicalAccountRef,
      persona: row.persona, parentLoginVerification: row.parentLoginVerification,
      credential: row.credentialId === null ? null : { credentialId: row.credentialId, revision: Number(row.credentialRevision), state: row.credentialState },
      publishingIdentities: row.identities ?? [], reservation: row.reservation }));
  }
  async read(token: string) {
    return this.tx(token, null, async c => mediaAccountListResponseSchema.parse({ contractVersion, resourceVersion: await this.version(c), accounts: await this.readAccounts(c) }));
  }
  async lookup(token: string, rawKey: unknown) {
    const key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$(?![\s\S])/).safeParse(rawKey); if (!key.success) throw invalid();
    return this.tx(token, null, async (c, actor) => {
      const row = (await c.query<{ command_kind: string; account_id: string }>(`SELECT command_kind,account_id FROM ${s}.media_account_commands WHERE actor_id=$1 AND request_key=$2`, [actor, key.data])).rows[0];
      return row ? mediaAccountCommandLookupResponseSchema.parse({ contractVersion, state: "applied", commandKind: row.command_kind,
        accountId: row.account_id, resourceVersion: await this.version(c) }) : mediaAccountCommandLookupResponseSchema.parse({ contractVersion, state: "not_found" });
    });
  }
  async create(token: string, csrf: string, raw: unknown) {
    const parsed = createMediaAccountRequestSchema.safeParse(raw); if (!parsed.success) throw invalid();
    const r = parsed.data, secret = Buffer.from(JSON.stringify({ login: r.loginIdentifier, password: r.password }), "utf8");
    let keys = snapshotKeys(this.keys);
    try {
      return await this.tx(token, csrf, async (c, actor) => {
        if (!keys) throw unavailable();
        const sharedKey = await c.query(`SELECT 1 FROM ${s}.media_registry_commands WHERE actor_id=$1 AND request_key=$2
          UNION ALL SELECT 1 FROM ${s}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, r.metadata.idempotencyKey]);
        if (sharedKey.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another resource command");
        const digestKey = keys.digestKeys.find(item => item.keyId === keys!.currentDigestKeyId); if (!digestKey) throw unavailable();
        const digest = commandDigest("account_create", r, secret, digestKey), old = (await c.query<{ command_kind: string; payload_digest: Buffer; account_id: string }>(
          `SELECT command_kind,payload_digest,account_id FROM ${s}.media_account_commands WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rows[0];
        const version = await this.version(c);
        if (old) {
          if (old.command_kind !== "account_create" || old.payload_digest.length !== digest.length || !timingSafeEqual(old.payload_digest, digest))
            throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Media account command key already used");
          const account = (await this.readAccounts(c)).find(row => row.accountId === old.account_id); if (!account) throw stale();
          return { contractVersion, resourceVersion: version, account, changed: false, replayed: true, actionPermissionGranted: false, publicationAllowed: false };
        }
        if (version !== r.expectedResourceVersion || version === Number.MAX_SAFE_INTEGER) throw stale();
        const duplicate = await c.query(`SELECT 1 FROM ${s}.media_accounts WHERE platform=$1 AND normalized_login_identifier=lower(btrim($2))`, [r.platform, r.loginIdentifier]);
        if (duplicate.rowCount) throw stale();
        const accountId = randomUUID(), credentialId = randomUUID(), revision = 1;
        const envelope = sealMediaCredentialPayload(secret, { accountId, credentialId, platform: r.platform, revision }, keys.encryption);
        const write = async (query: string, values: unknown[]) => { if ((await c.query(query, values)).rowCount !== 1) throw unavailable(); };
        await write(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref,display_name,login_identifier,normalized_login_identifier,legacy_declared_canonical_account_ref,persona,parent_login_verification)
          VALUES($1,$2,NULL,$3,$4,lower(btrim($4)),NULL,$5,'registered_unverified')`, [accountId, r.platform, r.displayName, r.loginIdentifier, r.persona ?? null]);
        await write(`INSERT INTO ${s}.media_credential_revisions(credential_id,account_id,platform,revision,state,encryption_key_id,envelope,recorded_by) VALUES($1,$2,$3,$4,'stored_unverified',$5,$6,$7)`,
          [credentialId, accountId, r.platform, revision, envelope.keyId, envelope, actor]);
        await write(`INSERT INTO ${s}.media_credentials(credential_id,account_id,platform,revision) VALUES($1,$2,$3,$4)`, [credentialId, accountId, r.platform, revision]);
        await write(`UPDATE ${s}.resource_reservation_guard SET version=version+1 WHERE singleton=true`, []);
        await write(`INSERT INTO ${s}.media_account_commands(actor_id,request_key,command_kind,payload_digest,digest_key_id,account_id,applied_version) VALUES($1,$2,'account_create',$3,$4,$5,$6)`,
          [actor, r.metadata.idempotencyKey, digest, digestKey.keyId, accountId, version + 1]);
        await write(`INSERT INTO ${s}.media_credential_commands(actor_id,request_key,digest_key_id,payload_digest,credential_id,account_id,platform,applied_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [actor, r.metadata.idempotencyKey, digestKey.keyId, digest, credentialId, accountId, r.platform, revision]);
        await write(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'resource.media_account_created','media_account',$3,$4,$5)`,
          [randomUUID(), actor, accountId, r.metadata.requestId, { platform: r.platform, credentialId, credentialRevision: revision, state: "registered_unverified", resourceVersion: version + 1 }]);
        const account = (await this.readAccounts(c)).find(row => row.accountId === accountId); if (!account) throw unavailable();
        return { contractVersion, resourceVersion: version + 1, account, changed: true, replayed: false, actionPermissionGranted: false, publicationAllowed: false };
      });
    } finally { secret.fill(0); if (keys) for (const buffer of keyBuffers(keys)) buffer.fill(0); }
  }
  async updateProfile(token: string, csrf: string, accountIdInput: unknown, raw: unknown) {
    const accountId = id.safeParse(accountIdInput), parsed = updateMediaAccountRequestSchema.safeParse(raw);
    if (!accountId.success || !parsed.success) throw invalid(); const r = parsed.data;
    const keys = snapshotKeys(this.keys);
    try {
      return await this.tx(token, csrf, async (c, actor) => {
        if (!keys) throw unavailable(); const digestKey = keys.digestKeys.find(item => item.keyId === keys.currentDigestKeyId); if (!digestKey) throw unavailable();
        const sharedKey = await c.query(`SELECT 1 FROM ${s}.media_registry_commands WHERE actor_id=$1 AND request_key=$2
          UNION ALL SELECT 1 FROM ${s}.resource_reservation_commands WHERE actor_id=$1 AND request_key=$2 LIMIT 1`, [actor, r.metadata.idempotencyKey]);
        if (sharedKey.rowCount) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Request key belongs to another resource command");
        const version = await this.version(c), digest = commandDigest("profile_update", { accountId: accountId.data, ...r }, undefined, digestKey);
        const old = (await c.query<{ command_kind: string; payload_digest: Buffer; account_id: string }>(`SELECT command_kind,payload_digest,account_id FROM ${s}.media_account_commands WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rows[0];
        if (old) {
          if (old.command_kind !== "profile_update" || old.account_id !== accountId.data || !timingSafeEqual(old.payload_digest, digest)) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Media account command key already used");
          const account = (await this.readAccounts(c)).find(row => row.accountId === accountId.data); if (!account) throw stale();
          return { contractVersion, resourceVersion: version, account, changed: false, replayed: true, actionPermissionGranted: false, publicationAllowed: false };
        }
        if (version !== r.expectedResourceVersion || version === Number.MAX_SAFE_INTEGER) throw stale();
        const update = await c.query(`UPDATE ${s}.media_accounts SET display_name=$2,persona=$3 WHERE account_id=$1`, [accountId.data, r.displayName, r.persona]);
        if (update.rowCount !== 1) throw stale();
        await c.query(`UPDATE ${s}.resource_reservation_guard SET version=version+1 WHERE singleton=true`);
        await c.query(`INSERT INTO ${s}.media_account_commands(actor_id,request_key,command_kind,payload_digest,digest_key_id,account_id,applied_version) VALUES($1,$2,'profile_update',$3,$4,$5,$6)`, [actor, r.metadata.idempotencyKey, digest, digestKey.keyId, accountId.data, version + 1]);
        await c.query(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'resource.media_account_profile_updated','media_account',$3,$4,$5)`,
          [randomUUID(), actor, accountId.data, r.metadata.requestId, { resourceVersion: version + 1 }]);
        const account = (await this.readAccounts(c)).find(row => row.accountId === accountId.data); if (!account) throw unavailable();
        return { contractVersion, resourceVersion: version + 1, account, changed: true, replayed: false, actionPermissionGranted: false, publicationAllowed: false };
      });
    } finally { if (keys) for (const buffer of keyBuffers(keys)) buffer.fill(0); }
  }
}
