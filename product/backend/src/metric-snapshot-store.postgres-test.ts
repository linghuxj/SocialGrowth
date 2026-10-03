import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { MetricSnapshotStore, type TrustedMetricReportResolver } from "./metric-snapshot-store.js";
import { parseMetricHistory, type MetricSnapshot } from "./metric-snapshot-core.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { OperatorAuthService } from "./operator-auth-service.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires owned isolated reset-authorized PostgreSQL");
const pool = new Pool({ connectionString: url, max: 8 });
const expectCode = (code: string) => (error: unknown) => error instanceof ProductTransactionError && error.code === code;
const fixture = () => {
  const sourceId = randomUUID(), sourceReportId = randomUUID(), definitionId = randomUUID(), projectId = randomUUID();
  const identityId = randomUUID(), accountId = randomUUID(), operatorId = randomUUID(), deviceId = randomUUID();
  const snapshot: MetricSnapshot = { snapshotId: randomUUID(), sourceId, sourceReportId, definitionId, projectId, identityId, platform: "facebook",
    subject: { kind: "account" }, revision: 1, replacesSnapshotId: null, measurement: "cumulative", value: "0", availability: "available",
    missingReason: null, sourceTimeZone: "America/Los_Angeles", coverage: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z" },
    statisticsCutoffAt: "2026-10-02T00:00:00Z", collectedAt: "2026-10-02T00:01:00Z" };
  let current: unknown = structuredClone(snapshot);
  const resolver: TrustedMetricReportResolver = { resolve: async () => ({ accountId, snapshot: structuredClone(current) }) };
  return { sourceId, sourceReportId, definitionId, projectId, identityId, accountId, operatorId, deviceId, snapshot, resolver, current: () => current,
    setCurrent: (value: unknown) => { current = structuredClone(value); } };
};
function delayFeedbackReadQuery(source: Pool, delayMs: number): Pool {
  return new Proxy(source, { get(target, property, receiver) {
    if (property !== "connect") return Reflect.get(target, property, receiver);
    return async () => {
      const client = await target.connect();
      return new Proxy(client, { get(connection, key, innerReceiver) {
        if (key === "query") return async (...args: unknown[]) => {
          if (typeof args[0] === "string" && args[0].includes("metric_snapshot_history h")) await new Promise(resolve => setTimeout(resolve, delayMs));
          return (connection.query as (...queryArgs: unknown[]) => unknown)(...args);
        };
        const value = Reflect.get(connection, key, innerReceiver);
        return typeof value === "function" ? value.bind(connection) : value;
      } });
    };
  } }) as Pool;
}

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });

async function seed(f: ReturnType<typeof fixture>) {
  await pool.query(`INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status)
    VALUES($1,$2,'Metric fixture','not-a-password','active')`, [f.operatorId, `metric-${f.operatorId}`]);
  await pool.query(`INSERT INTO socialgrowth_product.projects(project_id,name,kind,created_by_operator_id)
    VALUES($1,'Metric fixture project','company_owned',$2)`, [f.projectId, f.operatorId]);
  await pool.query(`INSERT INTO socialgrowth_product.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [f.accountId, `acct_${f.accountId.replaceAll("-", "")}`]);
  await pool.query(`INSERT INTO socialgrowth_product.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`,
    [f.identityId, f.accountId, `page_${f.identityId.replaceAll("-", "")}`]);
  await pool.query("INSERT INTO socialgrowth_product.project_account_reservations(account_id,project_id) VALUES($1,$2)", [f.accountId, f.projectId]);
  await pool.query("INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Metric fixture device','associated_pending_access')", [f.deviceId]);
  await pool.query("INSERT INTO socialgrowth_product.project_device_reservations(device_id,project_id) VALUES($1,$2)", [f.deviceId, f.projectId]);
  await pool.query(`INSERT INTO socialgrowth_product.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id)
    VALUES($1,$2,'facebook',$3,$4,$5)`, [f.identityId, f.accountId, f.deviceId, f.projectId, f.operatorId]);
}
const key = (f: ReturnType<typeof fixture>) => ({ sourceId: f.sourceId, sourceReportId: f.sourceReportId });

test("operator feedback read is project scoped and reports disabled source explicitly", async () => {
  const f = fixture(); await seed(f);
  const token = randomBytes(32).toString("base64url"), auth = new OperatorAuthService(pool, "synthetic-metric-feedback-auth-pepper-0001");
  await pool.query(`INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at)
    VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 hour')`, [randomUUID(), f.operatorId,
    createHash("sha256").update(token).digest(), createHash("sha256").update("unused-csrf").digest()]);
  const disabled = new MetricSnapshotStore(pool, null, auth);
  const closed = await disabled.readProjectFeedback(token, f.projectId);
  assert.equal(closed.sourceState, "not_configured"); assert.equal(closed.sourceReasonCode, "source_not_configured"); assert.deepEqual(closed.metrics, []);
  await assert.rejects(disabled.readProjectFeedback("", f.projectId), expectCode("AUTHENTICATION_REQUIRED"));
  await assert.rejects(disabled.readProjectFeedback(token, randomUUID()), expectCode("AUTHORIZATION_DENIED"));

  const trusted = new MetricSnapshotStore(pool, f.resolver, auth);
  const configuredWithoutReport = await trusted.readProjectFeedback(token, f.projectId);
  assert.equal(configuredWithoutReport.sourceState, "unknown"); assert.equal(configuredWithoutReport.sourceReasonCode, "no_authoritative_report");
  await trusted.ingestCurrent(key(f));
  const persistedRead = await disabled.readProjectFeedback(token, f.projectId);
  assert.equal(persistedRead.sourceState, "available"); assert.equal(persistedRead.metrics[0]!.value, "0");
  const current = await trusted.readProjectFeedback(token, f.projectId);
  assert.equal(current.sourceState, "available"); assert.equal(current.sourceReasonCode, null);
  assert.equal(current.metrics.length, 1); assert.equal(current.metrics[0]!.value, "0");
  assert.equal(current.metrics[0]!.subject.kind, "account");

  await pool.query("DELETE FROM socialgrowth_product.project_identity_reservations WHERE identity_id=$1", [f.identityId]);
  const noLongerReserved = await trusted.readProjectFeedback(token, f.projectId);
  assert.equal(noLongerReserved.sourceState, "unknown"); assert.deepEqual(noLongerReserved.metrics, []);
  assert.equal(noLongerReserved.contentAttribution.state, "unknown");
});

