import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { materialLibraryResponseSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "32874" || new URL(url).pathname !== "/sg_library_api") throw new Error("Material library supplementary tests require owned isolated database");
const pool = new Pool({ connectionString: url, max: 4 }), s = "socialgrowth_product";
let app: INestApplication, base: string;
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
  process.env.SG_PRODUCT_DATABASE_URL = url; process.env.SG_PRODUCT_AUTH_PEPPER = "synthetic-material-library-pepper-00001"; process.env.SG_PRODUCT_SMS_MODE = "unavailable";
  delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN; process.env.SG_PRODUCT_MATERIAL_MODE = "unavailable";
  for (const key of ["LOCATION_ID", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "SESSION_TOKEN", "MAX_OBJECT_BYTES", "REQUEST_TIMEOUT_MS"]) delete process.env[`SG_PRODUCT_MATERIAL_${key}`];
  app = await NestFactory.create(AppModule, { logger: false }); app.useGlobalFilters(new ProductExceptionFilter()); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
after(async () => { try { await app?.close(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
async function fixture() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID(), digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic library','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic library','company_owned',$2)`, [projectId, operatorId]);
  return { operatorId, sessionId, token, projectId, path: `/api/operator/projects/${projectId}/materials` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function variantId(f: Fixture, index: number) { return `${f.projectId.slice(0, 24)}${index.toString(16).padStart(12, "0")}`; }
async function seedPendingHistory(f: Fixture, index: number, revisions = 1) {
  // Synthetic historical PENDING metadata only. No verified upload ticket,
  // actual bytes/media eligibility, UI success or public publication seeded.
  const variant = variantId(f, index), unit = randomUUID(), objectId = randomUUID(), c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO ${s}.material_content_units(content_unit_id,project_id,source_id,source_record_id,identity) VALUES($1,$2,$3,$4,$5)`, [unit, f.projectId, randomUUID(), randomUUID(), { mediaKind: "video", businessKind: "product", businessEntityId: randomUUID(), seriesId: null, episodeNumber: null }]);
    const reference = { storageLocationId: randomUUID(), storageBindingDigest: "b".repeat(64), projectId: f.projectId, objectId, key: `projects/${f.projectId}/objects/${objectId}`, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" };
    await c.query(`INSERT INTO ${s}.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [objectId, f.projectId, reference]);
    await c.query(`INSERT INTO ${s}.material_variants(variant_id,content_unit_id,project_id,language_tag,current_revision) VALUES($1,$2,$3,'en',$4)`, [variant, unit, f.projectId, revisions]);
    for (let revision = 1; revision <= revisions; revision++) {
      const declaration = { name: `Synthetic pending ${index}`, description: "Explicit pending", businessFacts: `Explicit historical revision ${revision}`, sourceStatement: "Synthetic declaration only", sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published" };
      await c.query(`INSERT INTO ${s}.material_variant_revisions(variant_id,revision,declaration,object_references,recorded_by_operator_id,recorded_at) VALUES($1,$2,$3,$4,$5,$6)`, [variant, revision, declaration, JSON.stringify([reference]), f.operatorId, `2026-09-30T00:00:${String(revision).padStart(2, "0")}.123456789123Z`]);
    }
    await c.query("COMMIT"); return variant;
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
async function get(f: Fixture, query = "", headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${f.path}${query}`, { headers: { cookie: `__Host-sg_operator_session=${f.token}`, ...headers } });
  assert.equal(response.headers.get("cache-control"), "no-store"); return { status: response.status, value: await response.json() as unknown };
}
function code(result: { status: number; value: unknown }, status: number, expected: string) { assert.equal(result.status, status); assert.equal(productErrorResponseSchema.parse(result.value).error.code, expected); }
const totals = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.material_variants) variants,(SELECT count(*)::int FROM ${s}.material_variant_revisions) revisions,(SELECT count(*)::int FROM ${s}.material_registry_commands) commands,(SELECT count(*)::int FROM ${s}.audit_records) audits`)).rows[0];
test("actual authenticated empty project is a known empty library, while unavailable project is not invented as empty", async () => {
  const f = await fixture(), before = await totals(), result = await get(f); assert.equal(result.status, 200);
  assert.deepEqual(materialLibraryResponseSchema.parse(result.value), { projectId: f.projectId, materials: [], nextAfterVariantId: null });
  code(await get({ ...f, path: `/api/operator/projects/${randomUUID()}/materials` }), 409, "FACT_VERSION_STALE"); assert.deepEqual(await totals(), before);
});
test("actual project-scoped stable variant pages cover 3/3/1 without duplicates, normalize cursor, and keep no private locators", async () => {
  const f = await fixture(), foreign = await fixture(); for (let index = 1; index <= 7; index++) await seedPendingHistory(f, index); await seedPendingHistory(foreign, 1);
  const first = materialLibraryResponseSchema.parse((await get(f, "?pageSize=3")).value); assert.deepEqual(first.materials.map(m => m.variantId), [1, 2, 3].map(i => variantId(f, i))); assert.equal(first.nextAfterVariantId, variantId(f, 3));
  const second = materialLibraryResponseSchema.parse((await get(f, `?pageSize=3&afterVariantId=${first.nextAfterVariantId!.toUpperCase()}`)).value); assert.deepEqual(second.materials.map(m => m.variantId), [4, 5, 6].map(i => variantId(f, i)));
  const last = materialLibraryResponseSchema.parse((await get(f, `?pageSize=3&afterVariantId=${second.nextAfterVariantId}`)).value); assert.deepEqual(last.materials.map(m => m.variantId), [variantId(f, 7)]); assert.equal(last.nextAfterVariantId, null);
  assert.equal(materialLibraryResponseSchema.parse((await get(f, `?afterVariantId=${variantId(f, 7)}`)).value).materials.length, 0);
  for (const key of ["key", "storageLocationId", "storageBindingDigest", "recordedByOperatorId", "revisions"]) assert.ok(!JSON.stringify(first).includes(`"${key}"`));
  // All operators remain same-role authorized, not per-project membership.
  assert.equal(materialLibraryResponseSchema.parse((await get({ ...f, path: foreign.path })).value).materials[0]!.projectId, foreign.projectId);
});
test("actual maximum fifty page uses lookahead and emits only selected current pending facts", async () => {
  const f = await fixture(); for (let index = 1; index <= 51; index++) await seedPendingHistory(f, index);
  const first = materialLibraryResponseSchema.parse((await get(f, "?pageSize=50")).value); assert.equal(first.materials.length, 50); assert.equal(first.nextAfterVariantId, variantId(f, 50));
  assert.ok(first.materials.every(m => m.status === "pending_validation" && !m.candidateAllowed && !m.publicationAllowed));
  const last = materialLibraryResponseSchema.parse((await get(f, `?pageSize=50&afterVariantId=${first.nextAfterVariantId}`)).value); assert.equal(last.materials.length, 1); assert.equal(last.nextAfterVariantId, null);
});
test("actual selected variant reads complete twelve-revision history before minimal current projection", async () => {
  const f = await fixture(); await seedPendingHistory(f, 1, 12); const row = materialLibraryResponseSchema.parse((await get(f)).value).materials[0]!;
  assert.equal(row.currentRevision, 12); assert.equal(row.declaration.businessFacts, "Explicit historical revision 12"); assert.equal(row.recordedAt, "2026-09-30T00:00:12.123456789123Z");
});
test("actual library Cookie/Bearer/credential/disabled/revocation authentication rejects reads without writes", async () => {
  const f = await fixture(); await seedPendingHistory(f, 1); const before = await totals();
  const invalidHeaders: Record<string, string>[] = [{ cookie: "", authorization: `Bearer ${f.token}` }, { cookie: `__Host-sg_operator_session=${f.token}=` }, { cookie: `__Host-sg_operator_session=${f.token}=extra` },
    { cookie: `__Host-sg_operator_session=${f.token}==extra` }, { cookie: `__Host-sg_operator_session=${f.token}; __Host-sg_operator_session=${f.token}` }];
  for (const headers of invalidHeaders) code(await get(f, "", headers), 401, "AUTHENTICATION_REQUIRED");
  assert.equal((await get(f, "", { "x-csrf-token": "irrelevant-to-read" })).status, 200);
  await pool.query(`UPDATE ${s}.operators SET credential_version=2 WHERE operator_id=$1`, [f.operatorId]); code(await get(f), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET credential_version=1,status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [f.operatorId]); code(await get(f), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET status='active',disabled_at=NULL WHERE operator_id=$1`, [f.operatorId]);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]); code(await get(f), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await totals(), before);
});
test("actual library query and same-project cursor guards distinguish malformed input and missing historical cursor", async () => {
  const f = await fixture(), other = await fixture(); const id = await seedPendingHistory(f, 1), foreign = await seedPendingHistory(other, 1);
  for (const query of ["?pageSize=0", "?pageSize=51", "?pageSize=01", "?pageSize=-1", "?pageSize=1&pageSize=2", "?afterVariantId=bad", "?extra=x"])
    code(await get(f, query), 400, "INPUT_INVALID");
  code(await get(f, `?afterVariantId=${randomUUID()}`), 409, "FACT_VERSION_STALE"); code(await get(f, `?afterVariantId=${foreign}`), 409, "FACT_VERSION_STALE");
  assert.equal(materialLibraryResponseSchema.parse((await get(f, `?afterVariantId=${id}`)).value).materials.length, 0);
});
test("actual corruption outside displayed history of selected variant rejects its page, not unrelated prior page", async () => {
  const f = await fixture(); await seedPendingHistory(f, 1); const corrupt = await seedPendingHistory(f, 2, 2);
  await pool.query(`ALTER TABLE ${s}.material_variant_revisions DISABLE TRIGGER material_revision_immutable`);
  try { await pool.query(`UPDATE ${s}.material_variant_revisions SET declaration=jsonb_set(declaration,'{name}',to_jsonb($2::text)) WHERE variant_id=$1 AND revision=1`, [corrupt, "\nprivate-library-error-marker"]); }
  finally { await pool.query(`ALTER TABLE ${s}.material_variant_revisions ENABLE TRIGGER material_revision_immutable`); }
  assert.equal((await get(f, "?pageSize=1")).status, 200); const result = await get(f, `?pageSize=1&afterVariantId=${variantId(f, 1)}`); code(result, 500, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(result.value).includes("private-library-error-marker"));
});
test("actual library waiting on guard rechecks database time after session expiry and cannot return late page", async () => {
  const f = await fixture(); await seedPendingHistory(f, 1); const holder = await pool.connect();
  try {
    await holder.query("BEGIN"); await holder.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`);
    await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE session_id=$1`, [f.sessionId]);
    const pending = get(f); let observed = false;
    for (let index = 0; index < 50; index++) {
      observed = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='sg_library_api' AND wait_event_type='Lock' AND query LIKE '%material_registry_guard%') present`)).rows[0].present;
      if (observed) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed); await new Promise(resolve => setTimeout(resolve, 550)); await holder.query("COMMIT"); code(await pending, 401, "AUTHENTICATION_REQUIRED");
  } finally { await holder.query("ROLLBACK"); holder.release(); }
});
