import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { InstallationAuthService } from "./installation-auth-service.js";
import { NetworkAdmissionStore } from "./network-admission-store.js";
import { challengeSigningBytes, type AdmissionRecord } from "./network-admission-core.js";
import { EndpointReportError, endpointReportSigningBytes, type EndpointReport } from "./endpoint-report-core.js";
import { EndpointJournalError, EndpointReportJournal, type EndpointReportSourceVerifier } from "./endpoint-report-journal.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Endpoint journal tests require isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 12, application_name: "sg-endpoint-journal-fixtures" });
const s = "socialgrowth_product", hash = (v: string) => createHash("sha256").update(v).digest();
const auth = new InstallationAuthService(pool, "isolated-endpoint-auth-pepper-fixture-only");
const admission = new NetworkAdmissionStore(pool), transport = Object.freeze({ fixtureChannel: true });
const requestKey = () => `endpoint-${randomUUID()}`;
const code = (c: string) => (e: unknown) => (e instanceof EndpointJournalError || e instanceof EndpointReportError) && e.code === c && e.message === c && !e.cause;
async function clock(): Promise<string> { return (await pool.query<{ now: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') now`)).rows[0]!.now; }
// A synthetic trusted-source seam for transaction checks, NOT LocalAPI evidence
// or independent network/Web/phone acceptance. Default real adapter is absent.
const verifier: EndpointReportSourceVerifier = { observe: async (_channel, expected) => ({ scope: structuredClone(expected), observedAt: await clock() }) };
const journal = new EndpointReportJournal(pool, verifier, 10_000);
const migrations = new URL("../migrations/", import.meta.url);
let previousInstallation: string, counter = 0, bootstrapCounter = 0;
before(async () => {
  const files = (await readdir(migrations)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort();
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  for (const file of files) await pool.query(await readFile(new URL(file, migrations), "utf8"));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.endpoint_report_journals`)).rowCount, 0);
  await pool.query(`DROP SCHEMA ${s} CASCADE`);
  for (const file of files.filter(v => !v.startsWith("0015_"))) await pool.query(await readFile(new URL(file, migrations), "utf8"));
  previousInstallation = (await bootstrap()).installation.installationId;
  await pool.query(await readFile(new URL("0015_endpoint_report_journal.sql", migrations), "utf8"));
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
async function bootstrap() {
  return auth.bootstrap({ metadata: { contractVersion, requestId: requestKey(), idempotencyKey: requestKey() }, installationCredential: `sginst_v1_${randomBytes(32).toString("base64url")}` }, `192.0.2.${++bootstrapCounter}`);
}
async function fixture() {
  const install = await bootstrap(), context = await auth.authenticate(install.sessionToken), providerId = randomUUID(), deviceId = randomUUID(), associationId = randomUUID(), associationSession = randomUUID();
  await pool.query(`INSERT INTO ${s}.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Synthetic endpoint fixture','active')`, [providerId, `+1555${String(++counter).padStart(7, "0")}`]);
  await pool.query(`INSERT INTO ${s}.devices(device_id,display_name,state,fact_version) VALUES($1,'Synthetic endpoint phone','associated_pending_access',1)`, [deviceId]);
  await pool.query(`INSERT INTO ${s}.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at,consumed_at,consumed_by_provider_id)
    VALUES($1,$2,1,'Synthetic endpoint phone',$3,clock_timestamp()+interval '1 hour',clock_timestamp(),$4)`, [associationSession, context.installationId, hash(associationSession), providerId]);
  await pool.query(`INSERT INTO ${s}.device_associations(association_id,device_id,installation_id,provider_id,association_session_id) VALUES($1,$2,$3,$4,$5)`, [associationId, deviceId, context.installationId, providerId, associationSession]);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  let record = await admission.begin(context, keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"), requestKey());
  const scope = (r: AdmissionRecord) => ({ enrollmentId: r.enrollmentId, deviceId, installationId: context.installationId, enrollmentGeneration: r.authority.enrollmentGeneration });
  record = await admission.apply(record.enrollmentId, record.version, requestKey(), { kind: "confirm_restriction", evidence: {
    ...scope(record), evidenceId: requestKey(), policyRevision: 1, networkRevision: 1, checkedAt: await clock(),
    independentVerifierReachable: true, adbDenied: true, otherPhonesDenied: true, operatorServicesDenied: true, businessEgressDenied: true, additiveRulesChecked: true,
  } });
  const node = { nodeId: `fixture-node-${deviceId}`, nodeKey: `fixture-key-${deviceId}`, networkRevision: 1 };
  const source = async () => ({ node, observedAt: await clock() });
  record = await admission.apply(record.enrollmentId, record.version, requestKey(), { kind: "issue_challenge", source: await source() });
  record = await admission.apply(record.enrollmentId, record.version, requestKey(), { kind: "consume_proof", source: await source(), proof: {
    challengeId: record.challenge!.challengeId, signature: sign("sha256", challengeSigningBytes(record.challenge!), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url"),
  } });
  record = await admission.apply(record.enrollmentId, record.version, requestKey(), { kind: "request_permission", source: await source(), policyRevision: 2 });
  record = await admission.apply(record.enrollmentId, record.version, requestKey(), { kind: "confirm_permission", source: await source(), evidence: {
    ...scope(record), node, evidenceId: requestKey(), policyRevision: 2, checkedAt: await clock(), requiredPathsVerified: true, forbiddenPathsDenied: true,
  } });
  assert.equal(record.phase, "admitted"); // Pure synthetic control-plane fixture, no real paths opened.
  const epochId = randomUUID(), started = await journal.begin(install.sessionToken, transport, { enrollmentId: record.enrollmentId, epochId, expectedRevision: 0 });
  const report = async (patch: Partial<EndpointReport> = {}): Promise<EndpointReport> => ({ protocol: "2026-09-30.endpoint-v1", reportId: randomUUID(), scope: started.state.scope,
    sourceEpoch: epochId, sequence: "1", endpoints: [{ purpose: "connect", status: "candidate", port: 37000, pairingSessionId: null }, { purpose: "pairing", status: "unknown", port: null, pairingSessionId: null }], observedAt: await clock(), reason: "initial_discovery", ...patch });
  const signed = (r: EndpointReport) => ({ report: r, signature: sign("sha256", endpointReportSigningBytes(r), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") });
  return { install, context, providerId, deviceId, associationId, record, epochId, started, report, signed,
    send: (r: EndpointReport, j = journal) => j.report(install.sessionToken, transport, { enrollmentId: record.enrollmentId }, signed(r)),
    query: (reportId: string | null = null, maximumAgeMs = 10_000, j = journal) => j.query(install.sessionToken, transport, { enrollmentId: record.enrollmentId, reportId, maximumAgeMs }) };
}
async function counts(enrollmentId: string) {
  return (await pool.query<{ receipts: number; audits: number; record: unknown }>(`SELECT
    (SELECT count(*)::int FROM ${s}.endpoint_report_receipts WHERE enrollment_id=$1) receipts,
    (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='endpoint_report' AND object_id=$1) audits,
    (SELECT record FROM ${s}.endpoint_report_journals WHERE enrollment_id=$1) record`, [enrollmentId])).rows[0]!;
}
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 250; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error("Synthetic PostgreSQL invariant did not become observable");
}
async function blocked(queryPart: string) {
  return (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE application_name='sg-endpoint-journal-fixtures' AND wait_event_type='Lock' AND query LIKE $1`, [`%${queryPart}%`])).rowCount !== 0;
}
const dbCode = (code: string) => (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === code;

test("0015 applies to empty/full0014 schema, retains existing install and enforces relational scope", async () => {
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.installations WHERE installation_id=$1`, [previousInstallation])).rowCount, 1);
  const f = await fixture(), other = await bootstrap();
  await assert.rejects(pool.query(`INSERT INTO ${s}.endpoint_report_journals(enrollment_id,installation_id,device_id,endpoint_revision,record) VALUES($1,$2,$3,1,'{}'::jsonb)`, [randomUUID(), f.context.installationId, f.deviceId]), dbCode("23514"));
  const invalidEnrollment = randomUUID();
  await assert.rejects(pool.query(`INSERT INTO ${s}.endpoint_report_journals(enrollment_id,installation_id,device_id,endpoint_revision,record) VALUES($1,$2,$3,1,$4)`,
    [invalidEnrollment, other.installation.installationId, f.deviceId, { ...f.started.state, scope: { ...f.started.state.scope, enrollmentId: invalidEnrollment, installationId: other.installation.installationId } }]), dbCode("23503"));
});

test("absent source adapter closes before DB; strict boundaries never create trusted state", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId), closed = new EndpointReportJournal(pool);
  await assert.rejects(f.query(null, 1000, closed), code("SOURCE_UNAVAILABLE"));
  await assert.rejects(f.send(await f.report(), closed), code("SOURCE_UNAVAILABLE"));
  await assert.rejects(journal.begin(f.install.sessionToken, transport, { enrollmentId: f.record.enrollmentId, epochId: randomUUID(), expectedRevision: 1, eligible: true }), code("INPUT_INVALID"));
  await assert.rejects(journal.query(f.install.sessionToken, transport, { enrollmentId: f.record.enrollmentId, reportId: null, maximumAgeMs: 0 }), code("INPUT_INVALID"));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
});

test("current installation bearer/session binds all reads/writes and is checked before exact replay", async () => {
  const f = await fixture(), r = await f.report(), first = await f.send(r), other = await fixture();
  for (const token of ["", "A".repeat(43), other.install.sessionToken]) await assert.rejects(journal.query(token, transport, { enrollmentId: f.record.enrollmentId, reportId: r.reportId, maximumAgeMs: 1000 }), code("AUTHENTICATION_REQUIRED"));
  await pool.query(`UPDATE ${s}.installation_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1`, [f.install.session.sessionId]);
  await assert.rejects(f.send(r), code("AUTHENTICATION_REQUIRED"));
  await assert.rejects(f.query(r.reportId), code("AUTHENTICATION_REQUIRED"));
  assert.equal((await counts(f.record.enrollmentId)).receipts, 1); assert.equal(first.receipt.reportId, r.reportId);
});

test("two independent journal instances converge concurrent exact report and retain one receipt/audit", async () => {
  const f = await fixture(), r = await f.report(), second = new EndpointReportJournal(pool, verifier, 10_000);
  const results = await Promise.all([f.send(r), f.send(r, second)]);
  assert.deepEqual(results[0]!.receipt, results[1]!.receipt);
  assert.deepEqual(results.map(v => v.disposition).sort(), ["accepted", "duplicate"]);
  const c = await counts(f.record.enrollmentId); assert.equal(c.receipts, 1); assert.equal(c.audits, 2);
  assert.deepEqual((await f.query(r.reportId)).receipt, results[0]!.receipt);
  assert.equal("signature" in results[0]!.receipt, false);
});

test("actual new process rehydrates persisted sequence and signed state without memory replay", async () => {
  const f = await fixture(), r = await f.report({ sequence: "9007199254740993" }), first = await f.send(r);
  const child = `const {Pool}=require('pg'); const {parseEndpointReportState}=require('./src/endpoint-report-core.ts'); (async()=>{const p=new Pool({connectionString:process.env.SG_PRODUCT_TEST_DATABASE_URL}); try {const x=await p.query('SELECT record FROM socialgrowth_product.endpoint_report_journals WHERE enrollment_id=$1',[process.env.SG_ENDPOINT_FIXTURE_ID]); const s=parseEndpointReportState(x.rows[0].record); process.stdout.write(JSON.stringify({sequence:s.sequence,revision:s.endpointRevision,epoch:s.epochs.at(-1).epochId}));} finally {await p.end();}})().catch(()=>process.exitCode=1);`;
  const result = await promisify(execFile)("pnpm", ["exec", "tsx", "--eval", child], { cwd: new URL("..", import.meta.url), env: { ...process.env, SG_ENDPOINT_FIXTURE_ID: f.record.enrollmentId }, maxBuffer: 4096 });
  assert.deepEqual(JSON.parse(result.stdout), { sequence: "9007199254740993", revision: first.state.endpointRevision, epoch: f.epochId });
  assert.equal((await f.send(r, new EndpointReportJournal(pool, verifier, 10_000))).disposition, "duplicate");
  await assert.rejects(f.send(await f.report({ sequence: "9007199254740992" })), code("STALE_SEQUENCE"));
});

test("real COMMIT with only lost response recovers original accepted receipt and no new write", async () => {
  const f = await fixture(), r = await f.report(); let once = true;
  const faultPool = { connect: async () => {
    const c = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
      const result = await c.query(sql, values); if (sql === "COMMIT" && once) { once = false; throw new Error("synthetic-lost-ack"); } return result;
    }, release: () => c.release() } as unknown as PoolClient;
  } } as unknown as Pool;
  await assert.rejects(f.send(r, new EndpointReportJournal(faultPool, verifier, 10_000)), code("DATABASE_UNAVAILABLE"));
  const saved = await f.query(r.reportId), recovered = await f.send(r);
  assert.equal(recovered.disposition, "duplicate"); assert.deepEqual(recovered.receipt, saved.receipt);
  assert.equal((await counts(f.record.enrollmentId)).receipts, 1); assert.equal((await counts(f.record.enrollmentId)).audits, 2);
});

test("epoch restart invalidates old endpoints and query of old receipt cannot revive or refresh them", async () => {
  const f = await fixture(), r = await f.report(), first = await f.send(r), epochId = randomUUID();
  const input = { enrollmentId: f.record.enrollmentId, epochId, expectedRevision: first.state.endpointRevision };
  const next = await journal.begin(f.install.sessionToken, transport, input), repeated = await journal.begin(f.install.sessionToken, transport, input);
  assert.equal(next.replayed, false); assert.equal(repeated.replayed, true); assert.deepEqual(next.state, repeated.state);
  const query = await f.query(r.reportId); assert.deepEqual(query.receipt, first.receipt); assert.equal(query.currentEpoch, epochId);
  assert.equal(query.sequence, null); assert.ok(query.candidates.every(e => e.status === "unknown"));
  await assert.rejects(f.send(r), code("STALE_EPOCH"));
  await assert.rejects(journal.begin(f.install.sessionToken, transport, { ...input, expectedRevision: 0 }), code("STALE_VERSION"));
  await assert.rejects(journal.begin(f.install.sessionToken, transport, { enrollmentId: f.record.enrollmentId, epochId: f.epochId, expectedRevision: 0 }), code("STALE_EPOCH"));
});

test("new sequence/cached observation does not refresh age or pause state; altered same report ID conflicts", async () => {
  const f = await fixture(), r = await f.report(), first = await f.send(r);
  await pool.query(`UPDATE ${s}.devices SET state='paused' WHERE device_id=$1`, [f.deviceId]);
  const second = await f.send({ ...r, reportId: randomUUID(), sequence: "2" });
  assert.equal(second.state.lastObservationReceivedAt, first.state.lastObservationReceivedAt);
  assert.equal(second.state.endpointRevision, first.state.endpointRevision);
  await assert.rejects(f.send({ ...r, reason: "changed" }), code("REPORT_ID_REUSED"));
  const row = (await pool.query<{ state: string }>(`SELECT state FROM ${s}.devices WHERE device_id=$1`, [f.deviceId])).rows[0]!;
  assert.equal(row.state, "paused");
  assert.equal((await f.query(null, 1)).candidates[0]!.status, "unknown");
});

test("bad proof/scope or pairing claim without actual central session cannot persist a report", async () => {
  const f = await fixture(), r = await f.report(), before = await counts(f.record.enrollmentId), proof = f.signed(r);
  await assert.rejects(journal.report(f.install.sessionToken, transport, { enrollmentId: f.record.enrollmentId }, { ...proof, signature: "A".repeat(86) }), code("INVALID_PROOF"));
  await assert.rejects(f.send({ ...r, scope: { ...r.scope, installationGeneration: "2" } }), code("AUTHORITY_CHANGED"));
  await assert.rejects(f.send({ ...r, endpoints: [r.endpoints[0]!, { purpose: "pairing", status: "candidate", port: 39000, pairingSessionId: randomUUID() }] }), code("PAIRING_SESSION_STALE"));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
});

test("missing/changed/stale/future/failed trusted-source evidence masks errors and preserves state", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId);
  const variants: [EndpointReportSourceVerifier, string][] = [
    [{ observe: async () => null }, "SOURCE_UNAVAILABLE"],
    [{ observe: async (_t, expected) => ({ scope: { ...expected, node: { ...expected.node, networkRevision: 2 } }, observedAt: await clock() }) }, "SOURCE_MISMATCH"],
    [{ observe: async (_t, expected) => ({ scope: expected, observedAt: "2026-01-01T00:00:00Z" }) }, "SOURCE_STALE"],
    [{ observe: async (_t, expected) => ({ scope: expected, observedAt: "9999-01-01T00:00:00Z" }) }, "SOURCE_STALE"],
    [{ observe: async () => { throw new Error("synthetic-private-source-detail"); } }, "SOURCE_UNAVAILABLE"],
  ];
  for (const [v, c] of variants) await assert.rejects(f.send(await f.report(), new EndpointReportJournal(pool, v, 10_000)), code(c));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
});

