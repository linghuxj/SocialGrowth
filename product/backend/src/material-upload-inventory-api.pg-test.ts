import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { materialUploadInventoryResponseSchema, materialUploadTicketViewSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { AppModule } from "./app.module.js";
import { ProductExceptionFilter } from "./product-exception.filter.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "32875" || new URL(url).pathname !== "/sg_upload_inventory") throw new Error("Upload inventory supplementary tests require owned isolated database");
const pool = new Pool({ connectionString: url, max: 4 }), s = "socialgrowth_product";
let app: INestApplication, base: string;
async function start() {
  app = await NestFactory.create(AppModule, { logger: false }); app.useGlobalFilters(new ProductExceptionFilter()); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
}
before(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, dir), "utf8"));
  process.env.SG_PRODUCT_DATABASE_URL = url; process.env.SG_PRODUCT_AUTH_PEPPER = "synthetic-upload-inventory-pepper-00001"; process.env.SG_PRODUCT_SMS_MODE = "unavailable";
  delete process.env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN; process.env.SG_PRODUCT_MATERIAL_MODE = "unavailable";
  for (const key of ["LOCATION_ID", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "SESSION_TOKEN", "MAX_OBJECT_BYTES", "REQUEST_TIMEOUT_MS"]) delete process.env[`SG_PRODUCT_MATERIAL_${key}`];
  await start();
});
after(async () => { try { await app?.close(); await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); } });
async function fixture() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url"), projectId = randomUUID(), digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic inventory','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic inventory','company_owned',$2)`, [projectId, operatorId]);
  return { operatorId, sessionId, token, projectId, path: `/api/operator/projects/${projectId}/material-uploads` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function objectId(f: Fixture, index: number) { return `${f.projectId.slice(0, 24)}${index.toString(16).padStart(12, "0")}`; }
async function seedPending(f: Fixture, index: number) {
  // Historical PENDING ticket fixtures only: not actual prepared/uploaded bytes,
  // a verified success, admissible media, UI success or publication permission.
  const id = objectId(f, index), descriptor = { projectId: f.projectId, objectId: id, storageLocationId: randomUUID(), storageBindingDigest: "b".repeat(64), key: `projects/${f.projectId}/objects/${id}`, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" };
  await pool.query(`INSERT INTO ${s}.material_upload_tickets(object_id,project_id,descriptor,prepared_by_operator_id,prepared_at) VALUES($1,$2,$3,$4,'2026-10-01T00:00:00.123456789123Z')`, [id, f.projectId, descriptor, f.operatorId]); return id;
}
async function get(f: Fixture, query = "", headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${f.path}${query}`, { headers: { cookie: `__Host-sg_operator_session=${f.token}`, ...headers } });
  assert.equal(response.headers.get("cache-control"), "no-store"); return { status: response.status, value: await response.json() as unknown };
}
function code(result: { status: number; value: unknown }, status: number, expected: string) { assert.equal(result.status, status); assert.equal(productErrorResponseSchema.parse(result.value).error.code, expected); }
const totals = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM ${s}.material_upload_tickets) tickets,(SELECT count(*)::int FROM ${s}.material_object_manifests) manifests,(SELECT count(*)::int FROM ${s}.material_upload_commands) commands,(SELECT count(*)::int FROM ${s}.audit_records) audits`)).rows[0];
test("actual empty inventory distinguishes unknown project, and storage unavailable does not disable historical reads", async () => {
  const f = await fixture(), before = await totals(), result = await get(f); assert.equal(result.status, 200);
  assert.deepEqual(materialUploadInventoryResponseSchema.parse(result.value), { projectId: f.projectId, tickets: [], nextAfterObjectId: null });
  code(await get({ ...f, path: `/api/operator/projects/${randomUUID()}/material-uploads` }), 409, "FACT_VERSION_STALE"); assert.deepEqual(await totals(), before);
});
test("actual same-project 3/3/1 stable pages preserve original pending IDs, no private locators or writes", async () => {
  const f = await fixture(), other = await fixture(); for (let index = 1; index <= 7; index++) await seedPending(f, index); await seedPending(other, 1); const before = await totals();
  const first = materialUploadInventoryResponseSchema.parse((await get(f, "?pageSize=3")).value); assert.deepEqual(first.tickets.map(t => t.objectId), [1, 2, 3].map(i => objectId(f, i))); assert.equal(first.nextAfterObjectId, objectId(f, 3));
  const second = materialUploadInventoryResponseSchema.parse((await get(f, `?pageSize=3&afterObjectId=${first.nextAfterObjectId!.toUpperCase()}`)).value); assert.deepEqual(second.tickets.map(t => t.objectId), [4, 5, 6].map(i => objectId(f, i)));
  const last = materialUploadInventoryResponseSchema.parse((await get(f, `?pageSize=3&afterObjectId=${second.nextAfterObjectId}`)).value); assert.deepEqual(last.tickets.map(t => t.objectId), [objectId(f, 7)]); assert.equal(last.nextAfterObjectId, null);
  assert.equal(materialUploadInventoryResponseSchema.parse((await get(f, `?afterObjectId=${objectId(f, 7)}`)).value).tickets.length, 0);
  assert.ok(first.tickets.every(t => t.status === "pending_bytes" && !t.candidateAllowed && !t.publicationAllowed));
  for (const key of ["descriptor", "key", "storageLocationId", "storageBindingDigest", "preparedByOperatorId", "idempotencyKey"]) assert.ok(!JSON.stringify(first).includes(`"${key}"`));
  assert.equal(materialUploadInventoryResponseSchema.parse((await get({ ...f, path: other.path })).value).tickets[0]!.projectId, other.projectId); assert.deepEqual(await totals(), before);
});
test("actual fifty limit plus lookahead, live later addition and restart recover original tickets without new IDs", async () => {
  const f = await fixture(); for (let index = 1; index <= 51; index++) await seedPending(f, index);
  const first = materialUploadInventoryResponseSchema.parse((await get(f, "?pageSize=50")).value); assert.equal(first.tickets.length, 50); assert.equal(first.nextAfterObjectId, objectId(f, 50));
  await seedPending(f, 52); const before = await totals(); await app.close(); await start();
  const tail = materialUploadInventoryResponseSchema.parse((await get(f, `?afterObjectId=${first.nextAfterObjectId}`)).value); assert.deepEqual(tail.tickets.map(t => t.objectId), [51, 52].map(i => objectId(f, i))); assert.equal(tail.nextAfterObjectId, null);
  const read = await get({ ...f, path: `${f.path}/${objectId(f, 51)}` }); assert.equal(read.status, 200); assert.equal(materialUploadTicketViewSchema.parse(read.value).objectId, objectId(f, 51)); assert.deepEqual(await totals(), before);
});
test("actual strict query rejects duplicates, malformed sizes and unknown or foreign cursor", async () => {
  const f = await fixture(), other = await fixture(); await seedPending(f, 1); const foreign = await seedPending(other, 1), before = await totals();
  for (const query of ["?pageSize=0", "?pageSize=51", "?pageSize=01", "?pageSize=1.2", "?pageSize=1&pageSize=2", "?afterObjectId=bad", `?afterObjectId=${foreign}&afterObjectId=${foreign}`, "?status=pending_bytes"]) code(await get(f, query), 400, "INPUT_INVALID");
  for (const id of [randomUUID(), foreign]) code(await get(f, `?afterObjectId=${id}`), 409, "FACT_VERSION_STALE"); assert.deepEqual(await totals(), before);
});
test("actual full Cookie, credential, disable and revoke guards fail closed without mutating ticket state", async () => {
  const f = await fixture(); await seedPending(f, 1); const before = await totals();
  const bad: Record<string, string>[] = [{ cookie: "", authorization: `Bearer ${f.token}` }, { cookie: `__Host-sg_operator_session=${f.token}=` }, { cookie: `__Host-sg_operator_session=${f.token}=suffix` }, { cookie: `__Host-sg_operator_session=${f.token}; __Host-sg_operator_session=${f.token}` }];
  for (const headers of bad) code(await get(f, "", headers), 401, "AUTHENTICATION_REQUIRED"); assert.equal((await get(f, "", { "x-csrf-token": "read-does-not-require-csrf" })).status, 200);
  await pool.query(`UPDATE ${s}.operators SET credential_version=2 WHERE operator_id=$1`, [f.operatorId]); code(await get(f), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET credential_version=1,status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1`, [f.operatorId]); code(await get(f), 401, "AUTHENTICATION_REQUIRED");
  await pool.query(`UPDATE ${s}.operators SET status='active',disabled_at=NULL WHERE operator_id=$1`, [f.operatorId]); await pool.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1`, [f.sessionId]); code(await get(f), 401, "AUTHENTICATION_REQUIRED"); assert.deepEqual(await totals(), before);
});
test("actual selected corrupt pending ticket rejects page safely; unselected ticket does not imply global validation", async () => {
  const f = await fixture(); await seedPending(f, 1); const id = await seedPending(f, 2);
  // prepared_at is journal text: synthetic corruption is not success setup.
  await pool.query(`ALTER TABLE ${s}.material_upload_tickets DISABLE TRIGGER material_upload_ticket_immutable`);
  try { await pool.query(`UPDATE ${s}.material_upload_tickets SET prepared_at='0000-01-01T00:00:00Z' WHERE object_id=$1`, [id]); }
  finally { await pool.query(`ALTER TABLE ${s}.material_upload_tickets ENABLE TRIGGER material_upload_ticket_immutable`); }
  assert.equal((await get(f, "?pageSize=1")).status, 200); const result = await get(f, `?pageSize=1&afterObjectId=${objectId(f, 1)}`); code(result, 500, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(result.value).includes("0000-"));
});
test("actual guard wait checks final database clock and cannot return expired session inventory", async () => {
  const f = await fixture(); await seedPending(f, 1); const holder = await pool.connect();
  try {
    await holder.query("BEGIN"); await holder.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`);
    await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE session_id=$1`, [f.sessionId]);
    const pending = get(f); let observed = false;
    for (let index = 0; index < 50; index++) {
      observed = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='sg_upload_inventory' AND wait_event_type='Lock' AND query LIKE '%material_registry_guard%') present`)).rows[0].present;
      if (observed) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed); await new Promise(resolve => setTimeout(resolve, 550)); await holder.query("COMMIT"); code(await pending, 401, "AUTHENTICATION_REQUIRED");
  } finally { await holder.query("ROLLBACK"); holder.release(); }
});
