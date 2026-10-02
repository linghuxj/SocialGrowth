import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { controlProtocolVersion, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import { ActionPermissionError, type ActionAuthorityFacts } from "./action-permission-core.js";
import { PhoneControlJournal, PhoneJournalError } from "./phone-control-journal.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
const clusterId = process.env.SG_PRODUCT_TEST_CLUSTER_ID;
if (!clusterId || !databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error("Phone journal PostgreSQL tests need an isolated URL and SG_PRODUCT_TEST_ALLOW_RESET=1");
}
const pool = new Pool({ connectionString: databaseUrl, max: 8, application_name: "sg-phone-journal-fixtures" });
const store = new PhoneControlJournal(pool);
const key = () => `journal_${randomUUID().replaceAll("-", "")}`;
const isStale = (error: unknown) => error instanceof PhoneJournalError && error.code === "STALE_FACT";
const isDenied = (error: unknown) => error instanceof ActionPermissionError && error.code === "ACTION_DENIED";
async function guard() {
  const row = (await pool.query("SELECT current_database() db,system_identifier::text cluster FROM pg_control_system()")).rows[0];
  assert.equal(row.db, "sg_phone4_component");
  assert.equal(row.cluster, clusterId);
}
before(async () => {
  await guard();
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const migration of ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql", "0005_network_admission.sql", "0006_phone_control_journal.sql", "0029_phone_holder_grants.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
});
after(async () => {
  try { await guard(); await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); }
  finally { await pool.end(); }
});
async function clock() {
  const result = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  return result.rows[0]!.now.toISOString();
}
async function device() {
  const deviceId = randomUUID();
  await pool.query(`INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Journal fixture','unassociated')`, [deviceId]);
  return deviceId;
}
// Synthetic internal authority/stop evidence, NOT actual phone acceptance.
// The fixture now uses the real stop/acquisition transactions, never an enabled
// row seeded in place of an actual holder grant.
async function heldFixture(generation = "1") {
  const deviceId = await device(), holderId = randomUUID(), taskAttemptId = randomUUID(), authorizationId = randomUUID();
  const initial = await store.initialize(deviceId, randomUUID(), key());
  if (generation !== "1") {
    await pool.query(`UPDATE socialgrowth_product.phone_control_journals SET control_generation=$2,record=$3 WHERE device_id=$1`,
      [deviceId, generation, { ...initial.record, controlGeneration: generation }]);
  }
  const stopped = await store.apply(deviceId, 0, key(), { kind: "confirm_stopped", evidence: {
    deviceId, holderId: null, stopRequestId: initial.record.stopRequestId, controlGeneration: generation,
    evidenceId: key(), checkedAt: await clock(), allPathsFenced: true, controllerReleased: true, targetQuiescent: true,
  } });
  const request: PhoneActionRequest = { protocolVersion: controlProtocolVersion, deviceId, holderId, taskAttemptId, authorizationId,
    controlGeneration: generation, actionId: randomUUID(), purpose: "business", kind: "read_screen" };
  const now = await clock(), until = new Date(Date.parse(now) + 300_000).toISOString();
  const facts: ActionAuthorityFacts = { deviceId, controlVersion: stopped.record.version, controlGeneration: generation, providerIntent: "active",
    projectPublicationPaused: false, networkAdmitted: true, adbAuthorized: true, targetVerified: true,
    holder: { holderId, taskAttemptId, authorizationId, controlGeneration: generation, kind: "executor", purpose: "business", leaseUntil: until },
    localConfirmation: { controlGeneration: generation, intent: "active", checkedAt: now },
    task: { taskAttemptId, authorizationId, operation: "collect", authorized: true, currentVersions: true, validUntil: until,
      allowedKinds: ["read_screen"], submission: "none", materialVerified: false, explicitRemovalAuthorized: false } };
  const { actionId: _action, kind: _kind, ...holderRequest } = request;
  const granted = await store.apply(deviceId, stopped.record.version, key(), { kind: "acquire_holder", request: holderRequest }, facts);
  return { deviceId, record: granted.record, request, facts: { ...facts, controlVersion: granted.record.version } };
}
async function refresh(f: Awaited<ReturnType<typeof heldFixture>>, version: number) {
  return { ...f.facts, controlVersion: version, localConfirmation: { ...f.facts.localConfirmation, checkedAt: await clock() } };
}
async function counts(deviceId: string) {
  const result = await pool.query<{ commands: string; audits: string }>(
    `SELECT (SELECT count(*)::text FROM socialgrowth_product.phone_control_commands WHERE device_id=$1) commands,
      (SELECT count(*)::text FROM socialgrowth_product.audit_records WHERE object_type='phone_control' AND object_id=$1) audits`, [deviceId],
  );
  return result.rows[0]!;
}

