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
import { ProjectCycleStore, resolveProjectCycleWindow } from "./project-cycle-store.js";
import { ProjectCycleProgressionLifecycle } from "./project-cycle-progression-lifecycle.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import type { InitialDirectionModel } from "./artemis-business-model.js";

const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires owned isolated reset-authorized PostgreSQL");
const pool = new Pool({ connectionString: url, max: 8 });
const auth = new OperatorAuthService(pool, "isolated-cycle-config-pepper-only-00000001");
const projects = new ProjectService(pool, auth), planning = new ProjectPlanningService(pool, auth);
const configuration = new ProjectCycleConfigService(pool, auth);
const cycles = new ProjectCycleStore();
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

async function appendDueFixture(projectId: string, observedAt: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const guard of ["material_registry_guard", "resource_reservation_guard", "business_plan_guard"]) {
      assert.equal((await c.query(`SELECT 1 FROM socialgrowth_product.${guard} WHERE singleton=true FOR UPDATE`)).rowCount, 1);
    }
    assert.equal((await c.query("SELECT 1 FROM socialgrowth_product.projects WHERE project_id=$1 FOR UPDATE", [projectId])).rowCount, 1);
    const result = await cycles.appendDueSuccessor(c, projectId, observedAt);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    try { await c.query("ROLLBACK"); } catch { /* cleanup continues */ }
    throw error;
  } finally { c.release(); }
}

test("due selector pages at twenty projects and ignores a superseded due cycle", async () => {
  const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
  for (let i = 0; i < 21; i += 1) fixtures.push(await fixture("- interval '8 days'"));
  const ordered = fixtures.map(item => item.projectId).sort();
  const lifecycle = new ProjectCycleProgressionLifecycle(pool);
  const selector = lifecycle as unknown as {
    afterProjectId: string | null;
    dueProjects(deadline: number): Promise<string[]>;
  };
  const deadline = Date.now() + 15_000;
  selector.afterProjectId = null;
  const firstPage = await selector.dueProjects(deadline);
  assert.deepEqual(firstPage, ordered.slice(0, 20));
  selector.afterProjectId = firstPage.at(-1) ?? null;
  const secondPage = await selector.dueProjects(deadline);
  assert.deepEqual(secondPage, ordered.slice(20));

  const supersededProjectId = ordered[0]!;
  const latest = (await pool.query<{ ends_at: string }>(`SELECT ends_at FROM socialgrowth_product.project_review_cycles
    WHERE project_id=$1 ORDER BY cycle_number DESC LIMIT 1`, [supersededProjectId])).rows[0];
  assert.ok(latest);
  assert.equal((await appendDueFixture(supersededProjectId, latest.ends_at)).state, "created");
  selector.afterProjectId = null;
  const afterSuccessor = await selector.dueProjects(deadline);
  assert.equal(afterSuccessor.length, 20);
  assert.equal(afterSuccessor.includes(supersededProjectId), false);
});

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
  assert.deepEqual(read.nextConfiguration, { ...result.nextConfiguration!, application: { state: "pending", materializedCycleId: null, reason: null } });
  assert.equal(read.nextCycle, null);
  const command = await configuration.readCommand(f.token, f.projectId, request.metadata.idempotencyKey);
  assert.equal(command.receipt?.outcome, "confirmed");
  assert.deepEqual(command.receipt?.nextConfiguration, result.nextConfiguration, "command lookup preserves the original POST receipt schema");
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

