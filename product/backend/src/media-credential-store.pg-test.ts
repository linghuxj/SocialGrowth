import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { MediaCredentialStore, type MediaCredentialWriteKeys } from "./media-credential-store.js";
import { withDecryptedMediaCredential } from "./media-credential-envelope.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, cluster = process.env.SG_PRODUCT_TEST_CLUSTER_ID;
const cid = process.env.SG_PRODUCT_TEST_CONTAINER_ID, volume = process.env.SG_PRODUCT_TEST_VOLUME;
if (!url || !cluster || !/^\d+$/.test(cluster) || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1"
  || !cid || !/^[a-f0-9]{64}$/.test(cid) || !volume || !/^[a-f0-9]{64}$/.test(volume)
  || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/sg_wp13_credentials_author") throw new Error("Credential supplemental checks require an owned isolated instance");
const s = "socialgrowth_product", pool = new Pool({ connectionString: url, max: 8, application_name: "sg-wp13-credential-fixtures" });
const auth = new OperatorAuthService(pool, "new-synthetic-credential-pepper-only-0001");
const keys: MediaCredentialWriteKeys = { encryption: { keyId: "enc_1", key: randomBytes(32) }, currentDigestKeyId: "intent_1", digestKeys: [{ keyId: "intent_1", key: randomBytes(32) }] };
const store = new MediaCredentialStore(pool, auth, keys);
const code = (value: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === value && !e.cause;
const metadata = () => ({ contractVersion, requestId: `credential-${randomUUID()}`, idempotencyKey: `credential-${randomUUID()}` });
async function guard() {
  const ins = JSON.parse(execFileSync("docker", ["inspect", cid!], { encoding: "utf8" }))[0];
  assert.equal(ins.Id, cid); assert.equal(ins.Name, "/sg-wp13-credential-author-20261001");
  assert.equal(ins.Image, "sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74");
  assert.equal(ins.State.Running, true); assert.equal(ins.HostConfig.AutoRemove, true);
  assert.deepEqual(ins.Config.Labels, { "socialgrowth.owner": "wp13-credentials-author-20261001" });
  assert.deepEqual(ins.Config.Env.filter((v: string) => v.startsWith("POSTGRES_")).sort(), ["POSTGRES_DB=sg_wp13_credentials_author", "POSTGRES_USER=sg_credential_fixture", "POSTGRES_PASSWORD=wp13-new-credential-isolated-fixture-only"].sort());
  assert.equal(ins.Mounts.length, 1); assert.equal(ins.Mounts[0].Type, "volume"); assert.equal(ins.Mounts[0].Name, volume);
  assert.deepEqual(ins.NetworkSettings.Ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: new URL(url!).port }] });
  const ids = execFileSync("docker", ["ps", "--no-trunc", "--format", "{{.ID}}"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const rows = execFileSync("docker", ["inspect", "--format", '{"Id":{{json .Id}},"Mounts":{{json .Mounts}}}', ...ids], { encoding: "utf8" }).trim().split("\n").map(v => JSON.parse(v));
  for (const row of rows) if (row.Id !== cid) assert.ok(!row.Mounts.some((m: { Name?: string }) => m.Name === volume));
  assert.deepEqual((await pool.query("SELECT current_database() database,current_user username,system_identifier::text cluster FROM pg_control_system()")).rows[0], { database: "sg_wp13_credentials_author", username: "sg_credential_fixture", cluster });
  assert.deepEqual((await pool.query("SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname")).rows.map(v => v.datname), ["postgres", "sg_wp13_credentials_author"]);
}
async function ddl(sql: string) { await guard(); return pool.query(sql); }
async function actor() {
  await guard();
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic credential','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
async function fixture(platform: "facebook" | "youtube" = "facebook") {
  const a = await actor(), accountId = randomUUID(), credentialId = randomUUID();
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,$2,$3)`, [accountId, platform, `synthetic_${randomUUID().replaceAll("-", "")}`]);
  return { a, credentialId, accountId, platform };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const input = (f: Fixture, expectedRevision = 0, operation: "put" | "invalidate" = "put") => ({ metadata: metadata(), credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, expectedRevision, operation,
  ...(operation === "put" ? { loginIdentifier: "synthetic-login" } : {}) });
const payload = () => Buffer.from('{ "password": " synthetic-only 密码 空格 ", "login": "synthetic-login" }');
async function write(f: Fixture, revision = 0, operation: "put" | "invalidate" = "put") { return store.write(f.a.token, f.a.csrf, input(f, revision, operation), operation === "put" ? payload() : undefined); }
async function image() {
  const result: Record<string, unknown> = {};
  for (const table of ["media_credentials", "media_credential_revisions", "media_credential_commands", "media_account_commands", "audit_records", "resource_reservation_guard", "media_accounts", "publishing_identities", "project_identity_reservations"]) {
    result[table] = (await pool.query(`SELECT to_jsonb(t) value FROM ${s}.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(v => v.value);
  }
  return result;
}
let oldRegistry: unknown;
before(async () => {
  await ddl(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url);
  const files = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort(); assert.equal(files.length, 39);
  for (const file of files.filter(v => !v.startsWith("0023_") && !v.startsWith("0039_"))) await ddl(await readFile(new URL(file, dir), "utf8"));
  const f = await fixture();
  await pool.query(`INSERT INTO ${s}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,$3,'old_synthetic_identity')`, [randomUUID(), f.accountId, f.platform]);
  oldRegistry = (await pool.query(`SELECT to_jsonb(t) value FROM ${s}.media_accounts t ORDER BY account_id`)).rows;
  await ddl(await readFile(new URL("0023_media_credentials.sql", dir), "utf8"));
  await ddl(await readFile(new URL("0039_media_accounts_r159.sql", dir), "utf8"));
});
after(async () => { try { await ddl(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); keys.encryption.key.fill(0); for (const key of keys.digestKeys) key.key.fill(0); } });