test("real audit/receipt insert failures roll back snapshot, history and acknowledgements together", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId), r = await f.report();
  for (const table of ["audit_records", "endpoint_report_receipts"]) {
    await pool.query(`CREATE FUNCTION ${s}.fixture_endpoint_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-private-DB-detail'; END $$;
      CREATE TRIGGER fixture_endpoint_failure BEFORE INSERT ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.fixture_endpoint_insert_failure()`);
    try { await assert.rejects(f.send(r), code("DATABASE_UNAVAILABLE")); } finally { await pool.query(`DROP TRIGGER fixture_endpoint_failure ON ${s}.${table}; DROP FUNCTION ${s}.fixture_endpoint_insert_failure()`); }
    assert.deepEqual(await counts(f.record.enrollmentId), before);
  }
  assert.equal((await f.send(r)).disposition, "accepted");
});

test("DB audit-lock wait expires actual installation session before final guard and rolls back all writes", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId), r = await f.report(), blocker = await pool.connect();
  await pool.query(`UPDATE ${s}.installation_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE session_id=$1`, [f.install.session.sessionId]);
  await blocker.query("BEGIN"); await blocker.query(`LOCK TABLE ${s}.audit_records IN EXCLUSIVE MODE`);
  const result = f.send(r).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    await waitFor(() => blocked("INSERT INTO socialgrowth_product.audit_records"));
    await waitFor(async () => (await pool.query(`SELECT 1 FROM ${s}.installation_sessions WHERE session_id=$1 AND expires_at<=clock_timestamp()`, [f.install.session.sessionId])).rowCount === 1);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  const outcome = await result; assert.equal(outcome.value, null); assert.ok(code("AUTHENTICATION_REQUIRED")(outcome.error));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
});

