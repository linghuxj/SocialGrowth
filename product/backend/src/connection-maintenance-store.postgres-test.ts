import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { InstallationAuthService } from "./installation-auth-service.js";
import { NetworkAdmissionStore } from "./network-admission-store.js";
import { ConnectionMaintenanceError, type ConnectionMaintenanceRound, type ConnectionMaintenanceScope } from "./connection-maintenance-budget.js";
import { ConnectionMaintenanceStore, MaintenanceStoreError, type MaintenanceCurrentContext } from "./connection-maintenance-store.js";
import { TaskRecoveryStore } from "./task-recovery-store.js";
import type { TaskRecoveryScope } from "./task-recovery-budget.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Maintenance SQL tests need isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 12, application_name: "sg-maintenance-fixtures" });
const s = "socialgrowth_product", key = () => `maint_${randomUUID().replaceAll("-", "")}`, hash = (v: string) => createHash("sha256").update(v).digest();
// Synthetic DB-only current-context seam, NOT a production authority/current
// task resolver, real network path, Web approval or phone-operation evidence.
const context: MaintenanceCurrentContext = { resolve: async (c, scope) => {
  const row = (await c.query<{ scope: ConnectionMaintenanceScope; task: TaskRecoveryScope | null; submission: "pre_submission" | "possible_submission" | "verified_success" | null }>(`SELECT scope,task,submission FROM ${s}.maintenance_context_fixture WHERE device_id=$1 FOR UPDATE`, [scope.deviceId])).rows[0];
  return row ? { scope: row.scope, currentTask: row.task, taskSubmission: row.submission } : null;
} };
const store = new ConnectionMaintenanceStore(pool, context), tasks = new TaskRecoveryStore(pool);
const isCode = (code: string) => (e: unknown) => (e instanceof MaintenanceStoreError || e instanceof ConnectionMaintenanceError) && e.code === code && e.message === code && !e.cause;
const sqlCode = (code: string) => (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === code;
let counter = 0, previousInstallation: string;
const auth = new InstallationAuthService(pool, "synthetic-maintenance-auth-pepper-fixture-only");
const migrationDirectory = new URL("../migrations/", import.meta.url);
before(async () => {
  const files = (await readdir(migrationDirectory)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort();
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  for (const f of files) await pool.query(await readFile(new URL(f, migrationDirectory), "utf8"));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.connection_maintenance_rounds`)).rowCount, 0);
  await pool.query(`DROP SCHEMA ${s} CASCADE`);
  for (const f of files.filter(v => v < "0016_")) await pool.query(await readFile(new URL(f, migrationDirectory), "utf8"));
  previousInstallation = (await bootstrap()).installation.installationId;
  await pool.query(await readFile(new URL("0016_connection_maintenance_budget.sql", migrationDirectory), "utf8"));
  for (const f of files.filter(v => v >= "0017_")) await pool.query(await readFile(new URL(f, migrationDirectory), "utf8"));
  await pool.query(`CREATE TABLE ${s}.maintenance_context_fixture(device_id uuid PRIMARY KEY REFERENCES ${s}.devices(device_id), scope jsonb NOT NULL, task jsonb, submission text)`);
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
async function bootstrap() {
  return auth.bootstrap({ metadata: { contractVersion, requestId: key(), idempotencyKey: key() }, installationCredential: `sginst_v1_${randomBytes(32).toString("base64url")}` }, `198.51.100.${++counter}`);
}
async function fixture(limits = { maxAttempts: 3, maxElapsedMs: 120_000 }) {
  const install = await bootstrap(), session = await auth.authenticate(install.sessionToken), deviceId = randomUUID(), providerId = randomUUID(), associationId = randomUUID(), associationSession = randomUUID();
  await pool.query(`INSERT INTO ${s}.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Synthetic maintenance provider','active')`, [providerId, `+1666${String(counter).padStart(7, "0")}`]);
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state,fact_version) VALUES($1,'Synthetic maintenance device','associated_pending_access',1)`, [deviceId]);
  await pool.query(`INSERT INTO ${s}.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at,consumed_at,consumed_by_provider_id)
    VALUES($1,$2,1,'Synthetic maintenance',$3,clock_timestamp()+interval '1 hour',clock_timestamp(),$4)`, [associationSession, session.installationId, hash(associationSession), providerId]);
  await pool.query(`INSERT INTO ${s}.device_associations(association_id,device_id,installation_id,provider_id,association_session_id) VALUES($1,$2,$3,$4,$5)`, [associationId, deviceId, session.installationId, providerId, associationSession]);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const enrollment = await new NetworkAdmissionStore(pool).begin(session, keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url"), key());
  // Relational enrollment only, NOT admitted or actual network permission.
  const scope: ConnectionMaintenanceScope = { deviceId, installationId: session.installationId, installationGeneration: enrollment.authority.installationGeneration,
    enrollmentId: enrollment.enrollmentId, enrollmentGeneration: enrollment.authority.enrollmentGeneration, ownershipVersion: enrollment.authority.ownershipVersion, roundId: randomUUID() };
  await pool.query(`INSERT INTO ${s}.maintenance_context_fixture(device_id,scope,task) VALUES($1,$2,null)`, [deviceId, scope]);
  const initialKey = key(), initial = await store.initialize(scope, initialKey, limits);
  return { scope, initialKey, initial: initial.record, limits };
}
const endpoint = () => ({ sourceEpoch: randomUUID(), reportId: randomUUID(), sequence: "9007199254740993", endpointRevision: 1 });
const beginCommand = () => ({ kind: "begin", recoveryId: randomUUID(), endpoint: endpoint() });
async function begin(f: Awaited<ReturnType<typeof fixture>>, r = f.initial) {
  return (await store.apply(f.scope, r.version, key(), beginCommand())).record;
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, r: ConnectionMaintenanceRound, outcome: "failed" | "unknown" | "verified_connected") {
  const a = r.attempts.at(-1)!;
  return (await store.apply(f.scope, r.version, key(), { kind: "complete", receipt: { scope: f.scope, recoveryId: a.recoveryId, endpoint: a.endpoint, outcome } })).record;
}
async function counts(f: Awaited<ReturnType<typeof fixture>>) {
  return (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.connection_maintenance_commands WHERE device_id=$1) commands,
    (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='connection_maintenance' AND object_id=$1) audits`, [f.scope.deviceId])).rows[0];
}
async function currentTask(f: Awaited<ReturnType<typeof fixture>>) {
  const scope = { deviceId: f.scope.deviceId, taskId: randomUUID(), taskAttemptId: randomUUID(), roundId: randomUUID() };
  const record = (await tasks.initialize(scope, key())).record;
  await pool.query(`UPDATE ${s}.maintenance_context_fixture SET task=$2,submission='pre_submission' WHERE device_id=$1`, [f.scope.deviceId, scope]); return { scope, record };
}

