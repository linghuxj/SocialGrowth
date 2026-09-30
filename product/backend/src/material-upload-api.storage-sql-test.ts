import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { contractVersion, materialUploadTicketViewSchema, prepareMaterialUploadResponseSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { MaterialRuntime } from "./material-runtime.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, endpoint = process.env.SG_PRODUCT_TEST_STORAGE_ENDPOINT;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/sg_upload_api"
  || endpoint !== "http://127.0.0.1:32903" || process.env.SG_PRODUCT_TEST_STORAGE_ISOLATED !== "1") throw new Error("Material API supplementary tests require owned isolated database and storage fixtures");
const accessKeyId = process.env.SG_PRODUCT_TEST_STORAGE_ACCESS_KEY, secretAccessKey = process.env.SG_PRODUCT_TEST_STORAGE_SECRET_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error("Explicit synthetic storage credentials required");
const pool = new Pool({ connectionString: url, max: 4 }), s = "socialgrowth_product";
const admin = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
const bucket = `sg-api-fixture-${randomUUID()}`;
const env = { SG_PRODUCT_DATABASE_URL: url, SG_PRODUCT_AUTH_PEPPER: "synthetic-material-api-pepper-only-00001", SG_PRODUCT_SMS_MODE: "unavailable",
  SG_PRODUCT_MATERIAL_MODE: "configured", SG_PRODUCT_MATERIAL_LOCATION_ID: randomUUID(), SG_PRODUCT_MATERIAL_ENDPOINT: endpoint,
  SG_PRODUCT_MATERIAL_REGION: "us-east-1", SG_PRODUCT_MATERIAL_BUCKET: bucket, SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: "true",
  SG_PRODUCT_MATERIAL_ACCESS_KEY: accessKeyId, SG_PRODUCT_MATERIAL_SECRET_KEY: secretAccessKey,
  SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "4096", SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: "3000" };
