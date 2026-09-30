import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProjectService } from "./project-service.js";
import { ResourceReservationError } from "./resource-reservation-core.js";
import { ResourceReservationStore } from "./resource-reservation-store.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Resource ledger tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 10, application_name: "sg-resource-fixtures" });
const auth = new OperatorAuthService(pool, "resource-auth-fixture-pepper-only-00001"), store = new ResourceReservationStore(pool, auth);
const metadata = () => ({ contractVersion, requestId: `resource-${randomUUID()}`, idempotencyKey: `resource-${randomUUID()}` });
const businessCode = (code: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === code;
const resourceCode = (code: string) => (e: unknown) => e instanceof ResourceReservationError && e.code === code;
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const file of ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql", "0005_network_admission.sql", "0006_phone_control_journal.sql", "0007_task_recovery_budget.sql", "0008_project_basics.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const a = await actor(), projectId = await project(a.operatorId);
  await pool.query(await readFile(new URL("../migrations/0009_resource_reservations.sql", import.meta.url), "utf8"));
  assert.equal((await pool.query("SELECT phase,fact_version FROM socialgrowth_product.projects WHERE project_id=$1", [projectId])).rows[0]?.phase, "preparing");
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });
// Synthetic fixtures for NON-UI invariant/transaction checks, never platform
// verification, actual association/network readiness or acceptance evidence.
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Resource fixture','not-real-password','active')", [operatorId, `fixture-${operatorId}`]);
  await pool.query("INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')", [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
async function project(operatorId: string) {
  const id = randomUUID(); await pool.query("INSERT INTO socialgrowth_product.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Resource fixture project','company_owned',$2)", [id, operatorId]); return id;
}
async function fixture() {
  const a = await actor(), projectId = await project(a.operatorId), project2 = await project(a.operatorId), deviceId = randomUUID(), device2 = randomUUID();
  for (const id of [deviceId, device2]) await pool.query("INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Resource fixture phone','associated_pending_access')", [id]);
  const fbAccount = randomUUID(), ytAccount = randomUUID(), fb = randomUUID(), yt = randomUUID(), fb2 = randomUUID();
  for (const [id, platform] of [[fbAccount, "facebook"], [ytAccount, "youtube"]]) await pool.query("INSERT INTO socialgrowth_product.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,$2,$3)", [id, platform, `fixture_${id!.replaceAll("-", "")}`]);
  for (const [id, accountId, platform] of [[fb, fbAccount, "facebook"], [fb2, fbAccount, "facebook"], [yt, ytAccount, "youtube"]]) {
    await pool.query("INSERT INTO socialgrowth_product.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,$3,$4)", [id, accountId, platform, `fixture_${id!.replaceAll("-", "")}`]);
  }
  return { a, projectId, project2, deviceId, device2, fbAccount, ytAccount, fb, yt, fb2 };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function request(f: Fixture, identityIds = [f.fb]) {
  return { metadata: metadata(), reservation: { projectId: f.projectId, deviceId: f.deviceId, identityIds },
    expectedResourceVersion: (await store.read(f.a.token)).version, expectedProjectVersion: 0, expectedDeviceVersion: 0 };
}
async function counts(f: Fixture) {
  return (await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.resource_reservation_commands WHERE actor_id=$1) commands,
    (SELECT count(*)::int FROM socialgrowth_product.audit_records WHERE action='resource.initial_reservation' AND object_id=$2) audits,
    (SELECT count(*)::int FROM socialgrowth_product.project_identity_reservations WHERE device_id=$2) identities`, [f.a.operatorId, f.deviceId])).rows[0];
}
test("durable FB/YT reservation remains pending; restart/replay returns current ledger, never a grant", async () => {
  const f = await fixture(), input = await request(f, [f.yt, f.fb]), first = await store.reserve(f.a.token, f.a.csrf, input);
  const g = await fixture(); await store.reserve(g.a.token, g.a.csrf, await request(g));
  const retry = await new ResourceReservationStore(pool, auth).reserve(f.a.token, f.a.csrf, { ...input, metadata: { ...input.metadata, requestId: metadata().requestId }, reservation: { ...input.reservation, identityIds: [f.fb, f.yt] } });
  assert.equal(retry.replayed, true); assert.equal(retry.version, first.version + 1);
  assert.ok(retry.snapshot.bindings.some(b => b.deviceId === g.deviceId));
  assert.deepEqual(await counts(f), { commands: 1, audits: 1, identities: 2 });
  const rows = await pool.query("SELECT state,reserved_by_operator_id FROM socialgrowth_product.project_identity_reservations WHERE device_id=$1", [f.deviceId]);
  assert.ok(rows.rows.every(r => r.state === "pending_initialization" && r.reserved_by_operator_id === f.a.operatorId));
  assert.equal((await pool.query("SELECT phase FROM socialgrowth_product.projects WHERE project_id=$1", [f.projectId])).rows[0]?.phase, "preparing");
});
test("competing projects on one phone have exactly one initial reservation winner", async () => {
  const f = await fixture(), input = await request(f), competing = { ...input, metadata: metadata(), reservation: { ...input.reservation, projectId: f.project2 } };
  const results = await Promise.allSettled([store.reserve(f.a.token, f.a.csrf, input), store.reserve(f.a.token, f.a.csrf, competing)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected" && businessCode("FACT_VERSION_STALE")(r.reason)).length, 1);
  assert.deepEqual(await counts(f), { commands: 1, audits: 1, identities: 1 });
});
test("same identity cannot move to another phone; fresh version does not bypass handover", async () => {
  const f = await fixture(); await store.reserve(f.a.token, f.a.csrf, await request(f));
  const input = await request(f); input.reservation.deviceId = f.device2;
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, input), resourceCode("HANDOVER_REQUIRED"));
  assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.project_device_reservations WHERE device_id=$1", [f.device2])).rowCount, 0);
});
test("same platform rotation and cross-project account use fail atomically", async () => {
  const f = await fixture(); await store.reserve(f.a.token, f.a.csrf, await request(f));
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, await request(f, [f.fb2, f.yt])), resourceCode("HANDOVER_REQUIRED"));
  const input = await request(f, [f.fb2]); input.reservation.projectId = f.project2; input.reservation.deviceId = f.device2;
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, input), resourceCode("HANDOVER_REQUIRED"));
  assert.deepEqual(await counts(f), { commands: 1, audits: 1, identities: 1 });
});
test("second platform may be added without repeating first reservation; exact new-key no-op has no audit/version", async () => {
  const f = await fixture(), first = await store.reserve(f.a.token, f.a.csrf, await request(f));
  const second = await store.reserve(f.a.token, f.a.csrf, await request(f, [f.yt])); assert.equal(second.version, first.version + 1);
  const noop = await store.reserve(f.a.token, f.a.csrf, await request(f, [f.fb, f.yt])); assert.equal(noop.version, second.version);
  assert.deepEqual(await counts(f), { commands: 3, audits: 2, identities: 2 });
});
test("project/device version changes, missing registry and forbidden extra fields cannot allocate", async () => {
  const f = await fixture(), old = await request(f);
  await pool.query("UPDATE socialgrowth_product.projects SET fact_version=fact_version+1 WHERE project_id=$1", [f.projectId]);
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, old), businessCode("FACT_VERSION_STALE"));
  const input = { ...old, expectedProjectVersion: 1 };
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, { ...input, metadata: metadata(), reservation: { ...input.reservation, identityIds: [randomUUID()] } }), resourceCode("INVALID_RESOURCE_FACTS"));
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, { ...input, reservation: { ...input.reservation, ready: true } }), businessCode("INPUT_INVALID"));
  await pool.query("UPDATE socialgrowth_product.devices SET fact_version=fact_version+1 WHERE device_id=$1", [f.deviceId]);
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, input), businessCode("FACT_VERSION_STALE"));
  assert.deepEqual(await counts(f), { commands: 0, audits: 0, identities: 0 });
});
test("auth and CSRF protect reads, writes and replay; any active operator can handle the same project", async () => {
  const f = await fixture(), b = await actor(), input = await request(f);
  await assert.rejects(store.reserve(f.a.token, "", input), businessCode("AUTHENTICATION_REQUIRED"));
  await store.reserve(b.token, b.csrf, input);
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [b.sessionId]);
  await assert.rejects(store.reserve(b.token, b.csrf, input), businessCode("AUTHENTICATION_REQUIRED"));
  await assert.rejects(store.read(b.token), businessCode("AUTHENTICATION_REQUIRED"));
  assert.equal((await pool.query("SELECT reserved_by_operator_id FROM socialgrowth_product.project_identity_reservations WHERE identity_id=$1", [f.fb])).rows[0]?.reserved_by_operator_id, b.operatorId);
});
test("same actor/key cannot substitute another phone or unseen resource version", async () => {
  const f = await fixture(), input = await request(f); await store.reserve(f.a.token, f.a.csrf, input);
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, { ...input, reservation: { ...input.reservation, deviceId: f.device2 } }), businessCode("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(store.reserve(f.a.token, f.a.csrf, { ...input, expectedResourceVersion: input.expectedResourceVersion + 1 }), businessCode("IDEMPOTENCY_KEY_REUSED"));
});
test("audit failure rolls back ALL reservations, resource version and command without leaking details", async () => {
  const f = await fixture(), input = await request(f);
  await pool.query(`CREATE FUNCTION socialgrowth_product.fail_resource_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='resource.initial_reservation' THEN RAISE EXCEPTION 'resource-fixture-secret'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER resource_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.fail_resource_audit()");
  try {
    await assert.rejects(store.reserve(f.a.token, f.a.csrf, input), (e: unknown) => businessCode("INTERNAL_ERROR")(e) && e instanceof Error && !e.message.includes("fixture-secret") && !e.cause);
    assert.deepEqual(await counts(f), { commands: 0, audits: 0, identities: 0 }); assert.equal((await store.read(f.a.token)).version, input.expectedResourceVersion);
    assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.project_device_reservations WHERE device_id=$1", [f.deviceId])).rowCount, 0);
  } finally { await pool.query("DROP TRIGGER resource_fault ON socialgrowth_product.audit_records"); await pool.query("DROP FUNCTION socialgrowth_product.fail_resource_audit()"); }
  await store.reserve(f.a.token, f.a.csrf, input);
});
test("expiry during guard lock wait rejects and rolls back after actual database deadline", async () => {
  const f = await fixture(), input = await request(f), blocker = await pool.connect(); let result: Promise<unknown> | undefined;
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE session_id=$1", [f.a.sessionId]);
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT 1 FROM socialgrowth_product.resource_reservation_guard FOR UPDATE");
    result = store.reserve(f.a.token, f.a.csrf, input); const guarded = assert.rejects(result, businessCode("AUTHENTICATION_REQUIRED"));
    let waiting = false, expired = false;
    for (let i = 0; i < 300; i++) {
      const state = await pool.query<{ expired: boolean; waiting: boolean }>(`SELECT (SELECT expires_at<=clock_timestamp() FROM socialgrowth_product.operator_sessions WHERE session_id=$1) expired,
        EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='sg-resource-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()) waiting`, [f.a.sessionId]);
      waiting ||= state.rows[0]!.waiting; expired = state.rows[0]!.expired;
      if (waiting && expired) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting && expired); await blocker.query("COMMIT"); await guarded;
    assert.deepEqual(await counts(f), { commands: 0, audits: 0, identities: 0 });
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await result?.catch(() => undefined); }
});
test("database constraints resist bypass: cross-project composite links and duplicate identity/phone slots", async () => {
  const f = await fixture(); await store.reserve(f.a.token, f.a.csrf, await request(f));
  await pool.query("INSERT INTO socialgrowth_product.project_device_reservations(device_id,project_id) VALUES($1,$2)", [f.device2, f.project2]);
  const dbCode = (code: string) => (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === code;
  await assert.rejects(pool.query(`INSERT INTO socialgrowth_product.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id) VALUES($1,$2,'facebook',$3,$4,$5)`, [f.fb2, f.fbAccount, f.device2, f.project2, f.a.operatorId]), dbCode("23503"));
  await assert.rejects(pool.query(`INSERT INTO socialgrowth_product.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id) VALUES($1,$2,'facebook',$3,$4,$5)`, [f.fb2, f.fbAccount, f.deviceId, f.projectId, f.a.operatorId]), dbCode("23505"));
  await assert.rejects(pool.query("UPDATE socialgrowth_product.publishing_identities SET canonical_identity_ref='different_source_identity' WHERE identity_id=$1", [f.fb]), dbCode("P0001"));
  await assert.rejects(pool.query("UPDATE socialgrowth_product.media_accounts SET canonical_account_ref='different_source_account' WHERE account_id=$1", [f.fbAccount]), dbCode("P0001"));
});
test("exit, exit pending and unassociated phones cannot be newly reserved; project/owner changes do not release reservations", async () => {
  const f = await fixture();
  for (const state of ["exit_pending", "exited", "unassociated"]) {
    await pool.query("UPDATE socialgrowth_product.devices SET state=$2 WHERE device_id=$1", [f.deviceId, state]);
    await assert.rejects(store.reserve(f.a.token, f.a.csrf, await request(f)), businessCode("INPUT_INVALID"));
  }
  await pool.query("UPDATE socialgrowth_product.devices SET state='associated_pending_access' WHERE device_id=$1", [f.deviceId]);
  await store.reserve(f.a.token, f.a.csrf, await request(f));
  await pool.query("UPDATE socialgrowth_product.devices SET state='paused' WHERE device_id=$1", [f.deviceId]);
  await pool.query("UPDATE socialgrowth_product.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1", [f.a.operatorId]);
  assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.project_identity_reservations WHERE identity_id=$1", [f.fb])).rowCount, 1);
});

test("resource guard wait and another operator assigning the first actor as owner share a deadlock-free metadata order", async () => {
  const f = await fixture(), b = await actor(), input = await request(f), blocker = await pool.connect();
  let settled: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT 1 FROM socialgrowth_product.resource_reservation_guard FOR UPDATE");
    const reserve = store.reserve(f.a.token, f.a.csrf, input); void reserve.catch(() => undefined);
    let guardWaiting = false;
    for (let i = 0; i < 100; i++) {
      guardWaiting = !!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-resource-fixtures' AND wait_event_type='Lock' AND query LIKE '%resource_reservation_guard%' AND pid<>pg_backend_pid()")).rowCount;
      if (guardWaiting) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(guardWaiting);
    const edit = new ProjectService(pool, auth).save(b.token, b.csrf, { metadata: metadata(), projectId: f.projectId, expectedFactVersion: 0,
      basics: { name: "Resource owner race", kind: "company_owned", customerName: null, ownerOperatorId: f.a.operatorId, notificationEmail: null } }, "update");
    settled = Promise.allSettled([reserve, edit]);
    let writerWaitingBeforeProject = false;
    for (let i = 0; i < 100; i++) {
      writerWaitingBeforeProject = !!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-resource-fixtures' AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE %operators%' AND pid<>pg_backend_pid()")).rowCount;
      if (writerWaitingBeforeProject) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(writerWaitingBeforeProject, "Project writer must wait before owning project/other-operator locks");
    await blocker.query("COMMIT");
    const results = await settled; assert.ok(results.every(r => r.status === "fulfilled"));
    assert.deepEqual(await counts(f), { commands: 1, audits: 1, identities: 1 });
    assert.equal((await pool.query("SELECT owner_operator_id FROM socialgrowth_product.projects WHERE project_id=$1", [f.projectId])).rows[0]?.owner_operator_id, f.a.operatorId);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await settled; }
});
