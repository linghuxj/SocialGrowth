import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { contractVersion, emptyProjectPlanningInputs, type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { BusinessPlanService } from "./business-plan-service.js";
import { MaterialRegistryStore } from "./material-registry-store.js";
import { materialDeclarationSchema } from "./material-registry-core.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { MaterialRuntime } from "./material-runtime.js";
import { ProjectService } from "./project-service.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { ProjectDirectionService } from "./project-direction-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { BusinessPlanController } from "./business-plan.controller.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
import type { BusinessModelPort } from "./business-model-coordinator.js";
import type { BusinessSuggestionContext } from "./business-suggestion-core.js";
import { parseContentQuota } from "./content-quota-core.js";
import type { InitialDirectionModel } from "./artemis-business-model.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires owned isolated reset-authorized PostgreSQL");
const pool = new Pool({ connectionString: url, max: 8 });
const auth = new OperatorAuthService(pool, "isolated-business-plan-pepper-only-00001");
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `business-plan-${randomUUID()}` });
const error = (code: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === code;

class CurrentChecksHttpFixtureModule {}

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });

async function approvedProject(identityRef = `synthetic_page_${randomUUID().replaceAll("-", "")}`,
  publishingWindow = { startsAt: "2090-01-01T00:00:00Z", endsAt: "2090-02-01T00:00:00Z" }) {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Plan fixture','not-a-password','active')", [operatorId, `fixture-${operatorId}`]);
  await pool.query("INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')", [sessionId, operatorId, digest(token), digest(csrf)]);
  const projects = new ProjectService(pool, auth), planning = new ProjectPlanningService(pool, auth), directions = new ProjectDirectionService(pool, auth, directionModel);
  const project = (await projects.save(token, csrf, { metadata: metadata(), basics: { name: `Plan-${randomUUID()}`, kind: "company_owned", customerName: null,
    ownerOperatorId: operatorId, notificationEmail: null } }, "create")).project;
  const inputs: ProjectPlanningInputs = { ...emptyProjectPlanningInputs(), preOpeningGoal: "Synthetic preparation", postOpeningGoal: "Synthetic retention",
    postOpeningPriority: "balanced", targetCountries: ["US"], targetLanguages: ["en"], contentForms: ["facebook_video"],
    contentRules: "Synthetic candidate only; no publication", businessTimeZone: "America/Los_Angeles", firstCycleStartsAt: "2090-01-01T00:00:00Z",
    reviewIntervalDays: 7, trafficMinimumPerCycle: 0, observationWindowHours: 24, tailObservationDays: 0, maxPublicationsPerDay: 1,
    publishingWindow };
  const draft = (await planning.save(token, csrf, { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: 0,
    expectedDraftVersion: 0, inputs })).draft;
  const generation = { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion,
    identities: [{ platform: "facebook" as const, canonicalRef: identityRef, declaredStage: "before_monetization" as const }] };
  const proposal = (await directions.generate(token, csrf, generation)).proposal;
  assert.ok(proposal);
  const approval = await directions.confirm(token, csrf, { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: proposal.projectVersion,
    proposalId: proposal.proposalId, snapshotDigest: proposal.snapshotDigest });
  assert.ok(approval.approval);
  return { token, csrf, operatorId, projectId: project.projectId, identityRef,
    service: new BusinessPlanService(pool, auth, new MaterialRuntime(pool, auth, null), planModel) };
}

const directionModel: InitialDirectionModel = { generateDirection: async () => ({ providerKey: "synthetic-port", modelKey: "fixture-direction",
  responseId: randomUUID(), output: { direction: "Synthetic bounded direction", rationale: "Test fixture only", limitations: ["No business acceptance"] } }) };
let arrangementCalls = 0;
let arrangementGate: Promise<void> | null = null;
let gateEntries = 0;
let notifyBothModelsStarted = () => {};
const confirmationSuggestion = (context: BusinessSuggestionContext) => ({ suggestionId: randomUUID(), projectId: context.projectId,
  factSetId: context.factSetId, factSetVersion: context.factSetVersion, approval: context.approval,
  basis: [{ factId: context.approval!.approvalId, version: context.factSetVersion }], explanation: "Synthetic confirmation boundary",
  limitations: ["Fixture only", "No tasks or posting"], decision: "requires_operator_confirmation", proposedDirection: "Synthetic direction change proposal" });
let makeArrangement: (context: BusinessSuggestionContext) => unknown = confirmationSuggestion;
const planModel: BusinessModelPort & { describe(signal: AbortSignal): Promise<{ providerKey: string; modelKey: string }> } = {
  describe: async () => ({ providerKey: "synthetic-port", modelKey: "fixture-plan" }),
  generate: async (request, _signal) => {
    arrangementCalls++;
    if (arrangementGate) {
      gateEntries++;
      if (gateEntries === 2) notifyBothModelsStarted();
      await arrangementGate;
    }
    const context = request.input.context;
    return { responseId: randomUUID(), outputText: JSON.stringify(makeArrangement(context)) };
  },
};

