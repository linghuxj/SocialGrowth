import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { RecoveryBudgetError, type TaskRecoveryLimits, type TaskRecoveryRound } from "./task-recovery-budget.js";
import { RecoveryStoreError, TaskRecoveryStore } from "./task-recovery-store.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Recovery PostgreSQL checks need an isolated URL and explicit reset");
const pool = new Pool({ connectionString: databaseUrl, max: 8, application_name: "sg-task-recovery-fixtures" });
const store = new TaskRecoveryStore(pool), key = () => `recovery_${randomUUID().replaceAll("-", "")}`;
const stale = (error: unknown) => error instanceof RecoveryStoreError && error.code === "STALE_FACT";
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const file of ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql", "0005_network_admission.sql", "0006_phone_control_journal.sql", "0007_task_recovery_budget.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
});
after(async () => {
  try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); }
});
// No real task/device/permission created: these are isolated transaction fixtures.
async function fixture(limits?: TaskRecoveryLimits) {
  const scope = { taskId: randomUUID(), taskAttemptId: randomUUID(), deviceId: randomUUID(), roundId: randomUUID() };
  await pool.query("INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Recovery fixture','unassociated')", [scope.deviceId]);
  const initialKey = key(), result = await store.initialize(scope, initialKey, limits);
  return { scope, initialKey, record: result.record };
}
async function start(f: Awaited<ReturnType<typeof fixture>>, record = f.record, fault: "network" | "page_load" = "network") {
  return (await store.apply(f.scope, record.version, key(), { kind: "begin", recoveryId: randomUUID(), fault, submission: "pre_submission" })).record;
}
async function end(f: Awaited<ReturnType<typeof fixture>>, record: TaskRecoveryRound, outcome = "failed") {
  return (await store.apply(f.scope, record.version, key(), { kind: "complete", receipt: {
    scope: f.scope, recoveryId: record.recoveries.at(-1)!.recoveryId, outcome,
  } })).record;
}
async function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await pool.query<{ commands: string; audits: string }>(
    `SELECT (SELECT count(*)::text FROM socialgrowth_product.task_recovery_commands WHERE task_attempt_id=$1) commands,
      (SELECT count(*)::text FROM socialgrowth_product.audit_records WHERE object_type='task_recovery' AND object_id=$1) audits`, [f.scope.taskAttemptId],
  );
  return result.rows[0]!;
}

