import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { contractVersion, productErrorResponseSchema, readMediaCredentialResponseSchema, writeMediaCredentialResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { MediaCredentialStore, type MediaCredentialWriteKeys } from "./media-credential-store.js";
import { MediaCredentialsController } from "./media-credentials.controller.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
import { withDecryptedMediaCredential } from "./media-credential-envelope.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, cluster = process.env.SG_PRODUCT_TEST_CLUSTER_ID;
const cid = process.env.SG_PRODUCT_TEST_CONTAINER_ID, volume = process.env.SG_PRODUCT_TEST_VOLUME;
if (!url || !cluster || !/^\d+$/.test(cluster) || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || !cid || !/^[a-f0-9]{64}$/.test(cid)
  || !volume || !/^[a-f0-9]{64}$/.test(volume) || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/sg_wp13_credential_api_author") throw new Error("Credential API checks require an owned isolated instance");
const s = "socialgrowth_product", pool = new Pool({ connectionString: url, max: 8, application_name: "sg-wp13-credential-api-fixtures" });
const pepper = "new-synthetic-credential-api-pepper-0001", auth = new OperatorAuthService(pool, pepper);
const keys: MediaCredentialWriteKeys = { encryption: { keyId: "api_enc_1", key: randomBytes(32) }, currentDigestKeyId: "api_intent_1", digestKeys: [{ keyId: "api_intent_1", key: randomBytes(32) }] };
// Targeted real HTTP module with actual controller/auth/PG/store and explicitly
// synthetic controlled keys, NOT mocked business results or production source.
// AppModule's no-key default is separately served and checked below.
@Module({ controllers: [MediaCredentialsController], providers: [
  { provide: MediaCredentialStore, useFactory: () => new MediaCredentialStore(pool, auth, keys) },
] })
class ControlledCredentialFixtureModule {}
let defaultApp: INestApplication | undefined, controlledApp: INestApplication | undefined, defaultBase: string, controlledBase: string;
async function guard(target = pool) {
  const ins = JSON.parse(execFileSync("docker", ["inspect", cid!], { encoding: "utf8" }))[0];
  assert.equal(ins.Id, cid); assert.equal(ins.Name, "/sg-wp13-credential-api-author-20261001");
  assert.equal(ins.Image, "sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74");
  assert.equal(ins.State.Running, true); assert.equal(ins.HostConfig.AutoRemove, true);
  assert.deepEqual(ins.Config.Labels, { "socialgrowth.owner": "wp13-credential-api-author-20261001" });
  assert.deepEqual(ins.Config.Env.filter((v: string) => v.startsWith("POSTGRES_")).sort(), ["POSTGRES_DB=sg_wp13_credential_api_author", "POSTGRES_USER=sg_credential_api_fixture", "POSTGRES_PASSWORD=wp13-new-credential-api-isolated-fixture-only"].sort());
  assert.equal(ins.Mounts.length, 1); assert.equal(ins.Mounts[0].Type, "volume"); assert.equal(ins.Mounts[0].Name, volume);
  assert.deepEqual(ins.NetworkSettings.Ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: new URL(url!).port }] });
  const ids = execFileSync("docker", ["ps", "--no-trunc", "--format", "{{.ID}}"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const rows = execFileSync("docker", ["inspect", "--format", '{"Id":{{json .Id}},"Mounts":{{json .Mounts}}}', ...ids], { encoding: "utf8" }).trim().split("\n").map(v => JSON.parse(v));
  for (const row of rows) if (row.Id !== cid) assert.ok(!row.Mounts.some((m: { Name?: string }) => m.Name === volume));
  assert.deepEqual((await target.query("SELECT current_database() database,current_user username,system_identifier::text cluster FROM pg_control_system()")).rows[0], { database: "sg_wp13_credential_api_author", username: "sg_credential_api_fixture", cluster });
  assert.deepEqual((await target.query("SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname")).rows.map(v => v.datname), ["postgres", "sg_wp13_credential_api_author"]);
}
async function ddl(sql: string) { await guard(); return pool.query(sql); }
interface HttpRequest { headers: Record<string, string | string[] | undefined>; path: string }
interface HttpResponse { json(body: unknown): HttpResponse; socket?: { destroy(): void } | null }
async function startControlled() {
  controlledApp = await NestFactory.create(ControlledCredentialFixtureModule, { logger: false }); controlledApp.useGlobalFilters(new ProductExceptionFilter());
  // Real transport response loss AFTER the actual controller/store commits.
  controlledApp.use((req: HttpRequest, res: HttpResponse, next: () => void) => {
    if (req.headers["x-test-drop-ack"] === "1" && req.path.endsWith("/credentials")) res.json = (_body: unknown) => { res.socket?.destroy(); return res; };
    next();
  });
  await controlledApp.listen(0, "127.0.0.1"); controlledBase = await controlledApp.getUrl();
}
before(async () => {
  await ddl(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url), files = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort(); assert.equal(files.length, 39);
  for (const file of files) await ddl(await readFile(new URL(file, dir), "utf8"));
  process.env.SG_PRODUCT_DATABASE_URL = url; process.env.SG_PRODUCT_AUTH_PEPPER = pepper;
  process.env.SG_PRODUCT_SMS_MODE = "unavailable"; process.env.SG_PRODUCT_MATERIAL_MODE = "unavailable"; delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN;
  for (const key of ["LOCATION_ID", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "SESSION_TOKEN", "MAX_OBJECT_BYTES", "REQUEST_TIMEOUT_MS"]) delete process.env[`SG_PRODUCT_MATERIAL_${key}`];
  defaultApp = await NestFactory.create(AppModule, { logger: false }); defaultApp.useGlobalFilters(new ProductExceptionFilter());
  await defaultApp.listen(0, "127.0.0.1"); defaultBase = await defaultApp.getUrl(); await guard(defaultApp.get(Pool)); await startControlled();
});
after(async () => { try { await controlledApp?.close(); await defaultApp?.close(); await ddl(`DROP SCHEMA IF EXISTS ${s} CASCADE`); }
  finally { await pool.end(); keys.encryption.key.fill(0); for (const key of keys.digestKeys) key.key.fill(0); } });
async function fixture(platform: "facebook" | "youtube" = "facebook") {
  await guard();
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), accountId = randomUUID(), credentialId = randomUUID();
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic API','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref,legacy_declared_canonical_account_ref,display_name) VALUES($1,$2,NULL,$3,'Synthetic fixture')`, [accountId, platform, `synthetic_${randomUUID().replaceAll("-", "")}`]);
  return { operatorId, sessionId, token, csrf, accountId, credentialId, platform };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const secret = () => Buffer.from('{ "password": " synthetic-api-only 密码 ", "login": "synthetic-api-login" }');
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `credential-${randomUUID()}` });
const input = (f: Fixture, revision = 0) => ({ metadata: metadata(), credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, expectedRevision: revision, operation: "put", loginIdentifier: "synthetic-api-login", payloadBase64: secret().toString("base64") });
async function request(f: Fixture, body?: unknown, options: { base?: string; path?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const response = await fetch(`${options.base ?? controlledBase}/api/operator/media-accounts/${options.path ?? f.accountId}/credentials`, {
    method: body === undefined && options.raw === undefined ? "GET" : "POST", headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json", ...options.headers },
    ...(options.raw !== undefined ? { body: options.raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.headers.get("cache-control"), "no-store"); return { status: response.status, value: await response.json() as unknown };
}
const checkError = (result: { status: number; value: unknown }, status: number, value: string) => {
  assert.equal(result.status, status); const error = productErrorResponseSchema.parse(result.value); assert.equal(error.error.code, value); return error;
};
async function post(f: Fixture, body = input(f)) { const result = await request(f, body); assert.equal(result.status, 201); return writeMediaCredentialResponseSchema.parse(result.value); }
async function image() {
  const result: Record<string, unknown> = {};
  for (const table of ["media_credentials", "media_credential_revisions", "media_credential_commands", "media_account_commands", "audit_records", "resource_reservation_guard", "media_accounts", "publishing_identities", "project_identity_reservations", "commission_income_sources"]) {
    result[table] = (await pool.query(`SELECT to_jsonb(t) value FROM ${s}.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(v => v.value);
  }
  return result;
}
test("actual AppModule serves safe empty/current metadata and authenticates before default key-unavailable refusal", async () => {
  const f = await fixture(), before = await image();
  const empty = await request(f, undefined, { base: defaultBase }); assert.equal(empty.status, 200); assert.deepEqual(readMediaCredentialResponseSchema.parse(empty.value), { contractVersion, credential: null });
  checkError(await request(f, input(f), { base: defaultBase }), 500, "INTERNAL_ERROR");
  checkError(await request(f, input(f), { base: defaultBase, headers: { cookie: "", authorization: `Bearer ${f.token}` } }), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await image(), before);
  await post(f); const current = await request(f, undefined, { base: defaultBase }); assert.equal(current.status, 200); assert.equal(readMediaCredentialResponseSchema.parse(current.value).credential?.revision, 1);
});
test("actual controlled HTTP put/update/invalidate has correct original bytes and current metadata, no ordinary secret response or grant", async () => {
  const f = await fixture("youtube"), body = input(f), first = await post(f, body); assert.equal(first.credential.state, "stored_unverified");
  const row = (await pool.query(`SELECT envelope FROM ${s}.media_credential_revisions WHERE credential_id=$1`, [f.credentialId])).rows[0];
  await withDecryptedMediaCredential(row.envelope, { credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, revision: 1 }, async bytes => { assert.ok(bytes.equals(secret())); }, keys.encryption);
  await post(f, input(f, 1)); const invalidation = { metadata: metadata(), credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, expectedRevision: 2, operation: "invalidate" };
  const invalid = await request(f, invalidation); assert.equal(invalid.status, 201); const current = writeMediaCredentialResponseSchema.parse(invalid.value); assert.equal(current.credential.state, "invalidated"); assert.equal(current.credential.revision, 3);
  const get = await request(f); assert.equal(get.status, 200); assert.deepEqual(readMediaCredentialResponseSchema.parse(get.value).credential, current.credential);
  const before = await image(), retry = await post(f, { ...body, metadata: { ...body.metadata, requestId: metadata().requestId } }); assert.equal(retry.replayed, true); assert.deepEqual(retry.credential, current.credential); assert.deepEqual(await image(), before);
  const ordinary = JSON.stringify({ first, get, retry, audits: (await pool.query(`SELECT facts FROM ${s}.audit_records WHERE object_id=$1`, [f.accountId])).rows });
  for (const forbidden of [body.payloadBase64, "synthetic-api-login", "password", "ciphertext", "envelope"]) assert.ok(!ordinary.includes(forbidden));
  assert.equal(first.credential.actionPermissionGranted, false); assert.equal(first.credential.acceptanceStarted, false);
  assert.equal((await pool.query(`SELECT version::text FROM ${s}.resource_reservation_guard`)).rows[0].version, "0"); assert.equal((await pool.query(`SELECT 1 FROM ${s}.project_identity_reservations`)).rowCount, 0);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.commission_income_sources`)).rowCount, 0);
});
test("actual committed HTTP response loss and restart return CURRENT invalidation on original-key retry without repeated writes", async () => {
  const f = await fixture(), body = input(f);
  await assert.rejects(request(f, body, { headers: { "x-test-drop-ack": "1" } }));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.media_credential_commands WHERE actor_id=$1 AND request_key=$2`, [f.operatorId, body.metadata.idempotencyKey])).rowCount, 1);
  const invalidation = { metadata: metadata(), credentialId: f.credentialId, accountId: f.accountId, platform: f.platform, expectedRevision: 1, operation: "invalidate" };
  assert.equal((await request(f, invalidation)).status, 201); const before = await image(); await controlledApp!.close(); await startControlled();
  const replay = await post(f, body); assert.equal(replay.replayed, true); assert.equal(replay.changed, false); assert.equal(replay.credential.revision, 2); assert.equal(replay.credential.state, "invalidated"); assert.deepEqual(await image(), before);
});
test("real path/body mismatch, extra authority, noncanonical bytes, unsupported contract and malformed payload have safe zero-write errors", async () => {
  const f = await fixture(), body = input(f), before = await image();
  checkError(await request(f, body, { path: randomUUID() }), 400, "INPUT_INVALID");
  for (const patch of [{ actorId: randomUUID() }, { acceptanceStarted: true }, { payloadBase64: "AB==" }, { platform: "youtube", accountId: f.accountId },
    { payloadBase64: Buffer.from("synthetic-secret-invalid-json").toString("base64") }]) {
    const result = await request(f, { ...body, ...patch }); const expected = "platform" in patch ? "FACT_VERSION_STALE" : "INPUT_INVALID"; checkError(result, expected === "FACT_VERSION_STALE" ? 409 : 400, expected);
    const serialized = JSON.stringify(result.value); assert.ok(!serialized.includes(body.payloadBase64) && !serialized.includes("synthetic-secret"));
  }
  checkError(await request(f, { ...body, metadata: { ...body.metadata, contractVersion: "future" } }), 400, "CONTRACT_VERSION_UNSUPPORTED");
  checkError(await request(f, { ...body, operation: "invalidate" }), 400, "INPUT_INVALID"); assert.deepEqual(await image(), before);
});
test("actual Cookie/CSRF and credential-version/revoked-session checks refuse reads, writes and original replay", async () => {
  const f = await fixture(), body = input(f); await post(f, body); const before = await image();
  for (const headers of [{ "x-csrf-token": "" }, { cookie: `__Host-sg_operator_session=${f.token}=suffix` }, { cookie: "", authorization: `Bearer ${f.token}` }] as Record<string, string>[]) checkError(await request(f, body, { headers }), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET credential_version=2 WHERE operator_id=$1`, [f.operatorId]); checkError(await request(f, body), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET credential_version=1 WHERE operator_id=$1`, [f.operatorId]);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]);
  checkError(await request(f), 401, "AUTHENTICATION_REQUIRED"); checkError(await request(f, body), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await image(), before);
});
test("two actual same-key HTTP requests commit one revision, and altered original-key bytes cannot replace it", async () => {
  const f = await fixture(), body = input(f), result = await Promise.all([post(f, body), post(f, body)]);
  assert.equal(result.filter(v => v.changed).length, 1); assert.equal(result.filter(v => v.replayed).length, 1);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.media_credential_revisions WHERE credential_id=$1`, [f.credentialId])).rowCount, 1);
  const before = await image(); checkError(await request(f, { ...body, payloadBase64: Buffer.from('{"login":"changed","password":"different"}').toString("base64") }), 409, "IDEMPOTENCY_KEY_REUSED"); assert.deepEqual(await image(), before);
});
test("actual RETURN NULL audit fault returns only a safe server trace, rolls back all writes, and original intent succeeds after removal", async () => {
  const f = await fixture(), body = input(f), before = await image();
  await ddl(`CREATE FUNCTION ${s}.credential_api_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  await ddl(`CREATE TRIGGER credential_api_fault BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.credential_api_fault()`);
  try {
    const result = await request(f, body), error = checkError(result, 500, "INTERNAL_ERROR"); assert.notEqual(error.requestId, body.metadata.requestId);
    assert.ok(!JSON.stringify(error).includes(body.payloadBase64)); assert.deepEqual(await image(), before);
  } finally { await ddl(`DROP TRIGGER credential_api_fault ON ${s}.audit_records`); await ddl(`DROP FUNCTION ${s}.credential_api_fault()`); }
  assert.equal((await post(f, body)).changed, true);
});
test("actual JSON parser failures and native 413 use safe product envelopes without echoing secret bytes", async () => {
  const f = await fixture(), before = await image();
  const malformed = await request(f, undefined, { raw: '{"payloadBase64":"synthetic-parser-secret"' }); checkError(malformed, 400, "INPUT_INVALID"); assert.ok(!JSON.stringify(malformed.value).includes("synthetic-parser-secret"));
  const large = await request(f, undefined, { raw: JSON.stringify({ payloadBase64: "synthetic-oversize-secret".repeat(7000) }) }); checkError(large, 413, "INPUT_INVALID"); assert.ok(!JSON.stringify(large.value).includes("synthetic-oversize-secret")); assert.deepEqual(await image(), before);
});