async function seedCandidateMaterial(f: Awaited<ReturnType<typeof approvedProject>>) {
  const accountId = randomUUID(), identityId = randomUUID(), deviceId = randomUUID(), contentUnitId = randomUUID(), variantId = randomUUID();
  const objectId = randomUUID(), sourceId = randomUUID(), sourceRecordId = randomUUID(), businessEntityId = randomUUID();
  const object = { storageLocationId: randomUUID(), storageBindingDigest: "a".repeat(64), projectId: f.projectId, objectId,
    key: `projects/${f.projectId}/objects/${objectId}`, sha256: randomBytes(32).toString("hex"), bytes: 128, contentType: "video/mp4" };
  const identity = { mediaKind: "video" as const, businessKind: "product" as const, businessEntityId, seriesId: null, episodeNumber: null };
  const current = await f.service.read(f.token, f.projectId);
  const declaration = materialDeclarationSchema.parse({ name: "Synthetic fixture material", description: "No external claim", businessFacts: "Fixture only",
    sourceStatement: "Synthetic isolated material", sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published",
    expectedApprovedDirectionId: current.currentScope.approvalId,
    expectedApprovedProjectVersion: current.currentScope.projectVersion, contentRulesReviewed: true });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Synthetic reserved device','unassociated')`, [deviceId]);
    await c.query(`INSERT INTO socialgrowth_product.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, f.identityRef]);
    await c.query(`INSERT INTO socialgrowth_product.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`, [identityId, accountId, f.identityRef]);
    await c.query(`INSERT INTO socialgrowth_product.project_device_reservations(device_id,project_id) VALUES($1,$2)`, [deviceId, f.projectId]);
    await c.query(`INSERT INTO socialgrowth_product.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, f.projectId]);
    await c.query(`INSERT INTO socialgrowth_product.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id)
      VALUES($1,$2,'facebook',$3,$4,$5)`, [identityId, accountId, deviceId, f.projectId, f.operatorId]);
    await c.query(`INSERT INTO socialgrowth_product.material_content_units(content_unit_id,project_id,source_id,source_record_id,identity) VALUES($1,$2,$3,$4,$5)`,
      [contentUnitId, f.projectId, sourceId, sourceRecordId, JSON.stringify(identity)]);
    await c.query(`INSERT INTO socialgrowth_product.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [objectId, f.projectId, JSON.stringify(object)]);
    await c.query(`INSERT INTO socialgrowth_product.material_variants(variant_id,content_unit_id,project_id,language_tag,current_revision) VALUES($1,$2,$3,'en',1)`, [variantId, contentUnitId, f.projectId]);
    await c.query(`INSERT INTO socialgrowth_product.material_variant_revisions(variant_id,revision,declaration,object_references,recorded_by_operator_id,recorded_at)
      VALUES($1,1,$2,$3,$4,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`,
      [variantId, JSON.stringify(declaration), JSON.stringify([object]), f.operatorId]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  const registry = new MaterialRegistryStore(pool, auth, null);
  const checkClient = await pool.connect();
  try {
    const material = await registry.listCurrentForBusinessPlan(checkClient, f.projectId);
    assert.equal(material.length, 1); assert.equal(material[0]?.candidateAllowed, true, `reason=${material[0]?.eligibilityReason}`); assert.equal(material[0]?.eligibilityReason, null);
  } finally { checkClient.release(); }
  f.service = new BusinessPlanService(pool, auth, { registry: () => registry } as unknown as MaterialRuntime, planModel);
  return { contentUnitId, variantId, identityId, sourceId, sourceRecordId, identity, object, declaration };
}

async function seedOutOfScopeIdentity(f: Awaited<ReturnType<typeof approvedProject>>) {
  const accountId = randomUUID(), identityId = randomUUID(), deviceId = randomUUID(), ref = `synthetic_unapproved_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Synthetic out-of-scope device','unassociated')`, [deviceId]);
  await pool.query(`INSERT INTO socialgrowth_product.media_accounts(account_id,platform,canonical_account_ref) VALUES($1,'facebook',$2)`, [accountId, ref]);
  await pool.query(`INSERT INTO socialgrowth_product.publishing_identities(identity_id,account_id,platform,canonical_identity_ref) VALUES($1,$2,'facebook',$3)`, [identityId, accountId, ref]);
  await pool.query(`INSERT INTO socialgrowth_product.project_device_reservations(device_id,project_id) VALUES($1,$2)`, [deviceId, f.projectId]);
  await pool.query(`INSERT INTO socialgrowth_product.project_account_reservations(account_id,project_id) VALUES($1,$2)`, [accountId, f.projectId]);
  await pool.query(`INSERT INTO socialgrowth_product.project_identity_reservations(identity_id,account_id,platform,device_id,project_id,reserved_by_operator_id)
    VALUES($1,$2,'facebook',$3,$4,$5)`, [identityId, accountId, deviceId, f.projectId, f.operatorId]);
  return identityId;
}

test("plan persistence replays exact command once and never promotes advisory to Task or action", async () => {
  arrangementCalls = 0;
  const f = await approvedProject(), initial = await f.service.read(f.token, f.projectId);
  assert.equal(initial.plan, null); assert.deepEqual(initial.tasks, []); assert.equal(initial.executionAllowed, false); assert.equal(initial.publicationAllowed, false);
  const request = { metadata: metadata(), expectedProjectVersion: initial.currentScope.projectVersion,
    expectedApprovalId: initial.currentScope.approvalId!, expectedPlanRevision: 0 };
  const first = await f.service.arrange(f.token, f.csrf, f.projectId, request);
  assert.equal(first.outcome, "direction_confirmation_required"); assert.equal(first.plan?.revision, 1); assert.deepEqual(first.tasks, []);
  assert.equal(first.executionAllowed, false); assert.equal(first.publicationAllowed, false);
  const replay = await f.service.arrange(f.token, f.csrf, f.projectId, request);
  assert.deepEqual(replay, first); assert.equal(arrangementCalls, 1);
  const otherProject = await approvedProject();
  await assert.rejects(f.service.arrange(f.token, f.csrf, otherProject.projectId, request), error("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(f.service.arrange(f.token, "", f.projectId, request), error("AUTHENTICATION_REQUIRED"));
  await assert.rejects(f.service.arrange(f.token, f.csrf, f.projectId, { ...request, expectedPlanRevision: 1 }), error("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual((await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.business_plan_revisions WHERE project_id=$1) revisions,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_tasks WHERE project_id=$1) tasks,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox WHERE project_id=$1) outbox,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_commands WHERE project_id=$1) commands`, [f.projectId])).rows[0], { revisions: 1, tasks: 0, outbox: 0, commands: 1 });
});

test("concurrent arrangements against one expected revision cannot both become current", async () => {
  arrangementCalls = 0; gateEntries = 0;
  const f = await approvedProject(), initial = await f.service.read(f.token, f.projectId);
  let release!: () => void;
  arrangementGate = new Promise<void>(resolve => { release = resolve; });
  const bothStarted = new Promise<void>(resolve => { notifyBothModelsStarted = resolve; });
  const base = { expectedProjectVersion: initial.currentScope.projectVersion, expectedApprovalId: initial.currentScope.approvalId!, expectedPlanRevision: 0 };
  const first = f.service.arrange(f.token, f.csrf, f.projectId, { ...base, metadata: metadata() });
  const second = f.service.arrange(f.token, f.csrf, f.projectId, { ...base, metadata: metadata() });
  await bothStarted; release(); arrangementGate = null;
  const results = await Promise.allSettled([first, second]);
  const fulfilled = results.filter(r => r.status === "fulfilled"), rejected = results.filter(r => r.status === "rejected");
  assert.equal(fulfilled.length, 1); assert.equal(rejected.length, 1); assert.equal(arrangementCalls, 2);
  assert.ok(rejected[0]!.status === "rejected" && error("FACT_VERSION_STALE")(rejected[0].reason));
  assert.deepEqual((await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.business_plan_revisions WHERE project_id=$1) revisions,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_commands WHERE project_id=$1) commands,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_tasks WHERE project_id=$1) tasks,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox WHERE project_id=$1) outbox`, [f.projectId])).rows[0],
  { revisions: 1, commands: 1, tasks: 0, outbox: 0 });
});

function scheduleSuggestion(context: BusinessSuggestionContext) {
  const material = context.materials[0]!, identity = parseContentQuota(context.quota).identities[0]!;
  return { suggestionId: randomUUID(), projectId: context.projectId, factSetId: context.factSetId, factSetVersion: context.factSetVersion,
    approval: context.approval, basis: context.facts.filter(f => f.availability === "available").map(f => ({ factId: f.factId, version: f.version })),
    explanation: "Synthetic scheduled candidate", limitations: ["Isolated fixture", "Not a real model decision", "No execution or publication"],
    decision: "adjust", changes: [{ kind: "schedule", publication: { taskId: randomUUID(), contentUnitId: material.contentUnitId,
      variantId: material.variantId, identityId: identity.identityId, form: "facebook_video", scheduledAt: "2090-01-02T12:00:00Z",
      title: "Synthetic candidate title", caption: "Synthetic candidate caption" } }] };
}
async function planRowCounts(projectId: string) {
  return (await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.business_plan_revisions WHERE project_id=$1) revisions,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_tasks WHERE project_id=$1) tasks,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox WHERE project_id=$1) outbox,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_commands WHERE project_id=$1) commands,
    (SELECT count(*)::int FROM socialgrowth_product.audit_records WHERE object_type='business_plan' AND object_id=$1) audits`, [projectId])).rows[0];
}

async function currentChecksOverHttp(service: BusinessPlanService, projectId: string, token: string) {
  const app = await NestFactory.create({ module: CurrentChecksHttpFixtureModule,
    controllers: [BusinessPlanController], providers: [{ provide: BusinessPlanService, useValue: service }] }, { logger: false });
  app.useGlobalFilters(new ProductExceptionFilter());
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/api/operator/projects/${projectId}/business-plan/current-checks`;
    const response = await fetch(url, { headers: { cookie: `__Host-sg_operator_session=${token}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as { tasks: Array<{ taskId: string; expectedFiles: Array<{ sha256: string }> }>; executionAllowed: boolean; publicationAllowed: boolean };
    assert.equal(body.executionAllowed, false); assert.equal(body.publicationAllowed, false);
    const denied = await fetch(url);
    assert.equal(denied.status, 401);
    return body;
  } finally { await app.close(); }
}

test("material-backed schedule atomically persists current-scope plan, Task, quota slot and check-reference outbox", async () => {
  arrangementCalls = 0; arrangementGate = null; makeArrangement = scheduleSuggestion;
  const f = await approvedProject(), material = await seedCandidateMaterial(f), current = await f.service.read(f.token, f.projectId);
  const request = { metadata: metadata(), expectedProjectVersion: current.currentScope.projectVersion,
    expectedApprovalId: current.currentScope.approvalId!, expectedPlanRevision: 0 };
  const response = await f.service.arrange(f.token, f.csrf, f.projectId, request);
  assert.equal(response.outcome, "planned"); assert.equal(response.plan?.scopeState, "current"); assert.equal(response.tasks.length, 1);
  assert.equal(response.tasks[0]?.contentUnitId, material.contentUnitId); assert.equal(response.tasks[0]?.variantId, material.variantId);
  assert.equal(response.tasks[0]?.state, "pending_current_checks"); assert.equal(response.executionAllowed, false); assert.equal(response.publicationAllowed, false);
  const rows = (await pool.query(`SELECT t.task_id,t.state,t.execution_allowed,t.publication_allowed,o.purpose,o.state outbox_state,
      o.execution_allowed outbox_execution_allowed,o.publication_allowed outbox_publication_allowed,r.quota_snapshot
    FROM socialgrowth_product.business_plan_tasks t JOIN socialgrowth_product.business_plan_outbox o USING(project_id,task_id)
    JOIN socialgrowth_product.business_plan_revisions r ON r.project_id=t.project_id AND r.revision=t.plan_revision AND r.plan_id=t.plan_id WHERE t.project_id=$1`, [f.projectId])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0]!.state, "pending_current_checks"); assert.equal(rows[0]!.execution_allowed, false);
  assert.equal(rows[0]!.publication_allowed, false); assert.equal(rows[0]!.purpose, "current_check_reference");
  assert.equal(rows[0]!.outbox_state, "pending_current_checks"); assert.equal(rows[0]!.outbox_execution_allowed, false); assert.equal(rows[0]!.outbox_publication_allowed, false);
  assert.equal(rows[0]!.quota_snapshot.slots.length, 1); assert.equal(rows[0]!.quota_snapshot.slots[0].taskId, rows[0]!.task_id);
  const checks = await f.service.currentChecks(f.token, f.projectId);
  assert.equal(checks.tasks.length, 1); assert.equal(checks.tasks[0]?.taskId, rows[0]!.task_id);
  assert.equal(checks.tasks[0]?.expectedMaterialRevision, 1); assert.equal(checks.tasks[0]?.current.materialRevision, 1);
  assert.deepEqual(checks.tasks[0]?.expectedFiles, [{ objectId: material.object.objectId, sha256: material.object.sha256,
    bytes: material.object.bytes, contentType: material.object.contentType }]);
  assert.deepEqual(checks.tasks[0]?.currentFiles, checks.tasks[0]?.expectedFiles);
  assert.ok(checks.tasks[0]?.blockers.includes("action_inspector_unavailable"));
  assert.ok(checks.tasks[0]?.blockers.includes("device_association_missing"));
  assert.ok(checks.tasks[0]?.blockers.includes("current_fact_unknown"));
  assert.deepEqual(checks.tasks[0]?.impactReferences, []);
  assert.equal(checks.executionAllowed, false); assert.equal(checks.publicationAllowed, false);
  const httpChecks = await currentChecksOverHttp(f.service, f.projectId, f.token);
  assert.deepEqual(httpChecks.tasks[0]?.expectedFiles, checks.tasks[0]?.expectedFiles);
  const providerId = randomUUID(), installationId = randomUUID(), associationSessionId = randomUUID(), associationId = randomUUID();
  const reservedDeviceId = checks.tasks[0]!.current.reservedDeviceId!;
  await pool.query(`INSERT INTO socialgrowth_product.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Generation fixture','active')`,
    [providerId, `+1${String(100_000_000 + (randomBytes(4).readUInt32BE(0) % 900_000_000))}`]);
  await pool.query(`INSERT INTO socialgrowth_product.installations(installation_id,credential_digest,generation,status) VALUES($1,$2,1,'active')`,
    [installationId, randomBytes(32)]);
  await pool.query(`INSERT INTO socialgrowth_product.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at,consumed_at,consumed_by_provider_id)
    VALUES($1,$2,1,'Current generation fixture',$3,clock_timestamp()+interval '1 day',clock_timestamp(),$4)`,
    [associationSessionId, installationId, randomBytes(32), providerId]);
  await pool.query(`UPDATE socialgrowth_product.devices SET state='associated_pending_access' WHERE device_id=$1`, [reservedDeviceId]);
  await pool.query(`INSERT INTO socialgrowth_product.device_associations(association_id,device_id,installation_id,provider_id,association_session_id)
    VALUES($1,$2,$3,$4,$5)`, [associationId, reservedDeviceId, installationId, providerId, associationSessionId]);
  const currentGeneration = await f.service.currentChecks(f.token, f.projectId);
  assert.equal(currentGeneration.tasks[0]?.current.associationCurrent, true);
  assert.equal(currentGeneration.tasks[0]?.current.installationGeneration, "1");
  assert.ok(!currentGeneration.tasks[0]?.blockers.includes("device_association_missing"));
  await pool.query(`UPDATE socialgrowth_product.installations SET generation=2 WHERE installation_id=$1`, [installationId]);
  const staleGeneration = await f.service.currentChecks(f.token, f.projectId);
  assert.equal(staleGeneration.tasks[0]?.current.associationCurrent, false);
  assert.equal(staleGeneration.tasks[0]?.current.installationGeneration, "2");
  assert.ok(staleGeneration.tasks[0]?.blockers.includes("device_association_missing"));
  assert.deepEqual(await planRowCounts(f.projectId), { revisions: 1, tasks: 1, outbox: 1, commands: 1, audits: 1 });
  makeArrangement = confirmationSuggestion;
});

