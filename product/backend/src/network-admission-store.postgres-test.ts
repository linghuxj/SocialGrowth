import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";

import { AdmissionError, challengeSigningBytes, type AdmissionRecord } from "./network-admission-core.js";
import { NetworkAdmissionStore } from "./network-admission-store.js";

const databaseUrl = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!databaseUrl || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") {
  throw new Error("Admission PostgreSQL tests need isolated SG_PRODUCT_TEST_DATABASE_URL and SG_PRODUCT_TEST_ALLOW_RESET=1");
}
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const store = new NetworkAdmissionStore(pool);
const requestKey = () => `request_${randomUUID().replaceAll("-", "")}`;
const digest = (value: string) => createHash("sha256").update(value).digest();
let counter = 0;
const legacyProviderId = randomUUID();

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const migration of ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  await pool.query(`INSERT INTO socialgrowth_product.providers(provider_id,phone_e164,display_name,status) VALUES($1,'+19990000000','Pre-WP08 identity','active')`, [legacyProviderId]);
  await pool.query(await readFile(new URL("../migrations/0005_network_admission.sql", import.meta.url), "utf8"));
});
after(async () => {
  try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); }
  finally { await pool.end(); }
});

// Non-UI fixtures test transaction invariants only. Never business acceptance.
async function fixture() {
  const installationId = randomUUID(), providerId = randomUUID(), deviceId = randomUUID();
  const sessionId = randomUUID(), associationId = randomUUID();
  await pool.query(`INSERT INTO socialgrowth_product.installations(installation_id,credential_digest,status) VALUES($1,$2,'active')`, [installationId, digest(installationId)]);
  await pool.query(`INSERT INTO socialgrowth_product.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Fixture Provider','active')`, [providerId, `+1555${String(++counter).padStart(7, "0")}`]);
  await pool.query(`INSERT INTO socialgrowth_product.devices(device_id,display_name,state,fact_version) VALUES($1,'Fixture Phone','associated_pending_access',1)`, [deviceId]);
  await pool.query(`INSERT INTO socialgrowth_product.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at,consumed_at,consumed_by_provider_id)
    VALUES($1,$2,1,'Fixture Phone',$3,clock_timestamp()+interval '1 hour',clock_timestamp(),$4)`, [sessionId, installationId, digest(sessionId), providerId]);
  await pool.query(`INSERT INTO socialgrowth_product.device_associations(association_id,device_id,installation_id,provider_id,association_session_id) VALUES($1,$2,$3,$4,$5)`, [associationId, deviceId, installationId, providerId, sessionId]);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const context = { installationId, installationGeneration: 1n };
  const creationKey = requestKey();
  const record = await store.begin(context, publicKey, creationKey);
  return { context, record, keys, publicKey, creationKey, providerId, associationId };
}

