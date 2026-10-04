import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion, emptyProjectPlanningInputs, type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProjectService } from "./project-service.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { ProjectDirectionService } from "./project-direction-service.js";
import { ProjectCycleConfigService } from "./project-cycle-config-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import type { InitialDirectionModel } from "./artemis-business-model.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires owned isolated reset-authorized PostgreSQL");
const pool = new Pool({ connectionString: url, max: 8 });
const auth = new OperatorAuthService(pool, "isolated-cycle-config-pepper-only-00000001");
const projects = new ProjectService(pool, auth), planning = new ProjectPlanningService(pool, auth);
const configuration = new ProjectCycleConfigService(pool, auth);
const metadata = () => ({ contractVersion, requestId: `cycle-request-${randomUUID()}`, idempotencyKey: `cycle-config-${randomUUID()}` });
const error = (code: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === code;
const dbInstant = async (sql: string) => (await pool.query<{ value: string }>(`SELECT to_char((${sql}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') value`)).rows[0]!.value;

before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });

const directionModel: InitialDirectionModel = { generateDirection: async () => ({ providerKey: "supplemental-fixture", modelKey: "not-a-real-model",
  responseId: randomUUID(), output: { direction: "Fixture only", rationale: "Supplemental transaction test", limitations: ["Not real operator or business acceptance"] } }) };

async function fixture(startOffset: string) {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Cycle fixture','not-a-password','active')", [operatorId, `cycle-fixture-${operatorId}`]);
  await pool.query(`INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at)
    VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  const project = (await projects.save(token, csrf, { metadata: metadata(), basics: { name: `Cycle fixture ${randomUUID()}`, kind: "company_owned",
    customerName: null, ownerOperatorId: operatorId, notificationEmail: null } }, "create")).project;
  const startsAt = await dbInstant(`clock_timestamp() ${startOffset}`);
  const windowStart = await dbInstant("clock_timestamp() - interval '1 day'");
  const windowEnd = await dbInstant("clock_timestamp() + interval '30 days'");
  const inputs: ProjectPlanningInputs = { ...emptyProjectPlanningInputs(), preOpeningGoal: "Fixture preparation", postOpeningGoal: "Fixture next step",
    postOpeningPriority: "balanced", targetCountries: ["CN"], targetLanguages: ["zh"], contentForms: ["facebook_image_text"],
    contentRules: "Fixture only; no publication", businessTimeZone: "Asia/Shanghai", firstCycleStartsAt: startsAt,
    reviewIntervalDays: 7, trafficMinimumPerCycle: 1, observationWindowHours: 24, tailObservationDays: 0, maxPublicationsPerDay: 1,
    publishingWindow: { startsAt: windowStart, endsAt: windowEnd } };
  const draft = (await planning.save(token, csrf, { metadata: metadata(), projectId: project.projectId, expectedProjectVersion: 0,
    expectedDraftVersion: 0, inputs })).draft;
  const directions = new ProjectDirectionService(pool, auth, directionModel);
  const generated = await directions.generate(token, csrf, { metadata: metadata(), projectId: project.projectId,
    expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion,
    identities: [{ platform: "facebook", canonicalRef: "fixture_page", declaredStage: "before_monetization" }] });
  assert.ok(generated.proposal);
  const approved = await directions.confirm(token, csrf, { metadata: metadata(), projectId: project.projectId,
    expectedProjectVersion: generated.proposal.projectVersion, proposalId: generated.proposal.proposalId,
    snapshotDigest: generated.proposal.snapshotDigest });
  assert.ok(approved.approval);
  return { operatorId, sessionId, token, csrf, projectId: project.projectId, directions };
}

test("operator confirmation appends only a next-cycle config, preserves current history, and replays the exact receipt", async () => {
  const f = await fixture("- interval '1 day'"), initial = await configuration.read(f.token, f.projectId);
  assert.ok(initial.currentCycle); assert.equal(initial.configurationRevision, 0); assert.equal(initial.nextConfiguration, null); assert.equal(initial.nextCycle, null);
  const request = { metadata: metadata(), expectedConfigurationRevision: 0, businessTimeZone: "Asia/Shanghai" as const,
    reviewIntervalDays: 14, trafficMinimumPerCycle: 2 };
  const result = await configuration.save(f.token, f.csrf, f.projectId, request);
  assert.equal(result.outcome, "confirmed"); assert.equal(result.replayed, false); assert.equal(result.configurationRevision, 1);
  assert.equal(result.nextConfiguration?.basedOnCycleId, initial.currentCycle.cycleId);
  assert.equal(result.nextConfiguration?.effectiveStartsAt, initial.currentCycle.endsAt);
  assert.equal(result.nextConfiguration?.trafficMinimumPerCycle, 2);
  assert.equal(result.executionAllowed, false); assert.equal(result.publicationAllowed, false);
  assert.equal(result.nextConfiguration?.confirmedByOperatorId, f.operatorId);
  assert.equal((await configuration.save(f.token, f.csrf, f.projectId, request)).replayed, true);
  const read = await configuration.read(f.token, f.projectId);
  assert.deepEqual(read.currentCycle, initial.currentCycle);
  assert.deepEqual(read.nextConfiguration, result.nextConfiguration); assert.equal(read.nextCycle, null);
  assert.equal((await configuration.readCommand(f.token, f.projectId, request.metadata.idempotencyKey)).receipt?.outcome, "confirmed");
  assert.equal((await configuration.readCommand(f.token, f.projectId, `cycle-missing-${randomUUID()}`)).status, "not_found");
  await assert.rejects(configuration.save(f.token, f.csrf, f.projectId, { ...request, reviewIntervalDays: 29 }), error("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(configuration.save(f.token, f.csrf, f.projectId, { ...request, metadata: metadata(), expectedConfigurationRevision: 0 }), error("FACT_VERSION_STALE"));
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM socialgrowth_product.project_review_cycles WHERE project_id=$1) cycles,
    (SELECT count(*)::int FROM socialgrowth_product.project_review_cycle_configs WHERE project_id=$1) configs,
    (SELECT count(*)::int FROM socialgrowth_product.project_review_cycle_config_commands WHERE project_id=$1) commands,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_tasks WHERE project_id=$1) tasks,
    (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox WHERE project_id=$1) outbox`, [f.projectId])).rows[0];
  assert.deepEqual(counts, { cycles: 1, configs: 1, commands: 1, tasks: 0, outbox: 0 });
  await assert.rejects(pool.query("UPDATE socialgrowth_product.project_review_cycle_configs SET traffic_minimum_per_cycle=8 WHERE project_id=$1", [f.projectId]));
});