test("source freshness is rechecked after actual write/lock wait, not just before transaction mutation", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId), r = await f.report(), blocker = await pool.connect(); let observed: string | null = null;
  const short = new EndpointReportJournal(pool, { observe: async (_t, expected) => { observed = await clock(); return { scope: expected, observedAt: observed }; } }, 1000);
  await blocker.query("BEGIN"); await blocker.query(`LOCK TABLE ${s}.audit_records IN EXCLUSIVE MODE`);
  const result = f.send(r, short).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    await waitFor(() => blocked("INSERT INTO socialgrowth_product.audit_records"));
    await waitFor(async () => observed !== null && (await pool.query(`SELECT clock_timestamp()>=$1::timestamptz+interval '1 second' AS elapsed`, [observed])).rows[0]?.elapsed === true);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  const outcome = await result; assert.equal(outcome.value, null); assert.ok(code("SOURCE_STALE")(outcome.error));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
});

test("current qualification/phase checked again on replay and mutation, without reviving exited device", async () => {
  const mutations = [
    async (f: Awaited<ReturnType<typeof fixture>>) => pool.query(`UPDATE ${s}.providers SET status='disabled' WHERE provider_id=$1`, [f.providerId]),
    async (f: Awaited<ReturnType<typeof fixture>>) => pool.query(`UPDATE ${s}.installations SET generation=2 WHERE installation_id=$1`, [f.context.installationId]),
    async (f: Awaited<ReturnType<typeof fixture>>) => pool.query(`UPDATE ${s}.device_associations SET ended_at=clock_timestamp() WHERE association_id=$1`, [f.associationId]),
    async (f: Awaited<ReturnType<typeof fixture>>) => pool.query(`UPDATE ${s}.devices SET state='exit_pending',fact_version=fact_version+1 WHERE device_id=$1`, [f.deviceId]),
    async (f: Awaited<ReturnType<typeof fixture>>) => admission.apply(f.record.enrollmentId, f.record.version, requestKey(), { kind: "request_reclamation", reason: "synthetic-qualification-changed" }),
  ];
  for (const mutate of mutations) {
    const f = await fixture(), r = await f.report(); await f.send(r); const before = await counts(f.record.enrollmentId); await mutate(f);
    await assert.rejects(f.send(r), code("AUTHORITY_CHANGED")); await assert.rejects(f.query(r.reportId), code("AUTHORITY_CHANGED"));
    await assert.rejects(journal.begin(f.install.sessionToken, transport, { enrollmentId: f.record.enrollmentId, epochId: randomUUID(), expectedRevision: 2 }), code("AUTHORITY_CHANGED"));
    assert.deepEqual(await counts(f.record.enrollmentId), before);
  }
});