test("journal initialization starts blocked, never resets an existing owner and replays current state", async () => {
  const deviceId = await device(), stopRequestId = randomUUID(), requestKey = key();
  const first = await store.initialize(deviceId, stopRequestId, requestKey);
  assert.equal(first.record.disposition, "stop_requested");
  assert.equal(first.record.holderId, null);
  assert.equal(first.record.stopEvidenceId, null);
  assert.equal(first.replayed, false);
  assert.equal((await store.initialize(deviceId, stopRequestId, requestKey)).replayed, true);
  const stopped = await store.apply(deviceId, 0, key(), { kind: "confirm_stopped", evidence: {
    deviceId, holderId: null, stopRequestId, controlGeneration: "1", evidenceId: key(), checkedAt: await clock(),
    allPathsFenced: true, controllerReleased: true, targetQuiescent: true,
  } });
  const replay = await store.initialize(deviceId, stopRequestId, requestKey);
  assert.deepEqual(replay.record, stopped.record);
  await assert.rejects(store.initialize(deviceId, randomUUID(), requestKey), isStale);
  await assert.rejects(store.initialize(deviceId, stopRequestId, key()), isStale);
  assert.deepEqual(await counts(deviceId), { commands: "2", audits: "2" });
});

test("concurrent distinct call IDs share one committed in-flight slot", async () => {
  const f = await heldFixture(), facts = await refresh(f, f.record.version);
  const results = await Promise.allSettled([
    store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: f.request }, facts),
    new PhoneControlJournal(pool).apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: { ...f.request, actionId: randomUUID() } }, facts),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected");
  assert.ok(rejected?.status === "rejected" && isStale(rejected.reason));
  const record = await store.read(f.deviceId);
  assert.equal(record.calls.length, 1);
  assert.equal(record.calls[0]?.status, "running");
  assert.equal(record.version, f.record.version + 1);
  assert.deepEqual(await counts(f.deviceId), { commands: "4", audits: "4" });
});

test("lost call response never returns repeat permission; same key with another payload is rejected", async () => {
  const f = await heldFixture(), requestKey = key(), command = { kind: "begin_call", request: f.request };
  await store.apply(f.deviceId, f.record.version + 0, requestKey, command, await refresh(f, f.record.version));
  await store.apply(f.deviceId, f.record.version + 1, key(), { kind: "request_stop", stopRequestId: randomUUID() });
  const replay = await new PhoneControlJournal(pool).apply(f.deviceId, f.record.version + 0, requestKey, command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.disposition, "stop_requested");
  assert.equal(replay.record.controlGeneration, "2");
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, requestKey, { ...command, request: { ...f.request, actionId: randomUUID() } }), isStale);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 1, requestKey, command), isStale);
  assert.deepEqual(await counts(f.deviceId), { commands: "5", audits: "5" });
});

test("pause accepts a running call, rejects next read, and late completion only updates history", async () => {
  const f = await heldFixture();
  await store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: f.request }, await refresh(f, f.record.version));
  const paused = await store.apply(f.deviceId, f.record.version + 1, key(), { kind: "request_stop", stopRequestId: randomUUID() });
  assert.equal(paused.record.calls[0]?.status, "running");
  await assert.rejects(store.apply(f.deviceId, f.record.version + 2, key(), { kind: "begin_call", request: { ...f.request, actionId: randomUUID() } }, await refresh(f, f.record.version + 2)), ActionPermissionError);
  const result = await store.apply(f.deviceId, f.record.version + 2, key(), { kind: "call_result", receipt: {
    deviceId: f.deviceId, actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: "1", status: "ended",
  } });
  assert.equal(result.record.disposition, "stop_requested");
  assert.equal(result.record.holderId, f.request.holderId);
  assert.equal(result.record.stopEvidenceId, null);
  assert.equal(result.record.calls[0]?.status, "ended");
});

