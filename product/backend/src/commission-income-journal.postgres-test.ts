import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { CommissionIncomeJournal, CommissionJournalError, type CommissionIncomeProducer } from "./commission-income-journal.js";
import { type CommissionContext, type CommissionIncome } from "./commission-core.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Commission SQL tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-commission-fixtures" });
const s = "socialgrowth_product", auth = new OperatorAuthService(pool, "synthetic-commission-test-pepper-only-00001");
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `commission-${randomUUID()}` });
const code = (code: string) => (e: unknown) => (e instanceof CommissionJournalError || e instanceof ProductTransactionError) && e.code === code && !e.cause;
const sqlCode = (code: string) => (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === code;
const producer: CommissionIncomeProducer = { read: async (c, incomeId) => (await c.query<{ value: unknown }>(`SELECT value FROM ${s}.commission_producer_fixture WHERE income_id=$1 FOR UPDATE`, [incomeId])).rows[0]?.value };
const journal = new CommissionIncomeJournal(pool, auth, producer);
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic commission','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
async function registry() {
  const identityId = randomUUID(), accountId = randomUUID();
  await pool.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, `fixture-${accountId}`]);
  await pool.query(`INSERT INTO ${s}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`, [identityId, accountId, `fixture-${identityId}`]);
  return { identityId, accountId };
}
async function fixture() {
  const a = await actor(), { identityId } = await registry(), incomeId = randomUUID();
  const income: CommissionIncome = { incomeId, sourceId: randomUUID(), sourceRecordId: randomUUID(), evidenceId: randomUUID(), revision: 1,
    identityId, platform: "facebook", kind: "advertising", currency: "USD", produced: { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-02T00:00:00Z" },
    amountMinorUnits: "105", minorUnitScale: 2, state: "received", receiptId: randomUUID(), receivedAt: "2026-09-25T00:00:00Z", attribution: "confirmed" };
  const context: CommissionContext = { identityId, platform: "facebook", ownership: [{ periodId: randomUUID(), version: 1, evidenceId: randomUUID(),
    kind: "provider", providerId: randomUUID(), deviceId: randomUUID(), startsAt: "2026-08-01T00:00:00Z", endsAt: null }],
    rates: [{ rateId: randomUUID(), version: 1, evidenceId: randomUUID(), fraction: "0.1", startsAt: "2026-08-01T00:00:00Z", endsAt: null }],
    moneyPolicy: { policyId: randomUUID(), version: 1, currency: "USD", minorUnitScale: 2, rounding: "half_even" } };
  const input: { metadata: ReturnType<typeof meta>; incomeId: string; expectedCurrentRevision: number } = { metadata: meta(), incomeId, expectedCurrentRevision: 0 };
  const f = { a, income, context, input }; await produce(f); return f;
}
async function produce(f: { income: CommissionIncome; context: CommissionContext }) {
  // Synthetic ordinary non-UI fixture only; NOT actual receipt/ownership facts.
  await pool.query(`INSERT INTO ${s}.commission_producer_fixture(income_id,value) VALUES($1,$2) ON CONFLICT(income_id) DO UPDATE SET value=excluded.value`, [f.income.incomeId, { income: f.income, context: f.context }]);
}
const apply = (f: Awaited<ReturnType<typeof fixture>>, input = f.input, service = journal) => service.reconcile(f.a.token, f.a.csrf, input);
async function counts(incomeId: string) { return (await pool.query(`SELECT
  (SELECT count(*)::int FROM ${s}.commission_income_sources WHERE income_id=$1) sources,
  (SELECT count(*)::int FROM ${s}.commission_income_revisions WHERE income_id=$1) revisions,
  (SELECT count(*)::int FROM ${s}.commission_income_commands WHERE income_id=$1) commands,
  (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='commission_income' AND object_id=$1) audits`, [incomeId])).rows[0]; }
const zero = { sources: 0, revisions: 0, commands: 0, audits: 0 };
let baselineIdentity: string;
before(async () => {
  const dir = new URL("../migrations/", import.meta.url), files = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort();
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  for (const file of files) await pool.query(await readFile(new URL(file, dir), "utf8"));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.commission_income_sources`)).rowCount, 0);
  await pool.query(`DROP SCHEMA ${s} CASCADE`);
  for (const file of files.filter(v => v < "0018_")) await pool.query(await readFile(new URL(file, dir), "utf8"));
  baselineIdentity = (await registry()).identityId; await actor();
  await pool.query(await readFile(new URL("0018_commission_income_journal.sql", dir), "utf8"));
  await pool.query(`CREATE TABLE ${s}.commission_producer_fixture(income_id uuid PRIMARY KEY,value jsonb NOT NULL)`);
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
test("0018 retains prior identity and metadata, creates no income automatically", async () => {
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.publishing_identities WHERE identity_id=$1`, [baselineIdentity])).rowCount, 1);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.commission_income_sources`)).rowCount, 0);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.commission_journal_guard`)).rowCount, 1);
});
test("authenticated reconciliation atomically records frozen basis, source, command and minimal audit", async () => {
  const f = await fixture(), r = await apply(f); assert.equal(r.changed, true); assert.equal(r.currentRevision, 1); assert.equal(r.replayed, false);
  assert.equal(r.current.calculation.commissionMinorUnits, "10"); assert.equal(r.current.calculation.paymentAllowed, false);
  assert.equal(r.current.recordedByOperatorId, f.a.operatorId); assert.match(r.current.calculation.evaluatedAt, /\.\d{6}Z$/);
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
  assert.deepEqual((await journal.read(f.a.token, f.income.incomeId)).revisions[0], r.current);
  const audit = (await pool.query(`SELECT facts FROM ${s}.audit_records WHERE object_type='commission_income' AND object_id=$1`, [f.income.incomeId])).rows[0]!.facts;
  assert.deepEqual(audit, { revision: 1, status: "provider_calculation" }); assert.equal(JSON.stringify(audit).includes(f.income.amountMinorUnits!), false);
});
test("same command normalizes UUIDs and ignores requestId; replay never calls producer or duplicates", async () => {
  const f = await fixture(), first = await apply(f); let calls = 0;
  const replay = await apply(f, { ...f.input, incomeId: f.income.incomeId.toUpperCase(), metadata: { ...f.input.metadata, requestId: `request-${randomUUID()}` } },
    new CommissionIncomeJournal(pool, auth, { read: async () => { calls++; throw new Error("should-not-read-on-replay"); } }));
  assert.deepEqual(replay.current, first.current); assert.equal(replay.replayed, true); assert.equal(replay.changed, false); assert.equal(calls, 0);
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
});
test("new actor/key reimport of unchanged income retains frozen original policy, not latest context", async () => {
  const f = await fixture(), first = await apply(f), b = await actor(); f.context.rates[0]!.fraction = "1"; await produce(f);
  const r = await journal.reconcile(b.token, b.csrf, { ...f.input, metadata: meta() });
  assert.equal(r.changed, false); assert.equal(r.replayed, false); assert.deepEqual(r.current, first.current);
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 2, audits: 1 });
});
test("same key with other revision or income cannot overwrite the command", async () => {
  const f = await fixture(); await apply(f);
  await assert.rejects(apply(f, { ...f.input, expectedCurrentRevision: 1 }), code("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(apply(f, { ...f.input, incomeId: randomUUID() }), code("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
});
test("stable source record cannot create a second income even across account or actor", async () => {
  const f = await fixture(); await apply(f); const b = await fixture();
  b.income.sourceId = f.income.sourceId; b.income.sourceRecordId = f.income.sourceRecordId; await produce(b);
  await assert.rejects(apply(b), code("SOURCE_CONFLICT")); assert.deepEqual(await counts(b.income.incomeId), zero);
});
test("continuous explicit income correction preserves original basis; old command returns CURRENT", async () => {
  const f = await fixture(), first = await apply(f); f.income.revision = 2; f.income.amountMinorUnits = "115"; f.income.evidenceId = randomUUID();
  f.context.rates[0]!.version = 2; await produce(f);
  const correction = { ...f.input, metadata: meta(), expectedCurrentRevision: 1 }, second = await apply(f, correction);
  assert.equal(second.changed, true); assert.equal(second.current.calculation.commissionMinorUnits, "12");
  assert.equal(second.current.calculation.rateRef?.version, 2);
  const history = await journal.read(f.a.token, f.income.incomeId); assert.equal(history.currentRevision, 2); assert.deepEqual(history.revisions[0], first.current);
  assert.deepEqual((await apply(f)).current, second.current); assert.equal((await apply(f)).changed, false);
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 2, commands: 2, audits: 2 });
});
test("stale base, skipped correction and changed payload without revision advancement reject", async () => {
  const f = await fixture(); await apply(f); f.income.amountMinorUnits = "999"; await produce(f);
  await assert.rejects(apply(f, { ...f.input, metadata: meta() }), code("REVISION_STALE"));
  f.income.revision = 2; await produce(f); await assert.rejects(apply(f, { ...f.input, metadata: meta() }), code("REVISION_STALE"));
  f.income.revision = 3; await produce(f); await assert.rejects(apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 }), code("REVISION_STALE"));
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
});
test("income source and account scope cannot be rebound by a correction", async () => {
  const f = await fixture(); await apply(f); const original = structuredClone(f.income);
  for (const field of ["sourceId", "sourceRecordId", "identityId"] as const) {
    f.income = { ...original, revision: 2, [field]: randomUUID() }; await produce(f);
    await assert.rejects(apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 }), code("SOURCE_CONFLICT"));
  }
  assert.deepEqual(await counts(original.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
});
test("unknown/estimated income is recorded pending and later explicit receipt revision does not invent paid amount", async () => {
  const f = await fixture(), received = structuredClone(f.income); f.income.state = "estimated"; f.income.receiptId = null; f.income.receivedAt = null; f.income.amountMinorUnits = null; await produce(f);
  const r = await apply(f); assert.equal(r.current.calculation.status, "pending_reconciliation"); assert.equal(r.current.calculation.commissionMinorUnits, null);
  f.income = { ...received, revision: 2 }; await produce(f); const actual = await apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 });
  assert.equal(actual.current.calculation.commissionMinorUnits, "10"); assert.equal(actual.current.calculation.paidAmountMinorUnits, null);
  assert.equal((await journal.read(f.a.token, f.income.incomeId)).revisions[0]!.income.amountMinorUnits, null);
});
test("strict body claims, malformed producer, wrong income locator and absent registry fail without writes", async () => {
  const f = await fixture(); await assert.rejects(apply(f, { ...f.input, income: f.income } as typeof f.input), code("INPUT_INVALID"));
  for (const produced of [null, { income: f.income, context: f.context, received: true }, { income: { ...f.income, incomeId: randomUUID() }, context: f.context }]) {
    const j = new CommissionIncomeJournal(pool, auth, { read: async () => produced });
    await assert.rejects(apply(f, f.input, j), code(produced && !('received' in produced) ? "SOURCE_CONFLICT" : "PRODUCER_UNAVAILABLE"));
  }
  const other = randomUUID(); f.income.identityId = other; f.context.identityId = other; await produce(f);
  await assert.rejects(apply(f), code("SOURCE_CONFLICT")); assert.deepEqual(await counts(f.income.incomeId), zero);
});
test("genuine concurrent same key converges once, and concurrent same correction only advances once", async () => {
  const f = await fixture(), initial = await Promise.all([apply(f), apply(f)]);
  assert.equal(initial.filter(v => v.changed).length, 1); assert.equal(initial.filter(v => v.replayed).length, 1);
  f.income.revision = 2; f.income.amountMinorUnits = "200"; await produce(f);
  const b = await actor(), request = { ...f.input, metadata: meta(), expectedCurrentRevision: 1 };
  const changes = await Promise.all([apply(f, request), journal.reconcile(b.token, b.csrf, { ...request, metadata: meta() })]);
  assert.equal(changes.filter(v => v.changed).length, 1); assert.equal(changes.every(v => v.currentRevision === 2), true);
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 2, commands: 3, audits: 2 });
});
test("actual committed writes with lost acknowledgement recover from new instance without repeating money", async () => {
  const f = await fixture(); let once = true;
  const faultPool = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
    const r = await c.query(sql, values); if (sql === "COMMIT" && once) { once = false; throw new Error("synthetic-lost-ack"); } return r;
  }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(apply(f, f.input, new CommissionIncomeJournal(faultPool, auth, producer)), code("DATABASE_UNAVAILABLE"));
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
  const restarted = new CommissionIncomeJournal(pool, auth, producer), replay = await apply(f, f.input, restarted);
  assert.equal(replay.replayed, true); assert.equal(replay.currentRevision, 1); assert.equal(replay.current.calculation.commissionMinorUnits, "10");
  const reader = new CommissionIncomeJournal(pool, auth); assert.equal((await reader.read(f.a.token, f.income.incomeId)).currentRevision, 1);
  await assert.rejects(reader.reconcile(f.a.token, f.a.csrf, f.input), code("PRODUCER_UNAVAILABLE"));
});
test("actual RETURN NULL suppression for each insert rolls back every part", async () => {
  await pool.query(`CREATE FUNCTION ${s}.commission_null_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  for (const table of ["commission_income_sources", "commission_income_revisions", "commission_income_commands", "audit_records"]) {
    const f = await fixture(); await pool.query(`CREATE TRIGGER a_commission_null_fixture BEFORE INSERT ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.commission_null_fixture()`);
    try { await assert.rejects(apply(f), code("DATABASE_UNAVAILABLE")); assert.deepEqual(await counts(f.income.incomeId), zero); }
    finally { await pool.query(`DROP TRIGGER a_commission_null_fixture ON ${s}.${table}`); }
  }
});
test("suppressed source revision UPDATE preserves old revision, command and audit", async () => {
  const f = await fixture(); await apply(f); f.income.revision = 2; f.income.amountMinorUnits = "200"; await produce(f);
  await pool.query(`CREATE TRIGGER a_commission_null_fixture BEFORE UPDATE ON ${s}.commission_income_sources FOR EACH ROW EXECUTE FUNCTION ${s}.commission_null_fixture()`);
  try { await assert.rejects(apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 }), code("DATABASE_UNAVAILABLE"));
    assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 }); }
  finally { await pool.query(`DROP TRIGGER a_commission_null_fixture ON ${s}.commission_income_sources`); }
});
test("SQL prevents historical edits/deletes, scope rebind and revision skips", async () => {
  const f = await fixture(); await apply(f);
  await assert.rejects(pool.query(`UPDATE ${s}.commission_income_revisions SET income=income WHERE income_id=$1`, [f.income.incomeId]), sqlCode("P0001"));
  await assert.rejects(pool.query(`DELETE FROM ${s}.commission_income_revisions WHERE income_id=$1`, [f.income.incomeId]), sqlCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.commission_income_sources SET source_id=$2,current_revision=2 WHERE income_id=$1`, [f.income.incomeId, randomUUID()]), sqlCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.commission_income_sources SET current_revision=3 WHERE income_id=$1`, [f.income.incomeId]), sqlCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.commission_income_sources SET current_revision=2 WHERE income_id=$1`, [f.income.incomeId]), sqlCode("23503"));
});
test("tampered stored calculation is detected on read/replay before new producer call", async () => {
  const f = await fixture(); await apply(f);
  await pool.query(`ALTER TABLE ${s}.commission_income_revisions DISABLE TRIGGER commission_revision_immutable`);
  try { await pool.query(`UPDATE ${s}.commission_income_revisions SET calculation=jsonb_set(calculation,'{commissionMinorUnits}','"777"'::jsonb) WHERE income_id=$1`, [f.income.incomeId]); }
  finally { await pool.query(`ALTER TABLE ${s}.commission_income_revisions ENABLE TRIGGER commission_revision_immutable`); }
  await assert.rejects(journal.read(f.a.token, f.income.incomeId), code("CORRUPT_HISTORY"));
  let called = false; const j = new CommissionIncomeJournal(pool, auth, { read: async () => { called = true; return null; } });
  await assert.rejects(apply(f, f.input, j), code("CORRUPT_HISTORY")); assert.equal(called, false);
  assert.deepEqual(await counts(f.income.incomeId), { sources: 1, revisions: 1, commands: 1, audits: 1 });
});
test("missing earlier history is rejected even when current source revision still exists", async () => {
  const f = await fixture(); await apply(f); f.income.revision = 2; f.income.amountMinorUnits = "200"; await produce(f);
  await apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 });
  await pool.query(`ALTER TABLE ${s}.commission_income_revisions DISABLE TRIGGER commission_revision_immutable`);
  try { await pool.query(`DELETE FROM ${s}.commission_income_revisions WHERE income_id=$1 AND revision=1`, [f.income.incomeId]); }
  finally { await pool.query(`ALTER TABLE ${s}.commission_income_revisions ENABLE TRIGGER commission_revision_immutable`); }
  await assert.rejects(journal.read(f.a.token, f.income.incomeId), code("CORRUPT_HISTORY"));
  await assert.rejects(apply(f), code("CORRUPT_HISTORY"));
});
test("CSRF, revoked and disabled current actor reject writes and old-key reads", async () => {
  const f = await fixture(); await assert.rejects(journal.reconcile(f.a.token, "", f.input), code("AUTHENTICATION_REQUIRED")); await apply(f);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.a.sessionId]);
  await assert.rejects(apply(f), code("AUTHENTICATION_REQUIRED")); await assert.rejects(journal.read(f.a.token, f.income.incomeId), code("AUTHENTICATION_REQUIRED"));
  const b = await fixture(); await pool.query(`UPDATE ${s}.operators SET status='disabled',disabled_at=clock_timestamp(),updated_at=clock_timestamp() WHERE operator_id=$1`, [b.a.operatorId]);
  await assert.rejects(apply(b), code("AUTHENTICATION_REQUIRED")); assert.deepEqual(await counts(b.income.incomeId), zero);
});
test("real producer wait crosses session expiry, final DB clock rolls all writes back", async () => {
  const f = await fixture(); await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE session_id=$1`, [f.a.sessionId]);
  let called = false;
  const j = new CommissionIncomeJournal(pool, auth, { read: async c => { called = true; await c.query("SELECT pg_sleep(0.3)"); return { income: f.income, context: f.context }; } });
  await assert.rejects(apply(f, f.input, j), code("AUTHENTICATION_REQUIRED")); assert.equal(called, true); assert.deepEqual(await counts(f.income.incomeId), zero);
});
test("guard wait checks current DB clock before producer, missing guard cannot succeed", async () => {
  const f = await fixture(), locker = await pool.connect(); await locker.query("BEGIN"); await locker.query(`SELECT singleton FROM ${s}.commission_journal_guard FOR UPDATE`);
  await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE session_id=$1`, [f.a.sessionId]);
  let called = false; const j = new CommissionIncomeJournal(pool, auth, { read: async () => { called = true; return null; } });
  const pending = assert.rejects(apply(f, f.input, j), code("AUTHENTICATION_REQUIRED"));
  try { await new Promise(resolve => setTimeout(resolve, 300)); await locker.query("COMMIT"); await pending; }
  finally { await locker.query("ROLLBACK"); locker.release(); }
  assert.equal(called, false); assert.deepEqual(await counts(f.income.incomeId), zero);
  await pool.query(`DELETE FROM ${s}.commission_journal_guard`); const b = await fixture();
  try { await assert.rejects(apply(b), code("CORRUPT_HISTORY")); }
  finally { await pool.query(`INSERT INTO ${s}.commission_journal_guard(singleton) VALUES(true)`); }
});
test("producer errors are fixed codes without raw text/cause or fake old successful calculation", async () => {
  const f = await fixture(); const j = new CommissionIncomeJournal(pool, auth, { read: async () => { throw new Error("synthetic-private-marker"); } });
  await assert.rejects(apply(f, f.input, j), (e: unknown) => e instanceof CommissionJournalError && e.code === "PRODUCER_UNAVAILABLE" && !e.cause && !e.message.includes("private-marker"));
  assert.deepEqual(await counts(f.income.incomeId), zero);
});