test("missing calendar runtime metadata fails closed and unresolved receipt retains the prior config", async () => {
  const f = await fixture("- interval '1 day'");
  const first = await configuration.save(f.token, f.csrf, f.projectId, { metadata: metadata(), expectedConfigurationRevision: 0,
    businessTimeZone: "Asia/Shanghai", reviewIntervalDays: 14, trafficMinimumPerCycle: 2 });
  assert.equal(first.outcome, "confirmed");
  assert.ok(first.nextConfiguration);
  const current = (await configuration.read(f.token, f.projectId)).currentCycle;
  assert.ok(current);
  assert.ok(resolveProjectCycleWindow(current.endsAt, 21, "Asia/Shanghai"), "control proves the old successful-preview path is otherwise available");

  const tzDescriptor = Object.getOwnPropertyDescriptor(process.versions, "tz");
  assert.ok(tzDescriptor?.configurable, "test runtime metadata must be safely restorable");
  Object.defineProperty(process.versions, "tz", { configurable: true, value: undefined });
  const secondMetadata = metadata();
  let unresolved;
  try {
    unresolved = await configuration.save(f.token, f.csrf, f.projectId, { metadata: secondMetadata, expectedConfigurationRevision: 1,
      businessTimeZone: "Asia/Shanghai", reviewIntervalDays: 21, trafficMinimumPerCycle: 4 });
  } finally {
    Object.defineProperty(process.versions, "tz", tzDescriptor);
  }
  assert.equal(unresolved!.outcome, "unresolved");
  assert.equal(unresolved!.reason, "calendar_runtime_unavailable");
  assert.equal(unresolved!.configurationRevision, 1);
  assert.deepEqual(unresolved!.nextConfiguration, first.nextConfiguration);
  const recovered = await configuration.readCommand(f.token, f.projectId, secondMetadata.idempotencyKey);
  assert.equal(recovered.receipt?.reason, "calendar_runtime_unavailable");
  assert.deepEqual(recovered.receipt?.nextConfiguration, first.nextConfiguration);
  const counts = (await pool.query(`SELECT count(*)::int configs,
    (SELECT count(*)::int FROM socialgrowth_product.project_review_cycle_config_commands WHERE project_id=$1) commands
    FROM socialgrowth_product.project_review_cycle_configs WHERE project_id=$1`, [f.projectId])).rows[0];
  assert.deepEqual(counts, { configs: 1, commands: 2 });
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

test("cycle progression consumes a confirmed revision once, then carries it across contiguous windows", async () => {
  const f = await fixture("- interval '1 day'"), initial = await configuration.read(f.token, f.projectId);
  assert.ok(initial.currentCycle);
  const confirmed = await configuration.save(f.token, f.csrf, f.projectId, { metadata: metadata(), expectedConfigurationRevision: 0,
    businessTimeZone: "Asia/Shanghai", reviewIntervalDays: 14, trafficMinimumPerCycle: 3 });
  assert.equal(confirmed.outcome, "confirmed");
  const firstBoundary = initial.currentCycle.endsAt;
  const applied = await appendDueFixture(f.projectId, firstBoundary);
  assert.equal(applied.state, "created");
  if (applied.state !== "created") return;
  assert.equal(applied.origin, "confirmed_next_configuration");
  assert.equal(applied.cycle.startsAt, firstBoundary);
  assert.equal(applied.cycle.businessTimeZone, "Asia/Shanghai");
  assert.equal(applied.cycle.trafficMinimum, 3);
  const firstRow = (await pool.query<{ origin_kind: string; source_configuration_revision: string; predecessor_cycle_id: string; recorded_at: string }>(
    `SELECT origin_kind,source_configuration_revision::text,predecessor_cycle_id,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
     FROM socialgrowth_product.project_review_cycles WHERE project_id=$1 AND cycle_id=$2`, [f.projectId, applied.cycle.cycleId])).rows[0]!;
  assert.equal(firstRow.origin_kind, "confirmed_next_configuration");
  assert.equal(firstRow.source_configuration_revision, "1");
  assert.equal(firstRow.predecessor_cycle_id, initial.currentCycle.cycleId);
  assert.notEqual(firstRow.recorded_at, applied.cycle.startsAt);

  const carried = await appendDueFixture(f.projectId, applied.cycle.endsAt);
  assert.equal(carried.state, "created");
  if (carried.state !== "created") return;
  assert.equal(carried.origin, "carry_forward");
  assert.equal(carried.cycle.startsAt, applied.cycle.endsAt);
  assert.equal(carried.cycle.configVersion, applied.cycle.configVersion);
  assert.equal(carried.cycle.businessTimeZone, applied.cycle.businessTimeZone);
  assert.equal(carried.cycle.trafficMinimum, applied.cycle.trafficMinimum);
  const secondRow = (await pool.query<{ origin_kind: string; source_configuration_revision: string | null; predecessor_cycle_id: string }>(
    `SELECT origin_kind,source_configuration_revision::text,predecessor_cycle_id FROM socialgrowth_product.project_review_cycles
     WHERE project_id=$1 AND cycle_id=$2`, [f.projectId, carried.cycle.cycleId])).rows[0]!;
  assert.deepEqual(secondRow, { origin_kind: "carry_forward", source_configuration_revision: null, predecessor_cycle_id: applied.cycle.cycleId });
  const read = await configuration.read(f.token, f.projectId);
  assert.equal(read.nextConfiguration?.application.state, "applied");
  assert.equal(read.nextConfiguration?.application.materializedCycleId, applied.cycle.cycleId);
  assert.equal(read.nextCycle, null);
  assert.equal(read.executionAllowed, false); assert.equal(read.publicationAllowed, false);
  assert.equal((await pool.query("SELECT count(*)::int count FROM socialgrowth_product.project_review_cycles WHERE project_id=$1", [f.projectId])).rows[0]!.count, 3);
  assert.equal((await pool.query("SELECT count(*)::int count FROM socialgrowth_product.business_plan_tasks WHERE project_id=$1", [f.projectId])).rows[0]!.count, 0);
});

test("no new configuration carries the initial settings and later approval cannot reset cycle one", async () => {
  const f = await fixture("- interval '1 day'"), first = await configuration.read(f.token, f.projectId);
  assert.ok(first.currentCycle);
  const carried = await appendDueFixture(f.projectId, first.currentCycle.endsAt);
  assert.equal(carried.state, "created");
  if (carried.state !== "created") return;
  assert.equal(carried.origin, "carry_forward");
  assert.equal(carried.cycle.startsAt, first.currentCycle.endsAt);
  assert.equal(carried.cycle.businessTimeZone, first.currentCycle.businessTimeZone);
  assert.equal(carried.cycle.trafficMinimum, first.currentCycle.trafficMinimumPerCycle);
  assert.equal(carried.cycle.configVersion, first.currentCycle.configVersion);

  const original = (await pool.query<{ record: Record<string, unknown> }>(
    "SELECT record FROM socialgrowth_product.project_direction_approvals WHERE project_id=$1", [f.projectId])).rows[0]!.record;
  const changedApproval = { ...original, approvalId: randomUUID() };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await assert.rejects(cycles.appendApprovedConfiguration(c, changedApproval), (cause: unknown) =>
      cause instanceof Error && cause.message === "BOUNDARY_STALE");
    await c.query("ROLLBACK");
  } finally { c.release(); }
  const initialRows = await pool.query<{ count: number }>(`SELECT count(*)::int count FROM socialgrowth_product.project_review_cycles
    WHERE project_id=$1 AND origin_kind='initial_direction_approval'`, [f.projectId]);
  assert.equal(initialRows.rows[0]!.count, 1);
});

test("project end suppresses due cycle progression without changing immutable history", async () => {
  const f = await fixture("- interval '1 day'"), before = await configuration.read(f.token, f.projectId);
  assert.ok(before.currentCycle);
  const digest = createHash("sha256").update("supplemental ended-cycle fixture").digest();
  await pool.query(`INSERT INTO socialgrowth_product.project_lifecycle_intents(project_id,revision,intent,actor_id,request_id,request_key,payload_digest)
    VALUES($1,1,'end_requested',$2,$3,$4,$5)`, [f.projectId, f.operatorId, `cycle-end-${randomUUID()}`, `cycle-end-key-${randomUUID()}`, digest]);
  const result = await appendDueFixture(f.projectId, before.currentCycle.endsAt);
  assert.deepEqual(result, { state: "unresolved", reason: "project_ended" });
  const after = await pool.query<{ count: number }>("SELECT count(*)::int count FROM socialgrowth_product.project_review_cycles WHERE project_id=$1", [f.projectId]);
  assert.equal(after.rows[0]!.count, 1);
  assert.equal((await configuration.read(f.token, f.projectId)).executionAllowed, false);
});