test("operator session expiring during history read is denied before returning the projection", async () => {
  const f = fixture(); await seed(f);
  const token = randomBytes(32).toString("base64url"), auth = new OperatorAuthService(pool, "synthetic-metric-feedback-auth-pepper-0001");
  await pool.query(`INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at)
    VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '400 milliseconds')`, [randomUUID(), f.operatorId,
    createHash("sha256").update(token).digest(), createHash("sha256").update("expiry-test-csrf").digest()]);
  const delayed = new MetricSnapshotStore(delayFeedbackReadQuery(pool, 800), null, auth);
  await assert.rejects(delayed.readProjectFeedback(token, f.projectId), expectCode("AUTHENTICATION_REQUIRED"));
});

test("default closed, account reservation scoped, cumulative zero/replay/correction history is atomic", async () => {
  const f = fixture(); await seed(f);
  const closed = new MetricSnapshotStore(pool);
  await assert.rejects(closed.ingestCurrent(key(f)), expectCode("INTERNAL_ERROR"));
  assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.metric_snapshot_report_heads WHERE source_id=$1 AND source_report_id=$2",
    [f.sourceId, f.sourceReportId])).rows[0]!.n, 0);

  const store = new MetricSnapshotStore(pool, f.resolver);
  const first = await store.ingestCurrent(key(f));
  assert.equal(first.changed, true); assert.equal(first.snapshot.value, "0"); assert.equal(first.snapshot.measurement, "cumulative");
  assert.equal((await store.ingestCurrent(key(f))).changed, false);

  const correction: MetricSnapshot = { ...f.snapshot, snapshotId: randomUUID(), revision: 2, replacesSnapshotId: f.snapshot.snapshotId,
    value: "3", collectedAt: "2026-10-03T00:01:00Z", statisticsCutoffAt: "2026-10-03T00:00:00Z",
    coverage: { startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-03T00:00:00Z" } };
  f.setCurrent(correction);
  const second = await store.ingestCurrent(key(f));
  assert.equal(second.changed, true); assert.equal(second.snapshot.value, "3");
  const rows = await pool.query<{ payload: unknown }>(`SELECT payload FROM socialgrowth_product.metric_snapshot_history
    WHERE source_id=$1 AND source_report_id=$2 ORDER BY revision`, [f.sourceId, f.sourceReportId]);
  const history = parseMetricHistory(rows.rows.map(row => row.payload));
  assert.deepEqual(history.map(row => [row.revision, row.value, row.replacesSnapshotId]), [[1, "0", null], [2, "3", f.snapshot.snapshotId]]);
  assert.equal((await pool.query(`SELECT current_revision FROM socialgrowth_product.metric_snapshot_report_heads WHERE source_id=$1 AND source_report_id=$2`,
    [f.sourceId, f.sourceReportId])).rows[0]!.current_revision, "2");
});