test("DB append-only guards protect prior epochs/receipts/scope while hydration rejects administrative bad projection", async () => {
  const f = await fixture(), r = await f.report(), first = await f.send(r), before = await counts(f.record.enrollmentId);
  for (const record of [
    { ...first.state, receipts: [] }, { ...first.state, epochs: [] },
    { ...first.state, publicKeySpki: first.state.publicKeySpki.replace(/^./, "A") },
    { ...first.state, scope: { ...first.state.scope, ownershipVersion: "2" } },
  ]) await assert.rejects(pool.query(`UPDATE ${s}.endpoint_report_journals SET record=$2 WHERE enrollment_id=$1`, [f.record.enrollmentId, record]), dbCode("P0001"));
  await assert.rejects(pool.query(`UPDATE ${s}.endpoint_report_receipts SET source_sequence='2' WHERE enrollment_id=$1`, [f.record.enrollmentId]), dbCode("P0001"));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
  const bad = structuredClone(first.state); bad.endpoints[0]!.port = 37001;
  await pool.query(`UPDATE ${s}.endpoint_report_journals SET record=$2 WHERE enrollment_id=$1`, [f.record.enrollmentId, bad]);
  await assert.rejects(f.query(r.reportId), code("CORRUPT_STATE"));
  await pool.query(`UPDATE ${s}.endpoint_report_journals SET record=$2 WHERE enrollment_id=$1`, [f.record.enrollmentId, first.state]);
  assert.deepEqual((await f.query(r.reportId)).receipt, first.receipt);
});

