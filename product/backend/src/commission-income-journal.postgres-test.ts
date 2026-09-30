import "reflect-metadata";
import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { CommissionIncomeJournal, CommissionJournalError, type CommissionIncomeProducer } from "./commission-income-journal.js";
import { calculateCommission, type CommissionContext, type CommissionIncome } from "./commission-core.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProviderAuthService, UnavailableSmsDeliveryPort } from "./provider-auth-service.js";
import { ProviderCommissionFeedService } from "./provider-commission-feed-service.js";
import { ProviderCommissionFeedController } from "./provider-commission-feed.controller.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
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
const providerPepper = "synthetic-commission-provider-pepper-00001";
const providerAuth = new ProviderAuthService(pool, providerPepper, new UnavailableSmsDeliveryPort());
const providerFeed = new ProviderCommissionFeedService(pool, providerAuth);
let phoneSequence = 0;
async function viewer() {
  const providerId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url");
  await pool.query(`INSERT INTO ${s}.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Synthetic commission viewer','active')`, [providerId, `+155501${String(++phoneSequence).padStart(5, "0")}`]);
  await pool.query(`INSERT INTO ${s}.provider_sessions(session_id,provider_id,token_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day')`, [sessionId, providerId, createHmac("sha256", providerPepper).update(token).digest()]);
  return { providerId, sessionId, token };
}
async function owned(v: Awaited<ReturnType<typeof viewer>>, incomeId?: string) {
  const f = await fixture(); if (incomeId) { f.income.incomeId = incomeId; f.input.incomeId = incomeId; }
  const row = f.context.ownership[0]!; assert.equal(row.kind, "provider");
  if (row.kind !== "provider") throw new Error("Wrong synthetic ownership fixture");
  row.providerId = v.providerId; await produce(f); await apply(f); return f;
}
const page = (v: Awaited<ReturnType<typeof viewer>>, after: { incomeId: string; revision: number } | null = null, pageSize = 20) => providerFeed.list(v.token, { after, pageSize });
test("numeric revision ordering remains continuous across 9/10 in read, correction, replay and provider projection", async () => {
  const a = await viewer(), f = await owned(a);
  for (let revision = 2; revision <= 12; revision++) {
    f.income.revision = revision; f.income.amountMinorUnits = String(revision * 100); await produce(f);
    assert.equal((await apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: revision - 1 })).currentRevision, revision);
  }
  const history = await journal.read(f.a.token, f.income.incomeId);
  assert.deepEqual(history.revisions.map(v => v.income.revision), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal((await apply(f)).currentRevision, 12);
  const records = (await page(a)).records;
  assert.deepEqual(records.map(v => v.revision), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(records.map(v => v.currentForIncome), Array.from({ length: 12 }, (_, i) => i === 11));
});
test("complete numeric 1000-revision fixture remains readable/replayable; 1001 is rejected, not truncated", async () => {
  // Synthetic boundary fixture only; continuous normal service writes above
  // separately prove the actual 9->10 path. This is not a receipt oracle.
  const a = await viewer(), f = await owned(a), first = (await journal.read(f.a.token, f.income.incomeId)).revisions[0]!;
  const entries = Array.from({ length: 1000 }, (_, i) => {
    const income = { ...f.income, revision: i + 2 };
    return { income, context: f.context, calculation: calculateCommission(income, f.context, first.calculation.evaluatedAt) };
  });
  await pool.query(`INSERT INTO ${s}.commission_income_revisions(income_id,revision,income,context,calculation,evaluated_at,recorded_by_operator_id)
    SELECT $1,(j->'income'->>'revision')::bigint,j->'income',j->'context',j->'calculation',$3,$4 FROM jsonb_array_elements($2::jsonb) j`, [f.income.incomeId, JSON.stringify(entries.slice(0, 999)), first.calculation.evaluatedAt, f.a.operatorId]);
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query(`ALTER TABLE ${s}.commission_income_sources DISABLE TRIGGER USER`);
    await c.query(`UPDATE ${s}.commission_income_sources SET current_revision=1000 WHERE income_id=$1`, [f.income.incomeId]);
    await c.query("SET CONSTRAINTS ALL IMMEDIATE"); // Resolve the fixture's deferred FK before ALTER TABLE.
    await c.query(`ALTER TABLE ${s}.commission_income_sources ENABLE TRIGGER USER`); await c.query("COMMIT");
  } finally { await c.query("ROLLBACK"); c.release(); }
  const history = await journal.read(f.a.token, f.income.incomeId); assert.equal(history.revisions.length, 1000);
  for (const revision of [10, 100, 1000]) assert.equal(history.revisions[revision - 1]!.income.revision, revision);
  assert.equal((await apply(f)).currentRevision, 1000);
  assert.deepEqual((await page(a, { incomeId: f.income.incomeId, revision: 999 }, 1)).records.map(v => [v.revision, v.currentForIncome]), [[1000, true]]);
  f.income.revision = 1001; await produce(f);
  await assert.rejects(apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1000 }), code("REVISION_STALE"));
  await pool.query(`INSERT INTO ${s}.commission_income_revisions(income_id,revision,income,context,calculation,evaluated_at,recorded_by_operator_id) VALUES($1,1001,$2,$3,$4,$5,$6)`, [f.income.incomeId, entries[999]!.income, f.context, entries[999]!.calculation, first.calculation.evaluatedAt, f.a.operatorId]);
  await assert.rejects(journal.read(f.a.token, f.income.incomeId), code("CORRUPT_HISTORY"));
  await assert.rejects(page(a, { incomeId: f.income.incomeId, revision: 1000 }), code("INTERNAL_ERROR"));
});
test("provider projection uses actual current session and returns only own allowlisted internal records", async () => {
  const a = await viewer(), b = await viewer(), empty = await viewer(), mine = await owned(a), other = await owned(b);
  const gap = await fixture(), old = gap.context.ownership[0]!;
  gap.context.ownership[0] = { kind: "company_gap", periodId: old.periodId, version: old.version, evidenceId: old.evidenceId, startsAt: old.startsAt, endsAt: old.endsAt }; await produce(gap); await apply(gap);
  const pending = await fixture(); pending.income.attribution = "unknown";
  const owner = pending.context.ownership[0]!; if (owner.kind !== "provider") throw new Error("Wrong synthetic ownership fixture");
  owner.providerId = a.providerId; await produce(pending); await apply(pending);
  const result = await page(a); assert.equal(result.records.length, 1); const row = result.records[0]!;
  assert.equal(row.incomeId, mine.income.incomeId); assert.equal(row.currentForIncome, true); assert.equal(row.commissionMinorUnits, "10");
  assert.equal(row.paymentAllowed, false); assert.equal(row.paymentStatus, "not_recorded"); assert.equal(row.rounding, "half_even");
  assert.equal((await page(b)).records[0]!.incomeId, other.income.incomeId); assert.deepEqual(await page(empty), { records: [], nextAfter: null });
  for (const forbidden of ["providerId", "deviceId", "sourceId", "sourceRecordId", "evidenceId", "receiptId", "recordedByOperatorId", "ownership", "paidAmountMinorUnits", "balance"]) assert.equal(forbidden in row, false);
  for (const secret of [b.providerId, other.income.incomeId, gap.income.incomeId, mine.income.receiptId!, mine.a.operatorId]) assert.equal(JSON.stringify(result).includes(secret), false);
});
test("corrected ownership retains former viewer's archived record without exposing new owner", async () => {
  const a = await viewer(), b = await viewer(), f = await owned(a);
  f.income.revision = 2; f.income.amountMinorUnits = "200";
  const owner = f.context.ownership[0]!; if (owner.kind !== "provider") throw new Error("Wrong synthetic ownership fixture");
  owner.providerId = b.providerId; await produce(f);
  await apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 });
  const first = (await page(a)).records, second = (await page(b)).records;
  assert.deepEqual(first.map(v => [v.revision, v.currentForIncome, v.commissionMinorUnits]), [[1, false, "10"]]);
  assert.deepEqual(second.map(v => [v.revision, v.currentForIncome, v.commissionMinorUnits]), [[2, true, "20"]]);
  assert.equal(JSON.stringify(first).includes(b.providerId), false); assert.equal(JSON.stringify(second).includes(a.providerId), false);
});
test("bounded own pagination handles two revisions and income UUID order; foreign cursors fail identically", async () => {
  const a = await viewer(), b = await viewer(), f = await owned(a), extra = await owned(a), other = await owned(b);
  f.income.revision = 2; f.income.amountMinorUnits = "200"; await produce(f); await apply(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 });
  const expected = [{ incomeId: f.income.incomeId, revision: 1 }, { incomeId: f.income.incomeId, revision: 2 }, { incomeId: extra.income.incomeId, revision: 1 }].sort((l, r) => l.incomeId.localeCompare(r.incomeId) || l.revision - r.revision);
  let cursor: { incomeId: string; revision: number } | null = null;
  for (const [index, ref] of expected.entries()) {
    const result = await page(a, cursor, 1); assert.equal(result.records.length, 1); assert.equal(result.records[0]!.incomeId, ref.incomeId); assert.equal(result.records[0]!.revision, ref.revision);
    assert.deepEqual(result.nextAfter, index === 2 ? null : ref); cursor = { ...ref, incomeId: ref.incomeId.toUpperCase() };
  }
  assert.deepEqual(await page(a, cursor), { records: [], nextAfter: null });
  for (const incomeId of [other.income.incomeId, randomUUID()]) await assert.rejects(page(a, { incomeId, revision: 1 }), code("FACT_VERSION_STALE"));
  for (const pageSize of [0, 51]) await assert.rejects(page(a, null, pageSize), code("INPUT_INVALID"));
  await assert.rejects(providerFeed.list(a.token, { after: null, pageSize: 20, providerId: b.providerId }), code("INPUT_INVALID"));
});
async function tamperCalculation(incomeId: string, value: string) {
  await pool.query(`ALTER TABLE ${s}.commission_income_revisions DISABLE TRIGGER commission_revision_immutable`);
  try { await pool.query(`UPDATE ${s}.commission_income_revisions SET calculation=jsonb_set(calculation,'{providerId}',to_jsonb($2::text)) WHERE income_id=$1`, [incomeId, value]); }
  finally { await pool.query(`ALTER TABLE ${s}.commission_income_revisions ENABLE TRIGGER commission_revision_immutable`); }
}
test("forged stored owner cannot disclose a foreign record, including cursor and overscan", async () => {
  const a = await viewer(), b = await viewer();
  await owned(a, "10000000-0000-4000-8000-000000000001");
  const foreign = await owned(b, "f0000000-0000-4000-8000-000000000001");
  await tamperCalculation(foreign.income.incomeId, a.providerId);
  try {
    await assert.rejects(page(a), code("INTERNAL_ERROR"));
    await assert.rejects(page(a, { incomeId: foreign.income.incomeId, revision: 1 }), code("INTERNAL_ERROR"));
    // The forged record sorts second and is the single-row page's overscan.
    await assert.rejects(page(a, null, 1), code("INTERNAL_ERROR"));
  } finally { await tamperCalculation(foreign.income.incomeId, b.providerId); }
});
test("revoked or disabled provider cannot use existing records; another current session survives logout", async () => {
  const a = await viewer(); await owned(a);
  const token = randomBytes(32).toString("base64url"), sessionId = randomUUID();
  await pool.query(`INSERT INTO ${s}.provider_sessions(session_id,provider_id,token_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day')`, [sessionId, a.providerId, createHmac("sha256", providerPepper).update(token).digest()]);
  await pool.query(`UPDATE ${s}.provider_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1`, [a.sessionId]);
  await assert.rejects(page(a), code("AUTHENTICATION_REQUIRED"));
  assert.equal((await providerFeed.list(token, { after: null, pageSize: 20 })).records.length, 1);
  await pool.query(`UPDATE ${s}.providers SET status='disabled' WHERE provider_id=$1`, [a.providerId]);
  await assert.rejects(providerFeed.list(token, { after: null, pageSize: 20 }), code("PROVIDER_DISABLED"));
});
test("real source-table lock wait crossing actual session expiry rejects before returning records", async () => {
  const a = await viewer(); await owned(a); const locker = await pool.connect();
  await pool.query(`UPDATE ${s}.provider_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE session_id=$1`, [a.sessionId]);
  await locker.query("BEGIN"); await locker.query(`LOCK TABLE ${s}.commission_income_sources IN ACCESS EXCLUSIVE MODE`);
  const rejection = assert.rejects(page(a), code("AUTHENTICATION_REQUIRED"));
  try {
    let waiting = false, expired = false;
    for (let i = 0; i < 300; i++) {
      waiting ||= Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-commission-fixtures' AND wait_event_type='Lock' AND query LIKE '%row_to_json(src)%'")).rowCount);
      expired = (await pool.query(`SELECT expires_at<=clock_timestamp() expired FROM ${s}.provider_sessions WHERE session_id=$1`, [a.sessionId])).rows[0]!.expired;
      if (waiting && expired) break; await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(waiting, true); assert.equal(expired, true); await locker.query("COMMIT"); await rejection;
  } finally { await locker.query("ROLLBACK"); locker.release(); }
});
@Module({ controllers: [ProviderCommissionFeedController], providers: [{ provide: ProviderCommissionFeedService, useValue: providerFeed }] })
class CommissionHttpFixtureModule {}
test("actual Nest readonly GET uses real provider authentication, strict query and no-store headers", async () => {
  // Ordinary NON-UI integration, not Playwright or actual income acceptance.
  const a = await viewer(), b = await viewer(), mine = await owned(a), foreign = await owned(b);
  const app = await NestFactory.create(CommissionHttpFixtureModule, { logger: false }); app.useGlobalFilters(new ProductExceptionFilter());
  try {
    await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
    const get = (query = "", token: string | undefined = a.token) => fetch(`${base}/api/provider/commissions${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const response = await get(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as { records: { incomeId: string }[] }; assert.deepEqual(body.records.map(v => v.incomeId), [mine.income.incomeId]);
    assert.equal((await get("", "")).status, 401); assert.equal((await get("?providerId=other")).status, 400);
    assert.equal((await get(`?afterIncomeId=${foreign.income.incomeId}&afterRevision=1`)).status, 409);
    assert.equal((await fetch(`${base}/api/provider/commissions`, { method: "POST", headers: { Authorization: `Bearer ${a.token}` } })).status, 404);
    const before = await counts(mine.income.incomeId); await get(); assert.deepEqual(await counts(mine.income.incomeId), before);
  } finally { await app.close(); }
});