let app: INestApplication, base: string, runtime: MaterialRuntime;
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `upload-${randomUUID()}` });
async function fixture() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID();
  const digest = (value: string) => createHash("sha256").update(value).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic API','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic API','company_owned',$2)`, [projectId, operatorId]);
  const bytes = Buffer.from(`synthetic API object-${randomUUID()}`), input = { metadata: meta(), projectId, objectId: randomUUID(), sha256: digest(bytes.toString()).toString("hex"), bytes: bytes.length, contentType: "video/mp4" };
  return { operatorId, sessionId, token, csrf, bytes, input, path: `/api/operator/projects/${projectId}/material-uploads` };
}
async function send(f: Awaited<ReturnType<typeof fixture>>, method: string, path = f.path, body: unknown = f.input, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json", ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.headers.get("cache-control"), "no-store"); const value: unknown = await response.json();
  assert.ok(!JSON.stringify(value).includes(secretAccessKey!)); return { status: response.status, value };
}
const counts = async (objectId: string) => (await pool.query(`SELECT
  (SELECT count(*)::int FROM ${s}.material_upload_tickets WHERE object_id=$1) tickets,
  (SELECT count(*)::int FROM ${s}.material_upload_commands WHERE object_id=$1) commands,
  (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='material_object' AND object_id=$1) audits`, [objectId])).rows[0];
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
  await admin.send(new CreateBucketCommand({ Bucket: bucket }));
  Object.assign(process.env, env); delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN; delete process.env.SG_PRODUCT_MATERIAL_SESSION_TOKEN;
  app = await NestFactory.create(AppModule, { logger: false }); app.useGlobalFilters(new ProductExceptionFilter());
  await app.listen(0, "127.0.0.1"); base = await app.getUrl(); runtime = app.get(MaterialRuntime);
});
after(async () => { try { await app?.close(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); admin.destroy(); } });
test("actual AppModule metadata HTTP uses real session/CSRF, pins original ticket and never exposes internal storage locator", async () => {
  const f = await fixture(), result = await send(f, "POST"); assert.equal(result.status, 201);
  const value = prepareMaterialUploadResponseSchema.parse(result.value); assert.equal(value.status, "pending_bytes"); assert.equal(value.changed, true);
  assert.deepEqual(Object.keys(value).sort(), ["projectId", "objectId", "sha256", "bytes", "contentType", "status", "preparedAt", "verifiedAt", "candidateAllowed", "publicationAllowed", "changed", "replayed"].sort());
  const read = await send(f, "GET", `${f.path}/${f.input.objectId}`); assert.equal(read.status, 200);
  assert.equal(materialUploadTicketViewSchema.parse(read.value).publicationAllowed, false);
  const replay = await send(f, "POST"); assert.equal(replay.status, 201); assert.equal(prepareMaterialUploadResponseSchema.parse(replay.value).replayed, true);
  assert.deepEqual(await counts(f.input.objectId), { tickets: 1, commands: 1, audits: 1 });
});
test("actual HTTP rejects caller secrets/status, conflicting path/body and unsupported contract without journal writes", async () => {
  const f = await fixture();
  for (const patch of [{ endpoint: "https://not-a-location.invalid" }, { bucket: "foreign" }, { actorId: f.operatorId }, { status: "verified_bytes" }]) assert.equal((await send(f, "POST", f.path, { ...f.input, ...patch })).status, 400);
  const other = await fixture(); assert.equal((await send(f, "POST", other.path)).status, 400);
  const unsupported = await send(f, "POST", f.path, { ...f.input, metadata: { ...f.input.metadata, contractVersion: "unsupported" } });
  assert.equal(productErrorResponseSchema.parse(unsupported.value).error.code, "CONTRACT_VERSION_UNSUPPORTED");
  assert.deepEqual(await counts(f.input.objectId), { tickets: 0, commands: 0, audits: 0 });
});
test("actual HTTP authentication cannot use claimed bearer, duplicate cookie, stale CSRF, revoked session or disabled operator", async () => {
  const f = await fixture();
  const invalidHeaders: Record<string, string>[] = [{ cookie: "", authorization: `Bearer ${f.token}` }, { cookie: `__Host-sg_operator_session=${f.token}; __Host-sg_operator_session=${f.token}` }, { "x-csrf-token": "wrong" }];
  for (const headers of invalidHeaders) assert.equal((await send(f, "POST", f.path, f.input, headers)).status, 401);
  await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]);
  assert.equal((await send(f, "POST")).status, 401);
  assert.equal((await send(f, "GET", `${f.path}/${f.input.objectId}`)).status, 401);
  const disabled = await fixture(); await pool.query(`UPDATE ${s}.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [disabled.operatorId]);
  // Existing authenticateSessionInTransaction intentionally treats disabled
  // operators as an invalid session, rather than exposing account status.
  const denied = await send(disabled, "POST"); assert.equal(denied.status, 401);
  assert.equal(productErrorResponseSchema.parse(denied.value).error.code, "AUTHENTICATION_REQUIRED");
  assert.deepEqual(await counts(disabled.input.objectId), { tickets: 0, commands: 0, audits: 0 });
  assert.deepEqual(await counts(f.input.objectId), { tickets: 0, commands: 0, audits: 0 });
});
test("actual AppModule without material configuration still reads history but closes new writes before SDK or journal changes", async () => {
  const f = await fixture(); await send(f, "POST");
  for (const key of Object.keys(env).filter(k => k.startsWith("SG_PRODUCT_MATERIAL_"))) delete process.env[key];
  process.env.AWS_ACCESS_KEY_ID = "synthetic-ambient-never-used"; process.env.AWS_SECRET_ACCESS_KEY = "synthetic-ambient-never-used";
  const closedApp = await NestFactory.create(AppModule, { logger: false }); closedApp.useGlobalFilters(new ProductExceptionFilter());
  try {
    await closedApp.listen(0, "127.0.0.1"); const closedBase = await closedApp.getUrl();
    const read = await fetch(`${closedBase}${f.path}/${f.input.objectId}`, { headers: { cookie: `__Host-sg_operator_session=${f.token}` } });
    assert.equal(read.status, 200); assert.equal(read.headers.get("cache-control"), "no-store"); materialUploadTicketViewSchema.parse(await read.json());
    const denied = await fetch(`${closedBase}${f.path}`, { method: "POST", headers: { cookie: `__Host-sg_operator_session=${f.token}`, "x-csrf-token": f.csrf, "content-type": "application/json" }, body: JSON.stringify({ ...f.input, objectId: randomUUID(), metadata: meta() }) });
    assert.equal(denied.status, 503); assert.equal(denied.headers.get("cache-control"), "no-store"); productErrorResponseSchema.parse(await denied.json());
    assert.deepEqual(await counts(f.input.objectId), { tickets: 1, commands: 1, audits: 1 });
  } finally { await closedApp.close(); Object.assign(process.env, env); delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY; }
});
test("actual HTTP concurrent prepare converges and key/descriptor/project conflict cannot create new ticket or status", async () => {
  const f = await fixture(), results = await Promise.all([send(f, "POST"), send(f, "POST")]);
  assert.equal(results.filter(r => prepareMaterialUploadResponseSchema.parse(r.value).changed).length, 1);
  const reused = await send(f, "POST", f.path, { ...f.input, sha256: "b".repeat(64) }); assert.equal(reused.status, 409);
  assert.equal(productErrorResponseSchema.parse(reused.value).error.code, "IDEMPOTENCY_KEY_REUSED");
  const rebound = await send(f, "POST", f.path, { ...f.input, metadata: meta(), sha256: "b".repeat(64) }); assert.equal(rebound.status, 409);
  const other = await fixture(); assert.equal((await send(f, "GET", `${other.path}/${f.input.objectId}`)).status, 409);
  assert.deepEqual(await counts(f.input.objectId), { tickets: 1, commands: 1, audits: 1 });
});
test("HTTP reads persisted actual byte result after internal upload and rejects metadata corruption without raw DB detail", async () => {
  const f = await fixture(); await send(f, "POST");
  const uploaded = await runtime.uploads().upload(f.token, f.csrf, { metadata: meta(), projectId: f.input.projectId, objectId: f.input.objectId }, f.bytes);
  assert.equal(uploaded.status, "verified_bytes");
  const read = await send(f, "GET", `${f.path}/${f.input.objectId}`); assert.equal(read.status, 200); assert.equal(materialUploadTicketViewSchema.parse(read.value).status, "verified_bytes");
  await pool.query(`ALTER TABLE ${s}.material_object_manifests DISABLE TRIGGER material_object_immutable`);
  try { await pool.query(`UPDATE ${s}.material_object_manifests SET reference=jsonb_set(reference,'{sha256}',to_jsonb($2::text)) WHERE object_id=$1`, [f.input.objectId, "c".repeat(64)]); }
  finally { await pool.query(`ALTER TABLE ${s}.material_object_manifests ENABLE TRIGGER material_object_immutable`); }
  const corrupt = await send(f, "GET", `${f.path}/${f.input.objectId}`); assert.equal(corrupt.status, 500); assert.equal(productErrorResponseSchema.parse(corrupt.value).error.code, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(corrupt.value).includes("reference"));
});
