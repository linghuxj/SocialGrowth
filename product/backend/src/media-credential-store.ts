import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { requestMetadataSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { MediaCredentialKeyCustodian } from "./media-credential-key-custodian.js";
import { maxMediaCredentialPayloadBytes, sealMediaCredentialPayload, type MediaCredentialKey } from "./media-credential-envelope.js";

const s = "socialgrowth_product", id = uuidSchema.length(36).refine(v => v === v.toLowerCase());
const commandSchema = z.strictObject({ metadata: requestMetadataSchema, credentialId: id, accountId: id,
  platform: z.enum(["facebook", "youtube"]), expectedRevision: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  operation: z.enum(["put", "invalidate"]) });
const metadataSchema = z.strictObject({ credentialId: id, accountId: id, platform: z.enum(["facebook", "youtube"]),
  revision: z.int().min(1).max(Number.MAX_SAFE_INTEGER), state: z.enum(["stored_unverified", "invalidated"]),
  actionPermissionGranted: z.literal(false), acceptanceStarted: z.literal(false) });
export type MediaCredentialMetadata = z.infer<typeof metadataSchema>;
export interface MediaCredentialWriteKeys {
  encryption: MediaCredentialKey;
  currentDigestKeyId: string;
  digestKeys: readonly MediaCredentialKey[];
}
const unavailable = () => new ProductTransactionError("INTERNAL_ERROR", "Controlled credential service unavailable", true);
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Controlled credential facts changed");
const invalid = () => new ProductTransactionError("INPUT_INVALID", "Invalid controlled credential request");
function snapshotKeys(input: MediaCredentialWriteKeys | null): MediaCredentialWriteKeys {
  const keys: Buffer[] = [];
  const copy = (v: MediaCredentialKey) => {
    if (!/^[A-Za-z0-9_-]{1,100}$(?![\s\S])/.test(v.keyId) || !Buffer.isBuffer(v.key) || v.key.length !== 32) throw unavailable();
    const key = Buffer.from(v.key); keys.push(key); return { keyId: v.keyId, key };
  };
  try {
    if (!input || !Array.isArray(input.digestKeys) || input.digestKeys.length < 1 || input.digestKeys.length > 16) throw unavailable();
    const encryption = copy(input.encryption), digestKeys = Array.from(input.digestKeys, copy);
    if (new Set(digestKeys.map(v => v.keyId)).size !== digestKeys.length || !digestKeys.some(v => v.keyId === input.currentDigestKeyId)
      || digestKeys.some(v => v.key.equals(encryption.key))) throw unavailable();
    return { encryption, digestKeys, currentDigestKeyId: input.currentDigestKeyId };
  } catch { for (const key of keys) key.fill(0); throw unavailable(); }
}
function intentDigest(r: z.infer<typeof commandSchema>, payload: Buffer | undefined, key: MediaCredentialKey): Buffer {
  // Domain-separated keyed digest: a database reader cannot brute-force a
  // password against a plain SHA manifest. requestId alone is not the intent.
  const hmac = createHmac("sha256", key.key);
  hmac.update("SocialGrowth/media-credential-command/v1\0");
  hmac.update(JSON.stringify({ credentialId: r.credentialId, accountId: r.accountId, platform: r.platform,
    expectedRevision: r.expectedRevision, operation: r.operation, metadata: { contractVersion: r.metadata.contractVersion, idempotencyKey: r.metadata.idempotencyKey } }));
  hmac.update("\0"); if (payload) hmac.update(payload); return hmac.digest();
}
// SERVER-ONLY metadata/write port, deliberately NOT registered in AppModule or
// exported as an HTTP/phone/model consumer. Keys are supplied explicitly by a
// trusted owner; no default/env/file/historical-secret loading or plaintext GET.
// Historical ciphertext is retained for audit/controlled recovery, NOT usable
// through this port. A future sink needs current authorization/revision again.
export class MediaCredentialStore {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService,
    private readonly keys: MediaCredentialWriteKeys | MediaCredentialKeyCustodian | null = null) {}
  private async transaction<T>(token: string, csrf: string | null,
    fn: (client: PoolClient, actor: string) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw unavailable(); }
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      // Preserve resource/project metadata ordering; no phone lease or network
      // calls inside this short transaction, and no resource version mutation.
      await client.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const context = await this.auth.authenticateSessionInTransaction(client, token, csrf ?? undefined, csrf !== null);
      const guard = await client.query(`SELECT 1 FROM ${s}.resource_reservation_guard WHERE singleton=true FOR UPDATE`);
      if (guard.rowCount !== 1) throw unavailable();
      const result = await fn(client, context.operator.operatorId);
      const valid = await client.query(`SELECT 1 FROM ${s}.operator_sessions WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [context.sessionId]);
      if (valid.rowCount !== 1) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired");
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { throw unavailable(); }
      if (error instanceof ProductTransactionError) throw error;
      throw unavailable(); // Never surface driver errors, payloads or causes.
    } finally { client.release(); }
  }
  private async current(client: PoolClient, accountId: string): Promise<MediaCredentialMetadata | null> {
    // No SELECT envelope/login/password/keyId: even metadata read never fetches
    // encrypted secret bytes from PostgreSQL into the ordinary response path.
    const row = (await client.query(`SELECT h.credential_id AS "credentialId",h.account_id AS "accountId",h.platform,
      h.revision::text AS revision,r.state FROM ${s}.media_credentials h JOIN ${s}.media_credential_revisions r
      ON (h.credential_id,h.account_id,h.platform,h.revision)=(r.credential_id,r.account_id,r.platform,r.revision)
      WHERE h.account_id=$1`, [accountId])).rows[0];
    return row ? metadataSchema.parse({ ...row, revision: Number(row.revision), actionPermissionGranted: false, acceptanceStarted: false }) : null;
  }
  async read(token: string, accountId: unknown): Promise<MediaCredentialMetadata | null> {
    const parsed = id.safeParse(accountId); if (!parsed.success) throw invalid();
    return this.transaction(token, null, client => this.current(client, parsed.data));
  }
  async write(token: string, csrf: string, input: unknown, payloadInput?: unknown): Promise<{ credential: MediaCredentialMetadata; changed: boolean; replayed: boolean }> {
    const parsed = commandSchema.safeParse(input); if (!parsed.success) throw invalid();
    const r = parsed.data;
    let payload: Buffer | undefined, keys: MediaCredentialWriteKeys | undefined;
    try {
      if (r.operation === "put") {
        if (!Buffer.isBuffer(payloadInput) || payloadInput.length < 1 || payloadInput.length > maxMediaCredentialPayloadBytes) throw invalid();
        payload = Buffer.from(payloadInput); // Snapshot before any await; caller mutation cannot replace the intent.
      } else if (payloadInput !== undefined) throw invalid();
      // Snapshot owned keys before any await, but report unavailability only
      // AFTER actual operator/CSRF authentication below. Reads need no keys.
      try {
        if (this.keys instanceof MediaCredentialKeyCustodian) this.keys.withWriteKeys(input => { keys = snapshotKeys(input); });
        else keys = snapshotKeys(this.keys);
      } catch { keys = undefined; }
      return await this.transaction(token, csrf, async (client, actor) => {
        if (!keys) throw unavailable();
        const ownedKeys = keys;
        const command = (await client.query<{ payload_digest: Buffer; digest_key_id: string; credential_id: string; account_id: string; platform: string }>(
          `SELECT payload_digest,digest_key_id,credential_id,account_id,platform FROM ${s}.media_credential_commands WHERE actor_id=$1 AND request_key=$2`, [actor, r.metadata.idempotencyKey])).rows[0];
        const key = ownedKeys.digestKeys.find(k => k.keyId === (command?.digest_key_id ?? ownedKeys.currentDigestKeyId));
        if (!key) throw unavailable(); // Missing old digest key cannot turn a retry into a new command.
        const digest = intentDigest(r, payload, key), current = await this.current(client, r.accountId);
        if (command) {
          if (command.payload_digest.length !== digest.length || !timingSafeEqual(command.payload_digest, digest)) {
            throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Controlled credential request key already used");
          }
          if (!current || current.credentialId !== command.credential_id || current.accountId !== command.account_id || current.platform !== command.platform) throw stale();
          return { credential: current, changed: false, replayed: true }; // Current state, never resurrect an old secret.
        }
        const account = await client.query(`SELECT 1 FROM ${s}.media_accounts WHERE account_id=$1 AND platform=$2`, [r.accountId, r.platform]);
        if (account.rowCount !== 1 || (current?.revision ?? 0) !== r.expectedRevision
          || (current && (current.credentialId !== r.credentialId || current.platform !== r.platform)) || (!current && r.operation === "invalidate")) throw stale();
        const changed = r.operation === "put" || current!.state !== "invalidated";
        if (changed && r.expectedRevision === Number.MAX_SAFE_INTEGER) throw stale();
        const revision = r.expectedRevision + (changed ? 1 : 0), state = r.operation === "put" ? "stored_unverified" : "invalidated";
        const write = async (sql: string, values: unknown[]) => { if ((await client.query(sql, values)).rowCount !== 1) throw unavailable(); };
        if (changed) {
          let envelope;
          try { envelope = r.operation === "put" ? sealMediaCredentialPayload(payload, { credentialId: r.credentialId, accountId: r.accountId, platform: r.platform, revision }, ownedKeys.encryption) : null; }
          catch { throw invalid(); }
          await write(`INSERT INTO ${s}.media_credential_revisions(credential_id,account_id,platform,revision,state,encryption_key_id,envelope,recorded_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [r.credentialId, r.accountId, r.platform, revision, state, envelope?.keyId ?? null, envelope, actor]);
          if (current) await write(`UPDATE ${s}.media_credentials SET revision=$2 WHERE credential_id=$1 AND revision=$3`, [r.credentialId, revision, r.expectedRevision]);
          else await write(`INSERT INTO ${s}.media_credentials(credential_id,account_id,platform,revision) VALUES($1,$2,$3,$4)`, [r.credentialId, r.accountId, r.platform, revision]);
          await write(`INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts)
            VALUES($1,'operator',$2,'resource.media_credential_changed','media_account',$3,$4,$5)`, [randomUUID(), actor, r.accountId, r.metadata.requestId,
            { credentialId: r.credentialId, platform: r.platform, revision, state }]);
        }
        await write(`INSERT INTO ${s}.media_credential_commands(actor_id,request_key,digest_key_id,payload_digest,credential_id,account_id,platform,applied_revision)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [actor, r.metadata.idempotencyKey, key.keyId, digest, r.credentialId, r.accountId, r.platform, revision]);
        const credential = await this.current(client, r.accountId); if (!credential) throw unavailable();
        return { credential, changed, replayed: false };
      });
    } finally { payload?.fill(0); keys?.encryption.key.fill(0); for (const key of keys?.digestKeys ?? []) key.key.fill(0); }
  }
}