test("unknown and restart preserve occupancy; actual stopped proof requires an ended call", async () => {
  const f = await heldFixture();
  await store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: f.request }, await refresh(f, f.record.version));
  await store.apply(f.deviceId, f.record.version + 1, key(), { kind: "call_result", receipt: {
    deviceId: f.deviceId, actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: "1", status: "unknown",
  } });
  const restart = new PhoneControlJournal(pool);
  assert.equal((await restart.read(f.deviceId)).calls[0]?.status, "unknown");
  await assert.rejects(restart.apply(f.deviceId, f.record.version + 2, key(), { kind: "begin_call", request: { ...f.request, actionId: randomUUID() } }, await refresh(f, f.record.version + 2)),
    (error: unknown) => error instanceof ActionPermissionError && error.code === "BUSY");
  const stopRequestId = randomUUID();
  await restart.apply(f.deviceId, f.record.version + 2, key(), { kind: "request_stop", stopRequestId });
  const evidence = { deviceId: f.deviceId, holderId: f.request.holderId, stopRequestId, controlGeneration: "2", evidenceId: key(),
    checkedAt: await clock(), allPathsFenced: true, controllerReleased: true, targetQuiescent: true };
  await assert.rejects(restart.apply(f.deviceId, f.record.version + 3, key(), { kind: "confirm_stopped", evidence }),
    (error: unknown) => error instanceof ActionPermissionError && error.code === "STOP_UNCONFIRMED");
  const ended = await restart.apply(f.deviceId, f.record.version + 3, key(), { kind: "call_result", receipt: {
    deviceId: f.deviceId, actionId: f.request.actionId, holderId: f.request.holderId, controlGeneration: "1", status: "ended",
  } });
  const checkedAt = await clock();
  assert.ok(Date.parse(checkedAt) >= Date.parse(ended.record.calls[0]!.endedAt!));
  const stopped = await restart.apply(f.deviceId, f.record.version + 4, key(), { kind: "confirm_stopped", evidence: { ...evidence, checkedAt } });
  assert.equal(stopped.record.disposition, "stopped");
  assert.equal(stopped.record.holderId, null);
  assert.equal(stopped.record.stopEvidenceId, evidence.evidenceId);
});

test("new pause invalidates a previous stop proof even when all old calls ended", async () => {
  const deviceId = await device(), oldId = randomUUID();
  await store.initialize(deviceId, oldId, key());
  const evidence = { deviceId, holderId: null, stopRequestId: oldId, controlGeneration: "1", evidenceId: key(), checkedAt: await clock(),
    allPathsFenced: true, controllerReleased: true, targetQuiescent: true };
  const newId = randomUUID();
  await store.apply(deviceId, 0, key(), { kind: "request_stop", stopRequestId: newId });
  await assert.rejects(store.apply(deviceId, 1, key(), { kind: "confirm_stopped", evidence }),
    (error: unknown) => error instanceof ActionPermissionError && error.code === "STALE_RECEIPT");
  assert.equal((await store.read(deviceId)).stopRequestId, newId);
});

test("duplicate stops consume one version, while changed stop IDs cannot reuse a command key", async () => {
  const f = await heldFixture(), requestKey = key(), command = { kind: "request_stop", stopRequestId: randomUUID() };
  const results = await Promise.all([
    store.apply(f.deviceId, f.record.version + 0, requestKey, command), new PhoneControlJournal(pool).apply(f.deviceId, f.record.version + 0, requestKey, command),
  ]);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.deepEqual(results[0].record, results[1].record);
  assert.equal(results[0].record.version, f.record.version + 1);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, requestKey, { ...command, stopRequestId: randomUUID() }), isStale);
  assert.deepEqual(await counts(f.deviceId), { commands: "4", audits: "4" });
});