test("project and material mutations append idempotent impact references in their source transactions", async () => {
  arrangementCalls = 0; arrangementGate = null; makeArrangement = scheduleSuggestion;
  const f = await approvedProject(), material = await seedCandidateMaterial(f), beforePlan = await f.service.read(f.token, f.projectId);
  const arranged = await f.service.arrange(f.token, f.csrf, f.projectId, { metadata: metadata(),
    expectedProjectVersion: beforePlan.currentScope.projectVersion, expectedApprovalId: beforePlan.currentScope.approvalId!, expectedPlanRevision: 0 });
  assert.equal(arranged.tasks.length, 1);
  const taskId = arranged.tasks[0]!.taskId;
  const impactState = async () => (await pool.query(`SELECT o.current_impact_revision::int head,
      count(i.impact_revision)::int impacts, array_agg(i.reason ORDER BY i.impact_revision) FILTER (WHERE i.reason IS NOT NULL) reasons,
      array_agg(i.impact_revision::int ORDER BY i.impact_revision) FILTER (WHERE i.impact_revision IS NOT NULL) revisions
    FROM socialgrowth_product.business_plan_outbox o LEFT JOIN socialgrowth_product.business_plan_outbox_impacts i USING(task_id)
    WHERE o.task_id=$1 GROUP BY o.current_impact_revision`, [taskId])).rows[0];
  assert.deepEqual(await impactState(), { head: 0, impacts: 0, reasons: null, revisions: null });

  const materialMetadata = { metadata: metadata() };
  const materialRequest = { ...materialMetadata, projectId: f.projectId, contentUnitId: material.contentUnitId, sourceId: material.sourceId,
    sourceRecordId: material.sourceRecordId, identity: material.identity, variantId: material.variantId, languageTag: "en", expectedCurrentRevision: 1,
    declaration: materialDeclarationSchema.parse({ ...material.declaration, name: "Corrected isolated declaration",
      expectedApprovedDirectionId: beforePlan.currentScope.approvalId, expectedApprovedProjectVersion: beforePlan.currentScope.projectVersion,
      contentRulesReviewed: true }), objectIds: [material.object.objectId] };
  const registry = new MaterialRegistryStore(pool, auth, { verify: async () => [material.object] });
  const saved = await registry.save(f.token, f.csrf, materialRequest);
  assert.equal(saved.currentRevision, 2); assert.equal(saved.changed, true); assert.equal(saved.replayed, false);
  assert.deepEqual(await impactState(), { head: 1, impacts: 1, reasons: ["material_revision_changed"], revisions: [1] });
  const afterMaterialImpact = await f.service.currentChecks(f.token, f.projectId);
  assert.deepEqual(afterMaterialImpact.tasks[0]?.impactReferences.map(ref => ref.reason), ["material_revision_changed"]);
  assert.equal(afterMaterialImpact.tasks[0]?.expectedFiles[0]?.sha256, material.object.sha256);
  assert.equal(afterMaterialImpact.tasks[0]?.currentFiles?.[0]?.sha256, material.object.sha256);
  assert.ok(afterMaterialImpact.tasks[0]?.blockers.includes("material_revision_changed"));
  assert.deepEqual((await pool.query(`SELECT reason,source_version::int,observed_project_version::int,observed_material_revision::int
    FROM socialgrowth_product.business_plan_outbox_impacts WHERE task_id=$1`, [taskId])).rows,
  [{ reason: "material_revision_changed", source_version: 2, observed_project_version: beforePlan.currentScope.projectVersion, observed_material_revision: 2 }]);
  const materialReplay = await registry.save(f.token, f.csrf, materialRequest);
  assert.equal(materialReplay.replayed, true); assert.equal(materialReplay.changed, false);
  assert.deepEqual(await impactState(), { head: 1, impacts: 1, reasons: ["material_revision_changed"], revisions: [1] });

  const projects = new ProjectService(pool, auth);
  const currentProject = (await pool.query<{ project_id: string; name: string; kind: "company_owned"; customer_name: string | null;
    owner_operator_id: string; notification_email: string | null; fact_version: string }>(
      `SELECT project_id,name,kind,customer_name,owner_operator_id,notification_email,fact_version::text FROM socialgrowth_product.projects WHERE project_id=$1`, [f.projectId])).rows[0]!;
  const updateMeta = metadata(), updateInput = { metadata: updateMeta, projectId: f.projectId, expectedFactVersion: Number(currentProject.fact_version), basics: {
    name: `${currentProject.name} revised`, kind: currentProject.kind, customerName: currentProject.customer_name,
    ownerOperatorId: currentProject.owner_operator_id, notificationEmail: currentProject.notification_email } };
  const updated = await projects.save(f.token, f.csrf, updateInput, "update");
  assert.equal(updated.project.factVersion, Number(currentProject.fact_version) + 1);
  assert.deepEqual(await impactState(), { head: 2, impacts: 2, reasons: ["material_revision_changed", "project_scope_changed"], revisions: [1, 2] });
  const afterProjectImpact = await f.service.currentChecks(f.token, f.projectId);
  assert.deepEqual(afterProjectImpact.tasks[0]?.impactReferences.map(ref => ref.reason), ["material_revision_changed", "project_scope_changed"]);
  assert.ok(afterProjectImpact.tasks[0]?.blockers.includes("project_scope_changed"));
  assert.deepEqual((await pool.query(`SELECT reason,source_version::int,observed_project_version::int,observed_material_revision::int
    FROM socialgrowth_product.business_plan_outbox_impacts WHERE task_id=$1 ORDER BY impact_revision`, [taskId])).rows,
  [{ reason: "material_revision_changed", source_version: 2, observed_project_version: beforePlan.currentScope.projectVersion, observed_material_revision: 2 },
    { reason: "project_scope_changed", source_version: updated.project.factVersion, observed_project_version: updated.project.factVersion, observed_material_revision: null }]);
  const projectReplay = await projects.save(f.token, f.csrf, updateInput, "update");
  assert.equal(projectReplay.project.factVersion, updated.project.factVersion);
  assert.deepEqual(await impactState(), { head: 2, impacts: 2, reasons: ["material_revision_changed", "project_scope_changed"], revisions: [1, 2] });

  const rollbackInput = { ...updateInput, metadata: metadata(), expectedFactVersion: updated.project.factVersion,
    basics: { ...updateInput.basics, name: `${updated.project.name} rollback-probe` } };
  await pool.query(`CREATE FUNCTION socialgrowth_product.test_reject_impact_reference() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN RAISE EXCEPTION 'synthetic impact insert failure'; END $fixture$`);
  await pool.query(`CREATE TRIGGER test_reject_impact_reference BEFORE INSERT ON socialgrowth_product.business_plan_outbox_impacts
    FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.test_reject_impact_reference()`);
  await assert.rejects(projects.save(f.token, f.csrf, rollbackInput, "update"), error("INTERNAL_ERROR"));
  const rolledBackProject = (await pool.query<{ fact_version: string; name: string }>(
    `SELECT fact_version::text,name FROM socialgrowth_product.projects WHERE project_id=$1`, [f.projectId])).rows[0]!;
  assert.equal(Number(rolledBackProject.fact_version), updated.project.factVersion);
  assert.equal(rolledBackProject.name, updated.project.name);
  assert.deepEqual(await impactState(), { head: 2, impacts: 2, reasons: ["material_revision_changed", "project_scope_changed"], revisions: [1, 2] });
  await pool.query("DROP TRIGGER test_reject_impact_reference ON socialgrowth_product.business_plan_outbox_impacts");
  await pool.query("DROP FUNCTION socialgrowth_product.test_reject_impact_reference()");
  const retried = await projects.save(f.token, f.csrf, rollbackInput, "update");
  assert.equal(retried.project.factVersion, updated.project.factVersion + 1);
  assert.deepEqual(await impactState(), { head: 3, impacts: 3, reasons: ["material_revision_changed", "project_scope_changed", "project_scope_changed"], revisions: [1, 2, 3] });

  const concurrentBase = (await pool.query<{ name: string; kind: "company_owned"; customer_name: string | null;
    owner_operator_id: string; notification_email: string | null; fact_version: string }>(
      `SELECT name,kind,customer_name,owner_operator_id,notification_email,fact_version::text FROM socialgrowth_product.projects WHERE project_id=$1`, [f.projectId])).rows[0]!;
  const concurrent = (suffix: string) => projects.save(f.token, f.csrf, { metadata: metadata(), projectId: f.projectId,
    expectedFactVersion: Number(concurrentBase.fact_version), basics: { name: `${concurrentBase.name} ${suffix}`, kind: concurrentBase.kind,
      customerName: concurrentBase.customer_name, ownerOperatorId: concurrentBase.owner_operator_id, notificationEmail: concurrentBase.notification_email } }, "update");
  const competing = await Promise.allSettled([concurrent("A"), concurrent("B")]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  const rejected = competing.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && error("FACT_VERSION_STALE")(rejected.reason));
  assert.deepEqual(await impactState(), { head: 4, impacts: 4,
    reasons: ["material_revision_changed", "project_scope_changed", "project_scope_changed", "project_scope_changed"], revisions: [1, 2, 3, 4] });
  makeArrangement = confirmationSuggestion;
});

