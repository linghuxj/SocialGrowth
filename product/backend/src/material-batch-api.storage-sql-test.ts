import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { contractVersion, batchMaterialDeclarationsResponseSchema, materialHistoryResponseSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { MaterialRuntime } from "./material-runtime.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, endpoint = process.env.SG_PRODUCT_TEST_STORAGE_ENDPOINT;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "32873" || new URL(url).pathname !== "/sg_batch_api"
  || endpoint !== "http://127.0.0.1:32906" || process.env.SG_PRODUCT_TEST_STORAGE_ISOLATED !== "1") throw new Error("Material batch supplemental tests require owned isolated fixtures");
const accessKeyId = process.env.SG_PRODUCT_TEST_STORAGE_ACCESS_KEY, secretAccessKey = process.env.SG_PRODUCT_TEST_STORAGE_SECRET_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error("Explicit synthetic storage credentials required");
const pool = new Pool({ connectionString: url, max: 4 }), s = "socialgrowth_product", bucket = `sg-batch-api-${randomUUID()}`;
const admin = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
const env = { SG_PRODUCT_DATABASE_URL: url, SG_PRODUCT_AUTH_PEPPER: "synthetic-material-batch-pepper-0000001", SG_PRODUCT_SMS_MODE: "unavailable", SG_PRODUCT_MATERIAL_MODE: "configured",
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
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic batch','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic batch','company_owned',$2)`, [projectId, operatorId]);
  const bytes = Buffer.from(`synthetic batch bytes-${randomUUID()}`), input = { metadata: meta(), projectId, contentUnitId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID(), variantId: randomUUID(), languageTag: "en", expectedCurrentRevision: 0,
    identity: { mediaKind: "video", businessKind: "product", businessEntityId: randomUUID(), seriesId: null, episodeNumber: null },
    declaration: { name: "Synthetic batch", description: "Explicit", businessFacts: "Explicit", sourceStatement: "Synthetic source", sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [objectId] };
  return { operatorId, sessionId, token, csrf, projectId, objectId, bytes, input, path: `/api/operator/projects/${projectId}/materials`, uploadPath: `/api/operator/projects/${projectId}/material-uploads` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function send(f: Fixture, method: string, path = f.path, body: unknown = f.input, headers: Record<string, string> = {}, target = base) {
  const response = await fetch(`${target}${path}`, { method, headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json", ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.headers.get("cache-control"), "no-store"); const value = await response.json() as unknown;
  assert.ok(!JSON.stringify(value).includes(secretAccessKey!)); return { status: response.status, value };
}
async function upload(f: Fixture, complete = true) {
  const descriptor = { metadata: meta(), projectId: f.projectId, objectId: f.objectId, sha256: createHash("sha256").update(f.bytes).digest("hex"), bytes: f.bytes.length, contentType: "video/mp4" };
  assert.equal((await send(f, "POST", f.uploadPath, descriptor)).status, 201); if (!complete) return;
  const metadata = meta(), result = await fetch(`${base}${f.uploadPath}/${f.objectId}/bytes`, { method: "PUT", body: new Uint8Array(f.bytes), headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf,
    "content-type": "application/octet-stream", "x-sg-contract-version": contractVersion, "x-request-id": metadata.requestId, "x-idempotency-key": metadata.idempotencyKey } });
  assert.equal(result.status, 200); await result.json();
}
const another = (f: Fixture) => ({ ...f.input, metadata: meta(), contentUnitId: randomUUID(), sourceRecordId: randomUUID(), variantId: randomUUID() });
const batch = (f: Fixture, items: unknown[]) => ({ metadata: { contractVersion, requestId: `request-${randomUUID()}` }, projectId: f.projectId, items });
const commandCount = async (variantId: string) => (await pool.query(`SELECT count(*)::int n FROM ${s}.material_registry_commands WHERE variant_id=$1`, [variantId])).rows[0].n;
function code(result: { status: number; value: unknown }, status: number, expected: string) { assert.equal(result.status, status); assert.equal(productErrorResponseSchema.parse(result.value).error.code, expected); }
test("actual explicit batch keeps per-item errors and later good items, then original keys replay without new commands", async () => {
  const f = await fixture(); await upload(f); const second = another(f), body = batch(f, [{ bad: "private-batch-error-marker" }, f.input, { ...f.input, projectId: randomUUID() }, second]);
  const first = await send(f, "POST", `${f.path}/batch`, body); assert.equal(first.status, 201);
  const result = batchMaterialDeclarationsResponseSchema.parse(first.value); assert.deepEqual(result.results.map(r => [r.index, r.outcome]), [[0, "rejected"], [1, "saved"], [2, "rejected"], [3, "saved"]]);
  assert.ok(!JSON.stringify(result).includes("private-batch-error-marker")); assert.ok(!("allSaved" in result));
  const replay = batchMaterialDeclarationsResponseSchema.parse((await send(f, "POST", `${f.path}/batch`, body)).value);
  assert.ok(replay.results.every(r => r.outcome === "rejected" || r.material.replayed));
  assert.equal(await commandCount(f.input.variantId), 1); assert.equal(await commandCount(second.variantId), 1);
});
test("actual batch auth/CSRF/path/version and count guard reject the envelope before any per-item writes", async () => {
  const f = await fixture(); await upload(f); const body = batch(f, [f.input]);
  for (const headers of [{ cookie: "" }, { cookie: `__Host-sg_operator_session=${f.token}=` }, { "x-csrf-token": "wrong" }] as Record<string, string>[])
    code(await send(f, "POST", `${f.path}/batch`, body, headers), 401, "AUTHENTICATION_REQUIRED");
  code(await send(f, "POST", `${f.path}/batch`, batch(f, Array(51).fill(f.input))), 400, "INPUT_INVALID");
  code(await send(f, "POST", `${f.path}/batch`, { ...body, metadata: { ...body.metadata, contractVersion: "unsupported" } }), 400, "CONTRACT_VERSION_UNSUPPORTED");
  code(await send(f, "POST", `${f.path}/batch`, { ...body, projectId: randomUUID() }), 400, "INPUT_INVALID");
  code(await send(f, "POST", `${f.path}/batch`, { ...body, metadata: f.input.metadata }), 400, "INPUT_INVALID");
  assert.equal(await commandCount(f.input.variantId), 0);
});
test("actual 50 indexed original-key entries fit transport and advance once, oversized legal batch safely returns 413", async () => {
  const f = await fixture(); await upload(f); const fifty = batchMaterialDeclarationsResponseSchema.parse((await send(f, "POST", `${f.path}/batch`, batch(f, Array(50).fill(f.input)))).value);
  assert.equal(fifty.results.length, 50); assert.equal(fifty.results.filter(r => r.outcome === "saved" && r.material.changed).length, 1); assert.equal(await commandCount(f.input.variantId), 1);
  const long = { ...another(f), declaration: { ...f.input.declaration, name: "😀".repeat(150), description: "😀".repeat(5000), businessFacts: "😀".repeat(5000), sourceStatement: "😀".repeat(5000) } }, body = batch(f, [long, { ...long, metadata: meta() }]);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 100 * 1024); code(await send(f, "POST", `${f.path}/batch`, body), 413, "INPUT_INVALID");
  assert.equal(await commandCount(long.variantId), 0);
});
test("actual session revocation after first committed item retains it and independently rejects every later item", async () => {
  const f = await fixture(); await upload(f); const next = another(f), registry = app.get(MaterialRuntime).registry(), original = registry.save;
  let calls = 0; registry.save = async (...args: Parameters<typeof original>) => { const saved = await original.apply(registry, args); if (++calls === 1) await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]); return saved; };
  try {
    const result = batchMaterialDeclarationsResponseSchema.parse((await send(f, "POST", `${f.path}/batch`, batch(f, [f.input, next, another(f)]))).value);
    assert.deepEqual(result.results.map(r => r.outcome), ["saved", "rejected", "rejected"]);
    for (const r of result.results.slice(1)) assert.ok(r.outcome === "rejected" && r.error.code === "AUTHENTICATION_REQUIRED");
    assert.equal(await commandCount(f.input.variantId), 1); assert.equal(await commandCount(next.variantId), 0);
  } finally { registry.save = original; }
});
test("actual history paginates twelve numeric revisions and remains a live append-only view rather than frozen snapshot", async () => {
  const f = await fixture(); await upload(f);
  for (let revision = 1; revision <= 12; revision++) assert.equal((await send(f, "POST", f.path, { ...f.input, metadata: meta(), expectedCurrentRevision: revision - 1, declaration: { ...f.input.declaration, businessFacts: `Explicit revision ${revision}` } })).status, 201);
  const read = async (suffix: string) => { const result = await send(f, "GET", `${f.path}/${f.input.variantId}/revisions${suffix}`); assert.equal(result.status, 200); return materialHistoryResponseSchema.parse(result.value); };
  const first = await read("?pageSize=5"); assert.deepEqual(first.revisions.map(r => r.revision), [1, 2, 3, 4, 5]); assert.equal(first.nextAfterRevision, 5);
  const second = await read("?afterRevision=5&pageSize=5"); assert.deepEqual(second.revisions.map(r => r.revision), [6, 7, 8, 9, 10]); assert.equal(second.nextAfterRevision, 10);
  const last = await read("?afterRevision=10&pageSize=5"); assert.deepEqual(last.revisions.map(r => r.revision), [11, 12]); assert.equal(last.nextAfterRevision, null); assert.equal(last.current.currentRevision, 12);
  assert.equal(first.revisions[0]!.declaration.businessFacts, "Explicit revision 1");
  assert.equal((await send(f, "POST", f.path, { ...f.input, metadata: meta(), expectedCurrentRevision: 12, declaration: { ...f.input.declaration, businessFacts: "Explicit revision 13" } })).status, 201);
  const appended = await read("?afterRevision=10&pageSize=5"); assert.deepEqual(appended.revisions.map(r => r.revision), [11, 12, 13]); assert.equal(appended.current.currentRevision, 13);
  assert.ok(!JSON.stringify(appended).includes('"key"')); assert.ok(!JSON.stringify(appended).includes('"recordedByOperatorId"'));
});
test("actual history query/auth/terminal cursor and cross-project scope fail precisely without implicit coercion", async () => {
  const f = await fixture(); await upload(f); assert.equal((await send(f, "POST")).status, 201); const path = `${f.path}/${f.input.variantId}/revisions`;
  for (const query of ["?afterRevision=-1", "?afterRevision=01", "?afterRevision=1.0", "?afterRevision=1001", "?pageSize=51", "?pageSize=1&pageSize=2", "?extra=x"])
    code(await send(f, "GET", path + query), 400, "INPUT_INVALID");
  code(await send(f, "GET", path + "?afterRevision=2"), 409, "FACT_VERSION_STALE"); code(await send(f, "GET", path, undefined, { cookie: "" }), 401, "AUTHENTICATION_REQUIRED");
  const terminal = materialHistoryResponseSchema.parse((await send(f, "GET", path + "?afterRevision=1")).value); assert.equal(terminal.revisions.length, 0); assert.equal(terminal.nextAfterRevision, null);
  const other = await fixture(); code(await send(f, "GET", `${other.path}/${f.input.variantId}/revisions`), 409, "FACT_VERSION_STALE");
});
test("actual off-page corrupt first revision rejects later history page, never suppresses damaged history", async () => {
  const f = await fixture(); await upload(f); assert.equal((await send(f, "POST")).status, 201);
  assert.equal((await send(f, "POST", f.path, { ...f.input, metadata: meta(), expectedCurrentRevision: 1, declaration: { ...f.input.declaration, name: "Second explicit name" } })).status, 201);
  await pool.query(`ALTER TABLE ${s}.material_variant_revisions DISABLE TRIGGER material_revision_immutable`);
  try { await pool.query(`UPDATE ${s}.material_variant_revisions SET recorded_at='0000-01-01T00:00:00Z' WHERE variant_id=$1 AND revision=1`, [f.input.variantId]); }
  finally { await pool.query(`ALTER TABLE ${s}.material_variant_revisions ENABLE TRIGGER material_revision_immutable`); }
  code(await send(f, "GET", `${f.path}/${f.input.variantId}/revisions?afterRevision=1&pageSize=1`), 500, "INTERNAL_ERROR");
});
test("actual item command INSERT suppression rolls back only that item and later qualified item still commits", async () => {
  const f = await fixture(); await upload(f); const next = another(f);
  await pool.query(`CREATE FUNCTION ${s}.batch_fixture_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.variant_id='${f.input.variantId}'::uuid THEN RETURN NULL; END IF; RETURN NEW; END $$;
    CREATE TRIGGER batch_fixture_suppress BEFORE INSERT ON ${s}.material_registry_commands FOR EACH ROW EXECUTE FUNCTION ${s}.batch_fixture_suppress()`);
  try {
    const result = batchMaterialDeclarationsResponseSchema.parse((await send(f, "POST", `${f.path}/batch`, batch(f, [f.input, next]))).value);
    assert.ok(result.results[0]!.outcome === "rejected" && result.results[0]!.error.code === "INTERNAL_ERROR"); assert.equal(result.results[1]!.outcome, "saved");
    assert.equal(await commandCount(f.input.variantId), 0); assert.equal(await commandCount(next.variantId), 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.material_variants WHERE variant_id=$1`, [f.input.variantId])).rows[0].n, 0);
  } finally { await pool.query(`DROP TRIGGER batch_fixture_suppress ON ${s}.material_registry_commands; DROP FUNCTION ${s}.batch_fixture_suppress()`); }
});
test("actual pending object rejects its item but good later item persists; unconfigured batch never invents saved results", async () => {
  const f = await fixture(); await upload(f, false); const readyId = randomUUID(), ready = { ...f, objectId: readyId, input: { ...another(f), objectIds: [readyId] } }; await upload(ready);
  const result = batchMaterialDeclarationsResponseSchema.parse((await send(f, "POST", `${f.path}/batch`, batch(f, [f.input, ready.input]))).value);
  assert.ok(result.results[0]!.outcome === "rejected" && result.results[0]!.error.code === "INTERNAL_ERROR" && result.results[0]!.error.retryable); assert.equal(result.results[1]!.outcome, "saved");
  for (const key of Object.keys(env).filter(k => k.startsWith("SG_PRODUCT_MATERIAL_"))) delete process.env[key]; const closed = await boot();
  try {
    const target = await closed.getUrl(), body = batch(f, [another(f), another(f)]);
    code(await send(f, "POST", `${f.path}/batch`, body, { cookie: "" }, target), 401, "AUTHENTICATION_REQUIRED");
    const rejected = batchMaterialDeclarationsResponseSchema.parse((await send(f, "POST", `${f.path}/batch`, body, {}, target)).value); assert.ok(rejected.results.every(r => r.outcome === "rejected"));
    const history = await send(f, "GET", `${f.path}/${ready.input.variantId}/revisions`, undefined, {}, target); assert.equal(history.status, 200); materialHistoryResponseSchema.parse(history.value);
  } finally { await closed.close(); Object.assign(process.env, env); }
});
