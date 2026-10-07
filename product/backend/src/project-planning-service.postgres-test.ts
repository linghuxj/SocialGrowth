import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion, emptyProjectPlanningInputs, type ProjectPlanningInputs, type ProjectPlanningDraftView } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProjectService } from "./project-service.js";
import { ProjectPlanningService } from "./project-planning-service.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Planning transaction tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-planning-fixtures" });
const auth = new OperatorAuthService(pool, "isolated-planning-pepper-only-00000001"), projects = new ProjectService(pool, auth), service = new ProjectPlanningService(pool, auth);
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `planning-${randomUUID()}` });
const errorCode = (code: string) => (error: unknown) => error instanceof ProductTransactionError && error.code === code;
let previousProject: string;
let previousActor: Awaited<ReturnType<typeof actor>>;
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const f of ["0001_identity_and_device.sql", "0002_provider_phone_auth.sql", "0003_provider_auth_recovery.sql", "0004_installation_bootstrap_admission.sql", "0005_network_admission.sql", "0006_phone_control_journal.sql", "0007_task_recovery_budget.sql", "0008_project_basics.sql", "0009_resource_reservations.sql"]) await pool.query(await readFile(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  previousActor = await actor(); previousProject = (await project(previousActor)).projectId;
  await pool.query(await readFile(new URL("../migrations/0010_project_planning_drafts.sql", import.meta.url), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });
// Synthetic NON-UI transaction fixtures; these do not prove real auth or approval.
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), sessionToken = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Planning fixture','not-real-password','active')", [operatorId, `fixture-${operatorId}`]);
  await pool.query("INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')", [sessionId, operatorId, digest(sessionToken), digest(csrfToken)]);
  return { operatorId, sessionId, sessionToken, csrfToken };
}
type Actor = Awaited<ReturnType<typeof actor>>;
async function project(a: Actor) {
  return (await projects.save(a.sessionToken, a.csrfToken, { metadata: meta(), basics: { name: `Planning ${randomUUID()}`, kind: "company_owned", customerName: null, ownerOperatorId: a.operatorId, notificationEmail: null } }, "create")).project;
}
const save = (a: Actor, view: ProjectPlanningDraftView, inputs: unknown, metadata = meta()) => service.save(a.sessionToken, a.csrfToken,
  { metadata, projectId: view.projectId, expectedProjectVersion: view.projectFactVersion, expectedDraftVersion: view.draftVersion, inputs });
