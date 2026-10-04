import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion, directionApprovalSchema, directionProposalSchema, directionScopeSchema, emptyProjectPlanningInputs, initialDirectionAutonomy } from "@socialgrowth/product-contracts";
import { materialSaveSchema } from "./material-registry-core.js";
import { MaterialRegistryStore, MaterialRegistryError, type MaterialObjectVerifier } from "./material-registry-store.js";
import { ProjectLifecycleService } from "./project-lifecycle-service.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Material registry requires isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-material-registry-fixtures" });
const s = "socialgrowth_product", auth = new OperatorAuthService(pool, "synthetic-material-registry-pepper-00001");
const references = new Map<string, unknown>(); // NON-UI fixture, not actual verified storage/media.
const verifier: MaterialObjectVerifier = { verify: async ({ objectIds }) => objectIds.map(id => references.get(id)) };
const store = new MaterialRegistryStore(pool, auth, verifier);
const lifecycle = new ProjectLifecycleService(pool, auth);
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `material-${randomUUID()}` });
const code = (value: string) => (e: unknown) => (e instanceof MaterialRegistryError || e instanceof ProductTransactionError) && e.code === value && !e.cause;
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Material fixture','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
async function fixture() {
  const a = await actor(), projectId = randomUUID(), objectId = randomUUID();
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Material fixture','company_owned',$2)`, [projectId, a.operatorId]);
  references.set(objectId, { storageLocationId: randomUUID(), storageBindingDigest: "a".repeat(64), projectId, objectId, key: `projects/${projectId}/objects/${objectId}`, sha256: randomBytes(32).toString("hex"), bytes: 100, contentType: "video/mp4" });
  const input = materialSaveSchema.parse({ metadata: meta(), projectId, contentUnitId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID(),
    identity: { mediaKind: "video", businessKind: "product", businessEntityId: randomUUID(), seriesId: null, episodeNumber: null }, variantId: randomUUID(), languageTag: "EN-us", expectedCurrentRevision: 0,
    declaration: { name: "Synthetic video", description: "Synthetic description", businessFacts: "Synthetic facts", sourceStatement: "Fixture declaration, not source proof", sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [objectId] });
  return { a, input };
}
async function approveDirection(f: Awaited<ReturnType<typeof fixture>>, language = "en-us", forms = ["facebook_video"] as string[], languages = [language]) {
  const proposalId = randomUUID(), approvalId = randomUUID(), inputs = { ...emptyProjectPlanningInputs(), preOpeningGoal: "Synthetic", postOpeningGoal: "Synthetic",
    postOpeningPriority: "balanced" as const, targetCountries: ["US"], targetLanguages: languages, contentForms: forms as ("facebook_video" | "facebook_image_text" | "youtube_shorts" | "youtube_video")[],
    contentRules: "Synthetic rule requiring operator review", businessTimeZone: "America/New_York" as const, firstCycleStartsAt: "2099-01-01T00:00:00Z",
    reviewIntervalDays: 7, trafficMinimumPerCycle: 0, observationWindowHours: 24, tailObservationDays: 0, maxPublicationsPerDay: 1,
    publishingWindow: { startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-02-01T00:00:00Z" } };
  const scope = directionScopeSchema.parse({ inputs, identities: [{ platform: "facebook", canonicalRef: "synthetic_page", declaredStage: "before_monetization" }], autonomy: initialDirectionAutonomy });
  const proposal = directionProposalSchema.parse({ proposalId, projectId: f.input.projectId, projectVersion: 0, draftVersion: 1, snapshotDigest: "a".repeat(64), scope,
    output: { direction: "Synthetic", rationale: "Fixture only", limitations: [] }, generatedAt: "2026-10-01T00:00:00Z", providerKey: "fixture", modelKey: "fixture", responseId: randomUUID() });
  const approval = directionApprovalSchema.parse({ approvalId, proposal, confirmedByOperatorId: f.a.operatorId, confirmedByOperatorName: "Fixture operator",
    confirmedAt: "2026-10-01T00:00:00Z", status: "approved_waiting_readiness" });
  await pool.query(`INSERT INTO ${s}.project_planning_drafts(project_id,draft_version,inputs,saved_by_operator_id) VALUES($1,1,$2,$3)`, [f.input.projectId, inputs, f.a.operatorId]);
  await pool.query(`INSERT INTO ${s}.project_direction_proposals(proposal_id,project_id,record) VALUES($1,$2,$3)`, [proposalId, f.input.projectId, proposal]);
  await pool.query(`INSERT INTO ${s}.project_direction_approvals(approval_id,project_id,proposal_id,actor_id,request_key,payload_digest,record) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [approvalId, f.input.projectId, proposalId, f.a.operatorId, `approval-${approvalId}`, Buffer.alloc(32), approval]);
  await pool.query(`UPDATE ${s}.projects SET fact_version=1 WHERE project_id=$1`, [f.input.projectId]);
  return { approvalId, projectVersion: 1 };
}
function withConfirmation(input: Awaited<ReturnType<typeof fixture>>["input"], scope: Awaited<ReturnType<typeof approveDirection>>) {
  return { ...input, declaration: { ...input.declaration, expectedApprovedDirectionId: scope.approvalId, expectedApprovedProjectVersion: scope.projectVersion, contentRulesReviewed: true } };
}
const save = (f: Awaited<ReturnType<typeof fixture>>, input = f.input, service = store) => service.save(f.a.token, f.a.csrf, input);
async function counts(variantId: string) { return (await pool.query(`SELECT
  (SELECT count(*)::int FROM ${s}.material_variants WHERE variant_id=$1) variants,
  (SELECT count(*)::int FROM ${s}.material_variant_revisions WHERE variant_id=$1) revisions,
  (SELECT count(*)::int FROM ${s}.material_registry_commands WHERE variant_id=$1) commands,
  (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='material_variant' AND object_id=$1) audits`, [variantId])).rows[0]; }
before(async () => {
  const dir = new URL("../migrations/", import.meta.url), files = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort();
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); for (const file of files) await pool.query(await readFile(new URL(file, dir), "utf8"));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.material_variants`)).rowCount, 0);
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
test("authenticated save pins verified bytes and explicit first-use declaration but waits for current approved scope", async () => {
  const f = await fixture(), r = await save(f); assert.equal(r.changed, true); assert.equal(r.currentRevision, 1); assert.equal(r.languageTag, "en-us");
  assert.equal(r.candidateAllowed, false); assert.equal(r.status, "pending_validation"); assert.equal(r.eligibilityReason, "direction_not_approved");
  assert.equal(r.publicationAllowed, false); assert.equal(r.revisions[0]!.status, "pending_validation"); assert.match(r.revisions[0]!.recordedAt, /\.\d{6}Z$/);
  assert.deepEqual(await counts(f.input.variantId), { variants: 1, revisions: 1, commands: 1, audits: 1 });
  assert.equal((await store.read(f.a.token, f.input.projectId, f.input.variantId)).currentRevision, 1);
  const facts = (await pool.query(`SELECT facts FROM ${s}.audit_records WHERE object_type='material_variant' AND object_id=$1`, [f.input.variantId])).rows[0]!.facts;
  assert.deepEqual(facts, { revision: 1, status: "pending_validation", eligibilityReason: "direction_not_approved" });
});
test("current approved direction, exact current project version, matching language/form and affirmative rule review produce candidate only", async () => {
  const f = await fixture(), scope = await approveDirection(f), r = await save(f, withConfirmation(f.input, scope));
  assert.equal(r.status, "candidate"); assert.equal(r.candidateAllowed, true); assert.equal(r.eligibilityReason, null); assert.equal(r.publicationAllowed, false);
  assert.equal(r.revisions[0]!.status, "pending_validation"); // Candidate is a current projection, not an immutable history rewrite.
  assert.equal((await store.read(f.a.token, f.input.projectId, f.input.variantId)).status, "candidate");
  const unchecked = await fixture(), uncheckedScope = await approveDirection(unchecked);
  const pending = await save(unchecked, { ...unchecked.input, declaration: { ...unchecked.input.declaration, expectedApprovedDirectionId: uncheckedScope.approvalId,
    expectedApprovedProjectVersion: uncheckedScope.projectVersion } });
  assert.equal(pending.eligibilityReason, "content_rules_need_human_check");
  const wrongLanguage = await fixture(), wrongLanguageScope = await approveDirection(wrongLanguage, "zh-cn");
  const language = await save(wrongLanguage, withConfirmation(wrongLanguage.input, wrongLanguageScope)); assert.equal(language.eligibilityReason, "language_not_targeted");
  const wrongForm = await fixture(), wrongFormScope = await approveDirection(wrongForm, "en-us", ["facebook_image_text"]);
  const form = await save(wrongForm, withConfirmation(wrongForm.input, wrongFormScope)); assert.equal(form.eligibilityReason, "no_approved_content_form");
  const stale = await fixture(), staleScope = await approveDirection(stale); await pool.query(`UPDATE ${s}.projects SET fact_version=2 WHERE project_id=$1`, [stale.input.projectId]);
  const oldScope = await save(stale, withConfirmation(stale.input, staleScope)); assert.equal(oldScope.eligibilityReason, "approved_direction_stale");
});
test("terminal material withdrawal remains visible but cannot re-enter current planning candidates", async () => {
  const f = await fixture(), scope = await approveDirection(f), saved = await save(f, withConfirmation(f.input, scope));
  assert.equal(saved.candidateAllowed, true);
  const withdrawal = await lifecycle.withdrawMaterial(f.a.token, f.a.csrf, f.input.projectId, f.input.variantId,
    { metadata: meta(), expectedMaterialRevision: saved.currentRevision });
  assert.equal(withdrawal.changed, true); assert.equal(withdrawal.replayed, false);
  const current = await store.read(f.a.token, f.input.projectId, f.input.variantId);
  assert.equal(current.status, "pending_validation"); assert.equal(current.candidateAllowed, false);
  assert.equal(current.eligibilityReason, "material_withdrawn"); assert.equal(current.publicationAllowed, false);
  assert.equal(current.currentRevision, saved.currentRevision); assert.deepEqual(current.revisions, saved.revisions);
  assert.deepEqual(current.withdrawal, { state: "withdrawn", materialRevision: saved.currentRevision,
    requestId: withdrawal.requestId, recordedAt: current.withdrawal?.recordedAt });
  assert.match(current.withdrawal!.recordedAt!, /^\d{4}-\d{2}-\d{2}T/);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const candidates = await store.listCurrentForBusinessPlan(c, f.input.projectId);
    assert.equal(candidates.find(item => item.variantId === f.input.variantId)?.candidateAllowed, false);
    assert.equal(candidates.filter(item => item.candidateAllowed).some(item => item.variantId === f.input.variantId), false);
    await c.query("ROLLBACK");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  await assert.rejects(save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: saved.currentRevision }), code("FACT_VERSION_STALE"));
});
test("exact SHA already bound to another contentUnit keeps both current revisions pending; same unit language shares remain candidates", async () => {
  const first = await fixture(), firstScope = await approveDirection(first, "en-us", ["facebook_video"], ["en-us", "es"]), firstSaved = await save(first, withConfirmation(first.input, firstScope));
  assert.equal(firstSaved.candidateAllowed, true);
  const sameUnitLanguage = await save(first, withConfirmation({ ...first.input, metadata: meta(), variantId: randomUUID(), languageTag: "es" }, firstScope));
  assert.equal(sameUnitLanguage.candidateAllowed, true);
  const other = await fixture(), otherScope = await approveDirection(other);
  const ref = references.get(other.input.objectIds[0]!) as { sha256: string };
  references.set(other.input.objectIds[0]!, { ...ref, sha256: firstSaved.revisions[0]!.objects[0]!.sha256 });
  const collided = await save(other, withConfirmation(other.input, otherScope));
  assert.equal(collided.revisions.at(-1)!.status, "pending_validation");
  assert.equal(collided.eligibilityReason, "exact_sha_collision"); assert.equal(collided.candidateAllowed, false); assert.equal(collided.publicationAllowed, false);
  assert.equal((await store.read(first.a.token, first.input.projectId, first.input.variantId)).candidateAllowed, false);
  assert.equal((await store.read(first.a.token, first.input.projectId, sameUnitLanguage.variantId)).candidateAllowed, false);
});
test("same-key replay reads current without object IO; new key unchanged declaration adds no version", async () => {
  const f = await fixture(); await save(f); let calls = 0;
  const reader = new MaterialRegistryStore(pool, auth, { verify: async () => { calls++; throw new Error("should-not-verify-replay"); } });
  const replay = await save(f, { ...f.input, projectId: f.input.projectId.toUpperCase(), metadata: { ...f.input.metadata, requestId: `request-${randomUUID()}` } }, reader);
  assert.equal(replay.replayed, true); assert.equal(calls, 0);
  assert.equal((await save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 })).changed, false);
  await assert.rejects(save(f, { ...f.input, declaration: { ...f.input.declaration, name: "Other" } }), code("IDEMPOTENCY_KEY_REUSED"));
  assert.deepEqual(await counts(f.input.variantId), { variants: 1, revisions: 1, commands: 2, audits: 1 });
});
test("language variant and correction keep original unit/source and frozen ordered objects, no inferred new quota", async () => {
  const f = await fixture(), first = await save(f);
  const language = await save(f, { ...f.input, metadata: meta(), variantId: randomUUID(), languageTag: "es" }); assert.equal(language.contentUnitId, first.contentUnitId);
  await assert.rejects(save(f, { ...f.input, metadata: meta(), variantId: randomUUID(), languageTag: "EN-US" }), code("FACT_VERSION_STALE"));
  const second = await save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, description: "Corrected explicit facts" } });
  assert.equal(second.currentRevision, 2); assert.equal(first.revisions[0]!.status, "pending_validation"); assert.equal(second.revisions[0]!.status, "pending_validation");
  assert.deepEqual(second.revisions[0]!.declaration, first.revisions[0]!.declaration); assert.deepEqual(second.revisions[0]!.objects, first.revisions[0]!.objects);
  assert.equal((await save(f)).currentRevision, 2);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.material_content_units WHERE content_unit_id=$1`, [f.input.contentUnitId])).rows[0]!.n, 1);
});
test("same source record cannot reimport new content, rebind project, business identity or variant language", async () => {
  const f = await fixture(); await save(f);
  for (const patch of [{ contentUnitId: randomUUID(), variantId: randomUUID() }, { identity: { ...f.input.identity, businessEntityId: randomUUID() } }, { languageTag: "es" }, { sourceRecordId: randomUUID() }]) await assert.rejects(save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1, ...patch }), code("FACT_VERSION_STALE"));
  const other = await fixture(); await assert.rejects(save(other, { ...other.input, sourceId: f.input.sourceId, sourceRecordId: f.input.sourceRecordId }), code("FACT_VERSION_STALE"));
});
test("actual concurrent same command creates one material; concurrent stale corrections advance once", async () => {
  const f = await fixture(), first = await Promise.all([save(f), save(f)]); assert.equal(first.filter(v => v.changed).length, 1); assert.equal(first.filter(v => v.replayed).length, 1);
  const correction = { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, description: "Same correction" } };
  const results = await Promise.allSettled([save(f, correction), save(f, { ...correction, metadata: meta() })]);
  assert.equal(results.filter(v => v.status === "fulfilled").length, 1); assert.equal(results.filter(v => v.status === "rejected" && code("FACT_VERSION_STALE")(v.reason)).length, 1);
  assert.deepEqual(await counts(f.input.variantId), { variants: 1, revisions: 2, commands: 2, audits: 2 });
});
test("object IO is outside DB locks; returned values are captured before abort callback mutation", async () => {
  const f = await fixture(); let unlocked = false; const ref = structuredClone(references.get(f.input.objectIds[0]!)!); const verifiedSha = (ref as { sha256: string }).sha256;
  const service = new MaterialRegistryStore(pool, auth, { verify: async (_, signal) => {
    const observer = await pool.connect(); try { await observer.query("BEGIN"); await observer.query("SET LOCAL lock_timeout='100ms'"); await observer.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`); unlocked = true; }
    finally { await observer.query("ROLLBACK"); observer.release(); }
    signal.addEventListener("abort", () => { if (typeof ref === "object" && ref !== null) Object.assign(ref, { sha256: "c".repeat(64) }); }, { once: true }); return [ref];
  } });
  const result = await save(f, f.input, service); assert.equal(unlocked, true); assert.equal(result.revisions[0]!.objects[0]!.sha256, verifiedSha);
});
test("verification timeout, foreign manifest or private error cannot commit or expose raw cause", async () => {
  const f = await fixture();
  for (const verify of [async () => [{ ...(references.get(f.input.objectIds[0]!) as object), projectId: randomUUID() }], async () => { throw new Error("synthetic-private-marker"); }]) await assert.rejects(save(f, f.input, new MaterialRegistryStore(pool, auth, { verify })), (e: unknown) => e instanceof MaterialRegistryError && ["INVALID_OBJECTS", "VERIFIER_UNAVAILABLE"].includes(e.code) && !e.message.includes("private-marker") && !e.cause);
  await assert.rejects(save(f, f.input, new MaterialRegistryStore(pool, auth, { verify: async () => new Promise(() => {}) })), code("VERIFIER_UNAVAILABLE"));
  assert.deepEqual(await counts(f.input.variantId), { variants: 0, revisions: 0, commands: 0, audits: 0 });
});
test("current CSRF/session is required before verification and rechecked after real IO wait", async () => {
  const f = await fixture(); let calls = 0; const service = new MaterialRegistryStore(pool, auth, { verify: async ({ objectIds }) => { calls++; return objectIds.map(v => references.get(v)); } });
  await assert.rejects(service.save(f.a.token, "", f.input), code("AUTHENTICATION_REQUIRED")); assert.equal(calls, 0);
  await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE session_id=$1`, [f.a.sessionId]);
  await assert.rejects(save(f, f.input, new MaterialRegistryStore(pool, auth, { verify: async ({ objectIds }) => { await pool.query("SELECT pg_sleep(0.3)"); return objectIds.map(v => references.get(v)); } })), code("AUTHENTICATION_REQUIRED"));
  assert.deepEqual(await counts(f.input.variantId), { variants: 0, revisions: 0, commands: 0, audits: 0 });
});
test("numeric history crosses revision10 without overwriting, and SQL blocks identity/history mutation", async () => {
  const f = await fixture(); await save(f);
  for (let revision = 2; revision <= 12; revision++) await save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: revision - 1, declaration: { ...f.input.declaration, description: `Correction ${revision}` } });
  assert.deepEqual((await store.read(f.a.token, f.input.projectId, f.input.variantId)).revisions.map(v => v.revision), Array.from({ length: 12 }, (_, i) => i + 1));
  for (const table of ["material_variant_revisions", "material_content_units", "material_object_manifests"]) await assert.rejects(pool.query(`DELETE FROM ${s}.${table}`));
  await assert.rejects(pool.query(`UPDATE ${s}.material_variants SET current_revision=14 WHERE variant_id=$1`, [f.input.variantId]));
});
test("actual RETURN NULL suppression rolls back unit, object, variant, revision, command and audit", async () => {
  await pool.query(`CREATE FUNCTION ${s}.material_null_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  for (const table of ["material_content_units", "material_object_manifests", "material_variants", "material_variant_revisions", "material_registry_commands", "audit_records"]) {
    const f = await fixture(); await pool.query(`CREATE TRIGGER a_material_null_fixture BEFORE INSERT ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.material_null_fixture()`);
    try { await assert.rejects(save(f), code("INTERNAL_ERROR")); assert.deepEqual(await counts(f.input.variantId), { variants: 0, revisions: 0, commands: 0, audits: 0 });
      assert.equal((await pool.query(`SELECT 1 FROM ${s}.material_content_units WHERE content_unit_id=$1`, [f.input.contentUnitId])).rowCount, 0);
      assert.equal((await pool.query(`SELECT 1 FROM ${s}.material_object_manifests WHERE object_id=$1`, [f.input.objectIds[0]])).rowCount, 0); }
    finally { await pool.query(`DROP TRIGGER a_material_null_fixture ON ${s}.${table}`); }
  }
});
test("actual COMMIT acknowledgement loss recovers current pinned history after restart without repeated IO", async () => {
  const f = await fixture(); let fault = true;
  const faultPool = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, args?: unknown[]) => { const r = await c.query(sql, args); if (sql === "COMMIT" && fault && (await counts(f.input.variantId)).variants) { fault = false; throw new Error("synthetic-lost-ack"); } return r; }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(save(f, f.input, new MaterialRegistryStore(faultPool, auth, verifier)), code("INTERNAL_ERROR"));
  const r = await save(f, f.input, new MaterialRegistryStore(pool, auth, { verify: async () => { throw new Error("should-not-read"); } }));
  assert.equal(r.replayed, true); assert.equal(r.currentRevision, 1); assert.deepEqual(await counts(f.input.variantId), { variants: 1, revisions: 1, commands: 1, audits: 1 });
});
test("explicit batch persists later qualified items after invalid or conflicting rows, with actual per-item audit", async () => {
  const f = await fixture(), other = await fixture();
  const result = await store.saveBatch(f.a.token, f.a.csrf, { items: [{ ...f.input, approved: true }, f.input,
    { ...f.input, metadata: meta(), contentUnitId: randomUUID(), variantId: randomUUID() }, other.input] });
  assert.deepEqual(result.results.map(v => v.outcome), ["rejected", "saved", "rejected", "saved"]);
  assert.deepEqual(await counts(f.input.variantId), { variants: 1, revisions: 1, commands: 1, audits: 1 });
  assert.deepEqual(await counts(other.input.variantId), { variants: 1, revisions: 1, commands: 1, audits: 1 });
});
test("episode identity stays within one project/business; explicit image ordering is immutable per revision", async () => {
  const f = await fixture(); f.input.identity = { ...f.input.identity, businessKind: "drama", seriesId: randomUUID(), episodeNumber: 1 }; await save(f);
  await assert.rejects(save(f, { ...f.input, metadata: meta(), contentUnitId: randomUUID(), sourceRecordId: randomUUID(), variantId: randomUUID() }), code("FACT_VERSION_STALE"));
  const other = await fixture(); other.input.identity = f.input.identity; await assert.rejects(save(other), code("FACT_VERSION_STALE"));
  const images = await fixture(), secondId = randomUUID(); images.input.identity.mediaKind = "image_text";
  const firstRef = references.get(images.input.objectIds[0]!) as { projectId: string; objectId: string; contentType: string };
  firstRef.contentType = "image/png"; // Synthetic image manifest, not a real decoded image.
  references.set(secondId, { ...firstRef, objectId: secondId, key: `projects/${images.input.projectId}/objects/${secondId}`, contentType: "image/png" });
  images.input.objectIds.push(secondId); const first = await save(images);
  const second = await save(images, { ...images.input, metadata: meta(), expectedCurrentRevision: 1, objectIds: [...images.input.objectIds].reverse() });
  assert.equal(second.currentRevision, 2); assert.deepEqual(second.revisions[0]!.objects, first.revisions[0]!.objects);
  assert.deepEqual(second.revisions[1]!.objects.map(v => v.objectId), [...images.input.objectIds].reverse());
});
test("pinned manifest conflicts and missing earlier history reject current read/replay, not fallback success", async () => {
  const f = await fixture(); await save(f);
  const objectId = f.input.objectIds[0]!, old = references.get(objectId) as object; references.set(objectId, { ...old, sha256: "c".repeat(64) });
  await assert.rejects(save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, description: "Changed" } }), code("FACT_VERSION_STALE"));
  references.set(objectId, old); await save(f, { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, description: "Changed" } });
  await pool.query(`ALTER TABLE ${s}.material_variant_revisions DISABLE TRIGGER material_revision_immutable`);
  try { await pool.query(`DELETE FROM ${s}.material_variant_revisions WHERE variant_id=$1 AND revision=1`, [f.input.variantId]); }
  finally { await pool.query(`ALTER TABLE ${s}.material_variant_revisions ENABLE TRIGGER material_revision_immutable`); }
  await assert.rejects(store.read(f.a.token, f.input.projectId, f.input.variantId), code("CORRUPT_HISTORY"));
  let calls = 0; await assert.rejects(save(f, f.input, new MaterialRegistryStore(pool, auth, { verify: async () => { calls++; return []; } })), code("CORRUPT_HISTORY")); assert.equal(calls, 0);
});