async function clock() {
  const result = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  return result.rows[0]!.now.toISOString();
}
async function source(nodeId = "node-A") {
  return { node: { nodeId, nodeKey: `key-${nodeId}`, networkRevision: 1 }, observedAt: await clock() };
}
function scope(record: AdmissionRecord) {
  return { enrollmentId: record.enrollmentId, deviceId: record.authority.deviceId,
    installationId: record.authority.installationId, enrollmentGeneration: record.authority.enrollmentGeneration };
}
async function challengedFixture(nodeId = `node-${randomUUID()}`) {
  const f = await fixture();
  const evidence = {
    ...scope(f.record),
    evidenceId: requestKey(), policyRevision: 1, networkRevision: 1, checkedAt: await clock(),
    independentVerifierReachable: true, adbDenied: true, otherPhonesDenied: true,
    operatorServicesDenied: true, businessEgressDenied: true, additiveRulesChecked: true,
  };
  const restricted = await store.apply(f.record.enrollmentId, 0, requestKey(), { kind: "confirm_restriction", evidence });
  const challenged = await store.apply(restricted.enrollmentId, restricted.version, requestKey(), { kind: "issue_challenge", source: await source(nodeId) });
  assert.ok(challenged.challenge);
  const proof = {
    challengeId: challenged.challenge.challengeId,
    signature: sign("sha256", challengeSigningBytes(challenged.challenge), { key: f.keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url"),
  };
  return { ...f, challenged, proof, nodeId };
}
const stale = (error: unknown) => error instanceof AdmissionError && error.code === "STALE_FACT";

test("migration from prior product schema preserves existing identity and rejects missing JSON facts", async () => {
  const legacy = await pool.query<{ display_name: string }>(`SELECT display_name FROM socialgrowth_product.providers WHERE provider_id=$1`, [legacyProviderId]);
  assert.equal(legacy.rows[0]?.display_name, "Pre-WP08 identity");
  const f = await fixture();
  await assert.rejects(pool.query(`UPDATE socialgrowth_product.network_enrollments SET record='{}'::jsonb WHERE enrollment_id=$1`, [f.record.enrollmentId]), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514");
  const row = await pool.query<{ record: AdmissionRecord }>(`SELECT record FROM socialgrowth_product.network_enrollments WHERE enrollment_id=$1`, [f.record.enrollmentId]);
  assert.deepEqual(row.rows[0]?.record, f.record);
});

test("creation, duplicate response and restricted-policy intention share one transaction", async () => {
  const f = await fixture();
  const repeated = await store.begin(f.context, f.publicKey, f.creationKey);
  assert.equal(repeated.enrollmentId, f.record.enrollmentId);
  const counts = await pool.query<{ count: string }>(`SELECT count(*)::text FROM socialgrowth_product.network_operation_intents WHERE enrollment_id=$1`, [f.record.enrollmentId]);
  assert.equal(counts.rows[0]?.count, "1");
  assert.equal(f.record.phase, "awaiting_restriction");
  await assert.rejects(store.begin(f.context, f.publicKey, requestKey()), stale);
  const anotherKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  await assert.rejects(store.begin(f.context, anotherKey, f.creationKey), AdmissionError);
});

test("same proof command concurrent retry consumes once; service restart reads persisted current result", async () => {
  const f = await challengedFixture();
  const key = requestKey();
  const command = { kind: "consume_proof" as const, source: await source(f.nodeId), proof: f.proof };
  const result = await Promise.all([
    store.apply(f.challenged.enrollmentId, f.challenged.version, key, command),
    new NetworkAdmissionStore(pool).apply(f.challenged.enrollmentId, f.challenged.version, key, command),
  ]);
  assert.equal(result[0].phase, "proof_verified");
  assert.deepEqual(result[0], result[1]);
  const rows = await pool.query<{ count: string }>(`SELECT count(*)::text FROM socialgrowth_product.network_enrollment_commands WHERE enrollment_id=$1 AND request_key=$2`, [f.record.enrollmentId, key]);
  assert.equal(rows.rows[0]?.count, "1");
  await assert.rejects(store.apply(f.record.enrollmentId, f.challenged.version, key, { ...command, proof: { ...f.proof, signature: "A".repeat(86) } }), stale);
});

test("a lost proof response accepts the same payload with a newly observed server timestamp but not another node", async () => {
  const f = await challengedFixture();
  const key = requestKey();
  const command = { kind: "consume_proof" as const, source: await source(f.nodeId), proof: f.proof };
  const original = await store.apply(f.record.enrollmentId, f.challenged.version, key, command);
  await new Promise(resolve => setTimeout(resolve, 5));
  const retried = { ...command, source: await source(f.nodeId) };
  assert.notEqual(retried.source.observedAt, command.source.observedAt);
  const result = await new NetworkAdmissionStore(pool).apply(f.record.enrollmentId, f.challenged.version, key, retried);
  assert.deepEqual(result, original);
  await assert.rejects(store.apply(f.record.enrollmentId, f.challenged.version, key, { ...retried, source: await source("different-node") }), stale);
});

test("different command IDs competing for the same challenge have one winner", async () => {
  const f = await challengedFixture();
  const command = { kind: "consume_proof" as const, source: await source(f.nodeId), proof: f.proof };
  const results = await Promise.allSettled([
    store.apply(f.record.enrollmentId, f.challenged.version, requestKey(), command),
    store.apply(f.record.enrollmentId, f.challenged.version, requestKey(), command),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected");
  assert.ok(rejected?.status === "rejected" && stale(rejected.reason));
});

test("candidate node is reserved uniquely; failed claim rolls back command and state", async () => {
  const nodeId = `exclusive-${randomUUID()}`;
  const first = await challengedFixture(nodeId);
  const second = await fixture();
  const restricted = await store.apply(second.record.enrollmentId, 0, requestKey(), {
    kind: "confirm_restriction", evidence: {
      ...scope(second.record),
      evidenceId: requestKey(), policyRevision: 1, networkRevision: 1, checkedAt: await clock(),
      independentVerifierReachable: true, adbDenied: true, otherPhonesDenied: true,
      operatorServicesDenied: true, businessEgressDenied: true, additiveRulesChecked: true,
    },
  });
  await assert.rejects(store.apply(second.record.enrollmentId, restricted.version, requestKey(), { kind: "issue_challenge", source: await source(nodeId) }), stale);
  const row = await pool.query<{ record: AdmissionRecord; candidate_node_id: string | null }>(`SELECT record,candidate_node_id FROM socialgrowth_product.network_enrollments WHERE enrollment_id=$1`, [second.record.enrollmentId]);
  assert.equal(row.rows[0]?.record.version, restricted.version);
  assert.equal(row.rows[0]?.record.challenge, null);
  assert.equal(row.rows[0]?.candidate_node_id, null);
  assert.equal(first.challenged.challenge?.node.nodeId, nodeId);
});

test("exit blocks upgrade and duplicate old success; cleanup remains permitted and cancels old intents", async () => {
  const f = await challengedFixture();
  const key = requestKey();
  const command = { kind: "consume_proof" as const, source: await source(f.nodeId), proof: f.proof };
  const verified = await store.apply(f.record.enrollmentId, f.challenged.version, key, command);
  await pool.query(`UPDATE socialgrowth_product.devices SET state='exit_pending',fact_version=fact_version+1 WHERE device_id=$1`, [f.record.authority.deviceId]);
  await assert.rejects(store.apply(f.record.enrollmentId, verified.version, requestKey(), { kind: "request_permission", source: await source(f.nodeId), policyRevision: 2 }), AdmissionError);
  await assert.rejects(store.apply(f.record.enrollmentId, f.challenged.version, key, command), AdmissionError);
  const cleanup = await store.apply(f.record.enrollmentId, verified.version, requestKey(), { kind: "request_reclamation", reason: "provider_exited" });
  assert.equal(cleanup.phase, "reclaim_pending");
  const jobs = await pool.query<{ kind: string; status: string }>(`SELECT kind,status FROM socialgrowth_product.network_operation_intents WHERE enrollment_id=$1 ORDER BY kind`, [f.record.enrollmentId]);
  assert.equal(jobs.rows.filter(j => j.status === "pending").length, 2);
  assert.deepEqual(jobs.rows.filter(j => j.status === "pending").map(j => j.kind), ["revoke_credential", "revoke_node_access"]);
});

test("authority revocation, association end and generation changes are rechecked before command replay", async () => {
  for (const change of ["generation", "association", "provider"]) {
    const f = await challengedFixture();
    if (change === "generation") await pool.query(`UPDATE socialgrowth_product.installations SET generation=2 WHERE installation_id=$1`, [f.context.installationId]);
    if (change === "association") await pool.query(`UPDATE socialgrowth_product.device_associations SET ended_at=clock_timestamp() WHERE association_id=$1`, [f.associationId]);
    if (change === "provider") await pool.query(`UPDATE socialgrowth_product.providers SET status='disabled' WHERE provider_id=$1`, [f.providerId]);
    await assert.rejects(store.begin(f.context, f.publicKey, f.creationKey), AdmissionError);
    await assert.rejects(store.apply(f.record.enrollmentId, f.challenged.version, requestKey(), { kind: "consume_proof", source: await source(f.nodeId), proof: f.proof }), AdmissionError);
    const cleanup = await store.apply(f.record.enrollmentId, f.challenged.version, requestKey(), { kind: "request_reclamation", reason: "authority_changed" });
    assert.equal(cleanup.phase, "reclaim_pending");
  }
});

test("partial reclamation holds unique node/device claim; confirmed cleanup permits new generation but old callbacks cannot revive it", async () => {
  const f = await challengedFixture();
  const reclaiming = await store.apply(f.record.enrollmentId, f.challenged.version, requestKey(), { kind: "request_reclamation", reason: "proof_expired" });
  const receipt = {
    ...scope(reclaiming), reclamationId: reclaiming.reclamationId!, node: reclaiming.node,
    evidenceId: requestKey(), checkedAt: await clock(), credentialRevoked: true, nodeAccessRevoked: false,
  };
  const partial = await store.apply(reclaiming.enrollmentId, reclaiming.version, requestKey(), { kind: "confirm_reclamation", evidence: receipt });
  assert.equal(partial.phase, "reclaim_pending");
  await assert.rejects(store.begin(f.context, f.publicKey, requestKey()), stale);
  await assert.rejects(store.apply(partial.enrollmentId, partial.version, requestKey(), { kind: "confirm_reclamation", evidence: { ...receipt, node: { ...sourceNode(f.nodeId), nodeId: "wrong-node" } } }), AdmissionError);
  const complete = await store.apply(partial.enrollmentId, partial.version, requestKey(), {
    kind: "confirm_reclamation", evidence: { ...receipt, checkedAt: await clock(), nodeAccessRevoked: true },
  });
  assert.equal(complete.phase, "reclaimed");
  const newRecord = await store.begin(f.context, f.publicKey, requestKey());
  assert.equal(newRecord.authority.enrollmentGeneration, "2");
  assert.notEqual(newRecord.enrollmentId, complete.enrollmentId);
  await assert.rejects(store.apply(complete.enrollmentId, complete.version, requestKey(), { kind: "consume_proof", source: await source(f.nodeId), proof: f.proof }), AdmissionError);
});

test("repeated cleanup after reclaimed never queues a new revocation against a reassigned node", async () => {
  const f = await challengedFixture();
  const pending = await store.apply(f.record.enrollmentId, f.challenged.version, requestKey(), { kind: "request_reclamation", reason: "expired" });
  const receipt = { ...scope(pending), reclamationId: pending.reclamationId!, node: pending.node,
    evidenceId: requestKey(), checkedAt: await clock(), credentialRevoked: true, nodeAccessRevoked: true };
  const complete = await store.apply(pending.enrollmentId, pending.version, requestKey(), { kind: "confirm_reclamation", evidence: receipt });
  const next = await store.begin(f.context, f.publicKey, requestKey());
  const restricted = await store.apply(next.enrollmentId, 0, requestKey(), { kind: "confirm_restriction", evidence: {
    ...scope(next), evidenceId: requestKey(), policyRevision: 1, networkRevision: 1, checkedAt: await clock(),
    independentVerifierReachable: true, adbDenied: true, otherPhonesDenied: true, operatorServicesDenied: true, businessEgressDenied: true, additiveRulesChecked: true,
  } });
  const reassigned = await store.apply(restricted.enrollmentId, restricted.version, requestKey(), { kind: "issue_challenge", source: await source(f.nodeId) });
  assert.equal(reassigned.challenge?.node.nodeId, f.nodeId);
  const replay = await store.apply(complete.enrollmentId, complete.version, requestKey(), { kind: "request_reclamation", reason: "expired" });
  assert.equal(replay.phase, "reclaimed");
  assert.equal(replay.version, complete.version);
  const oldJobs = await pool.query<{ pending: string; confirmed: string }>(`SELECT count(*) FILTER(WHERE status='pending')::text AS pending,
    count(*) FILTER(WHERE status='confirmed')::text AS confirmed FROM socialgrowth_product.network_operation_intents WHERE enrollment_id=$1`, [complete.enrollmentId]);
  assert.deepEqual(oldJobs.rows[0], { pending: "0", confirmed: "2" });
});

function sourceNode(nodeId: string) { return { nodeId, nodeKey: `key-${nodeId}`, networkRevision: 1 }; }

test("outbox insertion failure rolls back state, command and audit together; driver details remain masked", async () => {
  const f = await challengedFixture();
  const key = requestKey();
  await pool.query(`CREATE FUNCTION socialgrowth_product.reject_test_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sensitive-test-marker'; END $$`);
  await pool.query(`CREATE TRIGGER reject_test_intent BEFORE INSERT ON socialgrowth_product.network_operation_intents FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_test_intent()`);
  try {
    await assert.rejects(store.apply(f.record.enrollmentId, f.challenged.version, key, { kind: "request_reclamation", reason: "expired" }), (error: unknown) => error instanceof Error && error.message === "Admission transaction failed" && !("cause" in error));
    const row = await pool.query<{ record: AdmissionRecord }>(`SELECT record FROM socialgrowth_product.network_enrollments WHERE enrollment_id=$1`, [f.record.enrollmentId]);
    assert.equal(row.rows[0]?.record.phase, "restricted");
    assert.equal(row.rows[0]?.record.version, f.challenged.version);
    const counts = await pool.query<{ commands: string; audits: string; cancelled: string }>(
      `SELECT (SELECT count(*)::text FROM socialgrowth_product.network_enrollment_commands WHERE enrollment_id=$1 AND request_key=$2) AS commands,
       (SELECT count(*)::text FROM socialgrowth_product.audit_records WHERE object_id=$1 AND request_id=$2) AS audits,
       (SELECT count(*)::text FROM socialgrowth_product.network_operation_intents WHERE enrollment_id=$1 AND status='cancelled') AS cancelled`, [f.record.enrollmentId, key],
    );
    assert.deepEqual(counts.rows[0], { commands: "0", audits: "0", cancelled: "0" });
  } finally {
    await pool.query("DROP TRIGGER reject_test_intent ON socialgrowth_product.network_operation_intents");
    await pool.query("DROP FUNCTION socialgrowth_product.reject_test_intent()");
  }
});

test("provider-first lock order does not deadlock against existing association confirmation", async () => {
  const f = await fixture();
  const holder = await pool.connect();
  let pending: Promise<PromiseSettledResult<AdmissionRecord>> | null = null;
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT provider_id FROM socialgrowth_product.providers WHERE provider_id=$1 FOR UPDATE`, [f.providerId]);
    pending = store.begin(f.context, f.publicKey, f.creationKey).then(
      value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }),
    );
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = await pool.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%providers%FOR UPDATE%') AS waiting`);
      if (state.rows[0]?.waiting) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "admission must be waiting at the provider lock");
    await holder.query("SET LOCAL lock_timeout='500ms'");
    await holder.query(`SELECT installation_id FROM socialgrowth_product.installations WHERE installation_id=$1 FOR UPDATE`, [f.context.installationId]);
    await holder.query("COMMIT");
    const result = await pending;
    assert.equal(result.status, "fulfilled");
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
    if (pending) await pending;
  }
});
