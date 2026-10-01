import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { contractVersion, registerMediaIdentityResponseSchema, resourcePreparationResponseSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
const cluster = process.env.SG_PRODUCT_TEST_CLUSTER_ID;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || !cluster || !/^\d+$/.test(cluster)
  || new URL(url).hostname !== "127.0.0.1" || !/^sg_wp13_preparation_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1))) {
  throw new Error("Resource preparation supplemental checks require an owned isolated loopback database and verified cluster ID");
}
const s = "socialgrowth_product", pool = new Pool({ connectionString: url, max: 8, application_name: "sg-wp13-preparation-fixtures" });
let app: INestApplication | undefined, base: string;
interface HttpRequest { headers: Record<string, string | string[] | undefined>; path: string }
interface HttpResponse { json(body: unknown): HttpResponse; socket?: { destroy(): void } | null }
async function guard(target = pool, database = new URL(url!).pathname.slice(1)) {
  const row = (await target.query("SELECT current_database() database,system_identifier::text cluster FROM pg_control_system()" )).rows[0];
  assert.equal(row.database, database); assert.equal(row.cluster, cluster);
}
async function start() {
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new ProductExceptionFilter());
  // Actual transport ACK loss after the real controller/store commits. No
  // mocked business response or success fixture; original HTTP body is lost.
  app.use((req: HttpRequest, res: HttpResponse, next: () => void) => {
    if (req.headers["x-test-drop-ack"] === "1" && req.path === "/api/operator/resources/identities") {
      res.json = (_body: unknown) => { res.socket?.destroy(); return res; };
    }
    next();
  });
  await app.listen(0, "127.0.0.1"); base = await app.getUrl();
  await guard(app.get(Pool));
}
before(async () => {
  await guard(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) {
    await guard(); await pool.query(await readFile(new URL(file, dir), "utf8"));
  }
  process.env.SG_PRODUCT_DATABASE_URL = url;
  process.env.SG_PRODUCT_AUTH_PEPPER = "synthetic-resource-preparation-pepper-00001";
  process.env.SG_PRODUCT_SMS_MODE = "unavailable"; process.env.SG_PRODUCT_MATERIAL_MODE = "unavailable";
  delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN;
  for (const key of ["LOCATION_ID", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "SESSION_TOKEN", "MAX_OBJECT_BYTES", "REQUEST_TIMEOUT_MS"]) delete process.env[`SG_PRODUCT_MATERIAL_${key}`];
  await start();
});
after(async () => {
  try { await app?.close(); await guard(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); }
  finally { await pool.end(); }
});
// Synthetic existing operator/project/associated-pending device facts only.
// These do not prove real registration, association, network or media identity.
async function fixture() {
  await guard();
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic preparation','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  const projectId = randomUUID(), deviceId = randomUUID();
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic preparation','company_owned',$2)`, [projectId, operatorId]);
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state) VALUES($1,'Synthetic preparation','associated_pending_access')`, [deviceId]);
  return { operatorId, sessionId, token, csrf, projectId, deviceId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `resource-${randomUUID()}` });
const declared = (platform: "facebook" | "youtube" = "facebook") => ({ accountId: randomUUID(), identityId: randomUUID(), platform,
  canonicalAccountRef: `declared_${randomUUID().replaceAll("-", "")}`, canonicalIdentityRef: `declared_${randomUUID().replaceAll("-", "")}` });
async function request(f: Fixture, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/api/operator/resources/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, value: await response.json() as unknown };
}
function code(result: { status: number; value: unknown }, status: number, expected: string) {
  assert.equal(result.status, status); assert.equal(productErrorResponseSchema.parse(result.value).error.code, expected);
}
async function current(f: Fixture) {
  const result = await request(f, "preparation"); assert.equal(result.status, 200); return resourcePreparationResponseSchema.parse(result.value);
}
async function registerInput(f: Fixture, registration = declared()) { return { metadata: metadata(), expectedResourceVersion: (await current(f)).version, registration }; }
async function register(f: Fixture, body: Awaited<ReturnType<typeof registerInput>>) {
  const result = await request(f, "identities", body); assert.equal(result.status, 201); return registerMediaIdentityResponseSchema.parse(result.value);
}
async function reserveInput(f: Fixture, ids: string[]) { return { metadata: metadata(), expectedResourceVersion: (await current(f)).version,
  expectedProjectVersion: 0, expectedDeviceVersion: 0, reservation: { projectId: f.projectId, deviceId: f.deviceId, identityIds: ids } }; }
async function totals() {
  return (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.media_accounts) accounts,
    (SELECT count(*)::int FROM ${s}.publishing_identities) identities,(SELECT count(*)::int FROM ${s}.media_registry_commands) registry_commands,
    (SELECT count(*)::int FROM ${s}.resource_reservation_commands) reservations,(SELECT count(*)::int FROM ${s}.project_identity_reservations) bindings,
    (SELECT count(*)::int FROM ${s}.audit_records) audits,(SELECT version::text FROM ${s}.resource_reservation_guard) version`)).rows[0];
}
test("actual empty resource read is pending-only and read does not create a grant or any journal entry", async () => {
  const f = await fixture(), before = await totals();
  const view = await current(f); assert.deepEqual(view.snapshot, { accounts: [], identities: [], phones: [], accountUses: [], bindings: [] });
  assert.equal(view.actionPermissionGranted, false); assert.equal(view.acceptanceStarted, false); assert.deepEqual(await totals(), before);
});
test("actual reference registration, distinct Page under same login, and exact new-key no-op are durable unverified facts", async () => {
  const f = await fixture(), input = await registerInput(f), first = await register(f, input);
  assert.equal(first.state, "registered_unverified"); assert.equal(first.changed, true); assert.equal(first.acceptanceStarted, false); assert.equal(first.actionPermissionGranted, false);
  const before = await totals(), noOp = await register(f, await registerInput(f, input.registration));
  assert.equal(noOp.changed, false); assert.equal(noOp.replayed, false); assert.equal(noOp.version, first.version);
  assert.deepEqual(await totals(), { ...before, registry_commands: before.registry_commands + 1 });
  const page2 = { ...input.registration, identityId: randomUUID(), canonicalIdentityRef: declared().canonicalIdentityRef };
  await register(f, await registerInput(f, page2)); const view = await current(f);
  assert.equal(view.snapshot.accounts.filter(a => a.accountId === page2.accountId).length, 1);
  assert.equal(view.snapshot.identities.filter(i => i.accountId === page2.accountId).length, 2);
  const audit = (await pool.query(`SELECT actor_id,facts FROM ${s}.audit_records WHERE object_id=$1`, [page2.identityId])).rows[0];
  assert.equal(audit.actor_id, f.operatorId); assert.equal(audit.facts.state, "registered_unverified");
  for (const value of [input.registration.canonicalAccountRef, page2.canonicalIdentityRef, f.token, f.csrf]) assert.ok(!JSON.stringify(audit).includes(value));
});
test("actual dropped transport ACK after commit restarts and replays original key at current version without duplicate registration", async () => {
  const f = await fixture(), input = await registerInput(f), before = await totals();
  await assert.rejects(request(f, "identities", input, { "x-test-drop-ack": "1" }));
  const committed = await totals(); assert.equal(committed.registry_commands, before.registry_commands + 1); assert.equal(committed.identities, before.identities + 1);
  await register(f, await registerInput(f)); await app!.close(); await start();
  const currentVersion = (await current(f)).version, prior = await totals();
  const replay = await register(f, { ...input, metadata: { ...input.metadata, requestId: metadata().requestId } });
  assert.equal(replay.replayed, true); assert.equal(replay.changed, false); assert.equal(replay.version, currentVersion); assert.deepEqual(replay.registration, input.registration);
  assert.deepEqual(await totals(), prior);
});
test("actual source aliases, UUID substitutions, platform changes and rewiring cannot overwrite immutable registry references", async () => {
  const f = await fixture(), input = await registerInput(f); await register(f, input); const before = await totals();
  for (const registration of [{ ...input.registration, accountId: randomUUID() }, { ...input.registration, identityId: randomUUID() },
    { ...input.registration, canonicalAccountRef: "different_login" }, { ...input.registration, canonicalIdentityRef: "different_page" },
    { ...input.registration, platform: "youtube" }]) {
    code(await request(f, "identities", await registerInput(f, registration as ReturnType<typeof declared>)), 409, "FACT_VERSION_STALE");
  }
  assert.deepEqual(await totals(), before);
});
test("actual same actor/key cannot substitute registration, version or scope; another active operator remains same-power", async () => {
  const f = await fixture(), other = await fixture(), input = await registerInput(f); await register(f, input); const before = await totals();
  for (const patch of [{ registration: declared() }, { expectedResourceVersion: input.expectedResourceVersion + 1 }])
    code(await request(f, "identities", { ...input, ...patch }), 409, "IDEMPOTENCY_KEY_REUSED");
  assert.deepEqual(await totals(), before);
  const noOp = await register(other, await registerInput(other, input.registration)); assert.equal(noOp.changed, false); assert.equal(noOp.replayed, false);
});
test("actual concurrent registry writers at one version have one winner and safe original losing request can be refreshed explicitly", async () => {
  const f = await fixture(), a = await registerInput(f), b = await registerInput(f), before = await totals();
  const responses = await Promise.all([request(f, "identities", a), request(f, "identities", b)]);
  assert.equal(responses.filter(r => r.status === 201).length, 1); assert.equal(responses.filter(r => r.status === 409).length, 1);
  code(responses.find(r => r.status === 409)!, 409, "FACT_VERSION_STALE");
  const loser = responses[0]!.status === 409 ? a : b;
  assert.equal((await totals()).registry_commands, before.registry_commands + 1);
  // Explicit revised intent only after definite stale rejection; not recovery of
  // an unknown commit. Keep its original identity IDs and request key.
  await register(f, { ...loser, expectedResourceVersion: (await current(f)).version });
  assert.equal((await totals()).identities, before.identities + 2);
});
test("actual FB and YT preparation preserves pending state, pause and project phase; reservation replay and new-key no-op do not grant acceptance", async () => {
  const f = await fixture(), fb = (await register(f, await registerInput(f))).registration;
  const yt = (await register(f, await registerInput(f, declared("youtube")))).registration;
  await pool.query(`UPDATE ${s}.devices SET state='paused' WHERE device_id=$1`, [f.deviceId]);
  const input = await reserveInput(f, [yt.identityId, fb.identityId]);
  const response = await request(f, "reservations", input); assert.equal(response.status, 201);
  const saved = resourcePreparationResponseSchema.parse(response.value);
  assert.ok(saved.snapshot.bindings.filter(b => b.deviceId === f.deviceId).every(b => b.state === "pending_initialization"));
  assert.equal(saved.acceptanceStarted, false); assert.equal(saved.actionPermissionGranted, false);
  const before = await totals(), replay = resourcePreparationResponseSchema.parse((await request(f, "reservations", { ...input,
    metadata: { ...input.metadata, requestId: metadata().requestId }, reservation: { ...input.reservation, identityIds: [fb.identityId, yt.identityId] } })).value);
  assert.equal(replay.replayed, true); assert.deepEqual(await totals(), before);
  const noOp = await request(f, "reservations", await reserveInput(f, [fb.identityId, yt.identityId])); assert.equal(noOp.status, 201);
  assert.deepEqual(await totals(), { ...before, reservations: before.reservations + 1 });
  assert.equal((await pool.query(`SELECT state FROM ${s}.devices WHERE device_id=$1`, [f.deviceId])).rows[0].state, "paused");
  assert.equal((await pool.query(`SELECT phase FROM ${s}.projects WHERE project_id=$1`, [f.projectId])).rows[0].phase, "preparing");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.commission_income_sources`)).rows[0].n, 0);
});
test("actual resource handover, duplicate slots and bad device/project versions cannot be bypassed via HTTP", async () => {
  const f = await fixture(), other = await fixture(), registration = (await register(f, await registerInput(f))).registration;
  const input = await reserveInput(f, [registration.identityId]); assert.equal((await request(f, "reservations", input)).status, 201); const before = await totals();
  code(await request(other, "reservations", await reserveInput(other, [registration.identityId])), 409, "FACT_VERSION_STALE");
  for (const patch of [{ expectedDeviceVersion: 1 }, { expectedProjectVersion: 1 }]) code(await request(f, "reservations", { ...await reserveInput(f, [registration.identityId]), ...patch }), 409, "FACT_VERSION_STALE");
  code(await request(f, "reservations", await reserveInput(f, [registration.identityId, registration.identityId])), 400, "INPUT_INVALID");
  assert.deepEqual(await totals(), before);
});
test("actual malformed Cookie, missing CSRF, provider bearer, credential-version change, disable and revoke never write or replay", async () => {
  const f = await fixture(), input = await registerInput(f), before = await totals();
  const badHeaders: Record<string, string>[] = [{ cookie: "", authorization: `Bearer ${f.token}` }, { cookie: `__Host-sg_operator_session=${f.token}=suffix` },
    { cookie: `__Host-sg_operator_session=${f.token}; __Host-sg_operator_session=${f.token}` }, { "x-csrf-token": "" }];
  for (const headers of badHeaders) {
    code(await request(f, "identities", input, headers), 401, "AUTHENTICATION_REQUIRED");
  }
  assert.deepEqual(await totals(), before); await register(f, input); const committed = await totals();
  await pool.query(`UPDATE ${s}.operators SET credential_version=2 WHERE operator_id=$1`, [f.operatorId]); code(await request(f, "identities", input), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET credential_version=1,status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [f.operatorId]); code(await request(f, "preparation"), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET status='active',disabled_at=NULL WHERE operator_id=$1`, [f.operatorId]);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]);
  code(await request(f, "identities", input), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await totals(), committed);
});
test("actual strict body rejects credentials, claimed readiness/actor, bad canonical format and unsupported version before registry writes", async () => {
  const f = await fixture(), input = await registerInput(f), before = await totals();
  for (const patch of [{ actorId: f.operatorId }, { actionPermissionGranted: true }, { registration: { ...input.registration, password: "synthetic-forbidden" } },
    { registration: { ...input.registration, canonicalIdentityRef: "https://fixture.invalid" } }, { registration: { ...input.registration, identityId: input.registration.identityId.toUpperCase() } },
    { metadata: { ...input.metadata, idempotencyKey: "not permitted key--000" } }, { metadata: { ...input.metadata, contractVersion: "future" } }]) {
    code(await request(f, "identities", { ...input, ...patch }), 400, patch.metadata?.contractVersion === "future" ? "CONTRACT_VERSION_UNSUPPORTED" : "INPUT_INVALID");
  }
  assert.deepEqual(await totals(), before);
});
test("actual registration audit failure rolls back account, identity, guard and command together; original request can resume", async () => {
  const f = await fixture(), input = await registerInput(f), before = await totals(); await guard();
  await pool.query(`CREATE FUNCTION ${s}.fail_media_registry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='resource.media_reference_registered' THEN RAISE EXCEPTION 'synthetic-private-database-value'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER registry_audit_fault BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.fail_media_registry_audit()`);
  try {
    const result = await request(f, "identities", input); code(result, 500, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(result.value).includes("synthetic-private")); assert.deepEqual(await totals(), before);
  } finally { await guard(); await pool.query(`DROP TRIGGER registry_audit_fault ON ${s}.audit_records`); await pool.query(`DROP FUNCTION ${s}.fail_media_registry_audit()`); }
  await register(f, input);
});
test("actual session expiry during resource guard wait rejects registration and read using database deadline", async () => {
  const f = await fixture(), input = await registerInput(f), before = await totals(), holder = await pool.connect();
  try {
    await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '700 milliseconds' WHERE session_id=$1`, [f.sessionId]);
    await holder.query("BEGIN"); await holder.query(`SELECT 1 FROM ${s}.resource_reservation_guard FOR UPDATE`);
    const pending = request(f, "identities", input); let observed = false, expired = false;
    for (let index = 0; index < 250; index++) {
      const row = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%resource_reservation_guard%' AND pid<>pg_backend_pid()) waiting,
        (SELECT expires_at<=clock_timestamp() FROM ${s}.operator_sessions WHERE session_id=$1) expired`, [f.sessionId])).rows[0];
      observed ||= row.waiting; expired = row.expired; if (observed && expired) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed && expired); await holder.query("COMMIT"); code(await pending, 401, "AUTHENTICATION_REQUIRED");
    code(await request(f, "preparation"), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await totals(), before);
  } finally { await holder.query("ROLLBACK"); holder.release(); }
});
test("actual RETURN NULL suppression of every registration write fails closed and rolls back the full journal", async () => {
  const f = await fixture();
  const targets = [["media_accounts", "INSERT"], ["publishing_identities", "INSERT"], ["resource_reservation_guard", "UPDATE"],
    ["audit_records", "INSERT"], ["media_registry_commands", "INSERT"]] as const;
  for (const [table, event] of targets) {
    const input = await registerInput(f), before = await totals(); await guard();
    await pool.query(`CREATE FUNCTION ${s}.suppress_registry_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
    await pool.query(`CREATE TRIGGER suppress_registry BEFORE ${event} ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.suppress_registry_write()`);
    try {
      code(await request(f, "identities", input), 500, "INTERNAL_ERROR"); assert.deepEqual(await totals(), before, table);
    } finally {
      await guard(); await pool.query(`DROP TRIGGER suppress_registry ON ${s}.${table}`); await pool.query(`DROP FUNCTION ${s}.suppress_registry_write()`);
    }
    // Original key/identity may resume only after failed transaction; no swap.
    await register(f, input);
  }
});
test("actual 0022 forward migration preserves existing immutable media references on the preceding 0021 schema", async () => {
  const database = `${new URL(url!).pathname.slice(1)}_upgrade`, upgradeUrl = new URL(url!); upgradeUrl.pathname = `/${database}`;
  await guard(); assert.equal((await pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [database])).rowCount, 0);
  await pool.query(`CREATE DATABASE ${database}`);
  const target = new Pool({ connectionString: upgradeUrl.toString(), max: 1 });
  try {
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f) && f < "0022").sort()) {
      await guard(target, database); await target.query(await readFile(new URL(file, dir), "utf8"));
    }
    const registration = declared();
    await target.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,$2,$3)`, [registration.accountId, registration.platform, registration.canonicalAccountRef]);
    await target.query(`INSERT INTO ${s}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,$3,$4)`, [registration.identityId, registration.accountId, registration.platform, registration.canonicalIdentityRef]);
    const previous = await target.query(`SELECT * FROM ${s}.publishing_identities`);
    await guard(target, database); await target.query(await readFile(new URL("0022_media_registry_commands.sql", dir), "utf8"));
    assert.deepEqual((await target.query(`SELECT * FROM ${s}.publishing_identities`)).rows, previous.rows);
    assert.equal((await target.query(`SELECT count(*)::int n FROM ${s}.media_registry_commands`)).rows[0].n, 0);
    const dbCode = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P0001";
    await assert.rejects(target.query(`UPDATE ${s}.publishing_identities SET canonical_identity_ref='replacement' WHERE identity_id=$1`, [registration.identityId]), dbCode);
    await guard(target, database); await target.query(`DROP SCHEMA ${s} CASCADE`);
  } finally {
    await target.end(); await guard(); await pool.query(`DROP DATABASE ${database}`);
  }
});