test("0016 retains prior 0015 identities and enforces scope CHECK/FK", async () => {
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.installations WHERE installation_id=$1`, [previousInstallation])).rowCount, 1);
  const f = await fixture(), other = await bootstrap(), newDevice = randomUUID();
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state) VALUES($1,'FK synthetic','unassociated')`, [newDevice]);
  const bad = { ...f.initial, scope: { ...f.scope, deviceId: newDevice, installationId: other.installation.installationId } };
  await assert.rejects(pool.query(`INSERT INTO ${s}.connection_maintenance_rounds(device_id,installation_id,enrollment_id,round_id,version,phase,record) VALUES($1,$2,$3,$4,0,'available',$5)`, [newDevice, bad.scope.installationId, f.scope.enrollmentId, f.scope.roundId, bad]), sqlCode("23505"));
  bad.scope.roundId = randomUUID();
  await assert.rejects(pool.query(`INSERT INTO ${s}.connection_maintenance_rounds(device_id,installation_id,enrollment_id,round_id,version,phase,record) VALUES($1,$2,$3,$4,0,'available',$5)`, [newDevice, bad.scope.installationId, f.scope.enrollmentId, bad.scope.roundId, bad]), sqlCode("23503"));
  await assert.rejects(pool.query(`UPDATE ${s}.connection_maintenance_rounds SET record='{}'::jsonb WHERE device_id=$1`, [f.scope.deviceId]), sqlCode("P0001"));
});
test("absent current-context closes every operation before pool access", async () => {
  const f = await fixture(); let calls = 0;
  const closed = new ConnectionMaintenanceStore({ connect: () => { calls++; throw new Error("should-not-connect"); } } as unknown as Pool);
  await assert.rejects(closed.initialize(f.scope, key(), f.limits), isCode("CURRENT_CONTEXT_UNAVAILABLE"));
  await assert.rejects(closed.read(f.scope), isCode("CURRENT_CONTEXT_UNAVAILABLE"));
  await assert.rejects(closed.apply(f.scope, 0, key(), beginCommand()), isCode("CURRENT_CONTEXT_UNAVAILABLE"));
  assert.equal(calls, 0); assert.deepEqual(await counts(f), { commands: 1, audits: 1 });
});
test("pinned one-device round/config survives instance restart and cannot reset under another epoch/round", async () => {
  const f = await fixture(), first = await complete(f, await begin(f), "failed");
  const repeated = await new ConnectionMaintenanceStore(pool, context).initialize(f.scope, f.initialKey, f.limits);
  assert.equal(repeated.replayed, true); assert.deepEqual(repeated.record, first);
  await assert.rejects(store.initialize(f.scope, key(), f.limits), isCode("STALE_VERSION"));
  await assert.rejects(store.initialize(f.scope, f.initialKey, { maxAttempts: 4, maxElapsedMs: 120_000 }), isCode("STALE_VERSION"));
  await assert.rejects(store.initialize({ ...f.scope, roundId: randomUUID() }, key(), f.limits), isCode("STALE_SCOPE"));
  const second = await complete(f, await begin(f, first), "failed"), third = await complete(f, await begin(f, second), "failed");
  assert.equal(third.attemptsUsed, 3); assert.equal(third.phase, "human_required"); assert.equal(new Set(third.attempts.map(a => a.endpoint.sourceEpoch)).size, 3);
  assert.deepEqual(await new ConnectionMaintenanceStore(pool, context).read(f.scope), third);
});
test("two real transactions reserve one attempt; historical replay returns current state with no eligibility", async () => {
  const f = await fixture(), requestKey = key(), command = beginCommand();
  const results = await Promise.all([store.apply(f.scope, 0, requestKey, command), new ConnectionMaintenanceStore(pool, context).apply(f.scope, 0, requestKey, command)]);
  assert.equal(results.filter(v => v.replayed).length, 1); assert.equal(results[0]!.record.attemptsUsed, 1);
  const human = await store.apply(f.scope, 1, key(), { kind: "require_human", reason: "authority_changed" });
  const old = await store.apply(f.scope, 0, requestKey, command); assert.equal(old.replayed, true); assert.deepEqual(old.record, human.record); assert.equal(old.joint, null);
  await assert.rejects(store.apply(f.scope, 0, requestKey, { ...command, endpoint: endpoint() }), isCode("STALE_VERSION"));
  assert.deepEqual(await counts(f), { commands: 3, audits: 3 });
});
test("actual COMMIT succeeds but lost acknowledgement recovers without another attempt/audit", async () => {
  const f = await fixture(), requestKey = key(), command = beginCommand(); let once = true;
  const fault = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
    const result = await c.query(sql, values); if (sql === "COMMIT" && once) { once = false; throw new Error("synthetic-confirmation-loss"); } return result;
  }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(new ConnectionMaintenanceStore(fault, context).apply(f.scope, 0, requestKey, command), isCode("DATABASE_UNAVAILABLE"));
  const repeated = await store.apply(f.scope, 0, requestKey, command); assert.equal(repeated.replayed, true); assert.equal(repeated.record.attemptsUsed, 1);
  assert.deepEqual(await counts(f), { commands: 2, audits: 2 });
});
test("fresh OS process reads durable accounting without parent process memory", async () => {
  const f = await fixture(), r = await begin(f);
  const child = `const {Pool}=require('pg'); const {parseConnectionMaintenanceRound}=require('./src/connection-maintenance-budget.ts'); (async()=>{const p=new Pool({connectionString:process.env.SG_PRODUCT_TEST_DATABASE_URL});try{const q=await p.query('SELECT record FROM socialgrowth_product.connection_maintenance_rounds WHERE device_id=$1',[process.env.SG_MAINT_FIXTURE]);const r=parseConnectionMaintenanceRound(q.rows[0].record);process.stdout.write(JSON.stringify({version:r.version,used:r.attemptsUsed,recovery:r.attempts[0].recoveryId}));}finally{await p.end();}})().catch(()=>process.exitCode=1);`;
  const result = await promisify(execFile)("pnpm", ["exec", "tsx", "--eval", child], { cwd: new URL("..", import.meta.url), env: { ...process.env, SG_MAINT_FIXTURE: f.scope.deviceId }, maxBuffer: 4096 });
  assert.deepEqual(JSON.parse(result.stdout), { version: r.version, used: 1, recovery: r.attempts[0]!.recoveryId });
});
test("actual task presence refuses maintenance-only begin; missing task budget never becomes no-task", async () => {
  const f = await fixture(), t = await currentTask(f);
  await assert.rejects(store.apply(f.scope, 0, key(), beginCommand()), isCode("TASK_BUDGET_REQUIRED"));
  assert.deepEqual(await store.read(f.scope), f.initial);
  await pool.query(`DELETE FROM ${s}.task_recovery_commands WHERE task_attempt_id=$1`, [t.scope.taskAttemptId]);
  await pool.query(`DELETE FROM ${s}.task_recovery_rounds WHERE task_attempt_id=$1`, [t.scope.taskAttemptId]);
  await assert.rejects(store.apply(f.scope, 0, key(), { kind: "observe_joint" }), isCode("CURRENT_CONTEXT_UNAVAILABLE"));
  assert.deepEqual(await counts(f), { commands: 1, audits: 1 });
});
test("joint observations atomically charge both ledgers; unknown publication dominates spare maintenance", async () => {
  const f = await fixture(), t = await currentTask(f);
  const unknown = (await tasks.apply(t.scope, 0, key(), { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "possible_submission" })).record;
  const requestKey = key(), observed = await store.apply(f.scope, 0, requestKey, { kind: "observe_joint" });
  assert.equal(observed.joint!.budgetsAvailable, false); assert.equal(observed.joint!.task!.phase, "verification_required");
  assert.equal((await tasks.read(t.scope)).version, unknown.version + 1); assert.equal((await store.read(f.scope)).version, 1);
  const repeated = await store.apply(f.scope, 0, requestKey, { kind: "observe_joint" }); assert.equal(repeated.replayed, true); assert.equal(repeated.joint, null);
  assert.equal((await tasks.read(t.scope)).version, unknown.version + 1);
  await pool.query(`UPDATE ${s}.maintenance_context_fixture SET task=$2 WHERE device_id=$1`, [f.scope.deviceId, { ...t.scope, deviceId: randomUUID() }]);
  await assert.rejects(store.apply(f.scope, 1, key(), { kind: "observe_joint" }), isCode("STALE_SCOPE"));
  await assert.rejects(store.read(f.scope), isCode("STALE_SCOPE"));
});
test("joint task command/audit or maintenance write failure rolls BOTH ledgers back, including silent skips", async () => {
  for (const [table, operation, predicate] of [
    ["task_recovery_rounds", "UPDATE", "true"], ["task_recovery_commands", "INSERT", "true"],
    ["audit_records", "INSERT", "NEW.action='task_recovery.observe'"], ["connection_maintenance_rounds", "UPDATE", "true"],
    ["connection_maintenance_commands", "INSERT", "true"], ["audit_records", "INSERT", "NEW.action='connection_maintenance.observe_joint'"],
  ]) {
    const f = await fixture(), t = await currentTask(f);
    await pool.query(`CREATE FUNCTION ${s}.fixture_maintenance_skip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RETURN NULL; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER maintenance_skip BEFORE ${operation} ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.fixture_maintenance_skip()`);
    try {
      await assert.rejects(store.apply(f.scope, 0, key(), { kind: "observe_joint" }), isCode("DATABASE_UNAVAILABLE"));
      assert.deepEqual(await store.read(f.scope), f.initial); assert.deepEqual(await tasks.read(t.scope), t.record); assert.deepEqual(await counts(f), { commands: 1, audits: 1 });
      assert.equal((await pool.query(`SELECT 1 FROM ${s}.task_recovery_commands WHERE task_attempt_id=$1`, [t.scope.taskAttemptId])).rowCount, 1);
    } finally { await pool.query(`DROP TRIGGER maintenance_skip ON ${s}.${table}`); await pool.query(`DROP FUNCTION ${s}.fixture_maintenance_skip()`); }
  }
});
test("real task-row lock wait is charged using DB clock AFTER both ledgers are locked", async () => {
  const f = await fixture(), t = await currentTask(f);
  const running = (await tasks.apply(t.scope, 0, key(), { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "pre_submission" })).record;
  const blocker = await pool.connect(); let pending: ReturnType<ConnectionMaintenanceStore["apply"]> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query(`SELECT 1 FROM ${s}.task_recovery_rounds WHERE task_attempt_id=$1 FOR UPDATE`, [t.scope.taskAttemptId]);
    pending = store.apply(f.scope, 0, key(), { kind: "observe_joint" });
    let waiting = false;
    for (let i = 0; i < 200; i++) {
      if ((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE application_name='sg-maintenance-fixtures' AND wait_event_type='Lock' AND query LIKE '%task_recovery_rounds%'`)).rowCount) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(waiting); await pool.query("SELECT pg_sleep(0.15)"); await blocker.query("COMMIT");
    const observed = await pending; assert.ok(observed.joint!.task!.elapsedMs >= 150); assert.equal(observed.joint!.task!.version, running.version + 1);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); }
});
test("unknown occupies slot after restart and late success cannot clear human gate or device pause", async () => {
  const f = await fixture({ maxAttempts: 3, maxElapsedMs: 10 }), running = await begin(f), unknown = await complete(f, running, "unknown");
  await pool.query(`UPDATE ${s}.devices SET state='paused' WHERE device_id=$1`, [f.scope.deviceId]);
  await pool.query("SELECT pg_sleep(0.02)");
  const observed = (await new ConnectionMaintenanceStore(pool, context).apply(f.scope, unknown.version, key(), { kind: "observe" })).record;
  assert.ok(observed.elapsedMs >= 20); assert.equal(observed.attempts[0]!.endedAt, null);
  await assert.rejects(begin(f, observed), isCode("BUSY"));
  const late = await complete(f, observed, "verified_connected"); assert.equal(late.phase, "human_required"); assert.equal(late.reason, unknown.reason);
  assert.equal((await pool.query(`SELECT state FROM ${s}.devices WHERE device_id=$1`, [f.scope.deviceId])).rows[0].state, "paused");
});
test("real audit exception rolls back safely; strict command/context validation rejects stale cached authority", async () => {
  const f = await fixture(), requestKey = key(), command = beginCommand();
  await pool.query(`CREATE FUNCTION ${s}.fixture_maintenance_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='connection_maintenance.begin' THEN RAISE EXCEPTION 'synthetic-private-detail'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER maintenance_fail BEFORE INSERT ON ${s}.audit_records FOR EACH ROW EXECUTE FUNCTION ${s}.fixture_maintenance_fail()`);
  try { await assert.rejects(store.apply(f.scope, 0, requestKey, command), isCode("DATABASE_UNAVAILABLE")); assert.deepEqual(await store.read(f.scope), f.initial); }
  finally { await pool.query(`DROP TRIGGER maintenance_fail ON ${s}.audit_records`); await pool.query(`DROP FUNCTION ${s}.fixture_maintenance_fail()`); }
  const accepted = await store.apply(f.scope, 0, requestKey, command); assert.equal(accepted.record.attemptsUsed, 1);
  for (const invalid of [{ kind: "reset" }, { kind: "observe", maxAttempts: 100 }, { kind: "begin", recoveryId: randomUUID(), endpoint: { ...endpoint(), permission: true } }]) {
    await assert.rejects(store.apply(f.scope, accepted.record.version, key(), invalid), isCode("INPUT_INVALID"));
  }
  await pool.query(`UPDATE ${s}.maintenance_context_fixture SET scope=$2 WHERE device_id=$1`, [f.scope.deviceId, { ...f.scope, ownershipVersion: "2" }]);
  await assert.rejects(store.apply(f.scope, 0, requestKey, command), isCode("STALE_SCOPE"));
  await pool.query(`DELETE FROM ${s}.maintenance_context_fixture WHERE device_id=$1`, [f.scope.deviceId]);
  await assert.rejects(store.read(f.scope), isCode("CURRENT_CONTEXT_UNAVAILABLE"));
});
test("DB scope/config/call and closed history cannot rewrite or shrink; corrupt elapsed is not repaired silently", async () => {
  const f = await fixture(), running = await begin(f), closed = await complete(f, running, "verified_connected");
  for (const record of [
    { ...closed, scope: { ...closed.scope, roundId: randomUUID() } }, { ...closed, limits: { ...closed.limits, maxAttempts: 4 } },
    { ...closed, attemptsUsed: 0, elapsedMs: 0, attempts: [] }, { ...closed, attempts: [{ ...closed.attempts[0], endpoint: endpoint() }] },
  ]) await assert.rejects(pool.query(`UPDATE ${s}.connection_maintenance_rounds SET record=$2 WHERE device_id=$1`, [f.scope.deviceId, record]), sqlCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.connection_maintenance_commands SET kind='observe' WHERE device_id=$1`, [f.scope.deviceId]), sqlCode("P0001"));
  await pool.query(`UPDATE ${s}.connection_maintenance_rounds SET record=$2 WHERE device_id=$1`, [f.scope.deviceId, { ...closed, elapsedMs: closed.elapsedMs + 1 }]);
  await assert.rejects(store.read(f.scope), isCode("CORRUPT_STATE"));
});
test("administrative missing command cannot be hidden by replay or a fresh request", async () => {
  const f = await fixture(), command = beginCommand(), requestKey = key();
  await store.apply(f.scope, 0, requestKey, command);
  await pool.query(`DELETE FROM ${s}.connection_maintenance_commands WHERE device_id=$1 AND request_key=$2`, [f.scope.deviceId, requestKey]);
  await assert.rejects(store.read(f.scope), isCode("CORRUPT_STATE"));
  await assert.rejects(store.apply(f.scope, 0, requestKey, command), isCode("CORRUPT_STATE"));
  await assert.rejects(store.apply(f.scope, 1, key(), { kind: "observe" }), isCode("CORRUPT_STATE"));
});

const jointCommand = () => ({ kind: "reserve_joint", recoveryId: randomUUID(), endpoint: endpoint() });
async function jointComplete(f: Awaited<ReturnType<typeof fixture>>, r: ConnectionMaintenanceRound, hasTask: boolean, outcome: "failed" | "unknown" | "verified_connected") {
  const a = r.attempts.at(-1)!;
  return store.apply(f.scope, r.version, key(), { kind: "complete_joint", receipt: { scope: f.scope, recoveryId: a.recoveryId, endpoint: a.endpoint, outcome,
    taskOutcome: hasTask ? outcome === "verified_connected" ? "verified_recovered" : outcome : null } });
}
async function reservationCount(f: Awaited<ReturnType<typeof fixture>>) {
  return (await pool.query(`SELECT count(*)::int n FROM ${s}.joint_recovery_reservations WHERE device_id=$1`, [f.scope.deviceId])).rows[0].n as number;
}
test("joint reservation occupies BOTH actual stored budgets atomically; completion preserves both counters", async () => {
  const f = await fixture(), t = await currentTask(f), command = jointCommand(), r = await store.apply(f.scope, 0, key(), command);
  assert.equal(r.joint, null); assert.equal(r.record.attemptsUsed, 1);
  const occupied = await tasks.read(t.scope); assert.equal(occupied.attemptsUsed, 1); assert.equal(occupied.phase, "recovering");
  assert.equal(occupied.recoveries[0]!.recoveryId, command.recoveryId); assert.equal(await reservationCount(f), 1);
  const linked = (await pool.query(`SELECT task_attempt_id,task_scope FROM ${s}.joint_recovery_reservations WHERE device_id=$1`, [f.scope.deviceId])).rows[0];
  assert.equal(linked.task_attempt_id, t.scope.taskAttemptId); assert.deepEqual(linked.task_scope, t.scope);
  const done = await jointComplete(f, r.record, true, "verified_connected"), taskDone = await tasks.read(t.scope);
  assert.equal(done.record.attemptsUsed, 1); assert.equal(taskDone.attemptsUsed, 1); assert.equal(taskDone.recoveries[0]!.outcome, "verified_recovered");
  assert.ok(done.record.elapsedMs > 0); assert.ok(taskDone.elapsedMs > 0); assert.equal(done.record.phase, "available"); assert.equal(taskDone.phase, "available");
});
test("genuinely no-task reservation has nullable linkage and never creates a fictional task budget", async () => {
  const f = await fixture(), r = await store.apply(f.scope, 0, key(), jointCommand());
  const link = (await pool.query(`SELECT task_attempt_id,task_scope FROM ${s}.joint_recovery_reservations WHERE device_id=$1`, [f.scope.deviceId])).rows[0];
  assert.deepEqual(link, { task_attempt_id: null, task_scope: null });
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.task_recovery_rounds WHERE device_id=$1`, [f.scope.deviceId])).rowCount, 0);
  const done = await jointComplete(f, r.record, false, "failed"); assert.equal(done.record.attemptsUsed, 1);
});
test("concurrent exact joint allocation and actual COMMIT lost response consume each budget once", async () => {
  const f = await fixture(), t = await currentTask(f), requestKey = key(), command = jointCommand();
  const values = await Promise.all([store.apply(f.scope, 0, requestKey, command), new ConnectionMaintenanceStore(pool, context).apply(f.scope, 0, requestKey, command)]);
  assert.equal(values.filter(v => v.replayed).length, 1); assert.equal((await tasks.read(t.scope)).attemptsUsed, 1); assert.equal(await reservationCount(f), 1);
  const g = await fixture(), gt = await currentTask(g), gkey = key(), gcommand = jointCommand(); let once = true;
  const fault = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, args?: unknown[]) => {
    const result = await c.query(sql, args); if (sql === "COMMIT" && once) { once = false; throw new Error("synthetic-lost-joint-ack"); } return result;
  }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(new ConnectionMaintenanceStore(fault, context).apply(g.scope, 0, gkey, gcommand), isCode("DATABASE_UNAVAILABLE"));
  const repeated = await store.apply(g.scope, 0, gkey, gcommand); assert.equal(repeated.replayed, true); assert.equal(repeated.joint, null);
  assert.equal(repeated.record.attemptsUsed, 1); assert.equal((await tasks.read(gt.scope)).attemptsUsed, 1); assert.equal(await reservationCount(g), 1);
});
test("either spent budget blocks allocation; endpoints/restart/verified recovery cannot reset task 2/5 limits", async () => {
  const f = await fixture(), t = await currentTask(f); let r = f.initial;
  for (let i = 0; i < 2; i++) {
    r = (await store.apply(f.scope, r.version, key(), jointCommand())).record;
    r = (await jointComplete(f, r, true, "verified_connected")).record;
  }
  assert.equal((await tasks.read(t.scope)).attemptsUsed, 2); assert.deepEqual((await tasks.read(t.scope)).limits, { maxAttempts: 2, maxElapsedMs: 300_000 });
  const blocked = await new ConnectionMaintenanceStore(pool, context).apply(f.scope, r.version, key(), jointCommand());
  assert.equal(blocked.record.attemptsUsed, 2); assert.equal(await reservationCount(f), 2); assert.equal((await tasks.read(t.scope)).phase, "human_required");
  const g = await fixture({ maxAttempts: 1, maxElapsedMs: 120_000 }), gt = await currentTask(g);
  const first = await store.apply(g.scope, 0, key(), jointCommand()), done = await jointComplete(g, first.record, true, "verified_connected");
  const maintBlocked = await store.apply(g.scope, done.record.version, key(), jointCommand());
  assert.equal(maintBlocked.record.phase, "human_required"); assert.equal(maintBlocked.record.attemptsUsed, 1); assert.equal((await tasks.read(gt.scope)).attemptsUsed, 1);
});
test("unknown publication and missing authoritative submission never reserve retries", async () => {
  for (const submission of ["possible_submission", "verified_success", null]) {
    const f = await fixture(), t = await currentTask(f);
    await pool.query(`UPDATE ${s}.maintenance_context_fixture SET submission=$2 WHERE device_id=$1`, [f.scope.deviceId, submission]);
    if (submission === null) await assert.rejects(store.apply(f.scope, 0, key(), jointCommand()), isCode("CURRENT_CONTEXT_UNAVAILABLE"));
    else {
      await store.apply(f.scope, 0, key(), jointCommand());
      assert.equal((await tasks.read(t.scope)).phase, submission === "possible_submission" ? "verification_required" : "available");
    }
    assert.equal((await store.read(f.scope)).attemptsUsed, 0); assert.equal((await tasks.read(t.scope)).attemptsUsed, 0); assert.equal(await reservationCount(f), 0);
  }
});
test("unknown joint call retains BOTH occupied slots across restart; late success leaves both human gates sticky", async () => {
  const f = await fixture(), t = await currentTask(f), started = await store.apply(f.scope, 0, key(), jointCommand());
  const unknown = await jointComplete(f, started.record, true, "unknown");
  assert.equal(unknown.record.attempts[0]!.endedAt, null); assert.equal((await tasks.read(t.scope)).recoveries[0]!.endedAt, null);
  const replay = await new ConnectionMaintenanceStore(pool, context).apply(f.scope, unknown.record.version, key(), jointCommand());
  assert.equal(replay.record.attemptsUsed, 1); assert.equal((await tasks.read(t.scope)).attemptsUsed, 1); assert.equal(await reservationCount(f), 1);
  const ended = await jointComplete(f, replay.record, true, "verified_connected");
  assert.equal(ended.record.phase, "human_required"); assert.equal((await tasks.read(t.scope)).phase, "human_required");
});
test("task linkage/endpoint/receipt outcome cannot be replaced and maintenance-only completion cannot free a joint call", async () => {
  const f = await fixture(), t = await currentTask(f), started = await store.apply(f.scope, 0, key(), jointCommand()), a = started.record.attempts[0]!;
  await assert.rejects(store.apply(f.scope, started.record.version, key(), { kind: "complete", receipt: { scope: f.scope, recoveryId: a.recoveryId, endpoint: a.endpoint, outcome: "verified_connected" } }), isCode("TASK_BUDGET_REQUIRED"));
  for (const patch of [{ taskOutcome: null }, { taskOutcome: "unknown" }, { endpoint: endpoint() }]) {
    await assert.rejects(store.apply(f.scope, started.record.version, key(), { kind: "complete_joint", receipt: { scope: f.scope, recoveryId: a.recoveryId, endpoint: a.endpoint, outcome: "verified_connected", taskOutcome: "verified_recovered", ...patch } }),
      isCode("endpoint" in patch ? "STALE_RECEIPT" : "INPUT_INVALID"));
  }
  const newer = await currentTask(f); assert.notEqual(newer.scope.taskAttemptId, t.scope.taskAttemptId);
  const ended = await jointComplete(f, started.record, true, "verified_connected");
  assert.equal(ended.record.attempts[0]!.outcome, "verified_connected"); assert.equal((await tasks.read(t.scope)).recoveries[0]!.outcome, "verified_recovered"); assert.equal((await tasks.read(newer.scope)).attemptsUsed, 0);
  await assert.rejects(pool.query(`UPDATE ${s}.joint_recovery_reservations SET task_attempt_id=$2,task_scope=$3 WHERE device_id=$1`, [f.scope.deviceId, newer.scope.taskAttemptId, newer.scope]), sqlCode("P0001"));
});
test("reservation and every affected ledger/command/audit silent write skip rolls back entire joint allocation", async () => {
  for (const [table, operation, predicate] of [
    ["joint_recovery_reservations", "INSERT", "true"], ["task_recovery_rounds", "UPDATE", "true"], ["task_recovery_commands", "INSERT", "true"],
    ["audit_records", "INSERT", "NEW.action='task_recovery.begin'"], ["connection_maintenance_rounds", "UPDATE", "true"],
    ["connection_maintenance_commands", "INSERT", "true"], ["audit_records", "INSERT", "NEW.action='connection_maintenance.reserve_joint'"],
  ]) {
    const f = await fixture(), t = await currentTask(f);
    await pool.query(`CREATE FUNCTION ${s}.fixture_joint_skip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RETURN NULL; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER joint_skip BEFORE ${operation} ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.fixture_joint_skip()`);
    try {
      await assert.rejects(store.apply(f.scope, 0, key(), jointCommand()), isCode("DATABASE_UNAVAILABLE"));
      assert.deepEqual(await store.read(f.scope), f.initial); assert.deepEqual(await tasks.read(t.scope), t.record); assert.equal(await reservationCount(f), 0); assert.deepEqual(await counts(f), { commands: 1, audits: 1 });
    } finally { await pool.query(`DROP TRIGGER joint_skip ON ${s}.${table}`); await pool.query(`DROP FUNCTION ${s}.fixture_joint_skip()`); }
  }
});
test("joint completion task write failure never frees maintenance slot or confirms an uncommitted receipt", async () => {
  const f = await fixture(), t = await currentTask(f), started = await store.apply(f.scope, 0, key(), jointCommand()), taskBefore = await tasks.read(t.scope);
  await pool.query(`CREATE FUNCTION ${s}.fixture_joint_end_skip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  await pool.query(`CREATE TRIGGER joint_end_skip BEFORE UPDATE ON ${s}.task_recovery_rounds FOR EACH ROW EXECUTE FUNCTION ${s}.fixture_joint_end_skip()`);
  try {
    await assert.rejects(jointComplete(f, started.record, true, "verified_connected"), isCode("DATABASE_UNAVAILABLE"));
    assert.deepEqual(await store.read(f.scope), started.record); assert.deepEqual(await tasks.read(t.scope), taskBefore);
  } finally { await pool.query(`DROP TRIGGER joint_end_skip ON ${s}.task_recovery_rounds`); await pool.query(`DROP FUNCTION ${s}.fixture_joint_end_skip()`); }
});
test("legacy and joint reservation deletion is detected before any read, replay or new allocation", async () => {
  for (const joint of [false, true]) {
    const f = await fixture(); if (joint) await currentTask(f);
    const command = joint ? jointCommand() : beginCommand(), requestKey = key();
    await store.apply(f.scope, 0, requestKey, command);
    await pool.query(`DELETE FROM ${s}.joint_recovery_reservations WHERE device_id=$1`, [f.scope.deviceId]);
    await assert.rejects(store.read(f.scope), isCode("CORRUPT_STATE"));
    await assert.rejects(store.apply(f.scope, 0, requestKey, command), isCode("CORRUPT_STATE"));
  }
});
