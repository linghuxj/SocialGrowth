import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { S3Client, CreateBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { contractVersion, materialCurrentViewSchema, saveMaterialDeclarationResponseSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, endpoint = process.env.SG_PRODUCT_TEST_STORAGE_ENDPOINT;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "32872" || new URL(url).pathname !== "/sg_registry_api"
  || endpoint !== "http://127.0.0.1:32905" || process.env.SG_PRODUCT_TEST_STORAGE_ISOLATED !== "1") throw new Error("Material declaration tests require owned isolated fixtures");
const accessKeyId = process.env.SG_PRODUCT_TEST_STORAGE_ACCESS_KEY, secretAccessKey = process.env.SG_PRODUCT_TEST_STORAGE_SECRET_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error("Explicit synthetic storage credentials required");
const pool = new Pool({ connectionString: url, max: 4 }), s = "socialgrowth_product", bucket = `sg-registry-api-${randomUUID()}`;
const admin = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
const env = { SG_PRODUCT_DATABASE_URL: url, SG_PRODUCT_AUTH_PEPPER: "synthetic-material-registry-pepper-00001", SG_PRODUCT_SMS_MODE: "unavailable", SG_PRODUCT_MATERIAL_MODE: "configured",
  SG_PRODUCT_MATERIAL_LOCATION_ID: randomUUID(), SG_PRODUCT_MATERIAL_ENDPOINT: endpoint, SG_PRODUCT_MATERIAL_REGION: "us-east-1", SG_PRODUCT_MATERIAL_BUCKET: bucket,
  SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: "true", SG_PRODUCT_MATERIAL_ACCESS_KEY: accessKeyId, SG_PRODUCT_MATERIAL_SECRET_KEY: secretAccessKey,
  SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "4096", SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: "3000" };
let app: INestApplication, base: string;
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `material-${randomUUID()}` });
async function boot() { const instance = await NestFactory.create(AppModule, { logger: false }); instance.useGlobalFilters(new ProductExceptionFilter()); await instance.listen(0, "127.0.0.1"); return instance; }
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
  await admin.send(new CreateBucketCommand({ Bucket: bucket })); Object.assign(process.env, env); delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN; delete process.env.SG_PRODUCT_MATERIAL_SESSION_TOKEN;
  app = await boot(); base = await app.getUrl();
});
after(async () => { try { await app?.close(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); admin.destroy(); } });
async function fixture() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID(), objectId = randomUUID();
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic registry','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic registry','company_owned',$2)`, [projectId, operatorId]);
  const bytes = Buffer.from(`synthetic declaration bytes-${randomUUID()}`);
  const upload = { metadata: meta(), projectId, objectId, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, contentType: "video/mp4" };
  const input = { metadata: meta(), projectId, contentUnitId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID(), variantId: randomUUID(), languageTag: "EN-us", expectedCurrentRevision: 0,
    identity: { mediaKind: "video", businessKind: "product", businessEntityId: randomUUID(), seriesId: null, episodeNumber: null },
    declaration: { name: "Synthetic declaration", description: "Explicit description", businessFacts: "Explicit facts", sourceStatement: "Synthetic source only", sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [objectId] };
  return { operatorId, sessionId, token, csrf, projectId, objectId, bytes, upload, input, path: `/api/operator/projects/${projectId}/materials`, uploadPath: `/api/operator/projects/${projectId}/material-uploads` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function send(f: Fixture, method: string, path = f.path, body: unknown = f.input, headers: Record<string, string> = {}, target = base) {
  const response = await fetch(`${target}${path}`, { method, headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json", ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.headers.get("cache-control"), "no-store"); const value = await response.json() as unknown;
  assert.ok(!JSON.stringify(value).includes(secretAccessKey!)); return { status: response.status, value };
}
async function upload(f: Fixture) {
  assert.equal((await send(f, "POST", f.uploadPath, f.upload)).status, 201); const metadata = meta();
  const result = await fetch(`${base}${f.uploadPath}/${f.objectId}/bytes`, { method: "PUT", body: new Uint8Array(f.bytes), headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf,
    "content-type": "application/octet-stream", "x-sg-contract-version": contractVersion, "x-request-id": metadata.requestId, "x-idempotency-key": metadata.idempotencyKey } });
  assert.equal(result.status, 200); await result.json();
}
async function counts(f: Fixture) { return (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.material_content_units WHERE content_unit_id=$1) units,
  (SELECT count(*)::int FROM ${s}.material_variants WHERE variant_id=$2) variants,(SELECT count(*)::int FROM ${s}.material_variant_revisions WHERE variant_id=$2) revisions,
  (SELECT count(*)::int FROM ${s}.material_registry_commands WHERE variant_id=$2) commands,(SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='material_variant' AND object_id=$2) audits`, [f.input.contentUnitId, f.input.variantId])).rows[0]; }
function code(result: { status: number; value: unknown }, status: number, expected: string) { assert.equal(result.status, status); assert.equal(productErrorResponseSchema.parse(result.value).error.code, expected); }
test("actual HTTP prepare/byte PUT/declaration save/current GET/restart keeps one pending revision and minimal facts", async () => {
  const f = await fixture(); await upload(f); const result = await send(f, "POST"); assert.equal(result.status, 201);
  const value = saveMaterialDeclarationResponseSchema.parse(result.value); assert.equal(value.languageTag, "en-us"); assert.equal(value.changed, true);
  assert.equal(value.status, "pending_validation"); assert.equal(value.candidateAllowed, false); assert.equal(value.eligibilityReason, "direction_not_approved");
  for (const forbidden of ["key", "storageLocationId", "storageBindingDigest", "recordedByOperatorId", "revisions"]) assert.ok(!JSON.stringify(value).includes(`"${forbidden}"`));
  assert.deepEqual(value.objects.map(o => o.objectId), [f.objectId]); assert.equal(value.publicationAllowed, false);
  await app.close(); app = await boot(); base = await app.getUrl();
  const current = await send(f, "GET", `${f.path}/${f.input.variantId}`); assert.equal(current.status, 200); assert.equal(materialCurrentViewSchema.parse(current.value).currentRevision, 1);
  assert.equal(saveMaterialDeclarationResponseSchema.parse((await send(f, "POST")).value).replayed, true);
  assert.deepEqual(await counts(f), { units: 1, variants: 1, revisions: 1, commands: 1, audits: 1 });
});
test("actual declaration auth rejects missing/bearer/suffix/duplicates/CSRF/revocation and keeps zero registry writes", async () => {
  const f = await fixture(); await upload(f);
  const headers: Record<string, string>[] = [{ cookie: "", authorization: `Bearer ${f.token}` }, { cookie: `__Host-sg_operator_session=${f.token}=` },
    { cookie: `__Host-sg_operator_session=${f.token}=extra` }, { cookie: `__Host-sg_operator_session=${f.token}==extra` }, { cookie: `__Host-sg_operator_session=${f.token}; __Host-sg_operator_session=${f.token}` }, { "x-csrf-token": "wrong" }];
  for (const item of headers) code(await send(f, "POST", f.path, f.input, item), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]);
  code(await send(f, "POST"), 401, "AUTHENTICATION_REQUIRED"); code(await send(f, "GET", `${f.path}/${f.input.variantId}`), 401, "AUTHENTICATION_REQUIRED");
  const disabled = await fixture(); await pool.query(`UPDATE ${s}.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [disabled.operatorId]);
  code(await send(disabled, "POST"), 401, "AUTHENTICATION_REQUIRED");
  assert.deepEqual(await counts(disabled), { units: 0, variants: 0, revisions: 0, commands: 0, audits: 0 });
  assert.deepEqual(await counts(f), { units: 0, variants: 0, revisions: 0, commands: 0, audits: 0 });
});
test("actual strict declaration/path/version and pending/cross-project object failures never invent saved history", async () => {
  const f = await fixture();
  for (const patch of [{ actorId: f.operatorId }, { status: "approved" }, { key: "foreign" }, { declaration: { ...f.input.declaration, businessFacts: "\nsecret-source" } }]) code(await send(f, "POST", f.path, { ...f.input, ...patch }), 400, "INPUT_INVALID");
  code(await send(f, "POST", f.path, { ...f.input, metadata: { ...f.input.metadata, contractVersion: "unsupported" } }), 400, "CONTRACT_VERSION_UNSUPPORTED");
  const other = await fixture(); code(await send(f, "POST", other.path), 400, "INPUT_INVALID");
  assert.equal((await send(f, "POST", f.uploadPath, f.upload)).status, 201); code(await send(f, "POST"), 503, "INTERNAL_ERROR");
  await upload(other); code(await send(f, "POST", f.path, { ...f.input, objectIds: [other.objectId] }), 503, "INTERNAL_ERROR");
  assert.deepEqual(await counts(f), { units: 0, variants: 0, revisions: 0, commands: 0, audits: 0 });
});
test("actual concurrent save, unchanged new key, continuous correction and old key converge without rebind", async () => {
  const f = await fixture(); await upload(f); const concurrent = await Promise.all([send(f, "POST"), send(f, "POST")]);
  assert.equal(concurrent.filter(r => saveMaterialDeclarationResponseSchema.parse(r.value).changed).length, 1);
  const unchanged = await send(f, "POST", f.path, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 }); assert.equal(saveMaterialDeclarationResponseSchema.parse(unchanged.value).changed, false);
  const correction = { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, businessFacts: "Explicit corrected facts" } };
  assert.equal(saveMaterialDeclarationResponseSchema.parse((await send(f, "POST", f.path, correction)).value).currentRevision, 2);
  const old = saveMaterialDeclarationResponseSchema.parse((await send(f, "POST")).value); assert.equal(old.currentRevision, 2); assert.equal(old.replayed, true);
  code(await send(f, "POST", f.path, { ...correction, metadata: meta() }), 409, "FACT_VERSION_STALE");
  code(await send(f, "POST", f.path, { ...f.input, declaration: correction.declaration }), 409, "IDEMPOTENCY_KEY_REUSED");
  code(await send(f, "POST", f.path, { ...f.input, metadata: meta(), expectedCurrentRevision: 2, sourceRecordId: randomUUID() }), 409, "FACT_VERSION_STALE");
  const history = (await pool.query(`SELECT declaration FROM ${s}.material_variant_revisions WHERE variant_id=$1 ORDER BY revision`, [f.input.variantId])).rows;
  assert.equal(history[0].declaration.businessFacts, "Explicit facts"); assert.equal(history[1].declaration.businessFacts, "Explicit corrected facts");
  assert.deepEqual(await counts(f), { units: 1, variants: 1, revisions: 2, commands: 3, audits: 2 });
});
test("actual deleted physical object leaves historical GET/original replay available but blocks a fresh declaration", async () => {
  const f = await fixture(); await upload(f); assert.equal((await send(f, "POST")).status, 201);
  await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: `projects/${f.projectId}/objects/${f.objectId}` }));
  assert.equal((await send(f, "GET", `${f.path}/${f.input.variantId}`)).status, 200);
  assert.equal(saveMaterialDeclarationResponseSchema.parse((await send(f, "POST")).value).replayed, true);
  code(await send(f, "POST", f.path, { ...f.input, metadata: meta(), expectedCurrentRevision: 1 }), 503, "INTERNAL_ERROR");
  assert.deepEqual(await counts(f), { units: 1, variants: 1, revisions: 1, commands: 1, audits: 1 });
});
test("actual unconfigured runtime authenticates before safe 503 and still returns historical current declaration", async () => {
  const f = await fixture(); await upload(f); assert.equal((await send(f, "POST")).status, 201);
  for (const key of Object.keys(env).filter(k => k.startsWith("SG_PRODUCT_MATERIAL_"))) delete process.env[key];
  const closed = await boot();
  try {
    const target = await closed.getUrl(), body = { ...f.input, metadata: meta(), expectedCurrentRevision: 1 };
    code(await send(f, "POST", f.path, body, { cookie: "" }, target), 401, "AUTHENTICATION_REQUIRED");
    code(await send(f, "POST", f.path, body, {}, target), 503, "INTERNAL_ERROR");
    assert.equal((await send(f, "GET", `${f.path}/${f.input.variantId}`, undefined, {}, target)).status, 200);
    assert.deepEqual(await counts(f), { units: 1, variants: 1, revisions: 1, commands: 1, audits: 1 });
  } finally { await closed.close(); Object.assign(process.env, env); }
});
test("actual current-only response still rejects corrupted earlier history rather than hiding it or replaying prior success", async () => {
  const f = await fixture(); await upload(f); assert.equal((await send(f, "POST")).status, 201);
  const correction = { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, description: "Second explicit description" } };
  assert.equal((await send(f, "POST", f.path, correction)).status, 201);
  const other = await fixture(); code(await send(f, "GET", `${other.path}/${f.input.variantId}`), 409, "FACT_VERSION_STALE");
  await pool.query(`ALTER TABLE ${s}.material_variant_revisions DISABLE TRIGGER material_revision_immutable`);
  try { await pool.query(`UPDATE ${s}.material_variant_revisions SET declaration=jsonb_set(declaration,'{name}',to_jsonb($2::text)) WHERE variant_id=$1 AND revision=1`, [f.input.variantId, "\nprivate-fixture-source"]); }
  finally { await pool.query(`ALTER TABLE ${s}.material_variant_revisions ENABLE TRIGGER material_revision_immutable`); }
  for (const result of [await send(f, "GET", `${f.path}/${f.input.variantId}`), await send(f, "POST")]) {
    code(result, 500, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(result.value).includes("private-fixture-source"));
  }
  assert.deepEqual(await counts(f), { units: 1, variants: 1, revisions: 2, commands: 2, audits: 2 });
});
test("actual ordered image group corrections retain old files and a new language shares the same human unit/source", async () => {
  const f = await fixture(), first = { ...f, upload: { ...f.upload, contentType: "image/png" } }, secondId = randomUUID();
  const second = { ...first, objectId: secondId, upload: { ...first.upload, metadata: meta(), objectId: secondId } }; await upload(first); await upload(second);
  const input = { ...f.input, identity: { ...f.input.identity, mediaKind: "image_text" }, objectIds: [secondId, f.objectId] };
  const result = saveMaterialDeclarationResponseSchema.parse((await send(f, "POST", f.path, input)).value); assert.deepEqual(result.objects.map(o => o.objectId), input.objectIds);
  const correction = { ...input, metadata: meta(), expectedCurrentRevision: 1, objectIds: [f.objectId, secondId] };
  assert.deepEqual(saveMaterialDeclarationResponseSchema.parse((await send(f, "POST", f.path, correction)).value).objects.map(o => o.objectId), correction.objectIds);
  const translated = { ...input, metadata: meta(), variantId: randomUUID(), languageTag: "zh-CN" };
  const translation = saveMaterialDeclarationResponseSchema.parse((await send(f, "POST", f.path, translated)).value); assert.equal(translation.contentUnitId, f.input.contentUnitId); assert.equal(translation.languageTag, "zh-cn");
  const old = (await pool.query(`SELECT object_references FROM ${s}.material_variant_revisions WHERE variant_id=$1 AND revision=1`, [f.input.variantId])).rows[0];
  assert.deepEqual(old.object_references.map((o: { objectId: string }) => o.objectId), input.objectIds);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.material_variants WHERE content_unit_id=$1`, [f.input.contentUnitId])).rows[0].n, 2);
});
test("actual maximum single declaration fits unchanged default JSON parser, while an oversized declaration is rejected", async () => {
  const f = await fixture(); await upload(f); const long = { ...f.input, declaration: { ...f.input.declaration, name: "😀".repeat(150),
    description: "😀".repeat(5000), businessFacts: "😀".repeat(5000), sourceStatement: "😀".repeat(5000) } };
  assert.ok(Buffer.byteLength(JSON.stringify(long)) < 100 * 1024);
  assert.equal((await send(f, "POST", f.path, long)).status, 201);
  code(await send(f, "POST", f.path, { ...long, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...long.declaration, name: "😀".repeat(151) } }), 400, "INPUT_INVALID");
  assert.deepEqual(await counts(f), { units: 1, variants: 1, revisions: 1, commands: 1, audits: 1 });
});
