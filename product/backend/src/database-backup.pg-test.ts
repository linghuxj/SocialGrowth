import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, readdir, stat, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { contractVersion, taskProtocolVersion } from "@socialgrowth/product-contracts";
import { OperatorAuthService } from "./operator-auth-service.js";
import { TaskRecheckJournal } from "./task-recheck-journal.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { sealDatabaseBackup, openDatabaseBackup, DatabaseBackupError, type DatabaseBackupEnvelope } from "./database-backup-envelope.js";
const cid = process.env.SG_PRODUCT_TEST_BACKUP_CONTAINER_ID;
if (!cid || !/^[a-f0-9]{64}$/.test(cid) || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires explicit owned backup fixture and reset authorization");
const docker = (args: string[], input?: Buffer) => execFileSync("docker", args, { input, timeout: 30000, maxBuffer: 128 * 1024 * 1024 });
const source = new Pool({ connectionString: "postgresql://sg_backup:synthetic-encrypted-backup-only-00001@127.0.0.1:32877/sg_backup_source" }), target = new Pool({ connectionString: "postgresql://sg_backup:synthetic-encrypted-backup-only-00001@127.0.0.1:32877/sg_backup_restore" });
const s = "socialgrowth_product", key = { keyId: "synthetic-backup-drill-only", key: randomBytes(32) }, hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
// pg_dump/restore reparses three known CHECK expressions, flattening nested
// associative AND without changing order/terms. No generic parenthesis removal,
// OR rewriting or dropped constraint. Every other definition remains exact.
function canonicalConstraint(row: { relname: string; conname: string; definition: string }) {
  for (const [table, constraint, column] of [["projects", "projects_name_check", "name"], ["projects", "projects_customer_name_check", "customer_name"], ["device_assistance_notes", "device_assistance_notes_text_check", "text"]]) {
    if (row.relname !== table || row.conname !== constraint) continue;
    const nested = `CHECK ((((length(${column}) >= 1) AND (length(${column}) <= 150)) AND (${column} = btrim(${column}))))`;
    const flat = `CHECK (((length(${column}) >= 1) AND (length(${column}) <= 150) AND (${column} = btrim(${column}))))`;
    if (row.definition === nested) return { ...row, definition: flat };
  }
  return row;
}
let envelope: DatabaseBackupEnvelope, expected: Awaited<ReturnType<typeof inventory>>, file: string, directory: string, token: string, projectId: string, taskId: string, operatorId: string;
async function guard() {
  const allIds = docker(["ps", "-aq"]).toString().trim().split(/\s+/);
  const all: { Id: string; Name: string; Image: string; State: { Running: boolean }; HostConfig: { AutoRemove: boolean }; Config: { Labels: Record<string, string> }; NetworkSettings: { Ports: unknown }; Mounts: { Type: string; Name: string; Destination: string }[] }[] = JSON.parse(docker(["inspect", ...allIds]).toString());
  const own = all.find(r => r.Id === cid); assert.ok(own); assert.equal(own.Name, "/sg-wp27-backup-pg"); assert.equal(own.State.Running, true); assert.equal(own.HostConfig.AutoRemove, true);
  assert.equal(own.Image, "sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74"); assert.equal(own.Config.Labels["socialgrowth.fixture"], "wp27-encrypted-backup");
  assert.deepEqual(own.NetworkSettings.Ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "32877" }] }); assert.equal(own.Mounts.length, 1); assert.equal(own.Mounts[0]!.Type, "volume"); assert.equal(own.Mounts[0]!.Destination, "/var/lib/postgresql/data");
  assert.equal(all.filter(r => r.Mounts.some(m => m.Name === own.Mounts[0]!.Name)).length, 1);
  const cluster = docker(["exec", cid!, "psql", "-U", "sg_backup", "-d", "sg_backup_source", "-Atc", "SELECT system_identifier FROM pg_control_system()"]).toString().trim();
  assert.deepEqual((await source.query("SELECT current_database() db,current_user usr,system_identifier::text cluster FROM pg_control_system()")).rows[0], { db: "sg_backup_source", usr: "sg_backup", cluster }); assert.match(cluster, /^[0-9]{19}$/);
  console.log("whole owned CID/volume/TCP cluster PASS", cid, cluster);
}
async function inventory(c: PoolClient) {
  const tables: { relname: string }[] = (await c.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`, [s])).rows;
  const data = [];
  for (const { relname } of tables) { assert.match(relname, /^[a-z][a-z0-9_]+$/); const rows = (await c.query(`SELECT row_to_json(t)::text value FROM ${s}.${relname} t ORDER BY row_to_json(t)::text`)).rows.map((r: { value: string }) => r.value); data.push({ table: relname, rows: rows.length, sha256: hash(JSON.stringify(rows)) }); }
  const constraints = (await c.query(`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,k.conname`, [s])).rows.map(canonicalConstraint);
  const triggers = (await c.query(`SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`, [s])).rows;
  return { data, constraints: hash(JSON.stringify(constraints)), constraintDefinitions: constraints, triggers: hash(JSON.stringify(triggers)) }; // No raw rows/secrets returned or logged.
}
async function inspect(pool: Pool) { const c = await pool.connect(); try { await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const i = await inventory(c); await c.query("COMMIT"); return i; } finally { c.release(); } }
before(async () => {
  await guard(); await source.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  if (!(await source.query("SELECT 1 FROM pg_database WHERE datname='sg_backup_restore'")).rowCount) await source.query("CREATE DATABASE sg_backup_restore");
  assert.deepEqual((await target.query("SELECT current_database() db,current_user usr,system_identifier::text cluster FROM pg_control_system()")).rows[0], { ...(await source.query("SELECT current_database() db,current_user usr,system_identifier::text cluster FROM pg_control_system()")).rows[0], db: "sg_backup_restore" });
  await target.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url), names = (await readdir(dir)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort(); for (const f of names) await source.query(await readFile(new URL(f, dir), "utf8"));
  operatorId = randomUUID(); const sessionId = randomUUID(), csrf = randomBytes(32).toString("base64url"); token = randomBytes(32).toString("base64url"); projectId = randomUUID(); taskId = randomUUID();
  await source.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic backup','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await source.query(`INSERT INTO ${s}.operator_sessions(session_id,operator_id,token_digest,csrf_digest,credential_version,expires_at) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day')`, [sessionId, operatorId, Buffer.from(hash(token), "hex"), Buffer.from(hash(csrf), "hex")]);
  await source.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Synthetic backup','company_owned',$2)`, [projectId, operatorId]);
  const task = { protocolVersion: taskProtocolVersion, taskId, taskRevision: 1, projectId, taskAttemptId: randomUUID(), deviceId: randomUUID(), identityId: randomUUID(), kind: "publish_content", platform: "youtube", form: "youtube_shorts",
    arrangementRevision: 1, projectVersion: 1, assignmentId: randomUUID(), assignmentVersion: 1, approvalId: randomUUID(), approvalVersion: 1, contentUnitId: randomUUID(), variantId: randomUUID(), materialRevision: 1, languageTag: "en-us",
    objects: [{ objectId: randomUUID(), sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" }], title: "Synthetic declaration", caption: "Not approved or published", scheduledAt: "2026-10-01T00:00:00Z",
    window: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T00:00:01Z" }, recovery: { roundId: randomUUID(), maxAttempts: 2, maxElapsedMs: 300000 } };
  const auth = new OperatorAuthService(source, "synthetic-backup-pepper-only-00001"); await new TaskRecheckJournal(source, auth).save(token, csrf, { metadata: { contractVersion, requestId: `request-${randomUUID()}`, idempotencyKey: `backup-${randomUUID()}` }, expectedCurrentRevision: 0, task });
  await source.query(`UPDATE ${s}.operators SET status='disabled',disabled_at=clock_timestamp(),credential_version=2 WHERE operator_id=$1`, [operatorId]); await source.query(`UPDATE ${s}.operator_sessions SET revoked_at=clock_timestamp(),revoked_reason='operator_disabled' WHERE session_id=$1`, [sessionId]);
  const c = await source.connect(); try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const snapshot = (await c.query("SELECT pg_export_snapshot() snapshot")).rows[0].snapshot; expected = await inventory(c);
    const dump = docker(["exec", cid!, "pg_dump", "-U", "sg_backup", "-d", "sg_backup_source", "-Fc", "--no-owner", "--no-acl", `--snapshot=${snapshot}`]);
    envelope = sealDatabaseBackup(dump, { backupId: randomUUID(), createdAt: new Date().toISOString(), postgresMajor: 17, migrationFiles: await Promise.all(names.map(async name => ({ name, sha256: hash(await readFile(new URL(name, dir))) }))) }, key); dump.fill(0); await c.query("COMMIT");
  } finally { c.release(); }
  directory = await mkdtemp(join(tmpdir(), "sg-encrypted-backup-drill-")); file = join(directory, "backup.encrypted.json"); await writeFile(file, JSON.stringify(envelope), { mode: 0o600, flag: "wx" });
});
after(async () => { try { await guard(); await target.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); await source.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); if (file) await unlink(file); if (directory) await rmdir(directory); }
  finally { key.key.fill(0); await target.end(); await source.end(); } });