test("audit write failure rolls back the call, command and version without leaking driver data", async () => {
  const f = await heldFixture(), requestKey = key();
  await pool.query(`CREATE FUNCTION socialgrowth_product.fail_journal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='phone_control.begin_call' THEN RAISE EXCEPTION 'fixture-secret-url-password'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER journal_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.fail_journal_audit()`);
  try {
    await assert.rejects(store.apply(f.deviceId, f.record.version + 0, requestKey, { kind: "begin_call", request: f.request }, await refresh(f, f.record.version)), (error: unknown) => {
      assert.ok(error instanceof PhoneJournalError);
      assert.equal(error.code, "DATABASE_UNAVAILABLE");
      assert.ok(!error.message.includes("fixture-secret"));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(await store.read(f.deviceId), f.record);
    assert.deepEqual(await counts(f.deviceId), { commands: "3", audits: "3" });
  } finally {
    await pool.query("DROP TRIGGER journal_fault ON socialgrowth_product.audit_records");
    await pool.query("DROP FUNCTION socialgrowth_product.fail_journal_audit()");
  }
  assert.equal((await store.apply(f.deviceId, f.record.version + 0, requestKey, { kind: "begin_call", request: f.request }, await refresh(f, f.record.version))).record.version, f.record.version + 1);
});

test("strict boundary rejects extra facts, secret-like strings, cross-device requests and fractional versions", async () => {
  const f = await heldFixture();
  const invalid = (error: unknown) => error instanceof PhoneJournalError && error.code === "INVALID_BOUNDARY";
  await assert.rejects(store.apply(f.deviceId, 0.5, key(), { kind: "request_stop", stopRequestId: randomUUID() }), invalid);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, key(), { kind: "request_stop", stopRequestId: randomUUID(), stopped: true }), invalid);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, key(), { kind: "confirm_stopped", evidence: "fixture-secret" }), invalid);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: f.request }), invalid);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: { ...f.request, deviceId: randomUUID() } }, await refresh(f, f.record.version)), ActionPermissionError);
  const facts = { ...await refresh(f, f.record.version), permissionGranted: true };
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: f.request }, facts), ActionPermissionError);
  assert.deepEqual(await counts(f.deviceId), { commands: "3", audits: "3" });
});

test("stored false-stopped or malformed JSON is rejected without releasing or rewriting the row", async () => {
  const f = await heldFixture();
  const corrupt = { ...f.record, disposition: "stopped", holderId: null, stopRequestId: randomUUID(), stopEvidenceId: key(),
    calls: [{ actionId: randomUUID(), holderId: f.request.holderId, controlGeneration: "1", startedAt: await clock(), endedAt: null, status: "unknown" }] };
  await pool.query(`UPDATE socialgrowth_product.phone_control_journals SET disposition='stopped',holder_id=NULL,record=$2 WHERE device_id=$1`, [f.deviceId, corrupt]);
  await assert.rejects(store.read(f.deviceId), ActionPermissionError);
  await assert.rejects(store.apply(f.deviceId, f.record.version + 0, key(), { kind: "request_stop", stopRequestId: randomUUID() }), ActionPermissionError);
  const saved = await pool.query<{ record: unknown }>("SELECT record FROM socialgrowth_product.phone_control_journals WHERE device_id=$1", [f.deviceId]);
  assert.deepEqual(saved.rows[0]?.record, corrupt);
  await assert.rejects(pool.query("UPDATE socialgrowth_product.phone_control_journals SET record='{}'::jsonb WHERE device_id=$1", [f.deviceId]));
});

