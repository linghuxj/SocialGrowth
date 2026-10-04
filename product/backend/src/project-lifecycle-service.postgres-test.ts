import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProjectLifecycleService } from "./project-lifecycle-service.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Lifecycle transaction tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 10, application_name: "sg-lifecycle-fixtures" });
const auth = new OperatorAuthService(pool, "isolated-lifecycle-auth-pepper-only-00000001");
const service = new ProjectLifecycleService(pool, auth);
const s = "socialgrowth_product";
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `lifecycle-${randomUUID()}` });
const expectedError = (code: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === code;

before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });

async function actor(expires = "1 day") {
  const operatorId = randomUUID(), sessionId = randomUUID(), sessionToken = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status)
    VALUES($1,$2,'Lifecycle fixture','not-real-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at)
    VALUES($1,$2,$3,$4,1,clock_timestamp()+$5::interval)`, [sessionId, operatorId, digest(sessionToken), digest(csrfToken), expires]);
  return { operatorId, sessionId, sessionToken, csrfToken };
}

async function project(operatorId: string) {
  const projectId = randomUUID();
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,fact_version,created_by_operator_id)
    VALUES($1,'Lifecycle synthetic','company_owned',1,$2)`, [projectId, operatorId]);
  return projectId;
}

async function tasks(projectId: string, operatorId: string, count: number) {
  const planId = randomUUID(), approvalId = randomUUID(), proposalId = randomUUID();
  const taskRows = Array.from({ length: count }, () => ({ taskId: randomUUID(), contentUnitId: randomUUID(), variantId: randomUUID(), identityId: randomUUID(),
    accountId: randomUUID(), materialObjectId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID() }));
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SET CONSTRAINTS ALL DEFERRED");
    await c.query(`INSERT INTO ${s}.project_direction_proposals(proposal_id,project_id,record) VALUES($1,$2,$3)`, [proposalId, projectId, { proposalId, projectId }]);
    await c.query(`INSERT INTO ${s}.project_direction_approvals(approval_id,project_id,proposal_id,actor_id,request_key,payload_digest,snapshot_digest,record)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [approvalId, projectId, proposalId, operatorId, `proposal-${randomUUID()}`, randomBytes(32), "a".repeat(64),
      { approvalId, projectId, proposalId, confirmedByOperatorId: operatorId, status: "approved_waiting_readiness", proposal: { proposalId, projectId } }]);
    await c.query(`INSERT INTO ${s}.business_plan_records(project_id,current_revision,plan_id) VALUES($1,1,$2)`, [projectId, planId]);
    await c.query(`INSERT INTO ${s}.business_plan_revisions(project_id,revision,plan_id,project_version,approval_id,window_start,window_end,outcome,suggestion,quota_snapshot,recorded_by_operator_id)
      VALUES($1,1,$2,1,$3,'2090-01-01T00:00:00Z','2090-02-01T00:00:00Z','planned','{}','{}',$4)`, [projectId, planId, approvalId, operatorId]);
    for (const row of taskRows) {
      await c.query(`INSERT INTO ${s}.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [row.accountId, `acct_${row.accountId.replaceAll("-", "")}`]);
      await c.query(`INSERT INTO ${s}.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`,
        [row.identityId, row.accountId, `ident_${row.identityId.replaceAll("-", "")}`]);
      await c.query(`INSERT INTO ${s}.material_content_units(content_unit_id,project_id,source_id,source_record_id,identity)
        VALUES($1,$2,$3,$4,$5)`, [row.contentUnitId, projectId, row.sourceId, row.sourceRecordId, { mediaKind: "video", businessKind: "product", businessEntityId: randomUUID(), seriesId: null, episodeNumber: null }]);
      await c.query(`INSERT INTO ${s}.material_variants(variant_id,content_unit_id,project_id,language_tag,current_revision) VALUES($1,$2,$3,'en',1)`, [row.variantId, row.contentUnitId, projectId]);
      await c.query(`INSERT INTO ${s}.material_variant_revisions(variant_id,revision,declaration,object_references,recorded_by_operator_id,recorded_at)
        VALUES($1,1,$2,$3,$4,'2090-01-01T00:00:00Z')`, [row.variantId, { name: "Fixture", description: "Fixture", businessFacts: "Fixture", sourceStatement: "Fixture",
        sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published" }, [{ objectId: row.materialObjectId, sha256: "b".repeat(64), bytes: 10, contentType: "video/mp4" }], operatorId]);
      await c.query(`INSERT INTO ${s}.business_plan_tasks(task_id,project_id,plan_id,plan_revision,content_unit_id,variant_id,material_revision,identity_id,platform,form,language_tag,scheduled_at,title,caption,recorded_by_operator_id)
        VALUES($1,$2,$3,1,$4,$5,1,$6,'facebook','facebook_video','en','2090-01-01T01:00:00Z','Fixture title','Fixture caption',$7)`,
        [row.taskId, projectId, planId, row.contentUnitId, row.variantId, row.identityId, operatorId]);
      await c.query(`INSERT INTO ${s}.business_plan_outbox(message_id,project_id,task_id) VALUES($1,$2,$3)`, [randomUUID(), projectId, row.taskId]);
    }
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  return taskRows;
}

test("pause is intent-only; terminal end records only confirmed unstarted cancellation and replays once", async () => {
  const a = await actor(), projectId = await project(a.operatorId), seeded = await tasks(projectId, a.operatorId, 2);
  const pauseMetadata = metadata();
  const pause = await service.setIntent(a.sessionToken, a.csrfToken, projectId, { metadata: pauseMetadata, expectedLifecycleRevision: 0, intent: "pause" });
  assert.equal(pause.intent, "pause_requested"); assert.equal(pause.cancelledTaskCount, 0); assert.equal(pause.impactedTaskCount, 2);
  await addAttempt(projectId, a.operatorId, seeded[0]!);
  assert.equal((await pool.query(`SELECT state,execution_allowed,publication_allowed FROM ${s}.business_plan_outbox WHERE task_id=$1`, [seeded[0]!.taskId])).rows[0]!.state, "pending_current_checks");
  const endMetadata = metadata(), request = { metadata: endMetadata, expectedLifecycleRevision: 1, intent: "end" };
  const end = await service.setIntent(a.sessionToken, a.csrfToken, projectId, request);
  assert.equal(end.intent, "end_requested"); assert.equal(end.cancelledTaskCount, 1); assert.equal(end.impactedTaskCount, 2);
  const replay = await service.setIntent(a.sessionToken, a.csrfToken, projectId, request);
  assert.deepEqual(replay, { ...end, changed: false, replayed: true });
  assert.deepEqual(await service.read(a.sessionToken, projectId), { projectId, lifecycleRevision: 2, intent: "end_requested", requestId: endMetadata.requestId, recordedAt: end.recordedAt });
  assert.equal((await pool.query(`SELECT source_request_id FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [seeded[1]!.taskId])).rows[0]!.source_request_id, endMetadata.requestId);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [seeded[0]!.taskId])).rows[0]!.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [seeded[1]!.taskId])).rows[0]!.count, 1);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_outbox_impacts WHERE task_id=$1`, [seeded[1]!.taskId])).rows[0]!.count, 2);
  await assert.rejects(service.setIntent(a.sessionToken, a.csrfToken, projectId, { metadata: metadata(), expectedLifecycleRevision: 2, intent: "resume" }), expectedError("FACT_VERSION_STALE"));
});

test("material withdrawal binds the exact current revision and does not touch another variant", async () => {
  const a = await actor(), projectId = await project(a.operatorId), [withdrawn, kept] = await tasks(projectId, a.operatorId, 2);
  const request = { metadata: metadata(), expectedMaterialRevision: 1 };
  const result = await service.withdrawMaterial(a.sessionToken, a.csrfToken, projectId, withdrawn!.variantId, request);
  assert.equal(result.materialRevision, 1); assert.equal(result.impactedTaskCount, 1); assert.equal(result.cancelledTaskCount, 1);
  const replay = await service.withdrawMaterial(a.sessionToken, a.csrfToken, projectId, withdrawn!.variantId, request);
  assert.deepEqual(replay, { ...result, changed: false, replayed: true });
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [withdrawn!.taskId])).rows[0]!.count, 1);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [kept!.taskId])).rows[0]!.count, 0);
  await assert.rejects(service.withdrawMaterial(a.sessionToken, a.csrfToken, projectId, kept!.variantId,
    { metadata: metadata(), expectedMaterialRevision: 2 }), expectedError("FACT_VERSION_STALE"));
});

