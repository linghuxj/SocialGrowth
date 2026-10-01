import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { Queue } from "bullmq";
import { contractVersion, taskProtocolVersion, type TaskDispatchNotice } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { TaskRecheckJournal } from "./task-recheck-journal.js";
import { TaskRecheckQueue } from "./task-recheck-queue.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, endpoint = process.env.SG_PRODUCT_TEST_REDIS_ENDPOINT, password = process.env.SG_PRODUCT_TEST_REDIS_PASSWORD;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "32876" || new URL(url).pathname !== "/sg_task_outbox"
  || endpoint !== "redis://127.0.0.1:32910/0" || !password || process.env.SG_PRODUCT_TEST_REDIS_ISOLATED !== "1") throw new Error("Outbox supplementary checks require owned isolated PG and Redis");
const pool = new Pool({ connectionString: url, max: 5 }), s = "socialgrowth_product", auth = new OperatorAuthService(pool, "synthetic-task-outbox-pepper-00001"), journal = new TaskRecheckJournal(pool, auth);
const queueName = `sg-outbox-${randomUUID()}`, prefix = "sg-outbox-fixture", sender = new TaskRecheckQueue({ endpoint, username: "default", password, queueName, prefix, requestTimeoutMs: 2000 });
const observer = new Queue<TaskDispatchNotice>(queueName, { connection: { host: "127.0.0.1", port: 32910, username: "default", password, maxRetriesPerRequest: 1, retryStrategy: () => null }, prefix }); observer.on("error", () => {});
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
  await observer.waitUntilReady(); assert.equal(await observer.getWaitingCount(), 0);
});
after(async () => { try { await sender.close(); await observer.obliterate({ force: true }); await observer.close(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `pending-${randomUUID()}` });
async function fixture() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID(), digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic pending','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic pending','company_owned',$2)`, [projectId, operatorId]);
  const task = { protocolVersion: taskProtocolVersion, taskId: randomUUID(), taskRevision: 1, projectId, taskAttemptId: randomUUID(), deviceId: randomUUID(), identityId: randomUUID(), kind: "publish_content", platform: "facebook", form: "facebook_video",
    arrangementRevision: 1, projectVersion: 1, assignmentId: randomUUID(), assignmentVersion: 1, approvalId: randomUUID(), approvalVersion: 1, contentUnitId: randomUUID(), variantId: randomUUID(), materialRevision: 1, languageTag: "en-us",
    objects: [{ objectId: randomUUID(), sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" }], title: "Synthetic pending reference", caption: "Declaration only, not published",
    scheduledAt: "2026-10-01T00:00:00Z", window: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T00:00:01Z" }, recovery: { roundId: randomUUID(), maxAttempts: 2, maxElapsedMs: 300000 } };
  return { operatorId, sessionId, token, csrf, task, input: { metadata: metadata(), expectedCurrentRevision: 0, task } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const save = (f: Fixture, input: unknown = f.input) => journal.save(f.token, f.csrf, input);
async function counts(f: Fixture) { return (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.task_recheck_records WHERE task_id=$1) records,
  (SELECT count(*)::int FROM ${s}.task_recheck_revisions WHERE task_id=$1) revisions,(SELECT count(*)::int FROM ${s}.task_recheck_outbox WHERE task_id=$1) outbox,
  (SELECT count(*)::int FROM ${s}.task_recheck_commands WHERE task_id=$1) commands,(SELECT count(*)::int FROM ${s}.audit_records WHERE object_id=$1 AND object_type='pending_task_reference') audits`, [f.task.taskId])).rows[0]; }
const denied = (code: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === code;
const empty = { records: 0, revisions: 0, outbox: 0, commands: 0, audits: 0 };
// Only defer earlier synthetic transport metadata, never success/admission flags.
async function deferEarlier() { await pool.query(`UPDATE ${s}.task_recheck_outbox SET next_attempt_at=clock_timestamp()+interval '1 day'`); }
test("actual pending reference and notice/outbox/command/audit commit together, never admitted or physically available", async () => {
  const f = await fixture(), result = await save(f); assert.equal(result.currentRevision, 1); assert.equal(result.status, "pending_current_checks"); assert.equal(result.executionAllowed, false); assert.equal(result.publicationAllowed, false);
  assert.deepEqual(await counts(f), { records: 1, revisions: 1, outbox: 1, commands: 1, audits: 1 }); assert.equal(result.revisions[0]!.notice.executionAllowed, false);
  assert.equal((await journal.read(f.token, f.task.projectId, f.task.taskId)).revisions[0]!.contract.taskAttemptId, f.task.taskAttemptId);
});
test("actual original key normalizes UUID/request trace and returns latest history after explicit new revision", async () => {
  const f = await fixture(); await save(f); const before = await counts(f);
  assert.equal((await save(f, { ...f.input, metadata: { ...f.input.metadata, requestId: `new-trace-${randomUUID()}` }, task: { ...f.task, taskId: f.task.taskId.toUpperCase() } })).replayed, true); assert.deepEqual(await counts(f), before);
  await save(f, { metadata: metadata(), expectedCurrentRevision: 1, task: { ...f.task, taskRevision: 2, title: "Explicit correction" } });
  const old = await save(f); assert.equal(old.currentRevision, 2); assert.equal(old.revisions[1]!.contract.title, "Explicit correction"); assert.deepEqual(await counts(f), { records: 1, revisions: 2, outbox: 2, commands: 2, audits: 2 });
});
test("actual same expected revision concurrent commands have one winner; rebinding and recovery reset remain rejected", async () => {
  const f = await fixture(); await save(f); const inputs = [0, 1].map(index => ({ metadata: metadata(), expectedCurrentRevision: 1, task: { ...f.task, taskRevision: 2, title: `Correction ${index}` } }));
  const results = await Promise.allSettled(inputs.map(input => save(f, input))); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const failed = results.find(r => r.status === "rejected"); assert.ok(failed?.status === "rejected" && denied("FACT_VERSION_STALE")(failed.reason));
  const before = await counts(f); for (const patch of [{ deviceId: randomUUID() }, { taskAttemptId: randomUUID() }, { variantId: randomUUID() }, { recovery: { ...f.task.recovery, maxAttempts: 3 } }])
    await assert.rejects(save(f, { metadata: metadata(), expectedCurrentRevision: 2, task: { ...f.task, taskRevision: 3, ...patch } }), denied("FACT_VERSION_STALE")); assert.deepEqual(await counts(f), before);
  await assert.rejects(save(f, { ...f.input, task: { ...f.task, title: "Different old key" } }), denied("IDEMPOTENCY_KEY_REUSED"));
});
test("actual auth/CSRF/credential/disable/revoke failures never create pending references or outbox", async () => {
  const f = await fixture(); await assert.rejects(journal.save("x".repeat(43), f.csrf, f.input), denied("AUTHENTICATION_REQUIRED")); await assert.rejects(journal.save(f.token, "wrong", f.input), denied("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.operators SET credential_version=2 WHERE operator_id=$1`, [f.operatorId]); await assert.rejects(save(f), denied("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.operators SET credential_version=1,status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [f.operatorId]); await assert.rejects(save(f), denied("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.operators SET status='active',disabled_at=NULL WHERE operator_id=$1`, [f.operatorId]); await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]); await assert.rejects(save(f), denied("AUTHENTICATION_REQUIRED")); assert.deepEqual(await counts(f), empty);
});
test("actual suppressed insert at each of five writes rolls the entire reference/outbox/command/audit back", async () => {
  await pool.query(`CREATE FUNCTION ${s}.test_suppress_pending() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  try { for (const table of ["task_recheck_records", "task_recheck_revisions", "task_recheck_outbox", "task_recheck_commands", "audit_records"]) {
    const f = await fixture(); await pool.query(`CREATE TRIGGER test_suppress BEFORE INSERT ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.test_suppress_pending()`);
    try { await assert.rejects(save(f), denied("INTERNAL_ERROR")); assert.deepEqual(await counts(f), empty); }
    finally { await pool.query(`DROP TRIGGER test_suppress ON ${s}.${table}`); }
  } } finally { await pool.query(`DROP FUNCTION ${s}.test_suppress_pending()`); }
});
test("actual final DB clock after outbox creation denies expired session and rolls injected expiry and all writes back", async () => {
  const f = await fixture(); await pool.query(`CREATE FUNCTION ${s}.test_expire_pending() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '20 milliseconds' WHERE session_id=TG_ARGV[0]::uuid; PERFORM pg_sleep(0.04); RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER test_expire BEFORE INSERT ON ${s}.task_recheck_commands FOR EACH ROW EXECUTE FUNCTION ${s}.test_expire_pending('${f.sessionId}')`);
  try { await assert.rejects(save(f), denied("AUTHENTICATION_REQUIRED")); assert.deepEqual(await counts(f), empty); }
  finally { await pool.query(`DROP TRIGGER test_expire ON ${s}.task_recheck_commands`); await pool.query(`DROP FUNCTION ${s}.test_expire_pending()`); }
  assert.equal((await save(f)).changed, true);
});
test("actual current revision only is relayed, real Redis acknowledgement remains pending and old notice retained", async () => {
  await deferEarlier(); const f = await fixture(), first = await save(f); const second = await save(f, { metadata: metadata(), expectedCurrentRevision: 1, task: { ...f.task, taskRevision: 2 } });
  const result = await journal.relayOne(sender, 100); assert.equal(result.relayStatus, "queue_observed"); assert.equal(result.messageId, second.revisions[1]!.notice.messageId);
  assert.equal(await observer.getJob(first.revisions[0]!.notice.messageId), undefined); assert.equal((await observer.getJob(result.messageId!))!.data.executionAllowed, false);
  assert.equal((await journal.read(f.token, f.task.projectId, f.task.taskId)).status, "pending_current_checks"); assert.equal((await counts(f)).outbox, 2);
});
test("actual Redis add followed by synthetic lost ACK stays unknown and original message recovers without extra job", async () => {
  await deferEarlier(); const f = await fixture(), saved = await save(f), messageId = saved.revisions[0]!.notice.messageId;
  const unknown = await journal.relayOne({ send: async notice => { await sender.send(notice); throw new Error("synthetic-lost-ack-private"); } }, 100); assert.equal(unknown.relayStatus, "delivery_unknown"); assert.equal(unknown.messageId, messageId); assert.ok(!JSON.stringify(unknown).includes("private"));
  assert.ok(await observer.getJob(messageId)); assert.equal((await pool.query(`SELECT queue_observed_at FROM ${s}.task_recheck_outbox WHERE message_id=$1`, [messageId])).rows[0].queue_observed_at, null);
  await new Promise(resolve => setTimeout(resolve, 120)); assert.equal((await journal.relayOne(sender, 100)).messageId, messageId);
  assert.equal((await observer.getWaiting()).filter(job => job.id === messageId).length, 1); assert.deepEqual(await counts(f), { records: 1, revisions: 1, outbox: 1, commands: 1, audits: 1 });
});
test("actual transport occurs outside DB locks and cannot mutate original notice/ack scope", async () => {
  await deferEarlier(); const f = await fixture(), saved = await save(f), originalId = saved.revisions[0]!.notice.messageId;
  const result = await journal.relayOne({ send: async input => {
    const c = await pool.connect(); try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='100ms'"); await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`); await c.query(`SELECT 1 FROM ${s}.task_recheck_guard FOR UPDATE`); await c.query("COMMIT"); } finally { await c.query("ROLLBACK"); c.release(); }
    const notice = input as TaskDispatchNotice; notice.messageId = randomUUID(); return { messageId: notice.messageId, queueAcceptance: "observed", executionAllowed: false, publicationAllowed: false };
  } }, 100);
  assert.equal(result.relayStatus, "delivery_unknown"); assert.equal(result.messageId, originalId); assert.equal((await pool.query(`SELECT queue_observed_at FROM ${s}.task_recheck_outbox WHERE message_id=$1`, [originalId])).rows[0].queue_observed_at, null);
});
test("actual COMMIT then lost acknowledgement recovers exact original reference/notice after pool reconstruction", async () => {
  const f = await fixture(); let fault = true;
  const faultPool = { connect: async () => { const c = await pool.connect(); return {
    query: async (sql: string, args?: unknown[]) => { const r = await c.query(sql, args); if (sql === "COMMIT" && fault) { fault = false; throw new Error("synthetic-private-commit-ack-loss"); } return r; }, release: () => c.release()
  } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(new TaskRecheckJournal(faultPool, auth).save(f.token, f.csrf, f.input), denied("INTERNAL_ERROR"));
  const before = await counts(f); assert.deepEqual(before, { records: 1, revisions: 1, outbox: 1, commands: 1, audits: 1 });
  const messageId = (await pool.query(`SELECT message_id FROM ${s}.task_recheck_outbox WHERE task_id=$1`, [f.task.taskId])).rows[0].message_id;
  const reopened = new Pool({ connectionString: url, max: 2 });
  try { const service = new TaskRecheckJournal(reopened, new OperatorAuthService(reopened, "synthetic-task-outbox-pepper-00001"));
    const r = await service.save(f.token, f.csrf, f.input); assert.equal(r.replayed, true); assert.equal(r.revisions[0]!.notice.messageId, messageId); assert.equal(r.executionAllowed, false);
    assert.equal((await service.read(f.token, f.task.projectId, f.task.taskId)).currentRevision, 1); assert.deepEqual(await counts(f), before);
  } finally { await reopened.end(); }
});
test("actual expired transport claim and late old acknowledgement cannot overwrite newer nonce", async () => {
  await deferEarlier(); const f = await fixture(), saved = await save(f), messageId = saved.revisions[0]!.notice.messageId;
  let entered!: () => void, release!: () => void; const entering = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const first = journal.relayOne({ send: async notice => { const ack = await sender.send(notice); entered(); await held; return ack; } }, 100);
  try { await entering; const oldToken = (await pool.query(`SELECT delivery_token FROM ${s}.task_recheck_outbox WHERE message_id=$1`, [messageId])).rows[0].delivery_token;
    await new Promise(resolve => setTimeout(resolve, 120)); const second = await journal.relayOne(sender, 100); assert.equal(second.relayStatus, "queue_observed");
    const row = (await pool.query(`SELECT delivery_token,queue_observed_at,attempts::text FROM ${s}.task_recheck_outbox WHERE message_id=$1`, [messageId])).rows[0];
    assert.notEqual(row.delivery_token, oldToken); assert.equal(row.attempts, "2"); assert.ok(row.queue_observed_at);
    release(); assert.equal((await first).relayStatus, "reconciliation_required");
    assert.deepEqual((await pool.query(`SELECT delivery_token,queue_observed_at,attempts::text FROM ${s}.task_recheck_outbox WHERE message_id=$1`, [messageId])).rows[0], row);
    assert.equal((await observer.getWaiting()).filter(job => job.id === messageId).length, 1); assert.equal((await counts(f)).outbox, 1);
  } finally { release(); await first; }
});
test("actual cross-project locators fail while same-role operators remain allowed; final read clock does not return stale authority", async () => {
  const f = await fixture(), other = await fixture(); await save(f);
  await assert.rejects(journal.read(f.token, other.task.projectId, f.task.taskId), denied("FACT_VERSION_STALE"));
  assert.equal((await journal.read(other.token, f.task.projectId, f.task.taskId)).taskId, f.task.taskId); // Current same-role policy, not member isolation.
  // Fault seam uses real SQL in the same transaction, after the actual history SELECT; no auth result mock.
  let inject = true;
  const faultPool = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, args?: unknown[]) => {
    const result = await c.query(sql, args); if (inject && sql.includes("ORDER BY r.revision LIMIT 1001")) { inject = false;
      await c.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '20 milliseconds' WHERE session_id=$1`, [f.sessionId]); await c.query("SELECT pg_sleep(0.04)"); }
    return result;
  }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(new TaskRecheckJournal(faultPool, auth).read(f.token, f.task.projectId, f.task.taskId), denied("AUTHENTICATION_REQUIRED"));
  assert.equal((await journal.read(f.token, f.task.projectId, f.task.taskId)).currentRevision, 1); assert.deepEqual(await counts(f), { records: 1, revisions: 1, outbox: 1, commands: 1, audits: 1 });
});
test("actual earlier contract corruption rejects current read/replay/relay instead of hiding it behind newest revision", async () => {
  await deferEarlier(); const f = await fixture(); await save(f); await save(f, { metadata: metadata(), expectedCurrentRevision: 1, task: { ...f.task, taskRevision: 2 } });
  await pool.query(`ALTER TABLE ${s}.task_recheck_revisions DISABLE TRIGGER task_recheck_revision_immutable`);
  try { await pool.query(`UPDATE ${s}.task_recheck_revisions SET contract=jsonb_set(contract,'{recovery,maxAttempts}','3') WHERE task_id=$1 AND revision=1`, [f.task.taskId]); }
  finally { await pool.query(`ALTER TABLE ${s}.task_recheck_revisions ENABLE TRIGGER task_recheck_revision_immutable`); }
  for (const operation of [() => journal.read(f.token, f.task.projectId, f.task.taskId), () => save(f), () => journal.relayOne(sender)]) await assert.rejects(operation(), e => e instanceof Error && e.message === "CORRUPT_HISTORY");
});
