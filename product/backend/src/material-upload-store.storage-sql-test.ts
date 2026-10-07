import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { contractVersion } from "@socialgrowth/product-contracts";
import { MaterialObjectStorage } from "./material-object-storage.js";
import { MaterialUploadStore } from "./material-upload-store.js";
import { MaterialUploadError } from "./material-upload-core.js";
import { MaterialRegistryStore, MaterialRegistryError } from "./material-registry-store.js";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL, endpoint = process.env.SG_PRODUCT_TEST_STORAGE_ENDPOINT;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1" || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/sg_upload_fixture"
  || endpoint !== "http://127.0.0.1:32902" || process.env.SG_PRODUCT_TEST_STORAGE_ISOLATED !== "1") throw new Error("Upload supplemental tests require owned isolated SQL and byte storage fixtures");
const accessKeyId = process.env.SG_PRODUCT_TEST_STORAGE_ACCESS_KEY, secretAccessKey = process.env.SG_PRODUCT_TEST_STORAGE_SECRET_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error("Explicit synthetic storage credentials required");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-upload-fixtures" });
const s = "socialgrowth_product", auth = new OperatorAuthService(pool, "synthetic-upload-sql-pepper-00001");
const config = { storageLocationId: randomUUID(), endpoint, region: "us-east-1", bucket: `sg-upload-fixture-${randomUUID()}`, forcePathStyle: true,
  accessKeyId, secretAccessKey, maxObjectBytes: 4096, requestTimeoutMs: 3000 };
const storage = new MaterialObjectStorage(config), uploads = new MaterialUploadStore(pool, auth, storage);
const admin = new S3Client({ endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `upload-${randomUUID()}` });
const code = (expected: string) => (e: unknown) => (e instanceof ProductTransactionError || e instanceof MaterialUploadError || e instanceof MaterialRegistryError) && e.code === expected && !e.cause;
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  await pool.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Upload fixture','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await pool.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, digest(token), digest(csrf)]);
  return { operatorId, sessionId, token, csrf };
}
async function fixture() {
  const a = await actor(), projectId = randomUUID(), body = Buffer.from(`synthetic owned upload bytes-${randomUUID()}`);
  await pool.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Upload fixture','company_owned',$2)`, [projectId, a.operatorId]);
  const prepare = { metadata: meta(), projectId, objectId: randomUUID(), sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length, contentType: "application/octet-stream" };
  return { a, body, prepare, upload: { metadata: meta(), projectId, objectId: prepare.objectId } };
}
const prepare = (f: Awaited<ReturnType<typeof fixture>>, service = uploads) => service.prepare(f.a.token, f.a.csrf, f.prepare);
const upload = (f: Awaited<ReturnType<typeof fixture>>, service = uploads) => service.upload(f.a.token, f.a.csrf, f.upload, f.body);
async function counts(objectId: string) { return (await pool.query(`SELECT
  (SELECT count(*)::int FROM ${s}.material_upload_tickets WHERE object_id=$1) tickets,
  (SELECT count(*)::int FROM ${s}.material_object_manifests WHERE object_id=$1) manifests,
  (SELECT count(*)::int FROM ${s}.material_upload_commands WHERE object_id=$1) commands,
  (SELECT count(*)::int FROM ${s}.audit_records WHERE object_type='material_object' AND object_id=$1) audits`, [objectId])).rows[0]; }
