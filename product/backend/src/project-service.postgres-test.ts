import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { contractVersion, type ProjectBasics } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ProjectService } from "./project-service.js";
const url = process.env.SG_PRODUCT_TEST_DATABASE_URL;
if (!url || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Project transaction tests require an isolated reset-authorized database");
const pool = new Pool({ connectionString: url, max: 8, application_name: "sg-project-fixtures" });
const auth = new OperatorAuthService(pool, "isolated-project-auth-pepper-only-00000001"), service = new ProjectService(pool, auth);
const meta = () => ({ contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `project-${randomUUID()}` });
const basics = (): ProjectBasics => ({ name: `项目${randomUUID().slice(0, 8)}`, kind: "company_owned", customerName: null, ownerOperatorId: null, notificationEmail: null });
const errorCode = (code: string) => (error: unknown) => error instanceof ProductTransactionError && error.code === code;
before(async () => {
  await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE");
  for (const file of ["0001_identity_and_device.sql", "0008_project_basics.sql"]) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
});
after(async () => { try { await pool.query("DROP SCHEMA IF EXISTS socialgrowth_product CASCADE"); } finally { await pool.end(); } });
// Synthetic authentication fixtures ONLY for non-UI transaction checks.
async function actor() {
  const operatorId = randomUUID(), sessionId = randomUUID(), sessionToken = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  await pool.query("INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Project fixture','not-real-password','active')", [operatorId, `fixture-${operatorId}`]);
  await pool.query("INSERT INTO socialgrowth_product.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')", [sessionId, operatorId, digest(sessionToken), digest(csrfToken)]);
  return { operatorId, sessionId, sessionToken, csrfToken };
}
async function create(a: Awaited<ReturnType<typeof actor>>, value = basics(), metadata = meta()) { return service.save(a.sessionToken, a.csrfToken, { metadata, basics: value }, "create"); }
async function counts(id: string) { return (await pool.query<{ commands: number; audits: number }>(`SELECT (SELECT count(*)::int FROM socialgrowth_product.project_metadata_commands WHERE project_id=$1) commands,(SELECT count(*)::int FROM socialgrowth_product.audit_records WHERE object_type='project' AND object_id=$1) audits`, [id])).rows[0]!; }
test("create remains preparing and lost response replay creates one object without invented defaults", async () => {
  const a = await actor(), metadata = meta(), input = basics();
  const first = await create(a, input, metadata), replay = await create(a, input, { ...metadata, requestId: `request-${randomUUID()}` });
  assert.deepEqual(replay, first); assert.equal(first.project.phase, "preparing"); assert.equal(first.project.ownerOperatorId, null);
  assert.deepEqual(await counts(first.project.projectId), { commands: 1, audits: 1 });
  await assert.rejects(create(a, { ...input, name: "Different" }, metadata), errorCode("IDEMPOTENCY_KEY_REUSED"));
});
test("all operators share projects; owner is not authorization isolation", async () => {
  const a = await actor(), b = await actor(), p = (await create(a, { ...basics(), ownerOperatorId: a.operatorId })).project;
  assert.ok((await service.list(b.sessionToken)).projects.some(item => item.projectId === p.projectId));
  const updated = await service.save(b.sessionToken, b.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 0, basics: { ...basics(), name: "Other operator edit", ownerOperatorId: a.operatorId } }, "update");
  assert.equal(updated.project.factVersion, 1); assert.equal(updated.project.createdByOperatorId, a.operatorId);
});
test("two operators saving the same version cannot silently overwrite one another", async () => {
  const a = await actor(), b = await actor(), p = (await create(a)).project;
  const input = { projectId: p.projectId, expectedFactVersion: 0, basics: basics() };
  const results = await Promise.allSettled([service.save(a.sessionToken, a.csrfToken, { ...input, metadata: meta() }, "update"), service.save(b.sessionToken, b.csrfToken, { ...input, metadata: meta(), basics: { ...input.basics, name: "Competing" } }, "update")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected" && errorCode("FACT_VERSION_STALE")(r.reason)).length, 1);
  assert.deepEqual(await counts(p.projectId), { commands: 2, audits: 2 });
});
test("new disabled owners are rejected but retained responsibility survives disable without a fake pause", async () => {
  const a = await actor(), owner = await actor(), input = { ...basics(), ownerOperatorId: owner.operatorId }, p = (await create(a, input)).project;
  await pool.query("UPDATE socialgrowth_product.operators SET status='disabled',disabled_at=clock_timestamp() WHERE operator_id=$1", [owner.operatorId]);
  const updated = await service.save(a.sessionToken, a.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 0, basics: { ...input, name: "Retained responsibility" } }, "update");
  assert.equal(updated.project.ownerOperatorId, owner.operatorId); assert.equal(updated.project.phase, "preparing");
  await assert.rejects(create(a, input), errorCode("INPUT_INVALID"));
});
test("unchanged metadata does not create a business version or audit; replay returns current facts", async () => {
  const a = await actor(), input = basics(), metadata = meta(), p = (await create(a, input, metadata)).project;
  const same = await service.save(a.sessionToken, a.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 0, basics: input }, "update");
  assert.equal(same.project.factVersion, 0); assert.deepEqual(await counts(p.projectId), { commands: 2, audits: 1 });
  const updated = await service.save(a.sessionToken, a.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 0, basics: { ...input, name: "New current name" } }, "update");
  assert.deepEqual((await create(a, input, metadata)).project, updated.project);
});
test("valid host authentication and matching CSRF are required before create, read and replay", async () => {
  const a = await actor(), input = basics(), metadata = meta(); await create(a, input, metadata);
  await assert.rejects(service.save(a.sessionToken, "", { metadata: meta(), basics: input }, "create"), errorCode("AUTHENTICATION_REQUIRED"));
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='logout' WHERE session_id=$1", [a.sessionId]);
  await assert.rejects(service.list(a.sessionToken), errorCode("AUTHENTICATION_REQUIRED"));
  await assert.rejects(create(a, input, metadata), errorCode("AUTHENTICATION_REQUIRED"));
});
test("audit failure rolls back project, idempotency and version with masked SQL details", async () => {
  const a = await actor(), input = basics(), metadata = meta();
  await pool.query(`CREATE FUNCTION socialgrowth_product.fail_project_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='project' THEN RAISE EXCEPTION 'fixture-secret-url'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER project_audit_fault BEFORE INSERT ON socialgrowth_product.audit_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.fail_project_audit()");
  try {
    await assert.rejects(create(a, input, metadata), (error: unknown) => errorCode("INTERNAL_ERROR")(error) && error instanceof Error && !error.message.includes("fixture-secret") && !error.cause);
    assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.projects WHERE name=$1", [input.name])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM socialgrowth_product.project_metadata_commands WHERE actor_id=$1", [a.operatorId])).rowCount, 0);
  } finally { await pool.query("DROP TRIGGER project_audit_fault ON socialgrowth_product.audit_records"); await pool.query("DROP FUNCTION socialgrowth_product.fail_project_audit()"); }
  assert.equal((await create(a, input, metadata)).project.factVersion, 0);
});
test("session expiry after project lock wait denies a write without losing saved metadata", async () => {
  const a = await actor(), p = (await create(a)).project, blocker = await pool.connect();
  await pool.query("UPDATE socialgrowth_product.operator_sessions SET expires_at=clock_timestamp()+interval '250 milliseconds' WHERE session_id=$1", [a.sessionId]);
  let result: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT 1 FROM socialgrowth_product.projects WHERE project_id=$1 FOR UPDATE", [p.projectId]);
    result = service.save(a.sessionToken, a.csrfToken, { metadata: meta(), projectId: p.projectId, expectedFactVersion: 0, basics: basics() }, "update");
    const guarded = assert.rejects(result, errorCode("AUTHENTICATION_REQUIRED"));
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='sg-project-fixtures' AND wait_event_type='Lock' AND pid<>pg_backend_pid()" )).rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(waiting); await new Promise(resolve => setTimeout(resolve, 300)); await blocker.query("COMMIT"); await guarded;
    assert.deepEqual(await counts(p.projectId), { commands: 1, audits: 1 });
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await result?.catch(() => undefined); }
});
