import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion, emptyProjectPlanningInputs, type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { BusinessPlanService } from "./business-plan-service.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { MaterialRuntime } from "./material-runtime.js";
import { ProjectService } from "./project-service.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { ProjectDirectionService } from "./project-direction-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import type { BusinessModelPort } from "./business-model-coordinator.js";
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

async function approvedProject() {
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
    publishingWindow: { startsAt: "2090-01-01T00:00:00Z", endsAt: "2090-02-01T00:00:00Z" } };
  const draft = (await planning.save(token, csrf, { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: 0,
    expectedDraftVersion: 0, inputs })).draft;
  const generation = { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion,
    identities: [{ platform: "facebook" as const, canonicalRef: "synthetic_page", declaredStage: "before_monetization" as const }] };
  const proposal = (await directions.generate(token, csrf, generation)).proposal;
  assert.ok(proposal);
  const approval = await directions.confirm(token, csrf, { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: proposal.projectVersion,
    proposalId: proposal.proposalId, snapshotDigest: proposal.snapshotDigest });
  assert.ok(approval.approval);
  return { token, csrf, projectId: project.projectId, service: new BusinessPlanService(pool, auth, new MaterialRuntime(pool, auth, null), planModel) };
}

const directionModel: InitialDirectionModel = { generateDirection: async () => ({ providerKey: "synthetic-port", modelKey: "fixture-direction",
  responseId: randomUUID(), output: { direction: "Synthetic bounded direction", rationale: "Test fixture only", limitations: ["No business acceptance"] } }) };
let arrangementCalls = 0;
const planModel: BusinessModelPort & { describe(signal: AbortSignal): Promise<{ providerKey: string; modelKey: string }> } = {
  describe: async () => ({ providerKey: "synthetic-port", modelKey: "fixture-plan" }),
  generate: async (request, _signal) => {
    arrangementCalls++;
    const context = request.input.context;
    return { responseId: randomUUID(), outputText: JSON.stringify({ suggestionId: randomUUID(), projectId: context.projectId,
      factSetId: context.factSetId, factSetVersion: context.factSetVersion, approval: context.approval,
      basis: [{ factId: context.approval!.approvalId, version: context.factSetVersion }], explanation: "Synthetic confirmation boundary",
      limitations: ["Fixture only", "No tasks or posting"], decision: "requires_operator_confirmation", proposedDirection: "Synthetic direction change proposal" }) };
  },
};

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
  await assert.rejects(f.service.arrange(f.token, "", f.projectId, request), error("AUTHENTICATION_REQUIRED"));
  await assert.rejects(f.service.arrange(f.token, f.csrf, f.projectId, { ...request, expectedPlanRevision: 1 }), error("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual((await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.business_plan_revisions WHERE project_id=$1) revisions,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_tasks WHERE project_id=$1) tasks,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox WHERE project_id=$1) outbox,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_commands WHERE project_id=$1) commands`, [f.projectId])).rows[0], { revisions: 1, tasks: 0, outbox: 0, commands: 1 });
});