test("0023 and 0039 upgrade preserve old references as explicitly unverified history; metadata read creates no credential or permission", async () => {
  const priorRows = oldRegistry as Array<{ value: { account_id: string; canonical_account_ref: string } }>;
  for (const row of priorRows) {
    const current = (await pool.query(`SELECT account_id,canonical_account_ref,legacy_declared_canonical_account_ref,parent_login_verification,login_identifier FROM ${s}.media_accounts WHERE account_id=$1`, [row.value.account_id])).rows[0];
    assert.equal(current.canonical_account_ref, null); assert.equal(current.legacy_declared_canonical_account_ref, row.value.canonical_account_ref);
    assert.equal(current.parent_login_verification, "registered_unverified"); assert.equal(current.login_identifier, null);
  }
  const f = await fixture(), before = await image(); assert.equal(await store.read(f.a.token, f.accountId), null); assert.deepEqual(await image(), before);
});
test("durable put/update/invalidate preserves encrypted history and original raw bytes; replay returns CURRENT invalidation after restart", async () => {
  const f = await fixture("youtube"), original = input(f), secret = payload();
  const first = await store.write(f.a.token, f.a.csrf, original, secret); assert.equal(first.credential.revision, 1); assert.equal(first.changed, true);
  const envelope = (await pool.query(`SELECT envelope FROM ${s}.media_credential_revisions WHERE credential_id=$1 AND revision=1`, [f.credentialId])).rows[0].envelope;
  await withDecryptedMediaCredential(envelope, { credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, revision: 1 }, async bytes => { assert.ok(bytes.equals(secret)); }, keys.encryption);
  await write(f, 1); const revoked = await write(f, 2, "invalidate"); assert.equal(revoked.credential.state, "invalidated"); assert.equal(revoked.credential.revision, 3);
  const before = await image(), restarted = new MediaCredentialStore(pool, new OperatorAuthService(pool, "new-synthetic-credential-pepper-only-0001"), keys);
  const retry = await restarted.write(f.a.token, f.a.csrf, { ...original, metadata: { ...original.metadata, requestId: metadata().requestId } }, secret);
  assert.equal(retry.replayed, true); assert.equal(retry.changed, false); assert.deepEqual(retry.credential, revoked.credential); assert.deepEqual(await image(), before);
  const history = (await pool.query(`SELECT state,envelope FROM ${s}.media_credential_revisions WHERE credential_id=$1 ORDER BY revision`, [f.credentialId])).rows;
  assert.equal(history.length, 3); assert.deepEqual(history[0].envelope, envelope); assert.equal(history[2].envelope, null);
  const current = await store.read(f.a.token, f.accountId); assert.deepEqual(current, revoked.credential);
  const ordinary = JSON.stringify({ current, retry, audits: (await pool.query(`SELECT facts FROM ${s}.audit_records WHERE object_id=$1`, [f.accountId])).rows });
  assert.ok(!ordinary.includes("password") && !ordinary.includes("synthetic-login") && !ordinary.includes("envelope") && !ordinary.includes("ciphertext"));
  assert.equal(current?.actionPermissionGranted, false); assert.equal(current?.acceptanceStarted, false);
  assert.equal((await pool.query(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0].version, "3");
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.project_identity_reservations`)).rowCount, 0);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.commission_income_sources`)).rowCount, 0);
});
test("credential rotation invalidates current parent verification but retains its canonical identity as history", async () => {
  const f = await fixture("facebook");
  await write(f, 0);
  const canonical = `verified_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`UPDATE ${s}.media_accounts SET canonical_account_ref=$2,parent_login_verification='verified' WHERE account_id=$1`, [f.accountId, canonical]);
  const rotated = await store.write(f.a.token, f.a.csrf, { ...input(f, 1), loginIdentifier: "rotated-login" }, Buffer.from('{"login":"rotated-login","password":"new-synthetic-secret"}'));
  assert.equal(rotated.credential.revision, 2);
  const current = (await pool.query(`SELECT canonical_account_ref,parent_login_verification,login_identifier FROM ${s}.media_accounts WHERE account_id=$1`, [f.accountId])).rows[0];
  assert.equal(current.canonical_account_ref, canonical);
  assert.equal(current.parent_login_verification, "registered_unverified");
  assert.equal(current.login_identifier, "rotated-login");
  const revisions = (await pool.query(`SELECT revision,state FROM ${s}.media_credential_revisions WHERE account_id=$1 ORDER BY revision`, [f.accountId])).rows;
  assert.deepEqual(revisions, [{ revision: "1", state: "stored_unverified" }, { revision: "2", state: "stored_unverified" }]);
});
test("actor/key binds exact bytes, operation, version and immutable account; requestId is excluded without weakening intent", async () => {
  const f = await fixture(), original = input(f), secret = payload(); await store.write(f.a.token, f.a.csrf, original, secret);
  const before = await image();
  for (const patch of [{ expectedRevision: 1 }, { accountId: randomUUID() }, { credentialId: randomUUID() }, { platform: "youtube" }, { operation: "invalidate" }]) {
    const command = { ...original, ...patch }; await assert.rejects(store.write(f.a.token, f.a.csrf, command, command.operation === "put" ? secret : undefined), code("IDEMPOTENCY_KEY_REUSED"));
  }
  await assert.rejects(store.write(f.a.token, f.a.csrf, original, Buffer.from(secret.toString().replace("synthetic-only", "different-secret"))), code("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual(await image(), before);
  const b = await actor(); const other = await store.write(b.token, b.csrf, { ...original, expectedRevision: 1 }, secret); assert.equal(other.credential.revision, 2); assert.equal(other.replayed, false);
  const foreign = await fixture(), foreignBefore = await image();
  await assert.rejects(store.write(foreign.a.token, foreign.a.csrf, { ...input(foreign), credentialId: f.credentialId }, secret), code("INTERNAL_ERROR")); assert.deepEqual(await image(), foreignBefore);
});
test("same-key competition applies exactly once; distinct stale update commands have only one winner", async () => {
  const f = await fixture(), original = input(f), secret = payload();
  const first = await Promise.all([store.write(f.a.token, f.a.csrf, original, secret), store.write(f.a.token, f.a.csrf, original, secret)]);
  assert.equal(first.filter(v => v.changed).length, 1); assert.equal(first.filter(v => v.replayed).length, 1);
  const updates = await Promise.allSettled([write(f, 1), write(f, 1)]); assert.equal(updates.filter(v => v.status === "fulfilled").length, 1);
  assert.equal(updates.filter(v => v.status === "rejected" && code("FACT_VERSION_STALE")(v.reason)).length, 1);
  assert.equal((await store.read(f.a.token, f.accountId))?.revision, 2);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.media_credential_revisions WHERE credential_id=$1`, [f.credentialId])).rowCount, 2);
});
test("current auth/CSRF, credential-version, disabled and revoked sessions protect metadata/write/replay; no-key mode stays closed", async () => {
  const f = await fixture(), original = input(f), secret = payload(); await store.write(f.a.token, f.a.csrf, original, secret);
  const noKey = new MediaCredentialStore(pool, auth), before = await image();
  await assert.rejects(noKey.write("invalid-token", f.a.csrf, original, secret), code("AUTHENTICATION_REQUIRED"));
  await assert.rejects(noKey.write(f.a.token, f.a.csrf, original, secret), code("INTERNAL_ERROR"));
  assert.equal((await noKey.read(f.a.token, f.accountId))?.revision, 1);
  await assert.rejects(store.write(f.a.token, "", original, secret), code("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.operators SET credential_version=2 WHERE operator_id=$1`, [f.a.operatorId]);
  await assert.rejects(store.write(f.a.token, f.a.csrf, original, secret), code("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.operators SET credential_version=1,status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [f.a.operatorId]);
  await assert.rejects(store.read(f.a.token, f.accountId), code("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.operators SET status='active',disabled_at=NULL WHERE operator_id=$1`, [f.a.operatorId]);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.a.sessionId]);
  await assert.rejects(store.write(f.a.token, f.a.csrf, original, secret), code("AUTHENTICATION_REQUIRED"));
  assert.deepEqual(await image(), before);
});
test("explicit key rotation retains old intent key for replay; missing old key fails closed; encryption/digest keys cannot be shared", async () => {
  const f = await fixture(), original = input(f), secret = payload(); await store.write(f.a.token, f.a.csrf, original, secret);
  const enc = randomBytes(32), digest = randomBytes(32);
  const rotatedKeys: MediaCredentialWriteKeys = { encryption: { keyId: "enc_2", key: enc }, currentDigestKeyId: "intent_2", digestKeys: [...keys.digestKeys, { keyId: "intent_2", key: digest }] };
  try {
    const rotated = new MediaCredentialStore(pool, auth, rotatedKeys); await rotated.write(f.a.token, f.a.csrf, input(f, 1), secret);
    assert.equal((await rotated.write(f.a.token, f.a.csrf, original, secret)).credential.revision, 2);
    const before = await image(), missing = new MediaCredentialStore(pool, auth, { ...rotatedKeys, digestKeys: [{ keyId: "intent_2", key: digest }] });
    await assert.rejects(missing.write(f.a.token, f.a.csrf, original, secret), code("INTERNAL_ERROR"));
    const shared = new MediaCredentialStore(pool, auth, { ...rotatedKeys, encryption: { keyId: "enc_2", key: digest } });
    await assert.rejects(shared.write(f.a.token, f.a.csrf, input(f, 2), secret), code("INTERNAL_ERROR")); assert.deepEqual(await image(), before);
    const row = (await pool.query(`SELECT encryption_key_id,envelope FROM ${s}.media_credential_revisions WHERE credential_id=$1 AND revision=2`, [f.credentialId])).rows[0]; assert.equal(row.encryption_key_id, "enc_2");
    await withDecryptedMediaCredential(row.envelope, { credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, revision: 2 }, async bytes => { assert.ok(bytes.equals(secret)); }, rotatedKeys.encryption);
  } finally { enc.fill(0); digest.fill(0); }
});
test("all four transactional writes must confirm rowCount=1; suppressed revision/head/audit/command or audit exception rolls back", async () => {
  for (const table of ["media_credential_revisions", "media_credentials", "audit_records", "media_credential_commands"]) {
    const f = await fixture(), original = input(f), before = await image();
    await ddl(`CREATE FUNCTION ${s}.credential_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
    await ddl(`CREATE TRIGGER credential_fault BEFORE INSERT ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.credential_fault()`);
    try { await assert.rejects(store.write(f.a.token, f.a.csrf, original, payload()), code("INTERNAL_ERROR")); assert.deepEqual(await image(), before); }
    finally { await ddl(`DROP TRIGGER credential_fault ON ${s}.${table}`); await ddl(`DROP FUNCTION ${s}.credential_fault()`); }
    assert.equal((await store.write(f.a.token, f.a.csrf, original, payload())).changed, true);
  }
  const f = await fixture(), before = await image();
  await ddl(`CREATE FUNCTION ${s}.credential_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-secret-must-not-escape'; END $$`);
  await ddl(`CREATE TRIGGER credential_fault BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.credential_fault()`);
  try { await assert.rejects(write(f), (e: unknown) => code("INTERNAL_ERROR")(e) && e instanceof Error && !e.message.includes("synthetic-secret")); assert.deepEqual(await image(), before); }
  finally { await ddl(`DROP TRIGGER credential_fault ON ${s}.audit_records`); await ddl(`DROP FUNCTION ${s}.credential_fault()`); }
});
test("update suppression rolls back history and invalidation; repeated invalidation no-op only journals; stale/invalid input cannot write", async () => {
  const f = await fixture(); await write(f); const request = input(f, 1, "invalidate"), before = await image();
  await ddl(`CREATE FUNCTION ${s}.credential_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  await ddl(`CREATE TRIGGER credential_fault BEFORE UPDATE ON ${s}.media_credentials FOR EACH ROW EXECUTE FUNCTION ${s}.credential_fault()`);
  try { await assert.rejects(store.write(f.a.token, f.a.csrf, request), code("INTERNAL_ERROR")); assert.deepEqual(await image(), before); }
  finally { await ddl(`DROP TRIGGER credential_fault ON ${s}.media_credentials`); await ddl(`DROP FUNCTION ${s}.credential_fault()`); }
  await store.write(f.a.token, f.a.csrf, request); const invalidated = await image();
  const noop = await write(f, 2, "invalidate"); assert.equal(noop.changed, false); assert.equal(noop.credential.revision, 2);
  const after = await image(); assert.deepEqual(after.media_credential_revisions, invalidated.media_credential_revisions); assert.deepEqual(after.audit_records, invalidated.audit_records);
  for (const bad of [{ ...input(f, 2), acceptanceStarted: true }, { ...input(f, 2), expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...input(f, 2), credentialId: f.credentialId.toUpperCase() }]) await assert.rejects(store.write(f.a.token, f.a.csrf, bad, payload()), code("INPUT_INVALID"));
  await assert.rejects(write(f, 1), code("FACT_VERSION_STALE"));
  for (const bytes of [Buffer.from("secret-invalid-json"), Buffer.from([255]), Buffer.alloc(8193), Buffer.from('{"login":"x","password":"x","extra":true}')]) await assert.rejects(store.write(f.a.token, f.a.csrf, input(f, 2), bytes), code("INPUT_INVALID"));
  await assert.rejects(store.write(f.a.token, f.a.csrf, input(f, 2, "invalidate"), payload()), code("INPUT_INVALID")); assert.deepEqual(await image(), after);
});
test("expiry while waiting for the shared metadata guard rolls back even a replay", async () => {
  const f = await fixture(), original = input(f), secret = payload(); await store.write(f.a.token, f.a.csrf, original, secret);
  await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE session_id=$1`, [f.a.sessionId]);
  const blocker = await pool.connect(); let pending: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR UPDATE`);
    const before = await image(); pending = store.write(f.a.token, f.a.csrf, original, secret); const rejected = assert.rejects(pending, code("AUTHENTICATION_REQUIRED"));
    let witnessed = false;
    for (let i = 0; i < 300; i++) {
      const row = (await pool.query(`SELECT (SELECT expires_at<=clock_timestamp() FROM ${s}.operator_sessions WHERE session_id=$1) expired,
        EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='sg-wp13-credential-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()) waiting`, [f.a.sessionId])).rows[0];
      if (row.expired && row.waiting) { witnessed = true; break; } await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(witnessed); await blocker.query("COMMIT"); await rejected; assert.deepEqual(await image(), before);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); }
});
test("request, payload and keys are owned snapshots while awaiting locks; caller Buffer overrides are never called", async () => {
  const f = await fixture(), original = input(f), expected = payload(), secret = Buffer.from(expected), localKeys = { encryption: { keyId: "snapshot_enc", key: randomBytes(32) }, currentDigestKeyId: "snapshot_intent", digestKeys: [{ keyId: "snapshot_intent", key: randomBytes(32) }] };
  const preservedKey = { keyId: localKeys.encryption.keyId, key: Buffer.from(localKeys.encryption.key) }, localStore = new MediaCredentialStore(pool, auth, localKeys);
  let calls = 0; secret.toString = () => { calls++; throw new Error("must-not-escape"); };
  const blocker = await pool.connect(); let pending: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR UPDATE`);
    pending = localStore.write(f.a.token, f.a.csrf, original, secret); void pending.catch(() => undefined);
    secret.fill(0); original.accountId = randomUUID(); original.metadata.idempotencyKey = metadata().idempotencyKey;
    localKeys.encryption.key.fill(0); localKeys.digestKeys[0]!.key.fill(0); localKeys.encryption.keyId = "changed";
    await blocker.query("COMMIT"); await pending; assert.equal(calls, 0);
    const row = (await pool.query(`SELECT envelope FROM ${s}.media_credential_revisions WHERE credential_id=$1`, [f.credentialId])).rows[0];
    await withDecryptedMediaCredential(row.envelope, { credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, revision: 1 }, async bytes => { assert.ok(bytes.equals(expected)); }, preservedKey);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); preservedKey.key.fill(0); }
});
test("SQL constraints reject history overwrite/delete, head identity/revision changes and unmatched encrypted context", async () => {
  const f = await fixture(); await write(f); const before = await image();
  const dbCode = (value: string) => (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === value;
  for (const table of ["media_credential_revisions", "media_credential_commands", "media_credentials"]) await assert.rejects(pool.query(`DELETE FROM ${s}.${table} WHERE credential_id=$1`, [f.credentialId]), dbCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.media_credential_revisions SET state='invalidated',envelope=NULL,encryption_key_id=NULL WHERE credential_id=$1`, [f.credentialId]), dbCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.media_credentials SET revision=revision+2 WHERE credential_id=$1`, [f.credentialId]), dbCode("P0001"));
  const envelope = (await pool.query(`SELECT envelope FROM ${s}.media_credential_revisions WHERE credential_id=$1`, [f.credentialId])).rows[0].envelope;
  for (const changed of [{ ...envelope, login: "plaintext-forbidden" }, { ...envelope, context: { ...envelope.context, accountId: randomUUID() } }, { ...envelope, context: {} }]) {
    await assert.rejects(pool.query(`INSERT INTO ${s}.media_credential_revisions(credential_id,account_id,platform,revision,state,encryption_key_id,envelope,recorded_by) VALUES($1,$2,$3,1,'stored_unverified',$4,$5,$6)`, [randomUUID(), f.accountId, f.platform, keys.encryption.keyId, changed, f.a.operatorId]), dbCode("23514"));
  }
  assert.deepEqual(await image(), before);
});
test("adapter return failure AFTER actual COMMIT remains unknown; reconstructed store retries original key without repeating writes", async () => {
  const f = await fixture(), original = input(f), secret = payload();
  let lost = false;
  // Real PostgreSQL queries/COMMIT, only an explicit adapter-return fault. This
  // is not a browser/HTTP ACK-loss test or a Mock business-success response.
  const adapter = { connect: async () => {
    const client = await pool.connect(), query = client.query.bind(client) as (sql: string, values?: unknown[]) => Promise<unknown>;
    return { query: async (sql: string, values?: unknown[]) => {
      const result = await query(sql, values);
      if (sql === "COMMIT" && !lost) { lost = true; throw new Error("synthetic-post-commit-return-fault"); }
      return result;
    }, release: client.release.bind(client) } as unknown as PoolClient;
  } } as unknown as Pool;
  await assert.rejects(new MediaCredentialStore(adapter, auth, keys).write(f.a.token, f.a.csrf, original, secret), code("INTERNAL_ERROR"));
  assert.equal(lost, true); assert.equal((await store.read(f.a.token, f.accountId))?.revision, 1);
  const before = await image(), recovered = await new MediaCredentialStore(pool, auth, keys).write(f.a.token, f.a.csrf, original, secret);
  assert.equal(recovered.changed, false); assert.equal(recovered.replayed, true); assert.equal(recovered.credential.revision, 1); assert.deepEqual(await image(), before);
});