test("missing, delayed, content, wrong-account, and stale revisions preserve uncertainty and default closed", async () => {
  const f = fixture(); await seed(f); const store = new MetricSnapshotStore(pool, f.resolver);
  const missingReportId = randomUUID(), missing = { ...f.snapshot, snapshotId: randomUUID(), sourceReportId: missingReportId,
    value: null, availability: "missing" as const, missingReason: "no_data" as const };
  f.setCurrent(missing); assert.equal((await store.ingestCurrent({ sourceId: f.sourceId, sourceReportId: missingReportId })).snapshot.availability, "missing");
  const delayedReportId = randomUUID(), delayed = { ...missing, snapshotId: randomUUID(), sourceReportId: delayedReportId,
    availability: "delayed" as const, missingReason: "source_unavailable" as const };
  f.setCurrent(delayed); assert.equal((await store.ingestCurrent({ sourceId: f.sourceId, sourceReportId: delayedReportId })).snapshot.availability, "delayed");
  const invalidDelayedReportId = randomUUID(); f.setCurrent({ ...delayed, snapshotId: randomUUID(), sourceReportId: invalidDelayedReportId, value: "0" });
  await assert.rejects(store.ingestCurrent({ sourceId: f.sourceId, sourceReportId: invalidDelayedReportId }), expectCode("INPUT_INVALID"));

  const contentReportId = randomUUID(); f.setCurrent({ ...f.snapshot, sourceReportId: contentReportId, subject: { kind: "content", publicationId: randomUUID(), taskId: randomUUID(), contentUnitId: randomUUID(), variantId: randomUUID() } });
  await assert.rejects(store.ingestCurrent({ sourceId: f.sourceId, sourceReportId: contentReportId }), expectCode("AUTHORIZATION_DENIED"));
  assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.metric_snapshot_report_heads WHERE source_report_id=$1", [contentReportId])).rows[0]!.n, 0);

  const wrongAccount = new MetricSnapshotStore(pool, { resolve: async () => ({ accountId: randomUUID(), snapshot: f.snapshot }) });
  await assert.rejects(wrongAccount.ingestCurrent(key(f)), expectCode("AUTHORIZATION_DENIED"));

  const unreservedIdentityId = randomUUID(), unreservedReportId = randomUUID();
  await pool.query(`INSERT INTO socialgrowth_product.publishing_identities(identity_id,account_id,platform,canonical_identity_ref)
    VALUES($1,$2,'facebook',$3)`, [unreservedIdentityId, f.accountId, `page_${unreservedIdentityId.replaceAll("-", "")}`]);
  f.setCurrent({ ...f.snapshot, snapshotId: randomUUID(), sourceReportId: unreservedReportId, identityId: unreservedIdentityId });
  await assert.rejects(store.ingestCurrent({ sourceId: f.sourceId, sourceReportId: unreservedReportId }), expectCode("AUTHORIZATION_DENIED"));
  assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.metric_snapshot_report_heads WHERE source_report_id=$1", [unreservedReportId])).rows[0]!.n, 0);

  f.setCurrent(f.snapshot); assert.equal((await store.ingestCurrent(key(f))).changed, true);
  f.setCurrent({ ...f.snapshot, revision: 2, snapshotId: randomUUID(), replacesSnapshotId: randomUUID() });
  await assert.rejects(store.ingestCurrent(key(f)), (error: unknown) => error instanceof ProductTransactionError && error.code === "INPUT_INVALID");
  const stale = { ...f.snapshot, revision: 2, snapshotId: randomUUID(), replacesSnapshotId: f.snapshot.snapshotId,
    collectedAt: "2026-10-03T00:00:00Z", statisticsCutoffAt: "2026-10-02T00:00:00Z",
    coverage: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z" } };
  f.setCurrent(stale); await store.ingestCurrent(key(f));
  f.setCurrent(stale); assert.equal((await store.ingestCurrent(key(f))).changed, false);
});

test("source-independent history write failure rolls back head and permits exact continuation", async () => {
  const f = fixture(); await seed(f); const store = new MetricSnapshotStore(pool, f.resolver);
  await pool.query(`CREATE FUNCTION socialgrowth_product.test_fail_metric_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic metric persistence failure'; END $$`);
  await pool.query(`CREATE TRIGGER metric_test_failure BEFORE INSERT ON socialgrowth_product.metric_snapshot_history
    FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.test_fail_metric_insert()`);
  await assert.rejects(store.ingestCurrent(key(f)), expectCode("INTERNAL_ERROR"));
  assert.equal((await pool.query("SELECT count(*)::int n FROM socialgrowth_product.metric_snapshot_report_heads WHERE source_id=$1 AND source_report_id=$2",
    [f.sourceId, f.sourceReportId])).rows[0]!.n, 0);
  await pool.query("DROP TRIGGER metric_test_failure ON socialgrowth_product.metric_snapshot_history");
  await pool.query("DROP FUNCTION socialgrowth_product.test_fail_metric_insert()");
  assert.equal((await store.ingestCurrent(key(f))).changed, true);
});
