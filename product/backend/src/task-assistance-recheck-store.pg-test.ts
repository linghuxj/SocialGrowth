import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { TaskAssistanceRecheckStore, TaskAssistanceRecheckStoreError } from "./task-assistance-recheck-store.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || !/^postgres(?:ql)?:\/\/[^/]+\/sg_loop_recovery_[a-z0-9_]+(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Recheck PostgreSQL test requires an isolated sg_loop_recovery_* database and SG_PRODUCT_TEST_ALLOW_RESET=1");
}
const pool = new Pool({ connectionString: databaseUrl, max: 8, application_name: "sg-loop-recovery-owned-test" });
const store = new TaskAssistanceRecheckStore(pool);
const id = () => randomUUID();
const stale = (error: unknown) => error instanceof TaskAssistanceRecheckStoreError && error.code === "STALE_FACT";
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  await pool.query(`CREATE SCHEMA socialgrowth_product;
    CREATE TABLE socialgrowth_product.devices(device_id uuid PRIMARY KEY);
    CREATE TABLE socialgrowth_product.business_plan_tasks(task_id uuid PRIMARY KEY);
    CREATE TABLE socialgrowth_product.business_plan_task_attempts(task_attempt_id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES socialgrowth_product.business_plan_tasks(task_id), reserved_device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id));
    CREATE TABLE socialgrowth_product.device_assistance_todos(todo_id uuid PRIMARY KEY);
    CREATE TABLE socialgrowth_product.device_assistance_impacts(todo_id uuid NOT NULL REFERENCES socialgrowth_product.device_assistance_todos(todo_id), device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id), PRIMARY KEY(todo_id,device_id));
    CREATE TABLE socialgrowth_product.device_assistance_notes(note_id uuid PRIMARY KEY, todo_id uuid NOT NULL REFERENCES socialgrowth_product.device_assistance_todos(todo_id), kind text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE socialgrowth_product.audit_records(audit_record_id uuid PRIMARY KEY, actor_type text NOT NULL, action text NOT NULL, object_type text NOT NULL, object_id uuid NOT NULL, request_id text NOT NULL, facts jsonb NOT NULL);`);
  await pool.query(await readFile(new URL("../migrations/0042_task_assistance_recheck.sql", import.meta.url), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });

async function fixture(reported = false) {
  const taskAttemptId = id(), taskId = id(), todoId = id(), deviceId = id(), noteId = reported ? id() : null;
  await pool.query("INSERT INTO socialgrowth_product.devices VALUES($1)", [deviceId]);
  await pool.query("INSERT INTO socialgrowth_product.business_plan_tasks VALUES($1)", [taskId]);
  await pool.query("INSERT INTO socialgrowth_product.business_plan_task_attempts VALUES($1,$2,$3)", [taskAttemptId, taskId, deviceId]);
  await pool.query("INSERT INTO socialgrowth_product.device_assistance_todos VALUES($1)", [todoId]);
  await pool.query("INSERT INTO socialgrowth_product.device_assistance_impacts VALUES($1,$2)", [todoId, deviceId]);
  if (noteId) await pool.query("INSERT INTO socialgrowth_product.device_assistance_notes VALUES($1,$2,'reported_processed')", [noteId, todoId]);
  return { taskAttemptId, taskId, todoId, deviceId, noteId };
}

test("exact immutable task-attempt/todo/device link rejects inferred or conflicting scopes", async () => {
  const f = await fixture(true);
  assert.deepEqual(await store.readDisposition(f.taskId, f.taskAttemptId), { status: "not_linked", blockers: [] });
  await store.linkExact({ taskAttemptId: f.taskAttemptId, taskId: f.taskId, todoId: f.todoId, deviceId: f.deviceId }).catch((error: unknown) => {
    if (error instanceof TaskAssistanceRecheckStoreError) assert.fail(`link exact failed with ${error.code}:${error.databaseCode ?? "unknown"}`);
    throw error;
  });
  assert.deepEqual(await store.read(f.todoId), { status: "pending", blockers: [], checkedAt: null });
  const queued = await store.claimNext(1_000);
  assert.ok(queued);
  assert.equal(queued.todoId, f.todoId);
  await store.complete(queued, { status: "still_blocked", blockers: ["trusted_recheck_unavailable"], checkedAt: new Date().toISOString() });
  await store.linkExact({ taskAttemptId: f.taskAttemptId, taskId: f.taskId, todoId: f.todoId, deviceId: f.deviceId });
  await assert.rejects(store.linkExact({ taskAttemptId: f.taskAttemptId, taskId: f.taskId, todoId: f.todoId, deviceId: id() }), stale);
  const otherAttempt = await fixture();
  await assert.rejects(store.linkExact({ taskAttemptId: otherAttempt.taskAttemptId, taskId: otherAttempt.taskId, todoId: f.todoId, deviceId: otherAttempt.deviceId }), stale);
  assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.task_assistance_recheck_links")).rows[0]?.n, 1);
});