test("session expiry during terminal cancellation append rolls back source, impact, cancellation, receipt and audit", async () => {
  const a = await actor(), projectId = await project(a.operatorId), [task] = await tasks(projectId, a.operatorId, 1);
  await pool.query(`CREATE FUNCTION ${s}.test_delay_lifecycle_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2.5); RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER test_delay_lifecycle_cancellation BEFORE INSERT ON ${s}.business_plan_task_cancellations FOR EACH ROW EXECUTE FUNCTION ${s}.test_delay_lifecycle_cancellation()`);
  try {
    await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE session_id=$1`, [a.sessionId]);
    await assert.rejects(service.setIntent(a.sessionToken, a.csrfToken, projectId,
      { metadata: metadata(), expectedLifecycleRevision: 0, intent: "end" }), expectedError("AUTHENTICATION_REQUIRED"));
  } finally {
    await pool.query(`DROP TRIGGER test_delay_lifecycle_cancellation ON ${s}.business_plan_task_cancellations`);
    await pool.query(`DROP FUNCTION ${s}.test_delay_lifecycle_cancellation()`);
  }
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.project_lifecycle_intents WHERE project_id=$1`, [projectId])).rows[0]!.count, 0);
  assert.equal((await pool.query(`SELECT current_impact_revision FROM ${s}.business_plan_outbox WHERE task_id=$1`, [task!.taskId])).rows[0]!.current_impact_revision, "0");
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_task_cancellations WHERE task_id=$1`, [task!.taskId])).rows[0]!.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.business_plan_commands WHERE project_id=$1`, [projectId])).rows[0]!.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${s}.audit_records WHERE request_id IS NOT NULL AND actor_id=$1`, [a.operatorId])).rows[0]!.count, 0);
});
