import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import type { BusinessPlanWorkflowScope } from "@socialgrowth/product-contracts";
import { BusinessPlanWorkflowStore, BusinessPlanWorkflowConsumer } from "./business-plan-workflow-store.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Workflow store requires owned isolated reset-authorized PostgreSQL");
const pool = new Pool({ connectionString: url, max: 8 });
const store = new BusinessPlanWorkflowStore(pool);
const uuid = () => randomUUID();
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map(key => JSON.stringify(key) + ":" + stable(obj[key])).join(",") + "}";
}
const fingerprint = (scope: BusinessPlanWorkflowScope) => createHash("sha256").update(stable(scope)).digest("hex");
const scope = (taskId = uuid(), taskAttemptId = uuid()): BusinessPlanWorkflowScope => ({
  projectId: uuid(), taskId, taskRevision: 1, planId: uuid(), planRevision: 1, projectVersion: 1, approvalId: uuid(),
  contentUnitId: uuid(), variantId: uuid(), materialRevision: 1,
  expectedFiles: [{ objectId: uuid(), sha256: "a".repeat(64), bytes: 128, contentType: "video/mp4" }],
  taskAttemptId, identityId: uuid(), reservedDeviceId: uuid(), platform: "facebook", form: "facebook_video", scheduledAt: "2090-01-01T00:00:00.000Z",
});
async function addTask(value: BusinessPlanWorkflowScope) {
  await pool.query("INSERT INTO socialgrowth_product.projects(project_id) VALUES($1)", [value.projectId]);
  await pool.query("INSERT INTO socialgrowth_product.project_direction_approvals(approval_id) VALUES($1)", [value.approvalId]);
  await pool.query(`INSERT INTO socialgrowth_product.business_plan_tasks(task_id,project_id,plan_id,plan_revision,task_revision,content_unit_id,
    variant_id,material_revision,identity_id,platform,form,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [value.taskId,value.projectId,value.planId,value.planRevision,value.taskRevision,value.contentUnitId,value.variantId,value.materialRevision,value.identityId,value.platform,value.form,value.scheduledAt]);
  await pool.query(`INSERT INTO socialgrowth_product.business_plan_task_attempts(task_attempt_id,task_id,project_id,plan_id,plan_revision,project_version,
    approval_id,task_revision,content_unit_id,variant_id,material_revision,verifier_manifest,identity_id,platform,reserved_device_id,attempt_origin,
    triggering_operator_id,plan_approval_id,recorded_by_operator_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'legacy_operator_request',NULL,NULL,$16)`,
  [value.taskAttemptId,value.taskId,value.projectId,value.planId,value.planRevision,value.projectVersion,value.approvalId,value.taskRevision,
    value.contentUnitId,value.variantId,value.materialRevision,JSON.stringify(value.expectedFiles),value.identityId,value.platform,value.reservedDeviceId,uuid()]);
}
const ready = (value: BusinessPlanWorkflowScope) => ({ adapterState: "connected" as const, businessState: "ready" as const,
  scopeFingerprint: fingerprint(value), blockers: [] as string[] });

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  await pool.query(`CREATE SCHEMA socialgrowth_product;
    CREATE TABLE socialgrowth_product.operators(operator_id uuid PRIMARY KEY);
    CREATE TABLE socialgrowth_product.projects(project_id uuid PRIMARY KEY);
    CREATE TABLE socialgrowth_product.project_direction_approvals(approval_id uuid PRIMARY KEY);
    CREATE TABLE socialgrowth_product.business_plan_tasks(task_id uuid PRIMARY KEY,project_id uuid NOT NULL,plan_id uuid NOT NULL,plan_revision bigint NOT NULL,
      task_revision bigint NOT NULL,content_unit_id uuid NOT NULL,variant_id uuid NOT NULL,material_revision bigint NOT NULL,identity_id uuid NOT NULL,
      platform text NOT NULL,form text NOT NULL,scheduled_at text NOT NULL,UNIQUE(project_id,task_id));
    CREATE TABLE socialgrowth_product.business_plan_task_attempts(task_attempt_id uuid PRIMARY KEY,task_id uuid UNIQUE NOT NULL,project_id uuid NOT NULL,
      plan_id uuid NOT NULL,plan_revision bigint NOT NULL,project_version bigint NOT NULL,approval_id uuid NOT NULL,task_revision bigint NOT NULL,
      content_unit_id uuid NOT NULL,variant_id uuid NOT NULL,material_revision bigint NOT NULL,verifier_manifest jsonb NOT NULL,identity_id uuid NOT NULL,
      platform text NOT NULL,reserved_device_id uuid NOT NULL,recorded_by_operator_id uuid NOT NULL);
    CREATE FUNCTION socialgrowth_product.business_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable'; END$$;`);
  const migration = await readFile(new URL("../migrations/0041_business_plan_workflow.sql", import.meta.url), "utf8");
  await pool.query(migration);
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });

test("scope is matched to the persisted attempt; claims are single-winner and trusted verification is required", async () => {
  const value = scope(); await addTask(value);
  const job = await store.materialize(value, ready(value));
  assert.equal(job.state, "queued");
  const claims = await Promise.all([store.claim(value.taskId,"worker-a"), store.claim(value.taskId,"worker-b")]);
  const won = claims.filter(Boolean); assert.equal(won.length, 1);
  const claim = won[0]!; assert.ok(claim.claimId); assert.equal(claim.originalClaimId, claim.claimId);
  const started = await store.startOperation(value.taskId, claim.claimId!, fingerprint(value)); assert.ok(started);
  const sourceEventId=uuid();
  await store.recordObservation(value.taskId, started!.operationId, { sourceEventId, payloadDigest: "b".repeat(64), reportedState: "submitted" });
  await assert.rejects(() => store.recordObservation(value.taskId, started!.operationId,
    { sourceEventId, payloadDigest: "f".repeat(64), reportedState: "failed" }), /EVENT_CONFLICT/);
  assert.equal((await store.readTask(value.taskId))?.state, "submission_unknown");
  const proof = { verificationEventId: uuid(), payloadDigest: "c".repeat(64), decision: "verified_published" as const,
    resultId: "platform-record-1", verifiedAt: new Date().toISOString() };
  const verified = await store.applyTrustedVerification(value.taskId, started!.operationId, proof);
  assert.equal(verified.state, "verified");
  assert.equal((await store.applyTrustedVerification(value.taskId, started!.operationId, proof)).state,"verified");
  await assert.rejects(() => store.applyTrustedVerification(value.taskId, started!.operationId,
    { verificationEventId:uuid(),payloadDigest:"f".repeat(64),decision:"unknown",resultId:null,verifiedAt:null }),/EVENT_CONFLICT/);
  assert.equal((await store.readTask(value.taskId))?.state,"verified");
  const mismatched={...value,reservedDeviceId:uuid()};
  await assert.rejects(() => store.materialize(mismatched,ready(mismatched)), /SCOPE_CHANGED/);
});

test("ready ports carrying blockers cannot create a dispatchable queue row", async () => {
  const value=scope(); await addTask(value);
  const job=await store.materialize(value,{...ready(value),blockers:["material_missing"]});
  assert.equal(job.state,"blocked"); assert.ok(job.blockers.includes("material_missing"));
  assert.equal(await store.claim(value.taskId,"must-not-dispatch"),null);
});

test("a new readiness blocker before dispatch or per-action permit fails closed", async () => {
  const beforeDispatch=scope(); await addTask(beforeDispatch); await store.materialize(beforeDispatch,ready(beforeDispatch));
  let checks=0, dispatches=0;
  const changedReadiness={assess:async(value:BusinessPlanWorkflowScope)=>++checks===1?ready(value):{...ready(value),blockers:["scope_changed"]}};
  const consumer=new BusinessPlanWorkflowConsumer(store,{readiness:changedReadiness,actionGate:{authorizeAction:async()=>{dispatches++;return null;}},
    executor:{execute:async()=>{dispatches++;return {sourceEventId:uuid(),payloadDigest:"1".repeat(64),reportedState:"unknown"};}},proofVerifier:null});
  assert.equal((await consumer.runOnce(beforeDispatch,"worker-check"))?.state,"blocked"); assert.equal(dispatches,0);

  const perAction=scope(); await addTask(perAction); await store.materialize(perAction,ready(perAction));
  let actionChecks=0, permits=0, actions=0;
  const actionConsumer=new BusinessPlanWorkflowConsumer(store,{readiness:{assess:async(value:BusinessPlanWorkflowScope)=>
    ++actionChecks<=2?ready(value):{...ready(value),blockers:["permit_scope_changed"]}},
    actionGate:{authorizeAction:async()=>{permits++;return {permitId:uuid(),scopeFingerprint:fingerprint(perAction),expiresAt:new Date(Date.now()+5000).toISOString()};}},
    executor:{execute:async({authorizeAction})=>{if(await authorizeAction("submit")) actions++;
      return {sourceEventId:uuid(),payloadDigest:"2".repeat(64),reportedState:"unknown"};}},
    proofVerifier:{verifyOriginal:async()=>({verificationEventId:uuid(),payloadDigest:"3".repeat(64),decision:"unknown",resultId:null,verifiedAt:null})}});
  assert.equal((await actionConsumer.runOnce(perAction,"worker-action"))?.state,"submission_unknown");
  assert.equal(permits,0); assert.equal(actions,0);
});

test("an expired pre-operation claim is retained for read-only reconciliation and is never redispatched", async () => {
  const value = scope(); await addTask(value);
  await store.materialize(value, ready(value));
  const claim = await store.claim(value.taskId,"worker-expiring",1000); assert.ok(claim?.claimId);
  await new Promise(resolve => setTimeout(resolve, 1200));
  const held = await store.expireLease(value.taskId);
  assert.equal(held?.state,"blocked"); assert.equal(held?.operationId,null);
  assert.equal(held?.originalClaimId,claim!.claimId);
  assert.equal(await store.claim(value.taskId,"worker-again"),null);
  let dispatches=0, reconciles=0;
  const consumer = new BusinessPlanWorkflowConsumer(store,{readiness:{assess:async()=>ready(value)},actionGate:{authorizeAction:async()=>null},
    executor:{execute:async()=>{dispatches++;return {sourceEventId:uuid(),payloadDigest:"d".repeat(64),reportedState:"unknown"};}},
    proofVerifier:{verifyOriginal:async()=>({verificationEventId:uuid(),payloadDigest:"e".repeat(64),decision:"unknown",resultId:null,verifiedAt:null})},
    originalAttemptReconciler:{reconcileOriginalAttempt:async input=>{reconciles++;assert.equal(input.claimId,claim!.claimId);return {outcome:"not_found"};}}});
  const reconciled = await consumer.runOnce(value,"worker-reconcile");
  assert.equal(reconciled?.state,"blocked"); assert.equal(dispatches,0); assert.equal(reconciles,1);
});