test("reported_processed queues one idempotent claim; concurrent consumers cannot both claim and recovery stays attempt-bound", async () => {
  const f = await fixture(); await store.linkExact({ taskAttemptId: f.taskAttemptId, taskId: f.taskId, todoId: f.todoId, deviceId: f.deviceId });
  const noteId = id();
  await pool.query("INSERT INTO socialgrowth_product.device_assistance_notes VALUES($1,$2,'reported_processed')", [noteId, f.todoId]);
  const client = await pool.connect();
  try { await client.query("BEGIN"); await TaskAssistanceRecheckStore.requestForReportedNote(client, f.todoId, noteId); await client.query("COMMIT"); }
  finally { client.release(); }
  const claims = await Promise.all([store.claimNext(1_000), store.claimNext(1_000)]);
  const claim = claims.find(Boolean)!;
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claim.taskAttemptId, f.taskAttemptId);
  assert.equal(claim.noteId, noteId);
  assert.equal(claim.reconcileOnly, false);
  assert.deepEqual(await store.read(f.todoId), { status: "pending", blockers: [], checkedAt: null });
  const overlappingNote = id();
  const secondClient = await pool.connect();
  try { await secondClient.query("BEGIN"); await TaskAssistanceRecheckStore.requestForReportedNote(secondClient, f.todoId, overlappingNote); await secondClient.query("COMMIT"); }
  finally { secondClient.release(); }
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const reclaimed = await store.claimNext(1_000);
  assert.ok(reclaimed);
  assert.equal(reclaimed.reconcileOnly, true);
  assert.equal(reclaimed.claimToken, claim.claimToken);
  assert.equal(reclaimed.idempotencyKey, claim.idempotencyKey);
  await assert.rejects(store.complete({ ...claim, taskId: id() }, { status: "verified_recovered", blockers: [], checkedAt: new Date().toISOString() }), stale);
  await store.complete(reclaimed, { status: "unknown", blockers: ["operation_still_unknown"], checkedAt: new Date().toISOString() });
  assert.equal((await store.read(f.todoId)).status, "unknown");
  assert.deepEqual(await store.readDisposition(f.taskId, f.taskAttemptId), { status: "unknown", blockers: ["operation_still_unknown"] });
  assert.deepEqual(await store.readDisposition(id(), f.taskAttemptId), { status: "unknown", blockers: ["task_attempt_scope_mismatch"] });
  const afterUnknownNote = id();
  await pool.query("INSERT INTO socialgrowth_product.device_assistance_notes VALUES($1,$2,'reported_processed')", [afterUnknownNote, f.todoId]);
  const thirdClient = await pool.connect();
  try { await thirdClient.query("BEGIN"); await TaskAssistanceRecheckStore.requestForReportedNote(thirdClient, f.todoId, afterUnknownNote); await thirdClient.query("COMMIT"); }
  finally { thirdClient.release(); }
  const preserved = (await pool.query<{ claim_token: string; last_reported_note_id: string; version: string }>(
    "SELECT claim_token,last_reported_note_id,version::text FROM socialgrowth_product.task_assistance_recheck_links WHERE task_attempt_id=$1", [f.taskAttemptId])).rows[0]!;
  assert.equal(preserved.claim_token, reclaimed.claimToken);
  assert.equal(preserved.last_reported_note_id, noteId);
  assert.equal(Number(preserved.version), reclaimed.version);
  assert.equal(await store.claimNext(1_000), null);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const reconcileAgain = await store.claimNext(1_000);
  assert.ok(reconcileAgain);
  assert.equal(reconcileAgain.reconcileOnly, true);
  assert.equal(reconcileAgain.claimToken, reclaimed.claimToken);
  assert.equal(reconcileAgain.idempotencyKey, reclaimed.idempotencyKey);
});