test("actual provider row wait sees later disable, and cannot use a pre-lock authority observation", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId), r = await f.report(), blocker = await pool.connect();
  await blocker.query("BEGIN"); await blocker.query(`SELECT provider_id FROM ${s}.providers WHERE provider_id=$1 FOR UPDATE`, [f.providerId]);
  const result = f.send(r).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try { await waitFor(() => blocked("FROM socialgrowth_product.providers")); await blocker.query(`UPDATE ${s}.providers SET status='disabled' WHERE provider_id=$1`, [f.providerId]); await blocker.query("COMMIT"); }
  finally { await blocker.query("ROLLBACK"); blocker.release(); }
  const outcome = await result; assert.equal(outcome.value, null); assert.ok(code("AUTHORITY_CHANGED")(outcome.error));
  assert.deepEqual(await counts(f.record.enrollmentId), before);
});

test("silent database triggers cannot produce an acknowledged report without durable row/audit", async () => {
  const f = await fixture(), before = await counts(f.record.enrollmentId), r = await f.report();
  for (const table of ["endpoint_report_journals", "endpoint_report_receipts", "audit_records"]) {
    const event = table === "endpoint_report_journals" ? "UPDATE" : "INSERT";
    await pool.query(`CREATE FUNCTION ${s}.fixture_endpoint_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER fixture_endpoint_suppress BEFORE ${event} ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.fixture_endpoint_suppress()`);
    try { await assert.rejects(f.send(r), code("DATABASE_UNAVAILABLE")); }
    finally { await pool.query(`DROP TRIGGER fixture_endpoint_suppress ON ${s}.${table}; DROP FUNCTION ${s}.fixture_endpoint_suppress()`); }
    assert.deepEqual(await counts(f.record.enrollmentId), before);
  }
  assert.equal((await f.send(r)).disposition, "accepted");
});