test("one attempt retains pinned limits and cannot initialize another round or reset after restart", async () => {
  const f = await fixture();
  const started = await start(f);
  const replay = await new TaskRecoveryStore(pool).initialize(f.scope, f.initialKey);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, started);
  await assert.rejects(store.initialize(f.scope, key()), stale);
  await assert.rejects(store.initialize({ ...f.scope, roundId: randomUUID() }, key()), stale);
  await assert.rejects(store.initialize(f.scope, f.initialKey, { maxAttempts: 3, maxElapsedMs: 300_000 }), stale);
  assert.deepEqual(await counts(f), { commands: "2", audits: "2" });
});
test("two starts compete for a single recovery slot; replay is current state, not a second retry", async () => {
  const f = await fixture(), requestKey = key(), command = { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "pre_submission" };
  const results = await Promise.all([
    store.apply(f.scope, 0, requestKey, command), new TaskRecoveryStore(pool).apply(f.scope, 0, requestKey, command),
  ]);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.equal(results[0].record.attemptsUsed, 1);
  const human = await store.apply(f.scope, 1, key(), { kind: "require_human", fault: "identity_mismatch" });
  const repeated = await store.apply(f.scope, 0, requestKey, command);
  assert.equal(repeated.replayed, true);
  assert.deepEqual(repeated.record, human.record);
  await assert.rejects(store.apply(f.scope, 0, requestKey, { ...command, fault: "page_load" }), stale);
});
test("fault-kind changes and service restart accumulate exactly two attempts, third cannot run", async () => {
  const f = await fixture();
  const first = await end(f, await start(f));
  const restart = new TaskRecoveryStore(pool);
  const second = (await restart.apply(f.scope, first.version, key(), { kind: "begin", recoveryId: randomUUID(), fault: "page_load", submission: "pre_submission" })).record;
  const finished = await end(f, second);
  assert.equal(finished.attemptsUsed, 2);
  assert.equal(finished.phase, "human_required");
  assert.equal(finished.reason, "attempt_limit");
  await assert.rejects(restart.apply(f.scope, finished.version, key(), { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "pre_submission" }),
    (error: unknown) => error instanceof RecoveryBudgetError && error.code === "AUTOMATIC_RECOVERY_BLOCKED");
  assert.equal((await restart.read(f.scope)).attemptsUsed, 2);
});
test("abandoned recovery wall time survives restart; budget expiry does not imply an ended phone call", async () => {
  const f = await fixture(), started = await start(f);
  // Non-UI clock-aging fixture only, not a physical stop or task result.
  const old = new Date(Date.parse(started.createdAt) - 310_000).toISOString();
  const aged: TaskRecoveryRound = { ...started, createdAt: old, observedAt: old,
    recoveries: started.recoveries.map(item => ({ ...item, startedAt: old, accountedAt: old })) };
  await pool.query("UPDATE socialgrowth_product.task_recovery_rounds SET record=$2 WHERE task_attempt_id=$1", [f.scope.taskAttemptId, aged]);
  const observed = (await new TaskRecoveryStore(pool).apply(f.scope, started.version, key(), { kind: "observe" })).record;
  assert.ok(observed.elapsedMs >= 310_000);
  assert.equal(observed.phase, "human_required");
  assert.equal(observed.reason, "time_limit");
  assert.equal(observed.recoveries[0]?.endedAt, null);
  const late = await end(f, observed, "verified_recovered");
  assert.equal(late.phase, "human_required");
  assert.equal(late.reason, "time_limit");
});
test("unknown publication is verified only; R-075 time limit does not convert it into publish retry", async () => {
  const f = await fixture({ maxAttempts: 2, maxElapsedMs: 1 });
  const verify = (await store.apply(f.scope, 0, key(), { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "possible_submission" })).record;
  assert.equal(verify.phase, "verification_required");
  assert.equal(verify.attemptsUsed, 0);
  const observed = (await store.apply(f.scope, verify.version, key(), { kind: "observe" })).record;
  assert.equal(observed.phase, "verification_required");
  assert.equal(observed.elapsedMs, 0);
  await assert.rejects(store.apply(f.scope, observed.version, key(), { kind: "begin", recoveryId: randomUUID(), fault: "page_load", submission: "pre_submission" }), RecoveryBudgetError);
});
test("unknown completion retains active occupancy and late recovery cannot clear human gate", async () => {
  const f = await fixture(), started = await start(f);
  const unknown = await end(f, started, "unknown");
  assert.equal(unknown.phase, "human_required");
  assert.equal(unknown.recoveries[0]?.endedAt, null);
  await assert.rejects(store.apply(f.scope, unknown.version, key(), { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "pre_submission" }),
    (error: unknown) => error instanceof RecoveryBudgetError && error.code === "BUSY");
  const late = await end(f, unknown, "verified_recovered");
  assert.equal(late.phase, "human_required");
  assert.equal(late.reason, "call_unknown");
  assert.ok(late.recoveries[0]?.endedAt);
});
test("task, attempt, device and round are pinned on read, new commands and receipt history", async () => {
  const f = await fixture(), started = await start(f);
  for (const field of ["taskId", "taskAttemptId", "deviceId", "roundId"] as const) {
    const wrong = { ...f.scope, [field]: randomUUID() };
    await assert.rejects(store.read(wrong), stale);
    await assert.rejects(store.apply(f.scope, started.version, key(), { kind: "complete", receipt: {
      scope: wrong, recoveryId: started.recoveries[0]!.recoveryId, outcome: "failed",
    } }), (error: unknown) => error instanceof RecoveryBudgetError && error.code === "STALE_SCOPE");
  }
  assert.equal((await store.read(f.scope)).recoveries[0]?.outcome, "running");
});
test("audit insertion fault rolls back counters and command; same request can safely retry", async () => {
  const f = await fixture(), requestKey = key(), command = { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "pre_submission" };
  await pool.query(`CREATE FUNCTION socialgrowth_product.fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='task_recovery.begin' THEN RAISE EXCEPTION 'fixture-secret-recovery-url'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER recovery_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.fail_recovery_audit()");
  try {
    await assert.rejects(store.apply(f.scope, 0, requestKey, command), (error: unknown) => {
      assert.ok(error instanceof RecoveryStoreError && error.code === "DATABASE_UNAVAILABLE");
      assert.ok(!error.message.includes("fixture-secret"));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(await store.read(f.scope), f.record);
    assert.deepEqual(await counts(f), { commands: "1", audits: "1" });
  } finally {
    await pool.query("DROP TRIGGER recovery_fault ON socialgrowth_product.audit_records");
    await pool.query("DROP FUNCTION socialgrowth_product.fail_recovery_audit()");
  }
  assert.equal((await store.apply(f.scope, 0, requestKey, command)).record.attemptsUsed, 1);
});
test("SQL rejects an unbound snapshot and application rejects a corrupt budget without resetting it", async () => {
  const f = await fixture(), started = await start(f);
  await assert.rejects(pool.query("UPDATE socialgrowth_product.task_recovery_rounds SET record='{}'::jsonb WHERE task_attempt_id=$1", [f.scope.taskAttemptId]));
  const corrupt = { ...started, elapsedMs: 999 };
  await pool.query("UPDATE socialgrowth_product.task_recovery_rounds SET record=$2 WHERE task_attempt_id=$1", [f.scope.taskAttemptId, corrupt]);
  await assert.rejects(store.apply(f.scope, started.version, key(), { kind: "observe" }), RecoveryBudgetError);
  const saved = await pool.query<{ record: unknown }>("SELECT record FROM socialgrowth_product.task_recovery_rounds WHERE task_attempt_id=$1", [f.scope.taskAttemptId]);
  assert.deepEqual(saved.rows[0]?.record, corrupt);
});
test("default limits cannot be expanded by extra fields, malformed parameters or a command", async () => {
  const f = await fixture();
  for (const command of [{ kind: "observe", maxAttempts: 100 }, { kind: "reset" }, { kind: "complete", receipt: "secret-marker" },
    { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "none" }]) {
    await assert.rejects(store.apply(f.scope, 0, key(), command), (error: unknown) => error instanceof RecoveryStoreError && error.code === "INVALID_BOUNDARY");
  }
  await assert.rejects(store.apply(f.scope, 0.5, key(), { kind: "observe" }), RecoveryStoreError);
  assert.deepEqual(await counts(f), { commands: "1", audits: "1" });
});
test("lock-time database clock charges waiting time and can escalate while a recovery is pending", async () => {
  const f = await fixture({ maxAttempts: 2, maxElapsedMs: 100 }), started = await start(f), blocker = await pool.connect();
  let pending: ReturnType<TaskRecoveryStore["apply"]> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT device_id FROM socialgrowth_product.devices WHERE device_id=$1 FOR UPDATE", [f.scope.deviceId]);
    pending = store.apply(f.scope, started.version, key(), { kind: "observe" });
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-task-recovery-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()");
      if (result.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting);
    await new Promise(resolve => setTimeout(resolve, 150));
    await blocker.query("COMMIT");
    const result = await pending;
    assert.ok(result.record.elapsedMs >= 150);
    assert.equal(result.record.phase, "human_required");
    assert.equal(result.record.recoveries[0]?.endedAt, null);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending?.catch(() => undefined);
  }
});
test("two real OS processes start only one counted recovery and one audit", async () => {
  const f = await fixture();
  const script = `import {Pool} from 'pg'; import {TaskRecoveryStore,RecoveryStoreError} from './src/task-recovery-store.ts';
    import {RecoveryBudgetError} from './src/task-recovery-budget.ts'; const pool=new Pool({connectionString:process.env.SG_PRODUCT_TEST_DATABASE_URL});
    try {const f=JSON.parse(process.env.SG_RECOVERY_FIXTURE);const r=await new TaskRecoveryStore(pool).apply(f.scope,0,f.key,f.command);
      process.stdout.write(JSON.stringify({attemptsUsed:r.record.attemptsUsed}));}
    catch(e){process.stdout.write(JSON.stringify({code:e instanceof RecoveryStoreError||e instanceof RecoveryBudgetError?e.code:'UNEXPECTED'}));}
    finally{await pool.end();}`;
  const run = promisify(execFile);
  const results = await Promise.all([0, 1].map(() => run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 20_000, env: { ...process.env, SG_RECOVERY_FIXTURE: JSON.stringify({ scope: f.scope, key: key(),
      command: { kind: "begin", recoveryId: randomUUID(), fault: "network", submission: "pre_submission" } }) },
  })));
  const outcomes = results.map(r => JSON.parse(r.stdout) as { attemptsUsed?: number; code?: string });
  assert.equal(outcomes.filter(r => r.attemptsUsed === 1).length, 1);
  assert.equal(outcomes.filter(r => r.code === "STALE_FACT").length, 1);
  assert.deepEqual(await counts(f), { commands: "2", audits: "2" });
});
