import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { contractVersion, executionLibraryVersion, accountPreparationWorkspaceSchema, productErrorResponseSchema, artemisPreparationAssignmentSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
import { PostgresArtemisPreparationJournal } from "./artemis-preparation-journal.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, cluster = process.env.SG_PRODUCT_TEST_CLUSTER_ID;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || !cluster || !/^\d+$/.test(cluster)
  || new URL(url).hostname !== "127.0.0.1" || !/^sg_preparation2_component$/.test(new URL(url).pathname.slice(1))) throw new Error("Owned isolated preparation component DB required");
const s = "socialgrowth_product", pool = new Pool({ connectionString: url });
let app: INestApplication, base: string;
async function guard() { const row = (await pool.query("select current_database() db,system_identifier::text cluster from pg_control_system()")).rows[0]; assert.equal(row.db, "sg_preparation2_component"); assert.equal(row.cluster, cluster); }
async function start() {
  app = await NestFactory.create(AppModule, { logger: false }); app.useGlobalFilters(new ProductExceptionFilter());
  app.use((req: { path: string; headers: Record<string, string> }, res: { json: (value: unknown) => unknown; socket: { destroy(): void } }, next: () => void) => {
    if (req.headers["x-test-drop-ack"] === "1" && req.path.endsWith("/account-preparation/request")) res.json = () => { res.socket.destroy(); return res; };
    next();
  });
  await app.listen(0, "127.0.0.1"); base = await app.getUrl();
}
before(async () => {
  await guard(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) { await guard(); await pool.query(await readFile(new URL(f, dir), "utf8")); }
  process.env.SG_PRODUCT_DATABASE_URL = url; process.env.SG_PRODUCT_AUTH_PEPPER = "synthetic-preparation-component-pepper-01";
  process.env.SG_PRODUCT_SMS_MODE = "unavailable"; process.env.SG_PRODUCT_MATERIAL_MODE = "unavailable";
  delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN; await start();
});
after(async () => { try { await app?.close(); await guard(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
async function fixture() {
  const actor = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID();
  const hash = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic prep','not-a-password','active')`, [actor, `fixture-${actor}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at,created_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day',clock_timestamp()-interval '1 hour')`, [sessionId, actor, hash(token), hash(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic prep','company_owned',$2)`, [projectId, actor]);
  return { actor, token, csrf, sessionId, projectId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `preparation-${randomUUID()}` });
function input(f: Fixture) { return { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId: f.projectId,
  expectedProjectVersion: 0, expectedResourceVersion: 0, intent: { accountId: null as string | null, deviceId: null as string | null,
    parentLoginRef: `parent_${randomUUID().replaceAll("-", "")}`, mode: "check_only", target: { platform: "facebook", name: "Synthetic Page", expectedId: null, category: null, description: "" },
    scopeRef: "synthetic-scope", allowTrustedInstall: false, allowIdentityCreation: false } }; }
async function request(f: Fixture, path = "", body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/api/operator/projects/${f.projectId}/account-preparation${path ? "/" + path : ""}`, {
    method: body === undefined ? "GET" : "POST", headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(r.headers.get("cache-control"), "no-store"); return { status: r.status, body: await r.json() as unknown };
}
const workspace = (r: { status: number; body: unknown }) => { assert.ok([200, 201].includes(r.status)); return accountPreparationWorkspaceSchema.parse(r.body); };
const code = (r: { status: number; body: unknown }, status: number, expected: string) => { assert.equal(r.status, status); assert.equal(productErrorResponseSchema.parse(r.body).error.code, expected); };
async function totals() { return (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.account_preparation_tasks) tasks,(SELECT count(*)::int FROM ${s}.account_preparation_commands) commands,(SELECT count(*)::int FROM ${s}.account_preparation_checks) checks,(SELECT count(*)::int FROM ${s}.audit_records) audits`)).rows[0]; }
test("GET is read-only; real request durably reports missing resources with no permission or fake success", async () => {
  const f = await fixture(), before = await totals(); assert.equal(workspace(await request(f)).tasks.length, 0); assert.deepEqual(await totals(), before);
  const w = workspace(await request(f, "request", input(f))); const t = w.tasks[0]!;
  assert.equal(t.state, "waiting_resources"); assert.equal(t.nextOperationId, null); assert.equal(t.actionPermissionGranted, false); assert.equal(t.acceptanceStarted, false);
  assert.deepEqual(await totals(), { tasks: before.tasks + 1, commands: before.commands + 1, checks: before.checks + 1, audits: before.audits + 1 });
});
test("transport ACK loss and process reconstruction recover same original task without another check", async () => {
  const f = await fixture(), r = input(f); await assert.rejects(request(f, "request", r, { "x-test-drop-ack": "1" }));
  const original = workspace(await request(f)).tasks[0]!, before = await totals(); await app.close(); await start();
  const recovered = workspace(await request(f, "request", { ...r, metadata: { ...r.metadata, requestId: metadata().requestId } }));
  assert.equal(recovered.tasks[0]!.taskId, original.taskId); assert.deepEqual(await totals(), before);
});
test("concurrent same-scope requests create one central task and one check; changed scope cannot replace it", async () => {
  const f = await fixture(), r = input(f), before = await totals();
  const results = await Promise.all([request(f, "request", r), request(f, "request", { ...r, metadata: metadata() })]);
  const ids = results.map(r => workspace(r).tasks[0]!.taskId); assert.equal(ids[0], ids[1]);
  assert.deepEqual(await totals(), { tasks: before.tasks + 1, commands: before.commands + 2, checks: before.checks + 1, audits: before.audits + 1 });
  const current = await totals(); code(await request(f, "request", { ...r, metadata: metadata(), intent: { ...r.intent, allowIdentityCreation: true } }), 409, "FACT_VERSION_STALE"); assert.deepEqual(await totals(), current);
});
test("same key cannot change payload/kind; forged evidence/permissions and wrong paths are rejected", async () => {
  const f = await fixture(), r = input(f); workspace(await request(f, "request", r)); const before = await totals();
  code(await request(f, "request", { ...r, intent: { ...r.intent, allowTrustedInstall: true } }), 409, "IDEMPOTENCY_KEY_REUSED");
  code(await request(f, "request", { ...input(f), facts: { app: "ready" } }), 400, "INPUT_INVALID");
  code(await request(f, "request", { ...input(f), actionPermissionGranted: true }), 400, "INPUT_INVALID");
  code(await request(f, "request", { ...input(f), projectId: randomUUID() }), 400, "INPUT_INVALID"); assert.deepEqual(await totals(), before);
});
test("recheck changes original task version once; replay and stale retry cannot generate a new attempt", async () => {
  const f = await fixture(), w = workspace(await request(f, "request", input(f))), t = w.tasks[0]!;
  const r = { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId: f.projectId, taskId: t.taskId, expectedTaskVersion: t.taskVersion,
    expectedResourceVersion: w.resourceVersion, selectedAccountId: null, selectedDeviceId: null };
  const next = workspace(await request(f, "recheck", r)); assert.equal(next.tasks[0]!.taskId, t.taskId); assert.equal(next.tasks[0]!.taskVersion, 1);
  const before = await totals(); workspace(await request(f, "recheck", r)); assert.deepEqual(await totals(), before);
  code(await request(f, "recheck", { ...r, metadata: metadata() }), 409, "FACT_VERSION_STALE"); assert.deepEqual(await totals(), before);
});
test("real reserved allocation selects app inspection, but physical execution remains closed", async () => {
  const f = await fixture(), r = input(f), accountId = randomUUID(), deviceId = randomUUID();
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, r.intent.parentLoginRef]);
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state) VALUES($1,'Synthetic phone','associated_pending_access')`, [deviceId]);
  await pool.query(`INSERT INTO ${s}.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, f.projectId]);
  await pool.query(`INSERT INTO ${s}.project_device_reservations(device_id,project_id) VALUES($1,$2)`, [deviceId, f.projectId]);
  r.intent.accountId = accountId; r.intent.deviceId = deviceId;
  const w = workspace(await request(f, "request", r)), t = w.tasks[0]!;
  assert.equal(t.state, "waiting_executor"); assert.equal(t.nextOperationId, "inspect_app"); assert.equal(t.actionPermissionGranted, false);
  await pool.query(`UPDATE ${s}.devices SET state='paused' WHERE device_id=$1`, [deviceId]);
  const next = workspace(await request(f, "recheck", { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId: f.projectId,
    taskId: t.taskId, expectedTaskVersion: 0, expectedResourceVersion: w.resourceVersion, selectedAccountId: null, selectedDeviceId: null }));
  assert.equal(next.tasks[0]!.state, "waiting_resources"); assert.deepEqual(next.tasks[0]!.blockers, ["DEVICE_PARTICIPATION_RECHECK_REQUIRED"]);
});
test("unassigned original task can attach only matching centrally reserved resources without replacing intent", async () => {
  const f = await fixture(), r = input(f), original = workspace(await request(f, "request", r)).tasks[0]!, accountId = randomUUID(), deviceId = randomUUID();
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, r.intent.parentLoginRef]);
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state) VALUES($1,'Synthetic phone','associated_pending_access')`, [deviceId]);
  await pool.query(`INSERT INTO ${s}.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, f.projectId]);
  await pool.query(`INSERT INTO ${s}.project_device_reservations(device_id,project_id) VALUES($1,$2)`, [deviceId, f.projectId]);
  const body = { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId: f.projectId, taskId: original.taskId,
    expectedTaskVersion: 0, expectedResourceVersion: 0, selectedAccountId: accountId, selectedDeviceId: deviceId };
  const next = workspace(await request(f, "recheck", body)).tasks[0]!;
  assert.equal(next.taskId, original.taskId); assert.deepEqual(next.intent, original.intent); assert.equal(next.selectedAccountId, accountId);
  const before = await totals(); code(await request(f, "recheck", { ...body, metadata: metadata(), expectedTaskVersion: 1, selectedDeviceId: randomUUID() }), 409, "FACT_VERSION_STALE"); assert.deepEqual(await totals(), before);
});
test("CSRF, expired session and audit failure are atomic and do not leak raw DB details", async () => {
  const f = await fixture(), before = await totals();
  code(await request(f, "request", input(f), { "x-csrf-token": randomBytes(32).toString("base64url") }), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE session_id=$1`, [f.sessionId]);
  code(await request(f, "request", input(f)), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await totals(), before);
  const fresh = await fixture();
  await pool.query(`CREATE FUNCTION ${s}.prep_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-db-error'; END $$; CREATE TRIGGER prep_test_audit_failure BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.prep_test_audit_failure()`);
  try { const result = await request(fresh, "request", input(fresh)); code(result, 500, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(result.body).includes("private-db-error")); assert.deepEqual(await totals(), before); }
  finally { await pool.query(`DROP TRIGGER prep_test_audit_failure ON ${s}.audit_records; DROP FUNCTION ${s}.prep_test_audit_failure()`); }
});
async function reservedTask() {
  const f = await fixture(), r = input(f), accountId = randomUUID(), deviceId = randomUUID();
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, r.intent.parentLoginRef]);
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state) VALUES($1,'Synthetic phone','associated_pending_access')`, [deviceId]);
  await pool.query(`INSERT INTO ${s}.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, f.projectId]);
  await pool.query(`INSERT INTO ${s}.project_device_reservations(device_id,project_id) VALUES($1,$2)`, [deviceId, f.projectId]);
  r.intent.accountId = accountId; r.intent.deviceId = deviceId;
  const w = workspace(await request(f, "request", r)), t = w.tasks[0]!;
  const a = artemisPreparationAssignmentSchema.parse({ taskId: t.taskId, taskVersion: t.taskVersion, taskAttemptId: randomUUID(), serial: "SYNTHETIC_NOT_A_DEVICE", operationId: "inspect_app",
    input: { protocolVersion: executionLibraryVersion, projectId: f.projectId, accountId, deviceId, parentLoginRef: r.intent.parentLoginRef, mode: "check_only", target: r.intent.target,
      requestedScope: { scopeRef: r.intent.scopeRef, allowTrustedInstall: false, allowIdentityCreation: false },
      facts: { version: 1, currentScopeMatches: true, unresolvedDeviceTask: false, boundIdentityId: null, priorCreation: "none",
        app: { state: "unknown", evidenceRef: null }, login: { state: "unknown", evidenceRef: null }, identity: { state: "unknown", observedId: null, observedName: null, kind: null, managementVerified: false, evidenceRef: null } } } });
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return { f, w, t, a, hash, journal: new PostgresArtemisPreparationJournal(pool) };
}
test("real journal requires exact central task/allocation; concurrent original claim has one winner", async () => {
  const { a, hash, journal } = await reservedTask();
  for (const bad of [{ ...a, taskId: randomUUID() }, { ...a, taskVersion: 1 }, { ...a, input: { ...a.input, deviceId: randomUUID() } }])
    await assert.rejects(journal.claim(bad, hash(bad)), /PREPARATION_JOURNAL_UNAVAILABLE/);
  const claims = await Promise.all([journal.claim(a, hash(a)), journal.claim(a, hash(a))]);
  assert.equal(claims.filter(c => c.state === "new").length, 1); assert.equal(claims.filter(c => c.state === "existing").length, 1);
  const alternate = { ...a, taskAttemptId: randomUUID() }; await assert.rejects(journal.claim(alternate, hash(alternate)), /UNAVAILABLE/);
});
test("durable original trace survives reconstruction; forged binding/observation and history edits fail", async () => {
  const { a, hash, journal } = await reservedTask(), fp = hash(a), trace = randomUUID(); await journal.claim(a, fp); await journal.bindTrace(a.taskAttemptId, fp, trace);
  const reconstructed = new PostgresArtemisPreparationJournal(pool); assert.deepEqual(await reconstructed.read(a, fp), { traceId: trace });
  await assert.rejects(reconstructed.bindTrace(a.taskAttemptId, fp, randomUUID()), /UNAVAILABLE/);
  await assert.rejects(reconstructed.record(a.taskAttemptId, fp, { traceId: randomUUID(), state: "reported", evidenceIds: [randomUUID()], identityVerified: false, publicationAllowed: false }), /UNAVAILABLE/);
  await reconstructed.record(a.taskAttemptId, fp, { traceId: null, state: "launch_unknown", evidenceIds: [], identityVerified: false, publicationAllowed: false });
  assert.deepEqual(await reconstructed.read(a, fp), { traceId: trace });
  await assert.rejects(pool.query(`UPDATE ${s}.artemis_preparation_intents SET trace_id=$2 WHERE task_attempt_id=$1`, [a.taskAttemptId, randomUUID()]));
  await assert.rejects(pool.query(`DELETE FROM ${s}.artemis_preparation_observations WHERE task_attempt_id=$1`, [a.taskAttemptId]));
});
test("rechecking after a committed launch preserves original uncertainty and prevents another launch version", async () => {
  const { f, w, t, a, hash, journal } = await reservedTask(); await journal.claim(a, hash(a));
  const next = workspace(await request(f, "recheck", { metadata: metadata(), protocolVersion: executionLibraryVersion, projectId: f.projectId,
    taskId: t.taskId, expectedTaskVersion: t.taskVersion, expectedResourceVersion: w.resourceVersion, selectedAccountId: null, selectedDeviceId: null }));
  assert.equal(next.tasks[0]!.state, "needs_reconciliation"); assert.equal(next.tasks[0]!.nextOperationId, null);
  const newAttempt = { ...a, taskVersion: 1, taskAttemptId: randomUUID() };
  await assert.rejects(journal.claim(newAttempt, hash(newAttempt)), /UNAVAILABLE/);
  assert.deepEqual(await journal.read(a, hash(a)), { traceId: null });
});
const executionReview = (f: Fixture, w: ReturnType<typeof workspace>) => ({ metadata: metadata(), protocolVersion: executionLibraryVersion,
  projectId: f.projectId, taskId: w.tasks[0]!.taskId, expectedTaskVersion: w.tasks[0]!.taskVersion, expectedResourceVersion: w.resourceVersion });
