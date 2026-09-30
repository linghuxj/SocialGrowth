import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { DeviceAssistanceTodoStore } from "./device-assistance-todo-store.js";
import { DeviceAssistanceFeedService } from "./device-assistance-feed-service.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Assistance journal tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 10, application_name: "sg-todo-fixtures" });
const auth = new OperatorAuthService(pool, "isolated-todo-fixture-pepper-only-00001"), store = new DeviceAssistanceTodoStore(pool, auth), feed = new DeviceAssistanceFeedService(pool, auth);
const meta = () => ({ contractVersion, requestId: `todo-${randomUUID()}`, idempotencyKey: `todo-${randomUUID()}` });
const code = (value: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === value;
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const name of ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql", "0005_network_admission.sql", "0006_phone_control_journal.sql", "0007_task_recovery_budget.sql", "0008_project_basics.sql", "0009_resource_reservations.sql", "0010_project_planning_drafts.sql", "0011_unassigned_device_todos.sql", "0012_device_assistance_feed_index.sql"]) await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });
// Synthetic NON-UI authority fixtures; not actual phone/SMS/Artemis evidence.
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), hash = (s: string) => createHash("sha256").update(s).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Todo fixture','not-real-password','active')", [operatorId, `fixture-${operatorId}`]);
  await pool.query("INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')", [sessionId, operatorId, hash(token), hash(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
let phoneSequence = 0;
async function provider(inviter: Awaited<ReturnType<typeof actor>>) {
  const providerId = randomUUID(), invitationId = randomUUID(), verificationId = randomUUID(), phone = `+155500${String(++phoneSequence).padStart(5, "0")}`;
  await pool.query("INSERT INTO socialgrowth_product.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Todo provider','active')", [providerId, phone]);
  await pool.query("INSERT INTO socialgrowth_product.provider_invitations(invitation_id,code_digest,created_by_operator_id,max_uses,consumed_uses,expires_at) VALUES($1,$2,$3,10,1,clock_timestamp()+interval '1 day')", [invitationId, randomBytes(32), inviter.operatorId]);
  await pool.query("INSERT INTO socialgrowth_product.phone_verifications(verification_id,phone_e164,purpose,expires_at) VALUES($1,$2,'provider_registration',clock_timestamp()+interval '1 day')", [verificationId, phone]);
  await pool.query("INSERT INTO socialgrowth_product.provider_invitation_consumptions(consumption_id,invitation_id,provider_id,verification_id) VALUES($1,$2,$3,$4)", [randomUUID(), invitationId, providerId, verificationId]);
  return { providerId, inviter };
}
async function device(p: Awaited<ReturnType<typeof provider>>) {
  const deviceId = randomUUID(), installationId = randomUUID(), associationId = randomUUID(), sessionId = randomUUID();
  await pool.query("INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Todo phone','associated_pending_access')", [deviceId]);
  await pool.query("INSERT INTO socialgrowth_product.installations(installation_id,credential_digest,status) VALUES($1,$2,'active')", [installationId, randomBytes(32)]);
  await pool.query("INSERT INTO socialgrowth_product.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at) VALUES($1,$2,1,'Todo phone',$3,clock_timestamp()+interval '1 day')", [sessionId, installationId, randomBytes(32)]);
  await pool.query("INSERT INTO socialgrowth_product.device_associations(association_id,device_id,installation_id,provider_id,association_session_id) VALUES($1,$2,$3,$4,$5)", [associationId, deviceId, installationId, p.providerId, sessionId]);
  return { deviceId, installationId, associationId };
}
const event = (deviceId: string, occurrenceId = randomUUID()) => ({ eventId: randomUUID(), occurrenceId, deviceId, expectedDeviceVersion: 0, kind: "network_access_help" });
async function fixture() { const a = await actor(), p = await provider(a), d = await device(p); return { a, p, d, input: event(d.deviceId) }; }
async function counts(todoId: string) {
  return (await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.device_assistance_impacts WHERE todo_id=$1) impacts,
    (SELECT count(*)::int FROM socialgrowth_product.device_assistance_notes WHERE todo_id=$1) notes,
    (SELECT count(*)::int FROM socialgrowth_product.device_assistance_events WHERE todo_id=$1) events,
    (SELECT count(*)::int FROM socialgrowth_product.device_assistance_commands WHERE todo_id=$1) commands,
    (SELECT count(*)::int FROM socialgrowth_product.device_assistance_notification_intents WHERE todo_id=$1) notifications,
    (SELECT count(*)::int FROM socialgrowth_product.audit_records WHERE object_type='device_assistance_todo' AND object_id=$1) audits`, [todoId])).rows[0];
}
const note = (todoId: string, version: number, kind = "reported_processed") => ({ metadata: meta(), todoId, expectedFactVersion: version, kind, text: "已处理，请复核实际设备" });
async function intakeProcess(input: ReturnType<typeof event>): Promise<{ todoId: string; factVersion: number }> {
  const worker = `import {Pool} from 'pg'; import {DeviceAssistanceTodoStore} from ${JSON.stringify(new URL("./device-assistance-todo-store.ts", import.meta.url).href)};
    import {OperatorAuthService} from ${JSON.stringify(new URL("./operator-auth-service.ts", import.meta.url).href)};
    const pool=new Pool({connectionString:process.env.SG_PRODUCT_TEST_DATABASE_URL});
    try {const value=await new DeviceAssistanceTodoStore(pool,new OperatorAuthService(pool,'isolated-todo-fixture-pepper-only-00001')).ingestUnassignedDeviceEvent(JSON.parse(process.argv[1])); console.log(JSON.stringify({todoId:value.todoId,factVersion:value.factVersion}));} finally {await pool.end();}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", worker, JSON.stringify(input)], { cwd: new URL("..", import.meta.url), env: process.env });
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Isolated fixture worker timed out")); }, 20000);
    child.stdout.on("data", v => { output += String(v); }); child.stderr.on("data", v => { errors += String(v); }); child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", status => { clearTimeout(timer); if (status !== 0) reject(new Error(`Isolated fixture worker failed: ${errors}`)); else { try { resolve(JSON.parse(output)); } catch (e) { reject(e); } } });
  });
}
test("two real OS processes adding two phones of the same occurrence have one issue and one notification intent", async () => {
  const f = await fixture(), d2 = await device(f.p);
  const results = await Promise.all([intakeProcess(f.input), intakeProcess(event(d2.deviceId, f.input.occurrenceId))]);
  assert.equal(results[0]!.todoId, results[1]!.todoId);
  assert.deepEqual(await counts(results[0]!.todoId), { impacts: 2, notes: 0, events: 2, commands: 0, notifications: 1, audits: 2 });
});
test("no-project journal derives inviter from canonical registration, persists one intent and replays after restart without granting access", async () => {
  const f = await fixture(), first = await store.ingestUnassignedDeviceEvent(f.input);
  assert.equal(first.initialResponsibleOperatorId, f.a.operatorId); assert.equal(first.providerId, f.p.providerId); assert.equal(first.factVersion, 1); assert.equal(first.status, "open");
  assert.deepEqual(await new DeviceAssistanceTodoStore(pool, auth).ingestUnassignedDeviceEvent({ ...f.input, deviceId: f.d.deviceId.toUpperCase() }), first);
  assert.deepEqual(await counts(first.todoId), { impacts: 1, notes: 0, events: 1, commands: 0, notifications: 1, audits: 1 });
  assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.projects")).rows[0]?.n, 0);
  assert.equal((await pool.query("SELECT state FROM socialgrowth_product.devices WHERE device_id=$1", [f.d.deviceId])).rows[0]?.state, "associated_pending_access");
});
test("same provider occurrence merges distinct phones, different provider occurrence stays separate, repeated impact does not renotify", async () => {
  const f = await fixture(), d2 = await device(f.p), first = await store.ingestUnassignedDeviceEvent(f.input);
  const merged = await store.ingestUnassignedDeviceEvent(event(d2.deviceId, f.input.occurrenceId));
  assert.equal(merged.todoId, first.todoId); assert.equal(merged.impacts.length, 2);
  const noop = await store.ingestUnassignedDeviceEvent(event(d2.deviceId, f.input.occurrenceId)); assert.equal(noop.factVersion, 2);
  assert.deepEqual(await counts(first.todoId), { impacts: 2, notes: 0, events: 3, commands: 0, notifications: 1, audits: 2 });
  const other = await fixture(), separate = await store.ingestUnassignedDeviceEvent({ ...other.input, occurrenceId: f.input.occurrenceId });
  assert.notEqual(separate.todoId, first.todoId); assert.equal(separate.providerId, other.p.providerId);
});
test("different operators may handle disabled inviter's issue; processed reports only await recheck and preserve device authority", async () => {
  const f = await fixture(), b = await actor(), initial = await store.ingestUnassignedDeviceEvent(f.input);
  await pool.query("UPDATE socialgrowth_product.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1", [f.a.operatorId]);
  assert.equal((await store.read(b.token, initial.todoId)).initialResponsibleOperatorId, f.a.operatorId);
  const input = note(initial.todoId.toUpperCase(), initial.factVersion), processed = await store.recordNote(b.token, b.csrf, input);
  assert.equal(processed.status, "awaiting_recheck"); assert.equal(processed.notes[0]?.actorId, b.operatorId); assert.equal(processed.initialResponsibleOperatorId, f.a.operatorId);
  assert.deepEqual(await store.recordNote(b.token, b.csrf, { ...input, todoId: initial.todoId, metadata: { ...input.metadata, requestId: meta().requestId } }), processed);
  const d2 = await device(f.p), reopened = await store.ingestUnassignedDeviceEvent(event(d2.deviceId, f.input.occurrenceId));
  assert.equal(reopened.status, "open"); assert.equal(reopened.notes.length, 1); assert.equal(reopened.impacts.length, 2);
  assert.deepEqual(await store.recordNote(b.token, b.csrf, input), reopened); // current facts, not stale status replay.
  assert.equal((await pool.query("SELECT state FROM socialgrowth_product.devices WHERE device_id=$1", [f.d.deviceId])).rows[0]?.state, "associated_pending_access");
});
test("two actual concurrent intake calls converge to one issue/impact/intent; two operator CAS notes have only one winner", async () => {
  const f = await fixture(), b = await actor();
  const results = await Promise.all([store.ingestUnassignedDeviceEvent(f.input), store.ingestUnassignedDeviceEvent(f.input)]);
  assert.equal(results[0]!.todoId, results[1]!.todoId); assert.equal(results[0]!.factVersion, 1);
  const id = results[0]!.todoId, inputs = note(id, 1), notes = await Promise.allSettled([store.recordNote(f.a.token, f.a.csrf, inputs), store.recordNote(b.token, b.csrf, note(id, 1))]);
  assert.equal(notes.filter(v => v.status === "fulfilled").length, 1); assert.equal(notes.filter(v => v.status === "rejected" && code("FACT_VERSION_STALE")(v.reason)).length, 1);
  assert.deepEqual(await counts(id), { impacts: 1, notes: 1, events: 1, commands: 1, notifications: 1, audits: 2 });
});
test("stale device versions, assigned/exited/ended associations, missing invitation and corrupt guard cannot open intake", async () => {
  const f = await fixture();
  await assert.rejects(store.ingestUnassignedDeviceEvent({ ...f.input, expectedDeviceVersion: 1 }), code("FACT_VERSION_STALE"));
  const projectId = randomUUID(); await pool.query("INSERT INTO socialgrowth_product.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Todo fixture project','company_owned',$2)", [projectId, f.a.operatorId]);
  await pool.query("INSERT INTO socialgrowth_product.project_device_reservations(device_id,project_id) VALUES($1,$2)", [f.d.deviceId, projectId]);
  await assert.rejects(store.ingestUnassignedDeviceEvent(f.input), code("FACT_VERSION_STALE"));
  await pool.query("DELETE FROM socialgrowth_product.project_device_reservations WHERE device_id=$1", [f.d.deviceId]);
  await pool.query("UPDATE socialgrowth_product.device_associations SET ended_at=clock_timestamp() WHERE association_id=$1", [f.d.associationId]);
  await assert.rejects(store.ingestUnassignedDeviceEvent(f.input), code("FACT_VERSION_STALE"));
  const g = await fixture(); await pool.query("UPDATE socialgrowth_product.devices SET state='exited' WHERE device_id=$1", [g.d.deviceId]);
  await assert.rejects(store.ingestUnassignedDeviceEvent(g.input), code("FACT_VERSION_STALE"));
  const h = await fixture(); await pool.query("DELETE FROM socialgrowth_product.provider_invitation_consumptions WHERE provider_id=$1", [h.p.providerId]);
  await assert.rejects(store.ingestUnassignedDeviceEvent(h.input), code("FACT_VERSION_STALE"));
  await pool.query("DELETE FROM socialgrowth_product.resource_reservation_guard");
  try { await assert.rejects(store.ingestUnassignedDeviceEvent(f.input), code("FACT_VERSION_STALE")); }
  finally { await pool.query("INSERT INTO socialgrowth_product.resource_reservation_guard(singleton) VALUES(true)"); }
});
test("auth/CSRF/revocation protect reads, notes and replay; altered stable event/note payloads cannot reuse keys", async () => {
  const f = await fixture(), view = await store.ingestUnassignedDeviceEvent(f.input), input = note(view.todoId, view.factVersion);
  await assert.rejects(store.read("", view.todoId), code("AUTHENTICATION_REQUIRED"));
  await assert.rejects(store.recordNote(f.a.token, "", input), code("AUTHENTICATION_REQUIRED"));
  await store.recordNote(f.a.token, f.a.csrf, input);
  await assert.rejects(store.recordNote(f.a.token, f.a.csrf, { ...input, text: "另一处理说明" }), code("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(store.ingestUnassignedDeviceEvent({ ...f.input, occurrenceId: randomUUID() }), code("IDEMPOTENCY_KEY_REUSED"));
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [f.a.sessionId]);
  await assert.rejects(store.read(f.a.token, view.todoId), code("AUTHENTICATION_REQUIRED"));
  await assert.rejects(store.recordNote(f.a.token, f.a.csrf, input), code("AUTHENTICATION_REQUIRED"));
});
test("final command failure atomically rolls back note, status, version and audit, and masks raw SQL details", async () => {
  const f = await fixture(), view = await store.ingestUnassignedDeviceEvent(f.input), input = note(view.todoId, 1);
  await pool.query(`CREATE FUNCTION socialgrowth_product.todo_command_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-sql-detail'; END $$`);
  await pool.query("CREATE TRIGGER todo_fault BEFORE INSERT ON socialgrowth_product.device_assistance_commands FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.todo_command_fault()");
  try {
    await assert.rejects(store.recordNote(f.a.token, f.a.csrf, input), (e: unknown) => code("INTERNAL_ERROR")(e) && e instanceof Error && !e.message.includes("private-sql") && !e.cause);
    assert.deepEqual(await store.read(f.a.token, view.todoId), view);
    assert.deepEqual(await counts(view.todoId), { impacts: 1, notes: 0, events: 1, commands: 0, notifications: 1, audits: 1 });
  } finally { await pool.query("DROP TRIGGER todo_fault ON socialgrowth_product.device_assistance_commands"); await pool.query("DROP FUNCTION socialgrowth_product.todo_command_fault()"); }
});
test("notification intent failure leaves no issue/event/impact; same event can recover; changed device version cannot rewrite original impact", async () => {
  const f = await fixture();
  await pool.query(`CREATE FUNCTION socialgrowth_product.todo_notification_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-notification-detail'; END $$`);
  await pool.query("CREATE TRIGGER todo_notification_fault BEFORE INSERT ON socialgrowth_product.device_assistance_notification_intents FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.todo_notification_fault()");
  try {
    await assert.rejects(store.ingestUnassignedDeviceEvent(f.input), code("INTERNAL_ERROR"));
    assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.device_assistance_todos WHERE provider_id=$1", [f.p.providerId])).rows[0]?.n, 0);
    assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.device_assistance_events WHERE event_id=$1", [f.input.eventId])).rowCount, 0);
  } finally { await pool.query("DROP TRIGGER todo_notification_fault ON socialgrowth_product.device_assistance_notification_intents"); await pool.query("DROP FUNCTION socialgrowth_product.todo_notification_fault()"); }
  const original = await store.ingestUnassignedDeviceEvent(f.input);
  await pool.query("UPDATE socialgrowth_product.devices SET fact_version=fact_version+1 WHERE device_id=$1", [f.d.deviceId]);
  await assert.rejects(store.ingestUnassignedDeviceEvent({ ...f.input, eventId: randomUUID(), expectedDeviceVersion: 1 }), code("FACT_VERSION_STALE"));
  assert.deepEqual(await store.ingestUnassignedDeviceEvent(f.input), original); // historical replay is not fresh acceptance.
  assert.deepEqual(await counts(original.todoId), { impacts: 1, notes: 0, events: 1, commands: 0, notifications: 1, audits: 1 });
});
test("actual row lock wait beyond database session expiry cannot commit a note", async () => {
  const f = await fixture(), view = await store.ingestUnassignedDeviceEvent(f.input), blocker = await pool.connect(); let pending: Promise<unknown> | undefined;
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE session_id=$1", [f.a.sessionId]);
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT 1 FROM socialgrowth_product.device_assistance_todos WHERE todo_id=$1 FOR UPDATE", [view.todoId]);
    pending = store.recordNote(f.a.token, f.a.csrf, note(view.todoId, 1)); const rejection = assert.rejects(pending, code("AUTHENTICATION_REQUIRED"));
    let waiting = false, expired = false;
    for (let i = 0; i < 200; i++) { if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-todo-fixtures' AND wait_event_type='Lock' AND query LIKE '%device_assistance_todos%FOR UPDATE%' AND pid<>pg_backend_pid()" )).rowCount) { waiting = true; break; } await new Promise(r => setTimeout(r, 5)); }
    assert.ok(waiting);
    for (let i = 0; i < 200; i++) { if ((await pool.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() expired FROM socialgrowth_product.operator_sessions WHERE session_id=$1", [f.a.sessionId])).rows[0]?.expired) { expired = true; break; } await new Promise(r => setTimeout(r, 5)); }
    assert.ok(expired); await blocker.query("COMMIT"); await rejection;
    assert.deepEqual(await counts(view.todoId), { impacts: 1, notes: 0, events: 1, commands: 0, notifications: 1, audits: 1 });
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); }
});
test("real COMMIT with only response failure is recoverable by the original event, not a second notification", async () => {
  const f = await fixture(), original = pool.connect.bind(pool); let inject = true;
  pool.connect = (async () => {
    const client = await original(), query = client.query.bind(client);
    client.query = (async (text: unknown, ...values: unknown[]) => {
      const result = await (query as (...args: unknown[]) => Promise<unknown>)(text, ...values);
      if (text === "COMMIT" && inject) { inject = false; throw new Error("fixture-only-lost-response"); }
      return result;
    }) as PoolClient["query"];
    const release = client.release.bind(client); client.release = () => { client.query = query; release(); }; return client;
  }) as Pool["connect"];
  try { await assert.rejects(store.ingestUnassignedDeviceEvent(f.input), code("INTERNAL_ERROR")); }
  finally { pool.connect = original as Pool["connect"]; }
  const recovered = await store.ingestUnassignedDeviceEvent(f.input);
  assert.deepEqual(await counts(recovered.todoId), { impacts: 1, notes: 0, events: 1, commands: 0, notifications: 1, audits: 1 });
});
test("all active operators see pending summaries, not secret/text payloads; origin scope does not claim current assignment", async () => {
  const f = await fixture(), b = await actor(), initial = await store.ingestUnassignedDeviceEvent(f.input);
  await store.recordNote(b.token, b.csrf, { ...note(initial.todoId, 1), text: "仅内部人工说明夹具" });
  const projectId = randomUUID(); await pool.query("INSERT INTO socialgrowth_product.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Feed fixture project','company_owned',$2)", [projectId, f.a.operatorId]);
  await pool.query("INSERT INTO socialgrowth_product.project_device_reservations(device_id,project_id) VALUES($1,$2)", [f.d.deviceId, projectId]);
  const page = await feed.list(b.token, { afterTodoId: null, pageSize: 50 }), value = page.todos.find(v => v.todoId === initial.todoId)!;
  assert.equal(value.initialResponsibleOperatorId, f.a.operatorId); assert.equal(value.status, "awaiting_recheck"); assert.equal(value.impactCount, 1); assert.equal(value.noteCount, 1);
  assert.equal(value.originScope, "unassigned_device"); assert.equal(value.notificationStatus, "awaiting_configuration");
  assert.ok(!JSON.stringify(page).includes("内部人工说明")); assert.ok(!JSON.stringify(page).includes(f.a.token)); assert.ok(!("projectId" in value)); assert.ok(!("permissionGranted" in value));
});
test("opaque keyset cursor preserves genuine database microseconds and visits each pending row once", async () => {
  const f = await fixture(), g = await fixture(), first = await store.ingestUnassignedDeviceEvent(f.input), second = await store.ingestUnassignedDeviceEvent(g.input);
  await pool.query("UPDATE socialgrowth_product.device_assistance_todos SET created_at='2026-01-01T00:00:00.123456Z' WHERE todo_id=$1", [first.todoId]);
  await pool.query("UPDATE socialgrowth_product.device_assistance_todos SET created_at='2026-01-01T00:00:00.123457Z' WHERE todo_id=$1", [second.todoId]);
  const one = await feed.list(f.a.token, { afterTodoId: null, pageSize: 1 }); assert.equal(one.todos[0]?.todoId, first.todoId); assert.equal(one.nextAfterTodoId, first.todoId);
  const two = await feed.list(f.a.token, { afterTodoId: one.nextAfterTodoId?.toUpperCase(), pageSize: 1 }); assert.equal(two.todos[0]?.todoId, second.todoId); assert.equal(two.todos[0]?.createdAt, one.todos[0]?.createdAt);
  const expected = (await pool.query<{ todo_id: string }>("SELECT todo_id FROM socialgrowth_product.device_assistance_todos ORDER BY created_at,todo_id")).rows.map(v => v.todo_id);
  const observed: string[] = []; let cursor: string | null = null;
  for (let i = 0; i < expected.length + 1; i++) {
    const page = await feed.list(f.a.token, { afterTodoId: cursor, pageSize: 3 }); observed.push(...page.todos.map(v => v.todoId)); cursor = page.nextAfterTodoId;
    if (!cursor) break;
  }
  assert.deepEqual(observed, expected); assert.equal(new Set(observed).size, observed.length); assert.equal(cursor, null);
});
test("feed rejects invalid query/unknown cursor, revoked or disabled sessions, never granting caller-selected ownership", async () => {
  const f = await fixture(); await store.ingestUnassignedDeviceEvent(f.input);
  for (const query of [{ afterTodoId: null, pageSize: 0 }, { afterTodoId: null, pageSize: 51 }, { afterTodoId: null, pageSize: 20, ownerOperatorId: f.a.operatorId }]) await assert.rejects(feed.list(f.a.token, query), code("INPUT_INVALID"));
  await assert.rejects(feed.list(f.a.token, { afterTodoId: randomUUID(), pageSize: 20 }), code("FACT_VERSION_STALE"));
  await assert.rejects(feed.list("", { afterTodoId: null, pageSize: 20 }), code("AUTHENTICATION_REQUIRED"));
  await pool.query("UPDATE socialgrowth_product.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1", [f.a.operatorId]);
  await assert.rejects(feed.list(f.a.token, { afterTodoId: null, pageSize: 20 }), code("AUTHENTICATION_REQUIRED"));
  const b = await actor(); await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [b.sessionId]);
  await assert.rejects(feed.list(b.token, { afterTodoId: null, pageSize: 20 }), code("AUTHENTICATION_REQUIRED"));
});
test("feed lock wait past actual database session deadline discards protected rows rather than returning stale authentication", async () => {
  const f = await fixture(); await store.ingestUnassignedDeviceEvent(f.input); const blocker = await pool.connect(); let pending: Promise<unknown> | undefined;
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE session_id=$1", [f.a.sessionId]);
  try {
    await blocker.query("BEGIN"); await blocker.query("LOCK TABLE socialgrowth_product.device_assistance_todos IN ACCESS EXCLUSIVE MODE");
    pending = feed.list(f.a.token, { afterTodoId: null, pageSize: 20 }); const rejection = assert.rejects(pending, code("AUTHENTICATION_REQUIRED"));
    let waiting = false, expired = false;
    for (let i = 0; i < 300; i++) { if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-todo-fixtures' AND wait_event_type='Lock' AND query LIKE '%SELECT t.%device_assistance_todos%' AND pid<>pg_backend_pid()" )).rowCount) { waiting = true; break; } await new Promise(r => setTimeout(r, 5)); }
    assert.ok(waiting);
    for (let i = 0; i < 300; i++) { if ((await pool.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() expired FROM socialgrowth_product.operator_sessions WHERE session_id=$1", [f.a.sessionId])).rows[0]?.expired) { expired = true; break; } await new Promise(r => setTimeout(r, 5)); }
    assert.ok(expired); await blocker.query("COMMIT"); await rejection;
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); }
});
test("public note bridge records same-right operator reports atomically, replays current summaries and never exposes text or grants access", async () => {
  const f = await fixture(), b = await actor(), initial = await store.ingestUnassignedDeviceEvent(f.input), input = note(initial.todoId.toUpperCase(), 1);
  const first = await feed.recordNote(b.token, b.csrf, input);
  assert.equal(first.todo.status, "awaiting_recheck"); assert.equal(first.todo.factVersion, 2); assert.equal(first.todo.noteCount, 1);
  assert.equal(first.todo.initialResponsibleOperatorId, f.a.operatorId); assert.equal(first.todo.notificationStatus, "awaiting_configuration");
  assert.ok(!JSON.stringify(first).includes(input.text)); assert.ok(!("permissionGranted" in first.todo));
  assert.deepEqual(await feed.recordNote(b.token, b.csrf, { ...input, todoId: initial.todoId, metadata: { ...input.metadata, requestId: meta().requestId } }), first);
  const second = await store.ingestUnassignedDeviceEvent(event((await device(f.p)).deviceId, f.input.occurrenceId));
  const replay = await feed.recordNote(b.token, b.csrf, input); assert.equal(replay.todo.status, "open"); assert.equal(replay.todo.factVersion, second.factVersion); assert.equal(replay.todo.impactCount, 2); assert.equal(replay.todo.noteCount, 1);
  assert.equal((await pool.query("SELECT state FROM socialgrowth_product.devices WHERE device_id=$1", [f.d.deviceId])).rows[0]?.state, "associated_pending_access");
  assert.deepEqual(await counts(initial.todoId), { impacts: 2, notes: 1, events: 2, commands: 1, notifications: 1, audits: 3 });
});
test("public note bridge rejects invalid authority, CSRF, altered keys, stale CAS and revoked replay without extra writes", async () => {
  const f = await fixture(), initial = await store.ingestUnassignedDeviceEvent(f.input), input = note(initial.todoId, 1, "note");
  await assert.rejects(feed.recordNote(f.a.token, f.a.csrf, { ...input, permissionGranted: true }), code("INPUT_INVALID"));
  await assert.rejects(feed.recordNote(f.a.token, "", input), code("AUTHENTICATION_REQUIRED"));
  const saved = await feed.recordNote(f.a.token, f.a.csrf, input); assert.equal(saved.todo.status, "open");
  await assert.rejects(feed.recordNote(f.a.token, f.a.csrf, { ...input, text: "改变原幂等载荷" }), code("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(feed.recordNote(f.a.token, f.a.csrf, note(initial.todoId, 1)), code("FACT_VERSION_STALE"));
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [f.a.sessionId]);
  await assert.rejects(feed.recordNote(f.a.token, f.a.csrf, input), code("AUTHENTICATION_REQUIRED"));
  assert.deepEqual(await counts(initial.todoId), { impacts: 1, notes: 1, events: 1, commands: 1, notifications: 1, audits: 2 });
});
test("public note actual COMMIT receipt loss remains retryable and original command recovers only one persisted report", async () => {
  const f = await fixture(), initial = await store.ingestUnassignedDeviceEvent(f.input), input = note(initial.todoId, 1), original = pool.connect.bind(pool); let inject = true;
  pool.connect = (async () => {
    const client = await original(), query = client.query.bind(client);
    client.query = (async (text: unknown, ...values: unknown[]) => {
      const result = await (query as (...args: unknown[]) => Promise<unknown>)(text, ...values);
      if (text === "COMMIT" && inject) { inject = false; throw new Error("fixture-private-lost-note-receipt"); }
      return result;
    }) as PoolClient["query"];
    const release = client.release.bind(client); client.release = () => { client.query = query; release(); }; return client;
  }) as Pool["connect"];
  try { await assert.rejects(feed.recordNote(f.a.token, f.a.csrf, input), (e: unknown) => code("INTERNAL_ERROR")(e) && (e as ProductTransactionError).retryable && !String(e).includes("fixture-private")); }
  finally { pool.connect = original as Pool["connect"]; }
  const recovered = await feed.recordNote(f.a.token, f.a.csrf, input); assert.equal(recovered.todo.status, "awaiting_recheck"); assert.equal(recovered.todo.noteCount, 1);
  assert.deepEqual(await counts(initial.todoId), { impacts: 1, notes: 1, events: 1, commands: 1, notifications: 1, audits: 2 });
});
test("actual synthetic BC history cannot escape the common calendar or turn a committed note into definitive input rejection", async () => {
  const f = await fixture(), initial = await store.ingestUnassignedDeviceEvent(f.input), input = note(initial.todoId, 1);
  await pool.query("UPDATE socialgrowth_product.device_assistance_todos SET created_at='0001-01-01 00:00:00+00 BC',updated_at='0001-01-01 00:00:00+00 BC' WHERE todo_id=$1", [initial.todoId]);
  const unknown = (e: unknown) => code("INTERNAL_ERROR")(e) && (e as ProductTransactionError).retryable;
  await assert.rejects(feed.list(f.a.token, { afterTodoId: null, pageSize: 1 }), unknown);
  for (let i = 0; i < 2; i++) await assert.rejects(feed.recordNote(f.a.token, f.a.csrf, input), unknown);
  assert.deepEqual(await counts(initial.todoId), { impacts: 1, notes: 1, events: 1, commands: 1, notifications: 1, audits: 2 });
});