test("project update expiry during impact append rolls back project, impacts, command and audit", async () => {
  arrangementCalls = 0; arrangementGate = null; makeArrangement = scheduleSuggestion;
  const f = await approvedProject(); await seedCandidateMaterial(f);
  const current = await f.service.read(f.token, f.projectId);
  const arranged = await f.service.arrange(f.token, f.csrf, f.projectId, { metadata: metadata(),
    expectedProjectVersion: current.currentScope.projectVersion, expectedApprovalId: current.currentScope.approvalId!, expectedPlanRevision: 0 });
  assert.equal(arranged.tasks.length, 1);
  const project = (await pool.query<{ name: string; fact_version: string; kind: "company_owned"; customer_name: string | null;
    owner_operator_id: string; notification_email: string | null }>(
      `SELECT name,fact_version::text,kind,customer_name,owner_operator_id,notification_email FROM socialgrowth_product.projects WHERE project_id=$1`, [f.projectId])).rows[0]!;
  const beforeImpacts = (await pool.query(`SELECT current_impact_revision::int head,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox_impacts WHERE task_id=$1) rows
    FROM socialgrowth_product.business_plan_outbox WHERE task_id=$1`, [arranged.tasks[0]!.taskId])).rows[0];
  const metadataInput = metadata();
  const updateInput = { metadata: metadataInput, projectId: f.projectId, expectedFactVersion: Number(project.fact_version), basics: {
    name: `${project.name} expired-session rollback`, kind: project.kind, customerName: project.customer_name,
    ownerOperatorId: project.owner_operator_id, notificationEmail: project.notification_email } };

  await pool.query(`UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE operator_id=$1`, [f.operatorId]);
  await pool.query(`CREATE FUNCTION socialgrowth_product.test_delay_impact_append() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN PERFORM pg_sleep(2.5); RETURN NEW; END $fixture$`);
  await pool.query(`CREATE TRIGGER test_delay_impact_append BEFORE INSERT ON socialgrowth_product.business_plan_outbox_impacts
    FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.test_delay_impact_append()`);
  try {
    await assert.rejects(new ProjectService(pool, auth).save(f.token, f.csrf, updateInput, "update"), error("AUTHENTICATION_REQUIRED"));
  } finally {
    await pool.query("DROP TRIGGER test_delay_impact_append ON socialgrowth_product.business_plan_outbox_impacts");
    await pool.query("DROP FUNCTION socialgrowth_product.test_delay_impact_append()");
  }

  const afterProject = (await pool.query<{ name: string; fact_version: string }>(
    `SELECT name,fact_version::text FROM socialgrowth_product.projects WHERE project_id=$1`, [f.projectId])).rows[0]!;
  assert.equal(afterProject.name, project.name);
  assert.equal(Number(afterProject.fact_version), Number(project.fact_version));
  assert.deepEqual((await pool.query(`SELECT current_impact_revision::int head,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox_impacts WHERE task_id=$1) rows
    FROM socialgrowth_product.business_plan_outbox WHERE task_id=$1`, [arranged.tasks[0]!.taskId])).rows[0], beforeImpacts);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM socialgrowth_product.project_metadata_commands
    WHERE actor_id=$1 AND request_key=$2`, [f.operatorId, metadataInput.idempotencyKey])).rows[0]!.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM socialgrowth_product.audit_records
    WHERE request_id=$1`, [metadataInput.requestId])).rows[0]!.count, 0);
  makeArrangement = confirmationSuggestion;
});