async function reviewTotals() { return (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.account_preparation_execution_reviews) reviews,
  (SELECT count(*)::int FROM ${s}.artemis_preparation_intents) intents,(SELECT count(*)::int FROM ${s}.audit_records) audits`)).rows[0]; }
test("concurrent execution admission reviews persist once, create no dispatch and never alter the original task", async () => {
  const f = await fixture(), w = workspace(await request(f, "request", input(f))), r = executionReview(f, w), before = await reviewTotals();
  const responses = await Promise.all([request(f, "execution-review", r), request(f, "execution-review", { ...r, metadata: { ...r.metadata, requestId: metadata().requestId } })]);
  const reviews = responses.map(r => workspace(r).executionReviews[0]!); assert.equal(reviews[0]!.reviewId, reviews[1]!.reviewId);
  assert.deepEqual(workspace(responses[0]!).tasks, w.tasks); assert.equal(reviews[0]!.dispatchCreated, false); assert.equal(reviews[0]!.actionPermissionGranted, false);
  assert.ok(reviews[0]!.blockers.includes("RESOURCE_ASSIGNMENT_REQUIRED")); assert.ok(reviews[0]!.blockers.includes("CURRENT_DEVICE_ACTION_FENCE_REQUIRED"));
  assert.deepEqual(await reviewTotals(), { reviews: before.reviews + 1, intents: before.intents, audits: before.audits + 1 });
  const current = await reviewTotals(); await app.close(); await start();
  assert.equal(workspace(await request(f)).executionReviews[0]!.reviewId, reviews[0]!.reviewId); assert.deepEqual(await reviewTotals(), current);
});
test("review keys cannot be reused across commands, scope or versions; forged permissions and CSRF cannot create a review", async () => {
  const f = await fixture(), original = input(f), w = workspace(await request(f, "request", original)), r = executionReview(f, w), before = await reviewTotals();
  code(await request(f, "execution-review", { ...r, metadata: original.metadata }), 409, "IDEMPOTENCY_KEY_REUSED");
  code(await request(f, "execution-review", { ...r, expectedTaskVersion: 4 }), 409, "FACT_VERSION_STALE");
  code(await request(f, "execution-review", { ...r, expectedResourceVersion: 4 }), 409, "FACT_VERSION_STALE");
  code(await request(f, "execution-review", { ...r, actionPermissionGranted: true }), 400, "INPUT_INVALID");
  code(await request(f, "execution-review", { ...r, taskId: randomUUID() }), 409, "FACT_VERSION_STALE");
  code(await request(f, "execution-review", r, { "x-csrf-token": randomBytes(32).toString("base64url") }), 401, "AUTHENTICATION_REQUIRED");
  assert.deepEqual(await reviewTotals(), before);
  workspace(await request(f, "execution-review", r));
  code(await request(f, "request", { ...original, metadata: r.metadata }), 409, "IDEMPOTENCY_KEY_REUSED");
  code(await request(f, "execution-review", { ...r, taskId: randomUUID() }), 409, "IDEMPOTENCY_KEY_REUSED");
});
test("original SDK completion stays unverified; review uses current pause and preserves the original attempt", async () => {
  const { f, w, t, a, hash, journal } = await reservedTask(), trace = randomUUID(), evidence = randomUUID();
  await journal.claim(a, hash(a)); await journal.bindTrace(a.taskAttemptId, hash(a), trace);
  await journal.record(a.taskAttemptId, hash(a), { traceId: trace, state: "reported", evidenceIds: [evidence], identityVerified: false, publicationAllowed: false });
  await pool.query(`UPDATE ${s}.devices SET state='paused' WHERE device_id=$1`, [a.input.deviceId]);
  const before = await reviewTotals(), current = workspace(await request(f, "execution-review", executionReview(f, w))), review = current.executionReviews[0]!;
  assert.equal(current.tasks[0]!.taskId, t.taskId); assert.equal(current.tasks[0]!.taskVersion, t.taskVersion);
  assert.ok(review.blockers.includes("DEVICE_PARTICIPATION_RECHECK_REQUIRED")); assert.ok(review.blockers.includes("NETWORK_ADMISSION_REQUIRED"));
  assert.ok(review.blockers.includes("PHONE_CONTROL_HOLDER_REQUIRED")); assert.equal(review.nextOperationId, null);
  assert.equal(current.originalOperations[0]!.taskAttemptId, a.taskAttemptId); assert.equal(current.originalOperations[0]!.traceId, trace);
  assert.equal(current.originalOperations[0]!.latestObservation!.state, "reported"); assert.deepEqual(current.originalOperations[0]!.latestObservation!.evidenceIds, [evidence]);
  assert.equal(current.originalOperations[0]!.identityVerified, false); assert.equal((await reviewTotals()).intents, before.intents);
});
test("read-only original-operation projection preserves bound trace after lost ACK and rejects corrupt receipt scope", async () => {
  const { f, a, hash, journal } = await reservedTask(), trace = randomUUID(); await journal.claim(a, hash(a)); await journal.bindTrace(a.taskAttemptId, hash(a), trace);
  await journal.record(a.taskAttemptId, hash(a), { traceId: null, state: "launch_unknown", evidenceIds: [], identityVerified: false, publicationAllowed: false });
  const before = await reviewTotals(), current = workspace(await request(f)); assert.equal(current.originalOperations[0]!.traceId, trace);
  assert.equal(current.originalOperations[0]!.latestObservation!.state, "launch_unknown"); assert.deepEqual(await reviewTotals(), before);
  const other = await fixture(); assert.equal(workspace(await request(other)).originalOperations.length, 0);
  // Explicitly corrupt the supplemental fixture, never a business/UI result.
  await pool.query(`INSERT INTO ${s}.artemis_preparation_observations(observation_id,task_attempt_id,fingerprint,record) VALUES($1,$2,$3,$4)`,
    [randomUUID(), a.taskAttemptId, "0".repeat(64), { traceId: randomUUID(), state: "running", evidenceIds: [], identityVerified: false, publicationAllowed: false }]);
  const rejected = await request(f); code(rejected, 500, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(rejected.body).includes(trace));
});
test("execution review audit failure rolls back; committed history cannot be rewritten", async () => {
  const f = await fixture(), w = workspace(await request(f, "request", input(f))), r = executionReview(f, w), before = await reviewTotals();
  await pool.query(`CREATE FUNCTION ${s}.prep_test_review_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-review-error'; END $$;
    CREATE TRIGGER prep_test_review_audit_failure BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.prep_test_review_audit_failure()`);
  try { code(await request(f, "execution-review", r), 500, "INTERNAL_ERROR"); assert.deepEqual(await reviewTotals(), before); }
  finally { await pool.query(`DROP TRIGGER prep_test_review_audit_failure ON ${s}.audit_records; DROP FUNCTION ${s}.prep_test_review_audit_failure()`); }
  const reviewed = workspace(await request(f, "execution-review", r)).executionReviews[0]!;
  await assert.rejects(pool.query(`DELETE FROM ${s}.account_preparation_execution_reviews WHERE review_id=$1`, [reviewed.reviewId]));
  await assert.rejects(pool.query(`UPDATE ${s}.account_preparation_execution_reviews SET record=record||'{"dispatchCreated":true}'::jsonb WHERE review_id=$1`, [reviewed.reviewId]));
});
test("a later recheck does not erase the saved older review or allow its key to create a new review", async () => {
  const f = await fixture(), w = workspace(await request(f, "request", input(f))), r = executionReview(f, w);
  const first = workspace(await request(f, "execution-review", r)).executionReviews[0]!;
  const next = workspace(await request(f, "recheck", { ...r, metadata: metadata(), selectedAccountId: null, selectedDeviceId: null }));
  assert.equal(next.tasks[0]!.taskVersion, 1); assert.equal(next.executionReviews[0]!.taskVersion, 0);
  const before = await reviewTotals(); assert.equal(workspace(await request(f, "execution-review", r)).executionReviews[0]!.reviewId, first.reviewId);
  assert.deepEqual(await reviewTotals(), before);
  code(await request(f, "execution-review", { ...r, expectedTaskVersion: 1 }), 409, "IDEMPOTENCY_KEY_REUSED");
});
test("reviews with identical timestamps use committed sequence, not UUID order, to project the latest facts", async () => {
  const f = await fixture(), w = workspace(await request(f, "request", input(f))), r = executionReview(f, w);
  const record = workspace(await request(f, "execution-review", r)).executionReviews[0]!, ids = [randomUUID(), randomUUID()].sort().reverse();
  // Supplemental fixture deliberately shares the timestamp and inverts UUID order.
  for (const id of ids) await pool.query(`INSERT INTO ${s}.account_preparation_execution_reviews(review_id,task_id,task_version,actor_id,request_key,payload_digest,reviewed_at,record)
    VALUES($1,$2,0,$3,$4,$5,$6,$7)`, [id, r.taskId, f.actor, `synthetic-review-${id}`, "a".repeat(64), record.reviewedAt, { ...record, reviewId: id }]);
  assert.equal(workspace(await request(f)).executionReviews[0]!.reviewId, ids[1]);
});