test("administrative receipt deletion cannot hide durable ledger/ack inconsistency or re-ack missing journal", async () => {
  const f = await fixture(), r = await f.report(); await f.send(r);
  await pool.query(`DELETE FROM ${s}.endpoint_report_receipts WHERE enrollment_id=$1 AND report_id=$2`, [f.record.enrollmentId, r.reportId]);
  await assert.rejects(f.query(r.reportId), code("CORRUPT_STATE"));
  await assert.rejects(f.send(r), code("CORRUPT_STATE"));
  assert.equal((await counts(f.record.enrollmentId)).receipts, 0);
});

test("returned source is copied before synchronous cancellation cleanup can refresh stale time or repair wrong scope", async () => {
  const f = await fixture(), r = await f.report(), before = await counts(f.record.enrollmentId);
  for (const mutation of ["time", "scope"] as const) {
    for (const operation of ["begin", "report", "query"] as const) {
      let aborted = false;
      const source: EndpointReportSourceVerifier = { observe: async (_channel, expected, signal) => {
        const fresh = await clock();
        const evidence = { scope: structuredClone(expected), observedAt: fresh };
        if (mutation === "time") evidence.observedAt = "2026-01-01T00:00:00Z";
        else evidence.scope.node.networkRevision++;
        signal.addEventListener("abort", () => { aborted = true; evidence.observedAt = fresh; evidence.scope = structuredClone(expected); }, { once: true });
        return evidence;
      } };
      const checked = new EndpointReportJournal(pool, source, 10_000);
      const call = operation === "report" ? f.send(r, checked) : operation === "query" ? f.query(null, 10_000, checked)
        : checked.begin(f.install.sessionToken, transport, { enrollmentId: f.record.enrollmentId, epochId: randomUUID(), expectedRevision: f.started.state.endpointRevision });
      await assert.rejects(call, code(mutation === "time" ? "SOURCE_STALE" : "SOURCE_MISMATCH"));
      assert.equal(aborted, true); assert.deepEqual(await counts(f.record.enrollmentId), before);
    }
  }
});