test("plan candidate cannot select a later reserved identity outside the exact approved platform/reference scope", async () => {
  arrangementCalls = 0; arrangementGate = null; makeArrangement = scheduleSuggestion;
  const f = await approvedProject(), material = await seedCandidateMaterial(f), outsideIdentityId = await seedOutOfScopeIdentity(f);
  const before = await f.service.read(f.token, f.projectId);
  makeArrangement = context => {
    const base = scheduleSuggestion(context) as ReturnType<typeof scheduleSuggestion>;
    return { ...base, changes: [{ ...base.changes[0]!, publication: { ...base.changes[0]!.publication, identityId: outsideIdentityId } }] };
  };
  const request = { metadata: metadata(), expectedProjectVersion: before.currentScope.projectVersion,
    expectedApprovalId: before.currentScope.approvalId!, expectedPlanRevision: 0 };
  await assert.rejects(f.service.arrange(f.token, f.csrf, f.projectId, request), error("FACT_VERSION_STALE"));
  assert.deepEqual(await planRowCounts(f.projectId), { revisions: 0, tasks: 0, outbox: 0, commands: 0, audits: 0 });
  const current = await f.service.read(f.token, f.projectId);
  assert.equal(current.plan, null); assert.deepEqual(current.tasks, []);
  assert.ok(material.identityId !== outsideIdentityId);
});

