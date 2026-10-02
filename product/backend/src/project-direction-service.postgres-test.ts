import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { artemisPreflightAssignmentSchema, contractVersion, emptyProjectPlanningInputs, taskProtocolVersion, type ProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProjectService } from "./project-service.js";
import { ProjectPlanningService } from "./project-planning-service.js";
import { ProjectDirectionService } from "./project-direction-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import type { InitialDirectionModel } from "./artemis-business-model.js";
import { PostgresArtemisPreflightJournal } from "./artemis-preflight-journal.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires owned isolated reset-authorized PostgreSQL");
const pool = new Pool({ connectionString: url, max: 8 }), auth = new OperatorAuthService(pool, "isolated-direction-pepper-only-00000001");
const projects = new ProjectService(pool, auth), planning = new ProjectPlanningService(pool, auth);
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `direction-${randomUUID()}` });
const error = (code: string) => (e: unknown) => e instanceof ProductTransactionError && e.code === code;
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });
// Synthetic NON-UI fixtures with a controlled model port. They test transaction
// and recovery rules; real model + browser evidence is a separate Playwright run.
async function fixture(complete = true) {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Direction fixture','not-a-password','active')", [operatorId, `fixture-${operatorId}`]);
  await pool.query("INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')", [sessionId, operatorId, digest(token), digest(csrf)]);
  const p = (await projects.save(token, csrf, { metadata: metadata(), basics: { name: `Fixture-${randomUUID()}`, kind: "company_owned", customerName: null, ownerOperatorId: operatorId, notificationEmail: null } }, "create")).project;
  const inputs: ProjectPlanningInputs = { ...emptyProjectPlanningInputs(), preOpeningGoal: "Synthetic preparation", postOpeningGoal: "Synthetic retention", postOpeningPriority: "balanced", targetCountries: ["CN"], targetLanguages: ["zh"], contentForms: ["facebook_image_text"], contentRules: "Synthetic only; no publication", businessTimeZone: "Asia/Shanghai", firstCycleStartsAt: "2090-01-01T00:00:00Z", reviewIntervalDays: 7, trafficMinimumPerCycle: 0, observationWindowHours: 24, tailObservationDays: 0, maxPublicationsPerDay: 1, publishingWindow: { startsAt: "2090-01-01T00:00:00Z", endsAt: "2090-02-01T00:00:00Z" } };
  const draft = (await planning.save(token, csrf, { metadata: metadata(), projectId: p.projectId, expectedProjectVersion: 0, expectedDraftVersion: 0, inputs: complete ? inputs : emptyProjectPlanningInputs() })).draft;
  const request = { metadata: metadata(), projectId: p.projectId, expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion, identities: [{ platform: "facebook", canonicalRef: "synthetic_page", declaredStage: "before_monetization" }] };
  return { operatorId, sessionId, token, csrf, p, draft, request };
}
const result = () => ({ providerKey: "synthetic-port", modelKey: "supplemental-fixture", responseId: randomUUID(), output: { direction: "Synthetic bounded direction", rationale: "Supplemental test only", limitations: ["Not real model evidence"] } });
const model: InitialDirectionModel = { generateDirection: async () => result() };
const service = (port: InitialDirectionModel | null = model) => new ProjectDirectionService(pool, auth, port);
const confirm = (f: Awaited<ReturnType<typeof fixture>>, proposal: NonNullable<Awaited<ReturnType<ProjectDirectionService["read"]>>["proposal"]>, meta = metadata()) => ({ metadata: meta, projectId: f.p.projectId, expectedProjectVersion: proposal.projectVersion, proposalId: proposal.proposalId, snapshotDigest: proposal.snapshotDigest });
async function count(id: string) { return (await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.project_direction_attempts WHERE project_id=$1) attempts,(SELECT count(*)::int FROM socialgrowth_product.project_direction_proposals WHERE project_id=$1) proposals,(SELECT count(*)::int FROM socialgrowth_product.project_direction_approvals WHERE project_id=$1) approvals`, [id])).rows[0]; }
test("incomplete or identity-mismatched scope cannot invoke the model or claim an attempt", async () => {
  const f = await fixture(false); let calls = 0; const s = service({ generateDirection: async () => { calls++; return result(); } });
  await assert.rejects(s.generate(f.token, f.csrf, f.request), error("INPUT_INVALID"));
  const g = await fixture(); await assert.rejects(s.generate(g.token, g.csrf, { ...g.request, identities: [{ platform: "youtube", canonicalRef: "synthetic", declaredStage: "before_monetization" }] }), error("INPUT_INVALID"));
  assert.equal(calls, 0); assert.deepEqual(await count(f.p.projectId), { attempts: 0, proposals: 0, approvals: 0 });
});
test("original concurrent generation claims once and rebuild replay cannot spend another model call", async () => {
  const f = await fixture(); let calls = 0, release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const s = service({ generateDirection: async () => { calls++; entered(); await gate; return result(); } });
  const first = s.generate(f.token, f.csrf, f.request); await started;
  assert.equal((await s.generate(f.token, f.csrf, f.request)).attempt?.state, "requested");
  await assert.rejects(s.generate(f.token, f.csrf, { ...f.request, metadata: metadata() }), error("FACT_VERSION_STALE"));
  release(); const proposed = await first; assert.ok(proposed.proposal);
  const replay = await service().generate(f.token, f.csrf, { ...f.request, metadata: { ...f.request.metadata, requestId: metadata().requestId } });
  assert.equal(replay.proposal?.proposalId, proposed.proposal.proposalId); assert.equal(calls, 1);
  await assert.rejects(s.generate(f.token, f.csrf, { ...f.request, identities: [{ platform: "facebook", canonicalRef: "different", declaredStage: "before_monetization" }] }), error("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual(await count(f.p.projectId), { attempts: 1, proposals: 1, approvals: 0 });
});
test("planning change while model is in flight discards its result instead of approving stale facts", async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const s = service({ generateDirection: async () => { entered(); await gate; return result(); } });
  const request = s.generate(f.token, f.csrf, f.request); await started;
  await planning.save(f.token, f.csrf, { metadata: metadata(), projectId: f.p.projectId, expectedProjectVersion: f.draft.projectFactVersion, expectedDraftVersion: f.draft.draftVersion, inputs: { ...f.draft.inputs, contentRules: "Changed while model ran" } });
  release(); assert.equal((await request).attempt?.state, "facts_changed"); assert.deepEqual(await count(f.p.projectId), { attempts: 1, proposals: 0, approvals: 0 });
});
test("unavailable real port does not synthesize a proposal; replay remains unavailable", async () => {
  const f = await fixture(), s = service(null);
  assert.equal((await s.generate(f.token, f.csrf, f.request)).attempt?.state, "unavailable");
  assert.equal((await service().generate(f.token, f.csrf, f.request)).attempt?.state, "unavailable");
  assert.deepEqual(await count(f.p.projectId), { attempts: 1, proposals: 0, approvals: 0 });
});
test("confirmation is atomic, immutable, replayable after rebuild and leaves all execution blocked", async () => {
  const f = await fixture(), s = service(), generated = await s.generate(f.token, f.csrf, f.request); assert.ok(generated.proposal);
  const request = confirm(f, generated.proposal), approved = await s.confirm(f.token, f.csrf, request);
  assert.ok(approved.approval); assert.equal(approved.projectVersion, f.draft.projectFactVersion + 1);
  assert.equal(approved.executionAllowed, false); assert.equal(approved.publicationAllowed, false);
  assert.equal((await service().confirm(f.token, f.csrf, request)).approval?.approvalId, approved.approval.approvalId);
  await assert.rejects(pool.query("UPDATE socialgrowth_product.project_direction_approvals SET record=record||'{\"status\":\"approved\"}'::jsonb WHERE project_id=$1", [f.p.projectId]));
  await assert.rejects(pool.query("DELETE FROM socialgrowth_product.project_direction_proposals WHERE project_id=$1", [f.p.projectId]));
  assert.deepEqual(await count(f.p.projectId), { attempts: 1, proposals: 1, approvals: 1 });
});
test("stale confirmation and concurrent confirmations cannot replace the approved scope", async () => {
  const f = await fixture(), s = service(), old = await s.generate(f.token, f.csrf, f.request); assert.ok(old.proposal);
  await planning.save(f.token, f.csrf, { metadata: metadata(), projectId: f.p.projectId, expectedProjectVersion: f.draft.projectFactVersion, expectedDraftVersion: f.draft.draftVersion, inputs: { ...f.draft.inputs, preOpeningGoal: "New goal" } });
  await assert.rejects(s.confirm(f.token, f.csrf, confirm(f, old.proposal)), error("FACT_VERSION_STALE"));
  const draft = (await planning.read(f.token, f.p.projectId)).draft;
  const next = await s.generate(f.token, f.csrf, { ...f.request, metadata: metadata(), expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion }); assert.ok(next.proposal);
  const outcomes = await Promise.allSettled([s.confirm(f.token, f.csrf, confirm(f, next.proposal)), s.confirm(f.token, f.csrf, confirm(f, next.proposal))]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1); assert.equal(outcomes.filter(r => r.status === "rejected" && error("FACT_VERSION_STALE")(r.reason)).length, 1);
  const approved = (await s.read(f.token, f.p.projectId)).approval; assert.equal(approved?.proposal.scope.inputs.preOpeningGoal, "New goal");
});
test("expired advisory claim recovers to unavailable and rejects any late model result", async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const s = service({ generateDirection: async () => { entered(); await gate; return result(); } });
  const pending = s.generate(f.token, f.csrf, f.request); await started;
  await pool.query("UPDATE socialgrowth_product.project_direction_attempts SET result_deadline=clock_timestamp()-interval '1 second' WHERE project_id=$1", [f.p.projectId]);
  assert.equal((await service().read(f.token, f.p.projectId)).attempt?.state, "unavailable");
  assert.equal((await pool.query("SELECT state FROM socialgrowth_product.project_direction_attempts WHERE project_id=$1", [f.p.projectId])).rows[0].state, "requested");
  release(); assert.equal((await pending).attempt?.state, "unavailable");
  assert.deepEqual(await count(f.p.projectId), { attempts: 1, proposals: 0, approvals: 0 });
});
test("revoked session during generation cannot persist a proposal, approval or raw provider error", async () => {
  const f = await fixture(); const s = service({ generateDirection: async () => { await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [f.sessionId]); return result(); } });
  await assert.rejects(s.generate(f.token, f.csrf, f.request), error("AUTHENTICATION_REQUIRED"));
  assert.deepEqual(await count(f.p.projectId), { attempts: 1, proposals: 0, approvals: 0 });
});
test("audit error rolls confirmation and project version back together", async () => {
  const f = await fixture(), s = service(), generated = await s.generate(f.token, f.csrf, f.request); assert.ok(generated.proposal);
  await pool.query(`CREATE FUNCTION socialgrowth_product.direction_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='project.direction_confirmed' THEN RAISE EXCEPTION 'fixture-secret'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER direction_audit_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.direction_audit_fault()");
  try { await assert.rejects(s.confirm(f.token, f.csrf, confirm(f, generated.proposal)), e => error("INTERNAL_ERROR")(e) && e instanceof Error && !e.message.includes("fixture-secret")); }
  finally { await pool.query("DROP TRIGGER direction_audit_fault ON socialgrowth_product.audit_records"); await pool.query("DROP FUNCTION socialgrowth_product.direction_audit_fault()"); }
  assert.equal((await s.read(f.token, f.p.projectId)).projectVersion, f.draft.projectFactVersion); assert.equal((await count(f.p.projectId)).approvals, 0);
});
test("an in-flight replacement direction cannot be bypassed by confirming the previous proposal", async () => {
  const f = await fixture(), initial = await service().generate(f.token, f.csrf, f.request); assert.ok(initial.proposal);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const s = service({ generateDirection: async () => { entered(); await gate; return result(); } });
  const pending = s.generate(f.token, f.csrf, { ...f.request, metadata: metadata() }); await started;
  await assert.rejects(service().confirm(f.token, f.csrf, confirm(f, initial.proposal)), error("FACT_VERSION_STALE"));
  release(); const current = await pending; assert.ok(current.proposal);
  assert.ok((await service().confirm(f.token, f.csrf, confirm(f, current.proposal))).approval);
});
test("declared stage limits required goals and cannot be changed by original-key replay", async () => {
  const f = await fixture(), s = service();
  const draft = (await planning.save(f.token, f.csrf, { metadata: metadata(), projectId: f.p.projectId, expectedProjectVersion: f.draft.projectFactVersion, expectedDraftVersion: f.draft.draftVersion, inputs: { ...f.draft.inputs, postOpeningGoal: null, postOpeningPriority: null } })).draft;
  const request = { ...f.request, metadata: metadata(), expectedProjectVersion: draft.projectFactVersion, expectedDraftVersion: draft.draftVersion };
  const proposal = (await s.generate(f.token, f.csrf, request)).proposal; assert.ok(proposal); assert.equal(proposal.scope.identities[0]?.declaredStage, "before_monetization");
  assert.deepEqual(proposal.scope.autonomy.reconfirm, ["change_main_goal", "change_confirmed_direction", "exceed_scope"]);
  await assert.rejects(s.generate(f.token, f.csrf, { ...request, identities: [{ ...request.identities[0], declaredStage: "after_monetization" }] }), error("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(s.generate(f.token, f.csrf, { ...request, metadata: metadata(), identities: [{ ...request.identities[0], declaredStage: "after_monetization" }] }), error("INPUT_INVALID"));
});
function assignment() {
  const sha = "a".repeat(64), objectId = randomUUID();
  const a = artemisPreflightAssignmentSchema.parse({ serial: "SYNTHETIC_SERIAL", platformIdentity: "synthetic-page", task: {
    protocolVersion: taskProtocolVersion, kind: "publish_content", taskId: randomUUID(), taskRevision: 1, projectId: randomUUID(), taskAttemptId: randomUUID(), deviceId: randomUUID(), identityId: randomUUID(), platform: "facebook", form: "facebook_video", arrangementRevision: 1, projectVersion: 1, assignmentId: randomUUID(), assignmentVersion: 1, approvalId: randomUUID(), approvalVersion: 1, contentUnitId: randomUUID(), variantId: randomUUID(), materialRevision: 1, languageTag: "zh", objects: [{ objectId, sha256: sha, bytes: 3, contentType: "video/mp4" }], title: "Synthetic", caption: "Not a real task or real rights", scheduledAt: "2090-01-01T00:00:00Z", window: { startsAt: "2090-01-01T00:00:00Z", endsAt: "2090-01-02T00:00:00Z" }, recovery: { roundId: randomUUID(), maxAttempts: 2, maxElapsedMs: 300000 } }, media: [{ objectId, sha256: sha, path: `/sdcard/Movies/SocialGrowth/${sha}.mp4` }] });
  return { a, digest: createHash("sha256").update(JSON.stringify(a)).digest("hex") };
}
test("durable preflight concurrent claim has one winner and rebuild preserves unknown launch intent", async () => {
  const { a, digest } = assignment(), j = new PostgresArtemisPreflightJournal(pool);
  const outcomes = await Promise.all([j.claim(a, digest), j.claim(a, digest)]);
  assert.equal(outcomes.filter(v => v.state === "new").length, 1);
  assert.deepEqual(await new PostgresArtemisPreflightJournal(pool).claim(a, digest), { state: "existing", traceId: null });
  assert.deepEqual(await j.read(a, digest), { traceId: null });
});
test("conflicting task/file intent is rejected without changing the persisted original", async () => {
  const { a, digest } = assignment(), j = new PostgresArtemisPreflightJournal(pool); await j.claim(a, digest);
  const altered = { ...a, platformIdentity: "other-page" }, alteredHash = createHash("sha256").update(JSON.stringify(artemisPreflightAssignmentSchema.parse(altered))).digest("hex");
  await assert.rejects(j.claim(altered, alteredHash)); await assert.rejects(j.claim(a, "b".repeat(64)));
  assert.deepEqual(await j.read(a, digest), { traceId: null });
});
test("lost real PG claim COMMIT acknowledgement cannot turn restart into a fresh claim", async () => {
  const { a, digest } = assignment(); let once = true;
  const faultPool = { connect: async () => { const client = await pool.connect(); return { query: async (sql: string, args?: unknown[]) => {
    const result = await client.query(sql, args); if (sql === "COMMIT" && once) { once = false; throw new Error("lost-claim-ack"); } return result;
  }, release: () => client.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(new PostgresArtemisPreflightJournal(faultPool).claim(a, digest));
  assert.deepEqual(await new PostgresArtemisPreflightJournal(pool).claim(a, digest), { state: "existing", traceId: null });
});
test("trace is one-to-one immutable and lost binding ACK preserves the exact original trace", async () => {
  const { a, digest } = assignment(), j = new PostgresArtemisPreflightJournal(pool), trace = randomUUID(); await j.claim(a, digest);
  let once = true; const faultPool = { connect: async () => { const client = await pool.connect(); return { query: async (sql: string, args?: unknown[]) => { const r = await client.query(sql, args); if (sql === "COMMIT" && once) { once = false; throw new Error("lost-binding-ack"); } return r; }, release: () => client.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(new PostgresArtemisPreflightJournal(faultPool).bindTrace(a.task.taskAttemptId, digest, trace));
  assert.deepEqual(await new PostgresArtemisPreflightJournal(pool).read(a, digest), { traceId: trace });
  await j.bindTrace(a.task.taskAttemptId, digest, trace);
  await assert.rejects(j.bindTrace(a.task.taskAttemptId, digest, randomUUID()));
  const other = assignment(); await j.claim(other.a, other.digest); await assert.rejects(j.bindTrace(other.a.task.taskAttemptId, other.digest, trace));
  await assert.rejects(pool.query("UPDATE socialgrowth_product.artemis_preflight_intents SET trace_id=NULL,bound_at=NULL WHERE task_attempt_id=$1", [a.task.taskAttemptId]));
});
test("unknown observation cannot erase bound trace or promote model evidence into publication", async () => {
  const { a, digest } = assignment(), j = new PostgresArtemisPreflightJournal(pool), trace = randomUUID(); await j.claim(a, digest); await j.bindTrace(a.task.taskAttemptId, digest, trace);
  await j.record(a.task.taskAttemptId, digest, { traceId: null, state: "launch_unknown", publicationState: "unverified", publicationAllowed: false, evidenceIds: [] });
  await j.record(a.task.taskAttemptId, digest, { traceId: trace, state: "reported_ready", publicationState: "unverified", publicationAllowed: false, evidenceIds: [randomUUID()] });
  assert.deepEqual(await j.read(a, digest), { traceId: trace });
  await assert.rejects(j.record(a.task.taskAttemptId, digest, { traceId: randomUUID(), state: "running", publicationState: "unverified", publicationAllowed: false, evidenceIds: [] }));
  const rows = (await pool.query("SELECT record FROM socialgrowth_product.artemis_preflight_observations WHERE task_attempt_id=$1", [a.task.taskAttemptId])).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.record.publicationState === "unverified" && r.record.publicationAllowed === false));
  await assert.rejects(pool.query("DELETE FROM socialgrowth_product.artemis_preflight_observations WHERE task_attempt_id=$1", [a.task.taskAttemptId]));
});
test("journal rejects absent binding and corrupt stored assignments before returning a trace", async () => {
  const { a, digest } = assignment(), j = new PostgresArtemisPreflightJournal(pool);
  await assert.rejects(j.bindTrace(a.task.taskAttemptId, digest, randomUUID())); assert.equal(await j.read(a, digest), null);
  await assert.rejects(j.record(a.task.taskAttemptId, digest, { traceId: null, state: "launch_unknown", publicationState: "unverified", publicationAllowed: false, evidenceIds: [] }));
  await assert.rejects(pool.query("INSERT INTO socialgrowth_product.artemis_preflight_intents(task_attempt_id,fingerprint,assignment) VALUES($1,$2,'{}'::jsonb)", [a.task.taskAttemptId, digest]));
});