async function counts(id: string) { return (await pool.query<{ commands: number; audits: number }>(`SELECT (SELECT count(*)::int FROM socialgrowth_product.project_planning_commands WHERE project_id=$1) commands,(SELECT count(*)::int FROM socialgrowth_product.audit_records WHERE object_id=$1 AND action='project.planning_draft_saved') audits`, [id])).rows[0]!; }
test("forward migration on full prior schema preserves project, sessions and resource guard without guessing planning inputs", async () => {
  assert.equal((await service.read(previousActor.sessionToken, previousProject)).draft.draftVersion, 0);
  assert.equal((await projects.list(previousActor.sessionToken)).projects.find(p => p.projectId === previousProject)?.phase, "preparing");
  assert.equal((await pool.query("SELECT version::text FROM socialgrowth_product.resource_reservation_guard")).rows[0].version, "0");
  assert.deepEqual(await counts(previousProject), { commands: 0, audits: 0 });
});
test("unconfigured project returns an unsaved empty draft, partial save remains preparing and unapproved", async () => {
  const a = await actor(), p = await project(a), current = (await service.read(a.sessionToken, p.projectId)).draft;
  assert.equal(current.draftVersion, 0); assert.equal(current.savedAt, null); assert.deepEqual(current.inputs, emptyProjectPlanningInputs());
  const inputs = { ...current.inputs, targetCountries: ["墨西哥"], targetLanguages: ["西班牙语"] };
  const result = (await save(a, current, inputs)).draft;
  assert.equal(result.draftVersion, 1); assert.equal(result.projectFactVersion, 1); assert.equal(result.status, "unapproved_draft"); assert.equal(result.savedByOperatorId, a.operatorId);
  assert.equal((await projects.list(a.sessionToken)).projects.find(x => x.projectId === p.projectId)?.phase, "preparing");
  assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
});
test("lost response restart and reordered set replay return current inputs without a duplicate write", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft, metadata = meta();
  const inputs = { ...base.inputs, targetCountries: ["墨西哥", "巴西"], contentForms: ["facebook_video", "youtube_shorts"] as ProjectPlanningInputs["contentForms"] };
  const first = (await save(a, base, inputs, metadata)).draft;
  const newService = new ProjectPlanningService(pool, auth);
  assert.deepEqual((await newService.save(a.sessionToken, a.csrfToken, { metadata: { ...metadata, requestId: meta().requestId }, projectId: p.projectId, expectedProjectVersion: 0, expectedDraftVersion: 0, inputs: { ...inputs, targetCountries: [...inputs.targetCountries].reverse(), contentForms: [...inputs.contentForms].reverse() } })).draft, first);
  const latest = (await save(a, first, { ...first.inputs, preOpeningGoal: "资格推进并保留引流" })).draft;
  assert.deepEqual((await save(a, base, inputs, metadata)).draft, latest);
  await assert.rejects(save(a, base, { ...inputs, targetCountries: [] }, metadata), errorCode("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual(await counts(p.projectId), { commands: 2, audits: 2 });
});
test("actual COMMIT success with lost transport response keeps original key safely replayable", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft, metadata = meta();
  let once = true;
  // Fault only AFTER real PG COMMIT. No fake DB success or pre-set business result.
  const faultPool = { connect: async () => {
    const client = await pool.connect();
    return { query: async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql, values);
      if (sql === "COMMIT" && once) { once = false; throw new Error("fixture-only-lost-commit-response"); }
      return result;
    }, release: () => client.release() } as unknown as PoolClient;
  } } as unknown as Pool;
  const faulty = new ProjectPlanningService(faultPool, auth);
  await assert.rejects(faulty.save(a.sessionToken, a.csrfToken, { metadata, projectId: p.projectId, expectedProjectVersion: 0, expectedDraftVersion: 0, inputs: base.inputs }),
    (e: unknown) => errorCode("INTERNAL_ERROR")(e) && e instanceof ProductTransactionError && e.retryable && !e.cause);
  const recovered = (await save(a, base, base.inputs, metadata)).draft;
  assert.equal(recovered.draftVersion, 1); assert.equal(recovered.projectFactVersion, 1); assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
});
test("same inputs do not fabricate a new project version, saved timestamp or audit", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft;
  const first = (await save(a, base, base.inputs)).draft, noop = (await save(a, first, first.inputs)).draft;
  assert.deepEqual(noop, first); assert.deepEqual(await counts(p.projectId), { commands: 2, audits: 1 });
});
test("upper-case UUID write and lower-case replay share the same committed request and canonical response", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId.toUpperCase())).draft, metadata = meta();
  const upper = { ...base, projectId: p.projectId.toUpperCase() };
  const first = (await save(a, upper, base.inputs, metadata)).draft;
  assert.equal(first.projectId, p.projectId); assert.deepEqual((await save(a, upper, base.inputs, metadata)).draft, first);
  assert.deepEqual((await save(a, base, base.inputs, metadata)).draft, first);
  assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
});
test("noncanonical time zone casing rejects before command persistence, canonical aliases save and replay unchanged", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft, metadata = meta();
  for (const businessTimeZone of ["asia/shanghai", "ASIA/SHANGHAI", "Asia/shanghai", "america/new_york", "Etc/utc", "US/eastern"]) {
    await assert.rejects(save(a, base, { ...base.inputs, businessTimeZone }, metadata), errorCode("INPUT_INVALID"));
    assert.deepEqual(await counts(p.projectId), { commands: 0, audits: 0 });
    assert.deepEqual((await service.read(a.sessionToken, p.projectId)).draft, base);
  }
  const inputs = { ...base.inputs, businessTimeZone: "US/Eastern" as const };
  const stored = (await save(a, base, inputs, metadata)).draft;
  assert.equal(stored.inputs.businessTimeZone, "US/Eastern");
  assert.deepEqual((await service.read(a.sessionToken, p.projectId)).draft, stored);
  assert.deepEqual((await save(a, base, inputs, metadata)).draft, stored);
  assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
});
test("two same-right operators saving the same draft version have one winner and preserved loser", async () => {
  const a = await actor(), b = await actor(), p = await project(a), base = (await service.read(b.sessionToken, p.projectId)).draft;
  const results = await Promise.allSettled([save(a, base, { ...base.inputs, preOpeningGoal: "A" }), save(b, base, { ...base.inputs, preOpeningGoal: "B" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected" && errorCode("FACT_VERSION_STALE")(r.reason)).length, 1);
  assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
});
test("basic metadata updates invalidate planning CAS and planning updates invalidate basic CAS", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft;
  await projects.save(a.sessionToken, a.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 0, basics: { name: "New basics", kind: p.kind, customerName: null, ownerOperatorId: a.operatorId, notificationEmail: null } }, "update");
  await assert.rejects(save(a, base, base.inputs), errorCode("FACT_VERSION_STALE"));
  const current = (await service.read(a.sessionToken, p.projectId)).draft; await save(a, current, current.inputs);
  await assert.rejects(projects.save(a.sessionToken, a.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 1, basics: { name: "Old basics edit", kind: p.kind, customerName: null, ownerOperatorId: a.operatorId, notificationEmail: null } }, "update"), errorCode("FACT_VERSION_STALE"));
});
test("CSRF, revoked session, disabled operator and unknown project fail closed on reads, writes and replay", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft, metadata = meta();
  await save(a, base, base.inputs, metadata);
  await assert.rejects(service.save(a.sessionToken, "", { metadata: meta(), projectId: p.projectId, expectedProjectVersion: 1, expectedDraftVersion: 1, inputs: base.inputs }), errorCode("AUTHENTICATION_REQUIRED"));
  await assert.rejects(service.read(a.sessionToken, randomUUID()), errorCode("FACT_VERSION_STALE"));
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [a.sessionId]);
  await assert.rejects(save(a, base, base.inputs, metadata), errorCode("AUTHENTICATION_REQUIRED"));
  const b = await actor(); await pool.query("UPDATE socialgrowth_product.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1", [b.operatorId]);
  await assert.rejects(service.read(b.sessionToken, p.projectId), errorCode("AUTHENTICATION_REQUIRED"));
});
test("audit failure atomically rolls back inputs, both versions and request key without leaking SQL", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft;
  await pool.query(`CREATE FUNCTION socialgrowth_product.fail_planning_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='project.planning_draft_saved' THEN RAISE EXCEPTION 'fixture-secret-planning'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER planning_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.fail_planning_audit()");
  try { await assert.rejects(save(a, base, base.inputs), (e: unknown) => errorCode("INTERNAL_ERROR")(e) && e instanceof Error && !e.message.includes("fixture-secret") && !e.cause); }
  finally { await pool.query("DROP TRIGGER planning_fault ON socialgrowth_product.audit_records"); await pool.query("DROP FUNCTION socialgrowth_product.fail_planning_audit()"); }
  assert.deepEqual((await service.read(a.sessionToken, p.projectId)).draft, base); assert.deepEqual(await counts(p.projectId), { commands: 0, audits: 0 });
});
test("session expiry after an observed project lock wait uses DB time and rolls back planning", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft, blocker = await pool.connect();
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE session_id=$1", [a.sessionId]);
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT 1 FROM socialgrowth_product.projects WHERE project_id=$1 FOR UPDATE", [p.projectId]);
    pending = save(a, base, base.inputs); const checked = assert.rejects(pending, errorCode("AUTHENTICATION_REQUIRED"));
    let waiting = false;
    for (let i = 0; i < 150; i++) { if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-planning-fixtures' AND wait_event_type='Lock' AND query LIKE '%projects%FOR UPDATE%' AND pid<>pg_backend_pid()" )).rowCount) { waiting = true; break; } await new Promise(r => setTimeout(r, 5)); }
    assert.ok(waiting);
    let expired = false;
    for (let i = 0; i < 150; i++) { if ((await pool.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM socialgrowth_product.operator_sessions WHERE session_id=$1", [a.sessionId])).rows[0]?.expired) { expired = true; break; } await new Promise(r => setTimeout(r, 5)); }
    assert.ok(expired); await blocker.query("COMMIT"); await checked;
    assert.deepEqual(await counts(p.projectId), { commands: 0, audits: 0 });
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => undefined); }
});
test("invalid planning and corrupted stored inputs cannot become approval or an unrestricted scope", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft;
  await assert.rejects(save(a, base, { ...base.inputs, businessTimeZone: "Asia/Unknown" }), errorCode("INPUT_INVALID"));
  await save(a, base, base.inputs);
  await assert.rejects(pool.query("UPDATE socialgrowth_product.project_planning_drafts SET status='approved' WHERE project_id=$1", [p.projectId]));
  await pool.query("UPDATE socialgrowth_product.project_planning_drafts SET inputs=inputs||'{\"permissionGranted\":true}'::jsonb WHERE project_id=$1", [p.projectId]);
  await assert.rejects(service.read(a.sessionToken, p.projectId), errorCode("INTERNAL_ERROR"));
});
test("version overflow rejects without wrapping either counter or claiming new saved facts", async () => {
  const a = await actor(), p = await project(a), base = (await service.read(a.sessionToken, p.projectId)).draft;
  const first = (await save(a, base, base.inputs)).draft;
  await pool.query("UPDATE socialgrowth_product.projects SET fact_version=9007199254740991 WHERE project_id=$1", [p.projectId]);
  const limit = (await service.read(a.sessionToken, p.projectId)).draft;
  await assert.rejects(save(a, limit, { ...limit.inputs, preOpeningGoal: "Changed at overflow" }), errorCode("FACT_VERSION_STALE"));
  assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
  assert.equal((await service.read(a.sessionToken, p.projectId)).draft.draftVersion, first.draftVersion);
});