test("database wall clock after a lock wait rejects an expired lease", async () => {
  const f = await heldFixture(), blocker = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT device_id FROM socialgrowth_product.devices WHERE device_id=$1 FOR UPDATE", [f.deviceId]);
    const facts = await refresh(f, f.record.version);
    facts.holder.leaseUntil = new Date(Date.parse(await clock()) + 150).toISOString();
    pending = store.apply(f.deviceId, f.record.version + 0, key(), { kind: "begin_call", request: f.request }, facts);
    const outcome = assert.rejects(pending, isDenied);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-phone-journal-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()");
      if (rows.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "must observe an actual lock wait");
    await new Promise(resolve => setTimeout(resolve, 200));
    await blocker.query("COMMIT");
    await outcome;
    assert.deepEqual(await store.read(f.deviceId), f.record);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending?.catch(() => undefined);
  }
});

test("another device progresses while one journal waits; no global executor lock", async () => {
  const first = await heldFixture(), second = await heldFixture(), blocker = await pool.connect();
  let pending: ReturnType<PhoneControlJournal["apply"]> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT device_id FROM socialgrowth_product.devices WHERE device_id=$1 FOR UPDATE", [first.deviceId]);
    pending = store.apply(first.deviceId, first.record.version, key(), { kind: "begin_call", request: first.request }, await refresh(first, first.record.version));
    const other = await store.apply(second.deviceId, second.record.version, key(), { kind: "begin_call", request: second.request }, await refresh(second, second.record.version));
    assert.equal(other.record.version, second.record.version + 1);
    await blocker.query("COMMIT");
    assert.equal((await pending).record.version, first.record.version + 1);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending?.catch(() => undefined);
  }
});

test("two real OS processes compete for one call slot without duplicating commands or audit", async () => {
  const f = await heldFixture(), facts = await refresh(f, f.record.version);
  const script = `import {Pool} from 'pg'; import {PhoneControlJournal,PhoneJournalError} from './src/phone-control-journal.ts';
    import {ActionPermissionError} from './src/action-permission-core.ts';
    const pool=new Pool({connectionString:process.env.SG_PRODUCT_TEST_DATABASE_URL});
    try { const f=JSON.parse(process.env.SG_JOURNAL_FIXTURE); const r=await new PhoneControlJournal(pool).apply(f.deviceId,f.facts.controlVersion,f.key,{kind:'begin_call',request:f.request},f.facts);
      process.stdout.write(JSON.stringify({version:r.record.version,replayed:r.replayed})); }
    catch(e) { process.stdout.write(JSON.stringify({code:e instanceof PhoneJournalError||e instanceof ActionPermissionError?e.code:'UNEXPECTED'})); }
    finally { await pool.end(); }`;
  const run = promisify(execFile);
  const results = await Promise.all([f.request, { ...f.request, actionId: randomUUID() }].map(request => run(process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, SG_JOURNAL_FIXTURE: JSON.stringify({ deviceId: f.deviceId, key: key(), request, facts }) }, timeout: 20_000 })));
  const outcomes = results.map(r => JSON.parse(r.stdout) as { version?: number; code?: string });
  assert.equal(outcomes.filter(r => r.version === f.record.version + 1).length, 1);
  assert.equal(outcomes.filter(r => r.code === "STALE_FACT").length, 1);
  assert.equal((await store.read(f.deviceId)).calls.length, 1);
  assert.deepEqual(await counts(f.deviceId), { commands: "4", audits: "4" });
});

test("cross-device misrouted receipts preserve each original device scope", async () => {
  const a = await heldFixture(), b = await heldFixture();
  const bRequest = { ...b.request, actionId: a.request.actionId };
  await store.apply(a.deviceId, a.record.version, key(), { kind: "begin_call", request: a.request }, await refresh(a, a.record.version));
  await store.apply(b.deviceId, b.record.version, key(), { kind: "begin_call", request: bRequest }, await refresh(b, b.record.version));
  const receipt = { deviceId: a.deviceId, actionId: a.request.actionId, holderId: a.request.holderId, controlGeneration: "1", status: "ended" };
  await assert.rejects(store.apply(b.deviceId, b.record.version + 1, key(), { kind: "call_result", receipt }),
    (error: unknown) => error instanceof ActionPermissionError && error.code === "STALE_RECEIPT");
  assert.equal((await store.read(b.deviceId)).calls[0]?.status, "running");
  assert.equal((await store.apply(a.deviceId, a.record.version + 1, key(), { kind: "call_result", receipt })).record.calls[0]?.status, "ended");
});