test("actual exported snapshot custom dump, encrypted-only 0600 file and independent empty DB restore preserve tables/constraints/triggers", async () => {
  assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await target.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [s])).rowCount, 0);
  const stored = await readFile(file, "utf8"); for (const secret of [token, key.key.toString("hex"), "not-a-password"]) assert.ok(!stored.includes(secret)); const opened = openDatabaseBackup(JSON.parse(stored), key);
  await source.query(`UPDATE ${s}.operators SET credential_version=3 WHERE operator_id=$1`, [operatorId]); // Backup deliberately older than actual current source.
  await guard(); docker(["exec", "-i", cid!, "pg_restore", "-U", "sg_backup", "-d", "sg_backup_restore", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"], opened.dump); opened.dump.fill(0);
  assert.deepEqual(await inspect(target), expected); assert.notDeepEqual(await inspect(source), expected); assert.equal(opened.manifest.requiresReconciliation, true); assert.equal(opened.manifest.executionAllowed, false);
  console.log("tables restored", expected.data.length, "snapshot equal, actual source newer, reconciliation REQUIRED");
});
test("actual restored revoked auth and pending outbox do not become executable or automatically replayed", async () => {
  await assert.rejects(new TaskRecheckJournal(target, new OperatorAuthService(target, "synthetic-backup-pepper-only-00001")).read(token, projectId, taskId), e => e instanceof ProductTransactionError && e.code === "AUTHENTICATION_REQUIRED");
  assert.deepEqual((await target.query(`SELECT status,execution_allowed,current_revision::text FROM ${s}.task_recheck_records WHERE task_id=$1`, [taskId])).rows[0], { status: "pending_current_checks", execution_allowed: false, current_revision: "1" });
  assert.deepEqual((await target.query(`SELECT attempts::text,queue_observed_at FROM ${s}.task_recheck_outbox WHERE task_id=$1`, [taskId])).rows[0], { attempts: "0", queue_observed_at: null });
  assert.equal((await target.query(`SELECT credential_version::text FROM ${s}.operators WHERE operator_id=$1`, [operatorId])).rows[0].credential_version, "2");
});
test("actual known PostgreSQL AND reparsing preserves exact three CHECK terms and all null/Unicode/length boundary semantics", async () => {
  for (const [table, constraint, column] of [["projects", "projects_name_check", "name"], ["projects", "projects_customer_name_check", "customer_name"], ["device_assistance_notes", "device_assistance_notes_text_check", "text"]]) {
    const sql = `SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND k.conname=$3`;
    const old = (await source.query(sql, [s, table, constraint])).rows[0], restored = (await target.query(sql, [s, table, constraint])).rows[0];
    assert.deepEqual(canonicalConstraint(old), restored);
    for (const value of [null, "", "a", " ", " a", "a ", "\ta", "a".repeat(149), "a".repeat(150), "a".repeat(151), "😀".repeat(150), "😀".repeat(151), "\u00a0a"]) {
      const row = (await target.query(`SELECT (${old.definition.slice(6)}) IS NOT DISTINCT FROM (${restored.definition.slice(6)}) same FROM (VALUES($1::text)) t(${column})`, [value])).rows[0]; assert.equal(row.same, true);
    }
  }
});
test("bad crypto/key/manifest closes before restoration, target inventory remains unchanged", async () => {
  const before = await inspect(target); let calls = 0;
  for (const [e,k] of [[{ ...envelope, tag: randomBytes(16).toString("base64") }, key], [envelope, { ...key, key: randomBytes(32) }], [{ ...envelope, manifest: { ...envelope.manifest, dumpSha256: "b".repeat(64) } }, key]] as const)
    assert.throws(() => { const opened = openDatabaseBackup(e,k); calls++; opened.dump.fill(0); }, e => e instanceof DatabaseBackupError);
  assert.equal(calls, 0); assert.deepEqual(await inspect(target), before);
});
test("actual missing restored table is detected, rather than counted as complete recovery", async () => {
  await guard(); await target.query(`DROP TABLE ${s}.operator_login_throttles`); const missing = await inspect(target); assert.notDeepEqual(missing, expected); assert.equal(missing.data.length, expected.data.length - 1);
  assert.ok(!missing.data.some(r => r.table === "operator_login_throttles"));
});