test("late confirmation and DST-crossing preview persist only unresolved command receipts", async () => {
  const late = await fixture("- interval '8 days'"), lateRequest = { metadata: metadata(), expectedConfigurationRevision: 0,
    businessTimeZone: "Asia/Shanghai" as const, reviewIntervalDays: 14, trafficMinimumPerCycle: 3 };
  const lateResult = await configuration.save(late.token, late.csrf, late.projectId, lateRequest);
  assert.equal(lateResult.outcome, "unresolved"); assert.equal(lateResult.reason, "previous_window_elapsed"); assert.equal(lateResult.nextConfiguration, null);
  assert.equal((await configuration.readCommand(late.token, late.projectId, lateRequest.metadata.idempotencyKey)).receipt?.outcome, "unresolved");
  assert.equal((await pool.query("SELECT count(*)::int count FROM socialgrowth_product.project_review_cycle_configs WHERE project_id=$1", [late.projectId])).rows[0]!.count, 0);

  const active = await fixture("- interval '1 day'"), before = await configuration.read(active.token, active.projectId);
  assert.ok(before.currentCycle);
  const ambiguous = await configuration.save(active.token, active.csrf, active.projectId,
    { metadata: metadata(), expectedConfigurationRevision: 0, businessTimeZone: "America/New_York", reviewIntervalDays: 30, trafficMinimumPerCycle: 2 });
  assert.equal(ambiguous.outcome, "unresolved"); assert.equal(ambiguous.reason, "civil_boundary_ambiguous");
  assert.equal((await pool.query("SELECT count(*)::int count FROM socialgrowth_product.project_review_cycle_configs WHERE project_id=$1", [active.projectId])).rows[0]!.count, 0);
});

test("session expiry after config insert rolls config, command receipt and audit back atomically", async () => {
  const f = await fixture("- interval '1 day'");
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE session_id=$1", [f.sessionId]);
  await pool.query(`CREATE FUNCTION socialgrowth_product.cycle_config_insert_delay() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER cycle_config_insert_delay BEFORE INSERT ON socialgrowth_product.project_review_cycle_configs
    FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.cycle_config_insert_delay()`);
  try {
    await assert.rejects(configuration.save(f.token, f.csrf, f.projectId, { metadata: metadata(), expectedConfigurationRevision: 0,
      businessTimeZone: "Asia/Shanghai", reviewIntervalDays: 14, trafficMinimumPerCycle: 2 }), error("AUTHENTICATION_REQUIRED"));
  } finally {
    await pool.query("DROP TRIGGER cycle_config_insert_delay ON socialgrowth_product.project_review_cycle_configs");
    await pool.query("DROP FUNCTION socialgrowth_product.cycle_config_insert_delay()");
  }
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM socialgrowth_product.project_review_cycle_configs WHERE project_id=$1) configs,
    (SELECT count(*)::int FROM socialgrowth_product.project_review_cycle_config_commands WHERE project_id=$1) commands,
    (SELECT count(*)::int FROM socialgrowth_product.audit_records WHERE object_id=$1 AND action LIKE 'project.review_cycle_config_%') audits`, [f.projectId])).rows[0];
  assert.deepEqual(counts, { configs: 0, commands: 0, audits: 0 });
});