test("persistent generation stays lossless above JavaScript safe integer and advances on pause", async () => {
  const generation = "9007199254740993", f = await heldFixture(generation);
  await store.apply(f.deviceId, f.record.version, key(), { kind: "begin_call", request: f.request }, await refresh(f, f.record.version));
  const stopping = await store.apply(f.deviceId, f.record.version + 1, key(), { kind: "request_stop", stopRequestId: randomUUID() });
  assert.equal(stopping.record.controlGeneration, "9007199254740994");
  assert.equal((await new PhoneControlJournal(pool).read(f.deviceId)).calls[0]?.controlGeneration, generation);
});

test("control version or generation overflow rejects without partial writes or a reset", async () => {
  const f = await heldFixture(), version = Number.MAX_SAFE_INTEGER;
  const record = { ...f.record, version };
  await pool.query("UPDATE socialgrowth_product.phone_control_journals SET version=$2,record=$3 WHERE device_id=$1", [f.deviceId, version, record]);
  const invalid = (error: unknown) => error instanceof ActionPermissionError && error.code === "INVALID_BOUNDARY";
  await assert.rejects(store.apply(f.deviceId, version, key(), { kind: "request_stop", stopRequestId: randomUUID() }), invalid);
  assert.deepEqual(await store.read(f.deviceId), record);
  const fullGeneration = { ...f.record, version: 0, controlGeneration: "9999999999999999999" };
  await pool.query("UPDATE socialgrowth_product.phone_control_journals SET version=0,control_generation=$2,record=$3 WHERE device_id=$1", [f.deviceId, fullGeneration.controlGeneration, fullGeneration]);
  await assert.rejects(store.apply(f.deviceId, 0, key(), { kind: "request_stop", stopRequestId: randomUUID() }), invalid);
  assert.deepEqual(await store.read(f.deviceId), fullGeneration);
  assert.deepEqual(await counts(f.deviceId), { commands: "3", audits: "3" });
});

async function nextHolder(f: Awaited<ReturnType<typeof heldFixture>>) {
  const stopping = await store.apply(f.deviceId, f.record.version, key(), { kind: "request_stop", stopRequestId: randomUUID() });
  const stopped = await store.apply(f.deviceId, stopping.record.version, key(), { kind: "confirm_stopped", evidence: {
    deviceId: f.deviceId, holderId: f.record.holderId, stopRequestId: stopping.record.stopRequestId,
    controlGeneration: stopping.record.controlGeneration, evidenceId: key(), checkedAt: await clock(),
    allPathsFenced: true, controllerReleased: true, targetQuiescent: true,
  } });
  const holderId = randomUUID(), generation = stopped.record.controlGeneration;
  const { actionId: _action, kind: _kind, ...identity } = f.request;
  const request = { ...identity, holderId, controlGeneration: generation };
  const facts = { ...await refresh(f, stopped.record.version), controlGeneration: generation,
    holder: { ...f.facts.holder, holderId, controlGeneration: generation },
    localConfirmation: { ...f.facts.localConfirmation, checkedAt: await clock(), controlGeneration: generation } };
  return { stopped: stopped.record, request, facts };
}