let legacy: { objectId: string; projectId: string };
before(async () => {
  await admin.send(new CreateBucketCommand({ Bucket: config.bucket }));
  const dir = new URL("../migrations/", import.meta.url), files = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort();
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); for (const file of files) await pool.query(await readFile(new URL(file, dir), "utf8"));
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.material_upload_tickets`)).rowCount, 0);
  await pool.query(`DROP SCHEMA ${s} CASCADE`); for (const file of files.filter(v => v < "0020_")) await pool.query(await readFile(new URL(file, dir), "utf8"));
  const f = await fixture(), ref = await storage.put({ projectId: f.prepare.projectId, objectId: f.prepare.objectId, contentType: f.prepare.contentType }, f.body);
  await pool.query(`INSERT INTO ${s}.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [ref.objectId, ref.projectId, ref]); legacy = ref;
  await pool.query(await readFile(new URL("0020_material_upload_tickets.sql", dir), "utf8"));
});
after(async () => { try { await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await pool.end(); storage.close(); admin.destroy(); } });
test("0020 preserves actual prior manifest without automatically creating migrated upload tickets", async () => {
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.material_object_manifests WHERE object_id=$1`, [legacy.objectId])).rowCount, 1);
  assert.equal((await pool.query(`SELECT 1 FROM ${s}.material_upload_tickets`)).rowCount, 0);
});
test("actual prepare/upload/read-back freezes binding and bytes, then new-instance DB resolver registers only pending material", async () => {
  const f = await fixture(), ticket = await prepare(f); assert.equal(ticket.status, "pending_bytes"); assert.equal(ticket.candidateAllowed, false);
  const result = await upload(f); assert.equal(result.status, "verified_bytes"); assert.equal(result.changed, true); assert.match(result.verifiedAt!, /\.\d{6}Z$/);
  assert.deepEqual(await storage.readVerified(result.descriptor), f.body); assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 1, commands: 2, audits: 2 });
  const restarted = new MaterialUploadStore(pool, auth, storage), registry = new MaterialRegistryStore(pool, auth, restarted.objectVerifier());
  const material = await registry.save(f.a.token, f.a.csrf, { metadata: meta(), projectId: f.prepare.projectId, contentUnitId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID(),
    identity: { mediaKind: "video", businessKind: "product", businessEntityId: randomUUID(), seriesId: null, episodeNumber: null }, variantId: randomUUID(), languageTag: "en", expectedCurrentRevision: 0,
    declaration: { name: "Synthetic", description: "Synthetic description", businessFacts: "Synthetic business facts", sourceStatement: "Fixture not copyright proof", sourceEvidenceIds: [randomUUID()], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [f.prepare.objectId] });
  assert.equal(material.candidateAllowed, false); assert.equal(material.publicationAllowed, false); assert.deepEqual(material.revisions[0]!.objects[0], result.descriptor);
  await admin.send(new PutObjectCommand({ Bucket: config.bucket, Key: result.descriptor.key, Body: Buffer.alloc(f.body.length, 120), ContentType: result.descriptor.contentType }));
  await assert.rejects(restarted.objectVerifier().verify({ projectId: f.prepare.projectId, objectIds: [f.prepare.objectId] }, new AbortController().signal), code("VERIFIER_UNAVAILABLE"));
});
test("exact old upload key and duplicate new key return current frozen result with no repeat object IO", async () => {
  const f = await fixture(); await prepare(f); await upload(f);
  const original = storage.put; let puts = 0; storage.put = async () => { puts++; throw new Error("should-not-reupload"); };
  try {
    const replay = await upload(f); assert.equal(replay.replayed, true); assert.equal(replay.changed, false);
    const another = await uploads.upload(f.a.token, f.a.csrf, { ...f.upload, metadata: meta() }, f.body); assert.equal(another.changed, false); assert.equal(puts, 0);
    assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 1, commands: 3, audits: 2 });
  } finally { storage.put = original; }
});
test("same ID/key cannot change descriptor, bytes, project, kind or configured storage binding", async () => {
  const f = await fixture(); await prepare(f);
  const other = await fixture();
  await assert.rejects(uploads.prepare(f.a.token, f.a.csrf, { ...f.prepare, metadata: meta(), projectId: other.prepare.projectId }), code("FACT_VERSION_STALE"));
  await assert.rejects(uploads.upload(f.a.token, f.a.csrf, { ...f.upload, projectId: other.prepare.projectId }, f.body), code("FACT_VERSION_STALE"));
  await assert.rejects(uploads.read(f.a.token, other.prepare.projectId, f.prepare.objectId), code("FACT_VERSION_STALE"));
  await assert.rejects(uploads.objectVerifier().verify({ projectId: other.prepare.projectId, objectIds: [f.prepare.objectId] }, new AbortController().signal), code("VERIFIER_UNAVAILABLE"));
  await assert.rejects(uploads.prepare(f.a.token, f.a.csrf, { ...f.prepare, sha256: "c".repeat(64) }), code("IDEMPOTENCY_KEY_REUSED"));
  await assert.rejects(uploads.prepare(f.a.token, f.a.csrf, { ...f.prepare, metadata: meta(), sha256: "c".repeat(64) }), code("FACT_VERSION_STALE"));
  await assert.rejects(uploads.upload(f.a.token, f.a.csrf, f.upload, Buffer.alloc(f.body.length, 0)), code("INVALID_BYTES"));
  await assert.rejects(uploads.upload(f.a.token, f.a.csrf, { ...f.upload, metadata: f.prepare.metadata }, f.body), code("IDEMPOTENCY_KEY_REUSED"));
  const changed = new MaterialObjectStorage({ ...config, bucket: `${config.bucket}-changed` });
  try { await assert.rejects(upload(f, new MaterialUploadStore(pool, auth, changed)), code("FACT_VERSION_STALE")); }
  finally { changed.close(); }
  assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 0, commands: 1, audits: 1 });
});
test("genuine concurrent same bytes converge in storage and SQL, while all metadata IO occurs outside locks", async () => {
  const f = await fixture(); await prepare(f); const original = storage.put; let unlocked = false;
  storage.put = async (input, body) => {
    const c = await pool.connect(); try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='100ms'"); await c.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`); unlocked = true; }
    finally { await c.query("ROLLBACK"); c.release(); }
    return original.call(storage, input, body);
  };
  try { const results = await Promise.all([upload(f), upload(f)]); assert.equal(results.filter(v => v.changed).length, 1); assert.equal(results.filter(v => v.replayed).length, 1); assert.equal(unlocked, true); }
  finally { storage.put = original; }
  assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 1, commands: 2, audits: 2 });
});
test("actual bytes written with lost storage acknowledgement leave pending ticket, then same ID recovers without overwrite", async () => {
  const f = await fixture(); await prepare(f); const original = storage.put; let ref: Awaited<ReturnType<typeof storage.put>> | undefined;
  storage.put = async (input, body) => { ref = await original.call(storage, input, body); throw new Error("synthetic-response-loss"); };
  try { await assert.rejects(upload(f), code("STORAGE_UNAVAILABLE")); }
  finally { storage.put = original; }
  assert.equal((await uploads.read(f.a.token, f.prepare.projectId, f.prepare.objectId)).status, "pending_bytes"); assert.deepEqual(await storage.readVerified(ref!), f.body);
  const recovered = await upload(f, new MaterialUploadStore(pool, auth, storage)); assert.equal(recovered.status, "verified_bytes"); assert.deepEqual(recovered.descriptor, ref);
});
test("current CSRF denies physical IO and actual completed object after session expiry cannot commit metadata", async () => {
  const f = await fixture(); await prepare(f); const original = storage.put; let puts = 0;
  storage.put = async (input, body) => { puts++; const ref = await original.call(storage, input, body); await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '10 milliseconds' WHERE session_id=$1`, [f.a.sessionId]); await pool.query("SELECT pg_sleep(0.05)"); return ref; };
  try {
    await assert.rejects(uploads.upload(f.a.token, "", f.upload, f.body), code("AUTHENTICATION_REQUIRED")); assert.equal(puts, 0);
    await assert.rejects(upload(f), code("AUTHENTICATION_REQUIRED")); assert.equal(puts, 1);
  } finally { storage.put = original; }
  assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 0, commands: 1, audits: 1 });
  await pool.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '1 day' WHERE session_id=$1`, [f.a.sessionId]);
  assert.equal((await upload(f)).status, "verified_bytes");
});
test("actual DB insert/update suppression retains original pending ticket and physical bytes, metadata all rolls back", async () => {
  await pool.query(`CREATE FUNCTION ${s}.upload_null_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
  for (const table of ["material_object_manifests", "material_upload_tickets", "material_upload_commands", "audit_records"]) {
    const f = await fixture(); await prepare(f); const operation = table === "material_upload_tickets" ? "UPDATE" : "INSERT";
    await pool.query(`CREATE TRIGGER a_upload_null_fixture BEFORE ${operation} ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.upload_null_fixture()`);
    try { await assert.rejects(upload(f), code("INTERNAL_ERROR")); assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 0, commands: 1, audits: 1 }); }
    finally { await pool.query(`DROP TRIGGER a_upload_null_fixture ON ${s}.${table}`); }
    assert.equal((await upload(f)).status, "verified_bytes");
  }
});
test("prepare checks every actual insert and rolls back suppressed ticket, command or audit before byte IO", async () => {
  for (const table of ["material_upload_tickets", "material_upload_commands", "audit_records"]) {
    const f = await fixture();
    await pool.query(`CREATE TRIGGER a_prepare_null_fixture BEFORE INSERT ON ${s}.${table} FOR EACH ROW EXECUTE FUNCTION ${s}.upload_null_fixture()`);
    try { await assert.rejects(prepare(f), code("INTERNAL_ERROR")); assert.deepEqual(await counts(f.prepare.objectId), { tickets: 0, manifests: 0, commands: 0, audits: 0 }); }
    finally { await pool.query(`DROP TRIGGER a_prepare_null_fixture ON ${s}.${table}`); }
    assert.equal((await prepare(f)).status, "pending_bytes");
  }
});
test("read and old-key replay check final actual session expiry without byte IO or extra metadata", async () => {
  const f = await fixture(); await prepare(f); await upload(f);
  const expiringPool = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
    const result = await c.query(sql, values);
    if (sql.startsWith("SELECT reference,project_id")) {
      await c.query(`UPDATE ${s}.operator_sessions SET expires_at=clock_timestamp()+interval '20 milliseconds' WHERE session_id=$1`, [f.a.sessionId]);
      await c.query("SELECT pg_sleep(0.04)");
    }
    return result;
  }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  const service = new MaterialUploadStore(expiringPool, auth, storage), original = storage.put; let puts = 0;
  storage.put = async () => { puts++; throw new Error("no-byte-IO-for-replay"); };
  try {
    await assert.rejects(service.read(f.a.token, f.prepare.projectId, f.prepare.objectId), code("AUTHENTICATION_REQUIRED"));
    await assert.rejects(upload(f, service), code("AUTHENTICATION_REQUIRED"));
    assert.equal(puts, 0); assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 1, commands: 2, audits: 2 });
    assert.equal((await upload(f)).replayed, true);
  } finally { storage.put = original; }
});
test("actual COMMIT success with lost DB acknowledgement recovers after restart and read works with storage disabled", async () => {
  const f = await fixture(); await prepare(f); let once = true;
  const faultPool = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
    const result = await c.query(sql, values); if (sql === "COMMIT" && once && (await counts(f.prepare.objectId)).manifests) { once = false; throw new Error("synthetic-commit-response-loss"); } return result;
  }, release: () => c.release() } as unknown as PoolClient; } } as unknown as Pool;
  await assert.rejects(upload(f, new MaterialUploadStore(faultPool, auth, storage)), code("INTERNAL_ERROR"));
  assert.deepEqual(await counts(f.prepare.objectId), { tickets: 1, manifests: 1, commands: 2, audits: 2 });
  assert.equal((await upload(f, new MaterialUploadStore(pool, auth, storage))).replayed, true);
  const read = await new MaterialUploadStore(pool, auth).read(f.a.token, f.prepare.projectId, f.prepare.objectId); assert.equal(read.status, "verified_bytes");
  await assert.rejects(pool.query(`UPDATE ${s}.material_upload_tickets SET status='pending_bytes' WHERE object_id=$1`, [f.prepare.objectId]));
  await assert.rejects(pool.query(`DELETE FROM ${s}.material_upload_tickets WHERE object_id=$1`, [f.prepare.objectId]));
});
