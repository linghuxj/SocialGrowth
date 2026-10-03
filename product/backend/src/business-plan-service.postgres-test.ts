import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
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
      [contentUnitId, f.projectId, sourceId, sourceRecordId, JSON.stringify({ mediaKind: "video", businessKind: "product", businessEntityId, seriesId: null, episodeNumber: null })]);
    await c.query(`INSERT INTO socialgrowth_product.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [objectId, f.projectId, JSON.stringify(object)]);
    await c.query(`INSERT INTO socialgrowth_product.material_variants(variant_id,content_unit_id,project_id,language_tag,current_revision) VALUES($1,$2,$3,'en',1)`, [variantId, contentUnitId, f.projectId]);
    await c.query(`INSERT INTO socialgrowth_product.material_variant_revisions(variant_id,revision,declaration,object_references,recorded_by_operator_id,recorded_at)
      VALUES($1,1,$2,$3,$4,'2026-10-04T00:00:00.000000Z')`, [variantId, JSON.stringify(declaration), JSON.stringify([object]), f.operatorId]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  const registry = new MaterialRegistryStore(pool, auth, null);
  const checkClient = await pool.connect();
  try {
    const material = await registry.listCurrentForBusinessPlan(checkClient, f.projectId);
    assert.equal(material.length, 1); assert.equal(material[0]?.candidateAllowed, true, `reason=${material[0]?.eligibilityReason}`); assert.equal(material[0]?.eligibilityReason, null);
  } finally { checkClient.release(); }
  f.service = new BusinessPlanService(pool, auth, { registry: () => registry } as unknown as MaterialRuntime, planModel);
  return { contentUnitId, variantId, identityId };
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
  assert.ok(checks.tasks[0]?.blockers.includes("action_inspector_unavailable"));
  assert.ok(checks.tasks[0]?.blockers.includes("device_association_missing"));
  assert.ok(checks.tasks[0]?.blockers.includes("current_fact_unknown"));
  assert.deepEqual(checks.tasks[0]?.impactReferences, []);
  assert.equal(checks.executionAllowed, false); assert.equal(checks.publicationAllowed, false);
  assert.deepEqual(await planRowCounts(f.projectId), { revisions: 1, tasks: 1, outbox: 1, commands: 1, audits: 1 });
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
