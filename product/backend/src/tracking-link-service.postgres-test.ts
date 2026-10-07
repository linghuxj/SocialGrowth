import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { contractVersion } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { TrackingLinkError, TrackingLinkPolicy } from "./tracking-link-policy.js";
import { TrackingLinkService } from "./tracking-link-service.js";
import { TrackingRedirectController } from "./tracking-redirect.controller.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Tracking tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-tracking-fixtures" });
const auth = new OperatorAuthService(pool, "isolated-tracking-auth-pepper-only-000001"), policy = new TrackingLinkPolicy({ revision: randomUUID(), allowedOrigins: ["https://example.org"] });
const service = new TrackingLinkService(pool, auth, policy), s = "socialgrowth_product";
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `tracking-${randomUUID()}` });
const code = (c: string) => (e: unknown) => (e instanceof TrackingLinkError || e instanceof ProductTransactionError) && e.code === c;
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic tracking fixture','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
async function scope(a: Awaited<ReturnType<typeof actor>>) {
  const projectId = randomUUID(), accountId = randomUUID(), identityId = randomUUID();
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic target project','company_owned',$2)`, [projectId, a.operatorId]);
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, `fixture-${accountId}`]);
  await pool.query(`INSERT INTO ${s}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`, [identityId, accountId, `fixture-${identityId}`]);
  await pool.query(`INSERT INTO ${s}.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, projectId]);
  return { projectId, identityId };
}
async function fixture() {
  const a = await actor(), p = await scope(a), input = { metadata: meta(), ...p, expectedProjectVersion: 0, configuredContentUnitId: randomUUID(), targetUrl: "https://example.org/business?campaign=fixture" };
  return { a, input };
}
const create = (f: Awaited<ReturnType<typeof fixture>>, patch = {}) => service.create(f.a.token, f.a.csrf, { ...f.input, ...patch });
const request = (path: string, patch = {}) => ({ recordId: randomUUID(), token: path.slice(3), method: "GET", recognizedPrefetch: false, ...patch });
async function counts(linkId: string) { return (await pool.query<{ records: number; commands: number; audits: number }>(`SELECT
  (SELECT count(*)::int FROM ${s}.tracking_link_requests WHERE link_id=$1) records,
  (SELECT count(*)::int FROM ${s}.tracking_link_commands WHERE link_id=$1) commands,
  (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='tracking_link' AND object_id=$1) audits`, [linkId])).rows[0]!; }
let baselineProject: string;
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const preceding = ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql",
    "0005_network_admission.sql", "0006_phone_control_journal.sql", "0007_task_recovery_budget.sql", "0008_project_basics.sql", "0009_resource_reservations.sql",
    "0010_project_planning_drafts.sql", "0011_unassigned_device_todos.sql", "0012_device_assistance_feed_index.sql", "0013_device_assistance_notes_index.sql"];
  for (const name of [...preceding, "0014_tracking_link_requests.sql"]) await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.tracking_links`)).rowCount, 0);
  await pool.query(`DROP SCHEMA ${s} CASCADE`);
  for (const name of preceding) await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  // Synthetic non-UI fixture only; cannot prove source provisioning/approval.
  baselineProject = (await scope(await actor())).projectId;
  await pool.query(await readFile(new URL("../migrations/0014_tracking_link_requests.sql", import.meta.url), "utf8"));
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
test("forward migration retains existing project/registry/reservations and empty request state", async () => {
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 AND fact_version=0 AND phase='preparing'`, [baselineProject])).rowCount, 1);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.project_account_reservations WHERE project_id=$1`, [baselineProject])).rowCount, 1);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.tracking_link_requests`)).rowCount, 0);
});
test("authenticated creation returns stable opaque path on exact replay without claiming source or approval", async () => {
  const f = await fixture(), first = await create(f), replay = await create(f, { metadata: { ...f.input.metadata, requestId: `request-${randomUUID()}` }, projectId: f.input.projectId.toUpperCase(), identityId: f.input.identityId.toUpperCase() });
  assert.deepEqual(replay, first); assert.match(first.path, /^\/r\/[A-Za-z0-9_-]{32}$/);
  assert.equal(first.path.includes(f.input.projectId), false); assert.equal(first.configuredContentUnitId, f.input.configuredContentUnitId);
  assert.equal("actualContentSource" in first, false); assert.equal("approved" in first, false); assert.equal("validPlatformPath" in first, false);
  assert.deepEqual(await counts(first.linkId), { records: 0, commands: 1, audits: 1 });
  await assert.rejects(create(f, { targetUrl: "https://example.org/other" }), code("IDEMPOTENCY_KEY_REUSED"));
  const facts = (await pool.query<{ facts: unknown }>(`SELECT facts FROM ${s}.audit_records WHERE object_id=$1`, [first.linkId])).rows[0]!.facts;
  assert.equal(JSON.stringify(facts).includes("https"), false); assert.equal(JSON.stringify(facts).includes(first.path), false);
});
test("missing/wrong CSRF, revoked session, cross-project identity and stale project facts cannot configure a link", async () => {
  const f = await fixture(), other = await scope(f.a);
  await assert.rejects(service.create(f.a.token, "", f.input), code("AUTHENTICATION_REQUIRED"));
  await assert.rejects(create(f, { identityId: other.identityId }), code("AUTHORIZATION_DENIED"));
  await assert.rejects(create(f, { expectedProjectVersion: 1 }), code("FACT_VERSION_STALE"));
  const first = await create(f);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.a.sessionId]);
  await assert.rejects(create(f), code("AUTHENTICATION_REQUIRED"));
  await assert.rejects(service.revoke(f.a.token, f.a.csrf, { metadata: meta(), linkId: first.linkId }), code("AUTHENTICATION_REQUIRED"));
  assert.deepEqual(await counts(first.linkId), { records: 0, commands: 1, audits: 1 });
});
test("genuine concurrent same-command creates converge on one path and independent actor keys remain independent", async () => {
  const f = await fixture(), rows = await Promise.all([create(f), create(f)]);
  assert.deepEqual(rows[0], rows[1]); assert.deepEqual(await counts(rows[0]!.linkId), { records: 0, commands: 1, audits: 1 });
  const b = await actor(), separate = await service.create(b.token, b.csrf, f.input);
  assert.notEqual(separate.linkId, rows[0]!.linkId); assert.notEqual(separate.path, rows[0]!.path);
});
test("real committed writes with only lost acknowledgement preserve original creation and request IDs on replay", async () => {
  const f = await fixture(); let once = true;
  // Failure injection AFTER the actual DB commit, not a fake success result.
  const faultPool = { connect: async () => {
    const client = await pool.connect();
    return { query: async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql, values);
      if (sql === "COMMIT" && once) { once = false; throw new Error("fixture-only-lost-ack"); }
      return result;
    }, release: () => client.release() } as unknown as PoolClient;
  } } as unknown as Pool;
  const fault = new TrackingLinkService(faultPool, auth, policy);
  await assert.rejects(fault.create(f.a.token, f.a.csrf, f.input), (e: unknown) => code("UNAVAILABLE")(e) && e instanceof TrackingLinkError && e.retryable && !e.cause);
  const link = await create(f); assert.deepEqual(await counts(link.linkId), { records: 0, commands: 1, audits: 1 });
  const r = request(link.path); once = true;
  await assert.rejects(fault.redirect(r), code("UNAVAILABLE"));
  assert.equal((await counts(link.linkId)).records, 1); assert.equal(await service.redirect(r), f.input.targetUrl); assert.equal((await counts(link.linkId)).records, 1);
});
test("GET journal stores unknown actual source even for a content-associated link and HEAD makes no record", async () => {
  const f = await fixture(), link = await create(f), r = request(link.path);
  assert.equal(await service.redirect(r), f.input.targetUrl);
  assert.equal(await service.redirect(request(link.path, { method: "HEAD" })), f.input.targetUrl);
  const row = (await pool.query<{ classification: string; actual_content_source: string; definition: string }>(`SELECT * FROM ${s}.tracking_link_requests WHERE record_id=$1`, [r.recordId])).rows[0]!;
  assert.equal(row.actual_content_source, "unknown"); assert.equal(row.classification, "request"); assert.equal(row.definition, "request_records_prefetch_v1");
  await assert.rejects(pool.query(`UPDATE ${s}.tracking_link_requests SET classification='recognized_prefetch' WHERE record_id=$1`, [r.recordId]), (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === "P0001");
  assert.deepEqual(await counts(link.linkId), { records: 1, commands: 1, audits: 1 });
  assert.equal("viewer_ip" in row, false); assert.equal("user_agent" in row, false); assert.equal("arrival" in row, false);
});
test("same record replay and concurrent processes journal once; incompatible reused record cannot disclose another target", async () => {
  const f = await fixture(), link = await create(f), r = request(link.path), second = new TrackingLinkService(pool, auth, policy);
  const values = await Promise.all([service.redirect(r), second.redirect(r)]); assert.deepEqual(values, [f.input.targetUrl, f.input.targetUrl]);
  assert.equal(await service.redirect(r), f.input.targetUrl);
  await assert.rejects(service.redirect({ ...r, recognizedPrefetch: true }), code("RECORD_ID_REUSED"));
  const other = await create(await fixture());
  await assert.rejects(service.redirect({ ...r, token: other.path.slice(3) }), code("RECORD_ID_REUSED"));
  assert.equal((await counts(link.linkId)).records, 1); assert.equal((await counts(other.linkId)).records, 0);
});
test("prefetch records remain auditable but cannot be counted as ordinary request records", async () => {
  const link = await create(await fixture());
  await service.redirect(request(link.path, { recognizedPrefetch: true })); await service.redirect(request(link.path));
  const rows = await pool.query<{ classification: string; count: number }>(`SELECT classification,count(*)::int FROM ${s}.tracking_link_requests WHERE link_id=$1 GROUP BY classification`, [link.linkId]);
  assert.deepEqual(rows.rows.sort((a, b) => a.classification.localeCompare(b.classification)), [{ classification: "recognized_prefetch", count: 1 }, { classification: "request", count: 1 }]);
});
test("revoke is idempotent and creation replay reports current revoked status without reopening the link", async () => {
  const f = await fixture(), link = await create(f), r = { metadata: meta(), linkId: link.linkId };
  assert.deepEqual(await service.revoke(f.a.token, f.a.csrf, r), { linkId: link.linkId, status: "revoked" });
  assert.deepEqual(await service.revoke(f.a.token, f.a.csrf, r), { linkId: link.linkId, status: "revoked" });
  assert.equal((await create(f)).status, "revoked");
  await assert.rejects(service.redirect(request(link.path)), code("NOT_FOUND"));
  assert.deepEqual(await counts(link.linkId), { records: 0, commands: 2, audits: 2 });
  await assert.rejects(pool.query(`UPDATE ${s}.tracking_links SET status='active',revoked_at=NULL WHERE link_id=$1`, [link.linkId]), (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === "P0001");
  await assert.rejects(service.revoke(f.a.token, f.a.csrf, { ...r, metadata: f.input.metadata }), code("IDEMPOTENCY_KEY_REUSED"));
});
test("actual GET row lock and request-journal wait serialize revocation, later requests cannot use revoked target", async () => {
  const f = await fixture(), link = await create(f), blocker = await pool.connect(); let get: Promise<string> | undefined, revoked: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query(`LOCK TABLE ${s}.tracking_link_requests IN EXCLUSIVE MODE`);
    get = service.redirect(request(link.path)); void get.catch(() => undefined);
    async function waiting(min: number) {
      for (let i = 0; i < 200; i++) {
        const n = (await pool.query<{ count: number }>("SELECT count(*)::int FROM pg_stat_activity WHERE application_name='sg-tracking-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0]!.count;
        if (n >= min) return; await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail("Expected actual database lock wait was not observed");
    }
    await waiting(1); revoked = service.revoke(f.a.token, f.a.csrf, { metadata: meta(), linkId: link.linkId });
    void revoked.catch(() => undefined); await waiting(2);
    assert.equal((await pool.query<{ status: string }>(`SELECT status FROM ${s}.tracking_links WHERE link_id=$1`, [link.linkId])).rows[0]!.status, "active");
    await blocker.query("COMMIT"); assert.equal(await get, f.input.targetUrl); await revoked;
    await assert.rejects(service.redirect(request(link.path)), code("NOT_FOUND")); assert.equal((await counts(link.linkId)).records, 1);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await get?.catch(() => undefined); await revoked?.catch(() => undefined); }
});
test("policy removal/change and corrupt target fail closed; request/query actor claims do not enter the schema", async () => {
  const f = await fixture(), link = await create(f);
  await assert.rejects(new TrackingLinkService(pool, auth, null).redirect(request(link.path)), code("NOT_FOUND"));
  await assert.rejects(new TrackingLinkService(pool, auth, new TrackingLinkPolicy({ revision: randomUUID(), allowedOrigins: ["https://example.org"] })).redirect(request(link.path)), code("NOT_FOUND"));
  for (const patch of [{ targetUrl: "https://evil.com" }, { actor: f.a.operatorId }, { actualContentSource: f.input.configuredContentUnitId }, { token: "invalid" }]) await assert.rejects(service.redirect(request(link.path, patch)), code("NOT_FOUND"));
  await assert.rejects(pool.query(`UPDATE ${s}.tracking_links SET target_url='javascript:fixture-secret' WHERE link_id=$1`, [link.linkId]), (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === "P0001");
  // Administrative corruption fixture only, with protection restored; not a
  // service path or business-state bypass. Only this synthetic schema exists.
  await pool.query(`ALTER TABLE ${s}.tracking_links DISABLE TRIGGER tracking_link_immutable`);
  try {
    await pool.query(`UPDATE ${s}.tracking_links SET target_url='javascript:fixture-secret' WHERE link_id=$1`, [link.linkId]);
    await assert.rejects(service.redirect(request(link.path)), (e: unknown) => code("NOT_FOUND")(e) && !String(e).includes("fixture-secret"));
  } finally { await pool.query(`ALTER TABLE ${s}.tracking_links ENABLE TRIGGER tracking_link_immutable`); }
  assert.equal((await counts(link.linkId)).records, 0);
});
test("audit failure rolls back link/command and journal failure refuses Location with no raw database detail", async () => {
  const f = await fixture();
  await pool.query(`CREATE FUNCTION ${s}.tracking_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='tracking_link' THEN RAISE EXCEPTION 'fixture-secret-tracking'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER tracking_audit_fail BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.tracking_audit_fail()`);
  try {
    await assert.rejects(create(f), (e: unknown) => code("UNAVAILABLE")(e) && !String(e).includes("fixture-secret") && e instanceof TrackingLinkError && e.retryable);
    assert.equal((await pool.query(`SELECT 1 FROM ${s}.tracking_links WHERE project_id=$1`, [f.input.projectId])).rowCount, 0);
  } finally { await pool.query(`DROP TRIGGER tracking_audit_fail ON ${s}.audit_records`); await pool.query(`DROP FUNCTION ${s}.tracking_audit_fail()`); }
  const link = await create(f);
  await pool.query(`CREATE FUNCTION ${s}.tracking_record_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-secret-tracking'; END $$`);
  await pool.query(`CREATE TRIGGER tracking_record_fail BEFORE INSERT ON ${s}.tracking_link_requests FOR EACH ROW EXECUTE FUNCTION ${s}.tracking_record_fail()`);
  try { await assert.rejects(service.redirect(request(link.path)), (e: unknown) => code("UNAVAILABLE")(e) && !String(e).includes("fixture-secret")); }
  finally { await pool.query(`DROP TRIGGER tracking_record_fail ON ${s}.tracking_link_requests`); await pool.query(`DROP FUNCTION ${s}.tracking_record_fail()`); }
  assert.equal((await counts(link.linkId)).records, 0);
});
test("expiry while blocked on project metadata cannot create late link or command", async () => {
  const f = await fixture(), blocker = await pool.connect(); let pending: Promise<unknown> | undefined;
  await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE session_id=$1`, [f.a.sessionId]);
  try {
    await blocker.query("BEGIN"); await blocker.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [f.input.projectId]);
    pending = create(f); const denied = assert.rejects(pending, code("AUTHENTICATION_REQUIRED")); let waiting = false;
    for (let i = 0; i < 200; i++) {
      if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-tracking-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()")).rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(waiting); let expired = false;
    for (let i = 0; i < 200; i++) {
      if ((await pool.query<{ expired: boolean }>(`SELECT expires_at<=clock_timestamp() expired FROM ${s}.operator_sessions WHERE session_id=$1`, [f.a.sessionId])).rows[0]?.expired) { expired = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(expired); await blocker.query("COMMIT"); await denied;
    assert.equal((await pool.query(`SELECT 1 FROM ${s}.tracking_links WHERE project_id=$1`, [f.input.projectId])).rowCount, 0);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); }
});
test("real Nest HTTP GET/HEAD redirect and no-store/body/source boundaries with genuine PG journal, not Web acceptance", async () => {
  const f = await fixture(), link = await create(f);
  @Module({ controllers: [TrackingRedirectController], providers: [{ provide: TrackingLinkService, useValue: service }] }) class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  try {
    await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
    for (const method of ["HEAD", "GET"]) {
      const response = await fetch(`${base}${link.path}?target=https://evil.com&contentId=${randomUUID()}`, { method, redirect: "manual", headers: { "x-request-id": "viewer-must-not-pin-record-id", "referer": "https://evil.com/claimed-content" } });
      assert.equal(response.status, 302); assert.equal(response.headers.get("location"), f.input.targetUrl); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.equal(await response.text(), ""); assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal((await counts(link.linkId)).records, 1); // HEAD did not run the GET handler.
    const prefetch = await fetch(`${base}${link.path}`, { redirect: "manual", headers: { "sec-purpose": "prefetch" } }); assert.equal(prefetch.status, 302);
    assert.equal((await pool.query(`SELECT 1 FROM ${s}.tracking_link_requests WHERE link_id=$1 AND classification='recognized_prefetch' AND actual_content_source='unknown'`, [link.linkId])).rowCount, 1);
    const unknown = await fetch(`${base}/r/${"A".repeat(32)}`, { redirect: "manual" }); assert.equal(unknown.status, 404); assert.equal(unknown.headers.get("location"), null);
    await pool.query(`CREATE FUNCTION ${s}.tracking_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-http-secret'; END $$`);
    await pool.query(`CREATE TRIGGER tracking_http_fail BEFORE INSERT ON ${s}.tracking_link_requests FOR EACH ROW EXECUTE FUNCTION ${s}.tracking_http_fail()`);
    try {
      const failed = await fetch(`${base}${link.path}`, { redirect: "manual" }); assert.equal(failed.status, 503); assert.equal(failed.headers.get("location"), null);
      assert.equal(await failed.text(), ""); assert.equal(failed.headers.get("cache-control"), "no-store"); assert.equal((await counts(link.linkId)).records, 2);
    } finally { await pool.query(`DROP TRIGGER tracking_http_fail ON ${s}.tracking_link_requests`); await pool.query(`DROP FUNCTION ${s}.tracking_http_fail()`); }
    await service.revoke(f.a.token, f.a.csrf, { metadata: meta(), linkId: link.linkId });
    const revoked = await fetch(`${base}${link.path}`, { redirect: "manual" }); assert.equal(revoked.status, 404); assert.equal(revoked.headers.get("location"), null);
    assert.equal((await counts(link.linkId)).records, 2);
  } finally { await app.close(); }
});