test("final transaction reruns the schedule check after delay before any plan or outbox write", async () => {
  arrangementCalls = 0; arrangementGate = null;
  const now = Date.now(), f = await approvedProject(undefined, {
    startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 5_000).toISOString(),
  });
  await seedCandidateMaterial(f);
  makeArrangement = context => {
    const base = scheduleSuggestion(context) as ReturnType<typeof scheduleSuggestion>;
    return { ...base, changes: [{ ...base.changes[0]!, publication: {
      ...base.changes[0]!.publication, scheduledAt: new Date(Date.now() + 2_000).toISOString(),
    } }] };
  };
  const current = await f.service.read(f.token, f.projectId);
  const request = { metadata: metadata(), expectedProjectVersion: current.currentScope.projectVersion,
    expectedApprovalId: current.currentScope.approvalId!, expectedPlanRevision: 0 };
  type Tx = <T>(token: string, csrf: string | null, fn: (client: import("pg").PoolClient, actorId: string) => Promise<T>) => Promise<T>;
  const service = f.service as unknown as { tx: Tx };
  const originalTx = service.tx.bind(f.service);
  let csrfTransactions = 0;
  service.tx = async (token, csrf, fn) => {
    // The first CSRF transaction checks for an idempotent replay. Delay the
    // second (final persistence) transaction to model time spent waiting to
    // enter the final locked section.
    if (csrf !== null && ++csrfTransactions === 2) await new Promise(resolve => setTimeout(resolve, 2_300));
    return originalTx(token, csrf, fn);
  };
  await assert.rejects(f.service.arrange(f.token, f.csrf, f.projectId, request), error("FACT_VERSION_STALE"));
  assert.deepEqual(await planRowCounts(f.projectId), { revisions: 0, tasks: 0, outbox: 0, commands: 0, audits: 0 });
  makeArrangement = confirmationSuggestion;
});