test("two holders race for one device; acquisition, immutable grant and audit commit once", async () => {
  const f = await heldFixture(), n = await nextHolder(f), other = randomUUID();
  const results = await Promise.allSettled([
    store.apply(f.deviceId, n.stopped.version, key(), { kind: "acquire_holder", request: n.request }, n.facts),
    new PhoneControlJournal(pool).apply(f.deviceId, n.stopped.version, key(), { kind: "acquire_holder", request: { ...n.request, holderId: other } },
      { ...n.facts, holder: { ...n.facts.holder, holderId: other } }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(results.some(r => r.status === "rejected" && isStale(r.reason)));
  const grants = await pool.query("SELECT holder_id FROM socialgrowth_product.phone_control_holder_grants WHERE device_id=$1", [f.deviceId]);
  assert.equal(grants.rowCount, 2); // Original holder plus exactly one successor.
  assert.equal((await store.read(f.deviceId)).calls.length, 0);
  await assert.rejects(pool.query("UPDATE socialgrowth_product.phone_control_holder_grants SET record=record WHERE holder_id=$1", [f.request.holderId]));
  await assert.rejects(pool.query("DELETE FROM socialgrowth_product.phone_control_holder_grants WHERE holder_id=$1", [f.request.holderId]));
});

test("lost acquisition response replays current pause and never renews or resurrects holder", async () => {
  const f = await heldFixture(), n = await nextHolder(f), requestKey = key(), command = { kind: "acquire_holder", request: n.request };
  const granted = await store.apply(f.deviceId, n.stopped.version, requestKey, command, n.facts);
  await store.apply(f.deviceId, granted.record.version, key(), { kind: "request_stop", stopRequestId: randomUUID() });
  const replay = await new PhoneControlJournal(pool).apply(f.deviceId, n.stopped.version, requestKey, command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.disposition, "stop_requested");
  assert.equal(replay.record.calls.length, 0);
});

test("persisted holder scope rejects kind expansion, operation substitution and lease renewal", async () => {
  const f = await heldFixture(), facts = await refresh(f, f.record.version);
  const changed = { ...facts, task: { ...facts.task, allowedKinds: ["read_screen", "navigate"] as ActionAuthorityFacts["task"]["allowedKinds"] } };
  await assert.rejects(store.apply(f.deviceId, f.record.version, key(), { kind: "begin_call", request: { ...f.request, kind: "navigate" } }, changed), isStale);
  await assert.rejects(store.apply(f.deviceId, f.record.version, key(), { kind: "begin_call", request: f.request },
    { ...facts, task: { ...facts.task, operation: "initialize" } }), isStale);
  await assert.rejects(store.apply(f.deviceId, f.record.version, key(), { kind: "begin_call", request: f.request },
    { ...facts, holder: { ...facts.holder, leaseUntil: new Date(Date.parse(facts.holder.leaseUntil) + 1000).toISOString() } }), isStale);
  assert.deepEqual(await store.read(f.deviceId), f.record);
});

test("a used holder cannot be granted again after confirmed stop or on another device", async () => {
  const f = await heldFixture(), n = await nextHolder(f);
  const request = { ...n.request, holderId: f.request.holderId };
  const facts = { ...n.facts, holder: { ...n.facts.holder, holderId: f.request.holderId } };
  await assert.rejects(store.apply(f.deviceId, n.stopped.version, key(), { kind: "acquire_holder", request }, facts), isStale);
  const b = await heldFixture(), next = await nextHolder(b);
  await assert.rejects(store.apply(b.deviceId, next.stopped.version, key(), { kind: "acquire_holder", request: { ...next.request, holderId: f.request.holderId } },
    { ...next.facts, holder: { ...next.facts.holder, holderId: f.request.holderId } }), isStale);
  assert.deepEqual(await store.read(f.deviceId), n.stopped);
});

test("holder acquisition audit failure rolls back grant and device ownership", async () => {
  const f = await heldFixture(), n = await nextHolder(f);
  await pool.query(`CREATE FUNCTION socialgrowth_product.fail_holder_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='phone_control.acquire_holder' THEN RAISE EXCEPTION 'private-fixture'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER holder_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.fail_holder_audit()");
  try {
    await assert.rejects(store.apply(f.deviceId, n.stopped.version, key(), { kind: "acquire_holder", request: n.request }, n.facts),
      (e: unknown) => e instanceof PhoneJournalError && e.code === "DATABASE_UNAVAILABLE" && !e.message.includes("private-fixture"));
    assert.deepEqual(await store.read(f.deviceId), n.stopped);
    assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.phone_control_holder_grants WHERE holder_id=$1", [n.request.holderId])).rowCount, 0);
  } finally {
    await pool.query("DROP TRIGGER holder_fault ON socialgrowth_product.audit_records");
    await pool.query("DROP FUNCTION socialgrowth_product.fail_holder_audit()");
  }
});
