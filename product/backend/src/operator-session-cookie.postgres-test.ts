import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { contractVersion, emptyProjectPlanningInputs, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "32871" || new URL(url).pathname !== "/sg_cookie_fixture") throw new Error("Cookie supplemental tests require owned isolated PostgreSQL fixture");
const pool = new Pool({ connectionString: url, max: 4 }), s = "socialgrowth_product", name = "__Host-sg_operator_session";
let app: INestApplication, base: string;
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
  process.env.SG_PRODUCT_DATABASE_URL = url; process.env.SG_PRODUCT_AUTH_PEPPER = "synthetic-cookie-fixture-pepper-only-00001";
  process.env.SG_PRODUCT_SMS_MODE = "unavailable"; delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN;
  process.env.SG_PRODUCT_MATERIAL_MODE = "unavailable";
  for (const key of ["LOCATION_ID", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "SESSION_TOKEN", "MAX_OBJECT_BYTES", "REQUEST_TIMEOUT_MS"]) delete process.env[`SG_PRODUCT_MATERIAL_${key}`];
  app = await NestFactory.create(AppModule, { logger: false }); app.useGlobalFilters(new ProductExceptionFilter()); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
after(async () => { try { await app?.close(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
async function fixture() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID(), objectId = randomUUID();
  const digest = (value: string) => createHash("sha256").update(value).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Cookie fixture','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Cookie fixture','company_owned',$2)`, [projectId, operatorId]);
  // Pending metadata fixture only: no verified bytes, admitted material or UI
  // success is preseeded. It permits a genuine historical-read auth check.
  const descriptor = { storageLocationId: randomUUID(), storageBindingDigest: "b".repeat(64), projectId, objectId, key: `projects/${projectId}/objects/${objectId}`, sha256: "a".repeat(64), bytes: 1, contentType: "video/mp4" };
  await pool.query(`INSERT INTO ${s}.material_upload_tickets(object_id,project_id,descriptor,prepared_by_operator_id,prepared_at) VALUES($1,$2,$3,$4,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`, [objectId, projectId, descriptor, operatorId]);
  return { operatorId, sessionId, token, csrf, projectId, objectId };
}
function routes(f: Awaited<ReturnType<typeof fixture>>) { return [
  { path: "/api/operator/accounts", status: 200 }, { path: "/api/operator/invitations", status: 200 }, { path: "/api/operator/device-facts", status: 200 },
  { path: "/api/operator/projects", status: 200 }, { path: `/api/operator/projects/${f.projectId}/planning-draft`, status: 200 },
  { path: "/api/operator/assistance-todos", status: 200 }, { path: `/api/operator/assistance-todos/${randomUUID()}/notes`, status: 409 },
  { path: `/api/operator/projects/${f.projectId}/material-uploads/${f.objectId}`, status: 200 }]; }
async function get(path: string, cookie: string) { const response = await fetch(`${base}${path}`, { headers: { cookie } }); assert.equal(response.headers.get("cache-control"), "no-store"); return { status: response.status, value: await response.json() as unknown }; }
const metadata = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `cookie-${randomUUID()}` });
const totals = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.projects) projects,(SELECT count(*)::int FROM ${s}.audit_records) audits,
  (SELECT count(*)::int FROM ${s}.project_metadata_commands) commands,(SELECT count(*)::int FROM ${s}.project_planning_drafts) drafts,(SELECT count(*)::int FROM ${s}.project_planning_commands) planning_commands`)).rows[0];
test("all six actual controller families keep normal cookie reads, pending history and unknown note semantics", async () => {
  const f = await fixture();
  for (const route of routes(f)) assert.equal((await get(route.path, `unrelated=a=b; ${name}=${f.token}`)).status, route.status);
});
test("all eight actual GET routes reject three complete-value suffixes and duplicate cookies with exact 401, without database writes", async () => {
  const f = await fixture(), before = await totals();
  const cookies = [`${name}=${f.token}=`, `${name}=${f.token}=synthetic-suffix`, `${name}=${f.token}==synthetic-suffix`, `${name}=${f.token}; ${name}=${f.token}`];
  for (const route of routes(f)) for (const cookie of cookies) {
    const result = await get(route.path, cookie); assert.equal(result.status, 401); assert.equal(productErrorResponseSchema.parse(result.value).error.code, "AUTHENTICATION_REQUIRED");
  }
  assert.deepEqual(await totals(), before);
});
test("actual original-key project mutation works normally, but malformed complete cookie cannot replay its success or save planning", async () => {
  const f = await fixture(), input = { metadata: metadata(), basics: { name: "Synthetic normal cookie", kind: "company_owned", customerName: null, ownerOperatorId: null, notificationEmail: null } };
  const post = async (path: string, body: unknown, cookie: string) => { const response = await fetch(`${base}${path}`, { method: "POST", headers: { cookie, "x-csrf-token": f.csrf, "content-type": "application/json" }, body: JSON.stringify(body) }); assert.equal(response.headers.get("cache-control"), "no-store"); return { status: response.status, value: await response.json() as unknown }; };
  assert.equal((await post("/api/operator/projects", input, `${name}=${f.token}`)).status, 201); const before = await totals();
  const planning = { metadata: metadata(), projectId: f.projectId, expectedProjectVersion: 0, expectedDraftVersion: 0, inputs: emptyProjectPlanningInputs() };
  for (const suffix of ["=", "=synthetic-suffix", "==synthetic-suffix"]) for (const operation of [{ path: "/api/operator/projects", body: input }, { path: `/api/operator/projects/${f.projectId}/planning-draft`, body: planning }]) {
    const result = await post(operation.path, operation.body, `${name}=${f.token}${suffix}`); assert.equal(result.status, 401); assert.equal(productErrorResponseSchema.parse(result.value).error.code, "AUTHENTICATION_REQUIRED");
  }
  assert.deepEqual(await totals(), before);
  assert.equal((await post("/api/operator/projects", input, `${name}=${f.token}`)).status, 201); assert.deepEqual(await totals(), before);
});