test("outbox failure rolls back revision, quota, Task, command and audit together", async () => {
  arrangementCalls = 0; arrangementGate = null; makeArrangement = scheduleSuggestion;
  const f = await approvedProject(); await seedCandidateMaterial(f); const current = await f.service.read(f.token, f.projectId);
  const request = { metadata: metadata(), expectedProjectVersion: current.currentScope.projectVersion,
    expectedApprovalId: current.currentScope.approvalId!, expectedPlanRevision: 0 };
  await pool.query(`CREATE FUNCTION socialgrowth_product.test_reject_plan_outbox() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN RAISE EXCEPTION 'synthetic outbox write failure'; END $fixture$`);
  await pool.query(`CREATE TRIGGER test_reject_plan_outbox BEFORE INSERT ON socialgrowth_product.business_plan_outbox
    FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.test_reject_plan_outbox()`);
  await assert.rejects(f.service.arrange(f.token, f.csrf, f.projectId, request), error("INTERNAL_ERROR"));
  assert.deepEqual(await planRowCounts(f.projectId), { revisions: 0, tasks: 0, outbox: 0, commands: 0, audits: 0 });
  await pool.query("DROP TRIGGER test_reject_plan_outbox ON socialgrowth_product.business_plan_outbox");
  await pool.query("DROP FUNCTION socialgrowth_product.test_reject_plan_outbox()");
  const retry = await f.service.arrange(f.token, f.csrf, f.projectId, request);
  assert.equal(retry.outcome, "planned"); assert.equal(retry.tasks.length, 1);
  assert.deepEqual(await planRowCounts(f.projectId), { revisions: 1, tasks: 1, outbox: 1, commands: 1, audits: 1 });
  makeArrangement = confirmationSuggestion;
});
