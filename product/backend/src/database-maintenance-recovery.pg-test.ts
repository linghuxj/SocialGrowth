import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdtemp, realpath, readdir, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import { Pool } from "pg";
import { CreateBucketCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { EncryptedDatabaseBackupFileStore } from "./database-backup-file-store.js";
import { metadataSchema } from "./database-backup-envelope.js";
import { openInventoryBoundDatabaseBackup } from "./database-backup-inventory-envelope.js";
import { MaterialObjectStorage } from "./material-object-storage.js";
import { captureAndStoreMaintenanceBackup, inspectMaintenanceRestore } from "./database-restore-maintenance.js";

const runId = randomUUID(), label = `socialgrowth.fixture=maintenance-joint-${runId}`;
const pgName = `sg-maint-pg-${runId.slice(0, 8)}`, minioName = `sg-maint-s3-${runId.slice(0, 8)}`;
const pgPassword = `fixture-${randomBytes(24).toString("hex")}`, minioUser = `fixture-${randomBytes(8).toString("hex")}`;
const minioPassword = `fixture-${randomBytes(24).toString("hex")}`, bucket = `sg-maint-${runId}`;
const pgImage = execFileSync("docker", ["image", "inspect", "postgres:17.11", "--format", "{{.Id}}"], { encoding: "utf8" }).trim();
const s3Image = execFileSync("docker", ["image", "inspect", "minio/minio:latest", "--format", "{{.Id}}"], { encoding: "utf8" }).trim();
const docker = (args: string[], input?: Buffer, encoding: BufferEncoding | undefined = "utf8") => {
  try { return execFileSync("docker", args, { input, timeout: 60_000, maxBuffer: 160 * 1024 * 1024, encoding }) as Buffer | string; }
  catch { throw new Error("isolated maintenance fixture command failed"); }
};
const invoke = (args: string[], input?: Buffer) => {
  try { return execFileSync("docker", args, { input, timeout: 60_000, maxBuffer: 160 * 1024 * 1024 }); }
  catch { throw new Error("isolated maintenance fixture command failed"); }
};
const text = (args: string[]) => docker(args) as string;
let pgId: string | undefined, s3Id: string | undefined, pgPort = "", s3Port = "";
let adminDb: Pool | undefined, source: Pool | undefined, target: Pool | undefined, admin: S3Client | undefined, storage: MaterialObjectStorage | undefined;
let directory: string | undefined, backupKey = { keyId: `fixture-${runId}`, key: randomBytes(32) };
let backupId = "";

type ContainerFacts = { Id: string; Name: string; Image: string; State: { Running: boolean }; HostConfig: { AutoRemove: boolean }; Config: { Labels: Record<string, string> }; NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> }; Mounts: { Type: string; Name: string; Destination: string }[] };
function ownedFacts(id: string): ContainerFacts {
  const fields = text(["inspect", "--format", "{{.Id}}\n{{.Name}}\n{{.Image}}\n{{.State.Running}}\n{{.HostConfig.AutoRemove}}\n{{json .Config.Labels}}\n{{json .NetworkSettings.Ports}}\n{{json .Mounts}}", id]).trim().split("\n");
  return { Id: fields[0]!, Name: fields[1]!, Image: fields[2]!, State: { Running: fields[3] === "true" }, HostConfig: { AutoRemove: fields[4] === "true" },
    Config: { Labels: JSON.parse(fields[5]!) as Record<string, string> }, NetworkSettings: { Ports: JSON.parse(fields[6]!) as ContainerFacts["NetworkSettings"]["Ports"] }, Mounts: JSON.parse(fields[7]!) as ContainerFacts["Mounts"] };
}
function guard(id: string, expected: { name: string; image: string; port: string; containerPort: string }, verifyVolumes = true): ContainerFacts {
  const facts = ownedFacts(id);
  assert.equal(facts.Id, id); assert.equal(facts.Name, `/${expected.name}`); assert.equal(facts.Image, expected.image);
  assert.equal(facts.State.Running, true); assert.equal(facts.HostConfig.AutoRemove, true); assert.equal(facts.Config.Labels["socialgrowth.fixture"], label.split("=")[1]);
  assert.deepEqual(facts.NetworkSettings.Ports[expected.containerPort], [{ HostIp: "127.0.0.1", HostPort: expected.port }]);
  assert.ok(facts.Mounts.length >= 1); assert.ok(facts.Mounts.every(m => m.Type === "volume" && m.Destination.startsWith("/var/lib/postgresql/") || m.Type === "volume" && m.Destination === "/data"));
  if (verifyVolumes) {
    const allIds = text(["ps", "-aq"]).trim().split(/\s+/).filter(Boolean);
    const all = allIds.map(other => {
      const fields = text(["inspect", "--format", "{{.Id}}\n{{json .Mounts}}", other]).trim().split("\n");
      return { Id: fields[0]!, Mounts: JSON.parse(fields[1]!) as ContainerFacts["Mounts"] };
    });
    for (const volume of facts.Mounts.map(m => m.Name)) assert.equal(all.filter(other => other.Mounts.some(m => m.Name === volume)).length, 1);
  }
  return facts;
}
async function databaseGuard(pool: Pool, database: string) {
  assert.ok(pgId); guard(pgId, { name: pgName, image: pgImage, port: pgPort, containerPort: "5432/tcp" }, false);
  const fromContainer = text(["exec", pgId, "psql", "-U", "postgres", "-d", database, "-Atc", "SELECT system_identifier FROM pg_control_system()"]).trim();
  const row = (await pool.query<{ db: string; cluster: string }>("SELECT current_database() db,system_identifier::text cluster FROM pg_control_system()")).rows[0];
  assert.deepEqual(row, { db: database, cluster: fromContainer }); assert.match(fromContainer, /^[0-9]{19}$/);
  return fromContainer;
}
async function waitFor(testReady: () => Promise<boolean>) {
  const until = Date.now() + 45_000;
  while (Date.now() < until) { try { if (await testReady()) return; } catch { /* private fixture may still be starting */ } await delay(250); }
  throw new Error("isolated maintenance fixture did not become ready");
}

test("full-current-migration maintenance rehearsal detects post-backup revocation and a deleted object, then keeps all release gates closed", async () => {
  assert.equal(text(["ps", "-aq", "--filter", `name=^/${pgName}$`]).trim(), "", "unique PG fixture name must be unused");
  assert.equal(text(["ps", "-aq", "--filter", `name=^/${minioName}$`]).trim(), "", "unique object-store fixture name must be unused");
  const pgStarted = text(["run", "-d", "--rm", "--name", pgName, "--label", label, "-p", "127.0.0.1::5432", "-e", "POSTGRES_PASSWORD=" + pgPassword, "postgres:17.11"]).trim(); pgId = pgStarted;
  let pg = ownedFacts(pgId); pgPort = pg.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort ?? ""; assert.match(pgPort, /^\d+$/); pg = guard(pgId, { name: pgName, image: pgImage, port: pgPort, containerPort: "5432/tcp" });
  const s3Started = text(["run", "-d", "--rm", "--name", minioName, "--label", label, "-p", "127.0.0.1::9000", "-e", `MINIO_ROOT_USER=${minioUser}`, "-e", `MINIO_ROOT_PASSWORD=${minioPassword}`, "minio/minio:latest", "server", "/data", "--address", ":9000"]).trim(); s3Id = s3Started;
  let s3 = ownedFacts(s3Id); assert.equal(s3.Id, s3Id); assert.equal(s3.Name, `/${minioName}`); assert.equal(s3.Image, s3Image); assert.equal(s3.State.Running, true); assert.equal(s3.HostConfig.AutoRemove, true); assert.equal(s3.Config.Labels["socialgrowth.fixture"], label.split("=")[1]);
  s3Port = s3.NetworkSettings.Ports["9000/tcp"]?.[0]?.HostPort ?? ""; assert.match(s3Port, /^\d+$/);
  s3 = guard(s3Id, { name: minioName, image: s3Image, port: s3Port, containerPort: "9000/tcp" });
  const pgUrl = `postgresql://postgres:${pgPassword}@127.0.0.1:${pgPort}/postgres`;
  adminDb = new Pool({ connectionString: pgUrl, max: 4, application_name: "sg-maintenance-joint-fixture" });
  await waitFor(async () => (await adminDb!.query("SELECT 1")).rowCount === 1);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${s3Port}/minio/health/live`)).ok);
  const initialCluster = await databaseGuard(adminDb, "postgres");
  await adminDb.query("CREATE DATABASE sg_ops_source"); await adminDb.query("CREATE DATABASE sg_ops_restore");
  source = new Pool({ connectionString: pgUrl.replace(/\/postgres$/, "/sg_ops_source"), max: 4, application_name: "sg-maintenance-joint-source" });
  target = new Pool({ connectionString: pgUrl.replace(/\/postgres$/, "/sg_ops_restore"), max: 4, application_name: "sg-maintenance-joint-target" });
  assert.equal(await databaseGuard(source, "sg_ops_source"), initialCluster); assert.equal(await databaseGuard(target, "sg_ops_restore"), initialCluster);
  // Engineering fixture only: apply every migration in this frozen source
  // tree. Empty product tables prove schema/inventory comparability only, not
  // business data recovery or production disaster-recovery readiness.
  const migrationDir = new URL("../migrations/", import.meta.url), available = (await readdir(migrationDir)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name));
  const names = available.sort();
  assert.ok(names.length > 0 && names.every(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)), "the frozen migration directory must contain the complete numbered SQL migration set");
  const migrationBytes = await Promise.all(names.map(name => readFile(new URL(name, migrationDir))));
  const migrationFiles = names.map((name, index) => ({ name, sha256: createHash("sha256").update(migrationBytes[index]!).digest("hex") }));
  for (const [index, migration] of names.entries()) { await databaseGuard(source, "sg_ops_source"); await source.query(migrationBytes[index]!.toString("utf8")); }
  await source.query("CREATE TABLE socialgrowth_product.maintenance_identity_fixture (fixture_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY)");
  assert.equal((await source.query<{ fixtureId: string }>("INSERT INTO socialgrowth_product.maintenance_identity_fixture DEFAULT VALUES RETURNING fixture_id::text \"fixtureId\"")).rows[0]?.fixtureId, "1");
  const operatorId = randomUUID(), providerId = randomUUID(), providerSessionId = randomUUID(), projectId = randomUUID();
  await source.query(`INSERT INTO socialgrowth_product.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Maintenance rehearsal','fixture-only','active')`, [operatorId, `fixture${runId.replaceAll("-", "").slice(0, 12)}`]);
  const fixturePhone = `+1${Array.from({ length: 14 }, () => randomInt(10)).join("")}`;
  await source.query(`INSERT INTO socialgrowth_product.providers(provider_id,phone_e164,display_name,status) VALUES($1,$2,'Maintenance rehearsal','active')`, [providerId, fixturePhone]);
  await source.query(`INSERT INTO socialgrowth_product.provider_sessions(session_id,provider_id,token_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day')`, [providerSessionId, providerId, randomBytes(32)]);
  await source.query(`INSERT INTO socialgrowth_product.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Maintenance rehearsal','company_owned',$2)`, [projectId, operatorId]);
  const installationId = randomUUID(), installationSessionId = randomUUID(), deviceId = randomUUID(), associationSessionId = randomUUID(), associationId = randomUUID();
  const participationRunId = randomUUID(), holderId = randomUUID(), stopRequestId = randomUUID();
  await source.query(`INSERT INTO socialgrowth_product.installations(installation_id,credential_digest,status) VALUES($1,$2,'active')`, [installationId, randomBytes(32)]);
  await source.query(`INSERT INTO socialgrowth_product.installation_sessions(session_id,installation_id,token_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day')`, [installationSessionId, installationId, randomBytes(32)]);
  await source.query(`INSERT INTO socialgrowth_product.devices(device_id,display_name,state) VALUES($1,'Maintenance fixture device','access_ready')`, [deviceId]);
  await source.query(`INSERT INTO socialgrowth_product.association_sessions(association_session_id,installation_id,expected_installation_generation,device_label,code_digest,expires_at,consumed_at,consumed_by_provider_id) VALUES($1,$2,1,'Maintenance fixture', $3,clock_timestamp()+interval '1 day',clock_timestamp(),$4)`, [associationSessionId, installationId, randomBytes(32), providerId]);
  await source.query(`INSERT INTO socialgrowth_product.device_associations(association_id,device_id,installation_id,provider_id,association_session_id) VALUES($1,$2,$3,$4,$5)`, [associationId, deviceId, installationId, providerId, associationSessionId]);
  await source.query(`INSERT INTO socialgrowth_product.local_participation_runs(run_id,device_id,installation_id,association_id,session_id,installation_generation,record) VALUES($1,$2,$3,$4,$5,'1',$6)`, [participationRunId, deviceId, installationId, associationId, installationSessionId, JSON.stringify({ runId: participationRunId })]);
  const controlGeneration = "1", controlRecord = { deviceId, version: 1, controlGeneration, disposition: "stop_requested", holderId, calls: [{ status: "unknown" }], stopRequestId };
  await source.query(`INSERT INTO socialgrowth_product.phone_control_journals(device_id,version,control_generation,disposition,holder_id,record) VALUES($1,1,$2,'stop_requested',$3,$4)`, [deviceId, controlGeneration, holderId, controlRecord]);
  await source.query(`INSERT INTO socialgrowth_product.phone_control_holder_grants(holder_id,device_id,control_generation,granted_version,record) VALUES($1,$2,$3,1,$4)`, [holderId, deviceId, controlGeneration, { holderId, deviceId, controlGeneration }]);
  const taskId = randomUUID(), messageId = randomUUID(), contract = { taskId, taskRevision: 1 }, notice = { taskId, taskRevision: 1, messageId, executionAllowed: false };
  await source.query("BEGIN");
  try {
    await source.query(`INSERT INTO socialgrowth_product.task_recheck_records(task_id,project_id,current_revision) VALUES($1,$2,1)`, [taskId, projectId]);
    await source.query(`INSERT INTO socialgrowth_product.task_recheck_revisions(task_id,revision,contract,notice,message_id,recorded_by_operator_id,recorded_at) VALUES($1,1,$2,$3,$4,$5,$6)`, [taskId, contract, notice, messageId, operatorId, new Date().toISOString()]);
    await source.query(`INSERT INTO socialgrowth_product.task_recheck_outbox(message_id,task_id,revision) VALUES($1,$2,1)`, [messageId, taskId]);
    await source.query("COMMIT");
  } catch (error) { await source.query("ROLLBACK"); throw error; }

  await databaseGuard(source, "sg_ops_source");
  const storageLocationId = randomUUID(), objectId = randomUUID(), endpoint = `http://127.0.0.1:${s3Port}`;
  const storageConfig = { storageLocationId, endpoint, region: "us-east-1", bucket, forcePathStyle: true, accessKeyId: minioUser, secretAccessKey: minioPassword, maxObjectBytes: 4096, requestTimeoutMs: 5000 };
  admin = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: minioUser, secretAccessKey: minioPassword }, maxAttempts: 1 });
  await admin.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(10_000) }); storage = new MaterialObjectStorage(storageConfig);
  const ref = await storage.put({ projectId, objectId, contentType: "application/octet-stream" }, Buffer.from("isolated object fixture"));
  await source.query(`INSERT INTO socialgrowth_product.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [objectId, projectId, ref]);
  let objectDeleteAcknowledged = false;
  const fileConfig = await mkdtemp(join(tmpdir(), `sg-maintenance-${runId}-`)); directory = await realpath(fileConfig);
  const fileStore = new EncryptedDatabaseBackupFileStore({ directory }); backupId = randomUUID();
  pg = guard(pgId, { name: pgName, image: pgImage, port: pgPort, containerPort: "5432/tcp" });
  let archiveStarted = false, archiveSucceeded = false, archiveFailure = "unknown", inventoryFailure = "unknown";
  const diagnosticPool = { connect: async () => {
    const client = await source!.connect();
    return new Proxy(client, { get(actual, property) {
      if (property === "query") return async (sql: string, ...args: unknown[]) => {
        try { return await Reflect.apply(actual.query, actual, [sql, ...args]); }
        catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown"; inventoryFailure = `${code}:${createHash("sha256").update(sql).digest("hex").slice(0, 12)}`; throw error; }
      };
      const value: unknown = Reflect.get(actual, property, actual); return typeof value === "function" ? value.bind(actual) : value;
    } });
  } } as unknown as Pool;
  const backupMetadata = { backupId, createdAt: new Date().toISOString(), postgresMajor: 17 as const, migrationFiles };
  assert.ok(metadataSchema.safeParse(backupMetadata).success, "the complete exact applied migration manifest enters backup metadata");
  const capturePromise = captureAndStoreMaintenanceBackup({
    pool: diagnosticPool,
    archive: async snapshotId => { archiveStarted = true; const bytes = invoke(["exec", pgId!, "pg_dump", "-U", "postgres", "-d", "sg_ops_source", "-Fc", "--no-owner", "--no-acl", `--snapshot=${snapshotId}`]);
      if (!Buffer.isBuffer(bytes)) { archiveFailure = `output-${typeof bytes}`; throw new Error("archive output type invalid"); }
      if (bytes.subarray(0, 5).toString("ascii") !== "PGDMP") { archiveFailure = "archive-magic-invalid"; throw new Error("archive header invalid"); }
      archiveSucceeded = true; return bytes; },
    metadata: backupMetadata, key: backupKey, store: fileStore,
  });
  let capture: Awaited<typeof capturePromise>;
  try { capture = await capturePromise; } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
    throw new Error(archiveSucceeded ? `maintenance capture failed after archive (${code}, ${inventoryFailure})` : archiveStarted ? `maintenance archive command failed (${archiveFailure})` : `maintenance inventory failed before archive (${inventoryFailure})`);
  }
  assert.equal(capture.state, "stored"); assert.equal(capture.backupId, backupId); assert.equal(capture.envelope, null);

  await databaseGuard(source, "sg_ops_source");
  await source.query(`UPDATE socialgrowth_product.provider_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1`, [providerSessionId]);
  await source.query(`UPDATE socialgrowth_product.installation_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1`, [installationSessionId]);
  await source.query(`UPDATE socialgrowth_product.installations SET status='revoked',generation=generation+1,updated_at=clock_timestamp() WHERE installation_id=$1`, [installationId]);
  await source.query(`UPDATE socialgrowth_product.device_associations SET ended_at=clock_timestamp() WHERE association_id=$1`, [associationId]);
  await source.query(`UPDATE socialgrowth_product.local_participation_runs SET revoked_at=clock_timestamp() WHERE run_id=$1`, [participationRunId]);
  s3 = guard(s3Id, { name: minioName, image: s3Image, port: s3Port, containerPort: "9000/tcp" });
  let deleteErrorCode = "unknown";
  for (let attempt = 0; attempt < 2 && !objectDeleteAcknowledged; attempt++) {
    try { await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: ref.key }), { abortSignal: AbortSignal.timeout(10_000) }); objectDeleteAcknowledged = true; }
    catch (error) { deleteErrorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown"; }
  }
  assert.equal(objectDeleteAcknowledged, true, `owned fixture object delete acknowledged (${deleteErrorCode})`);
  await assert.rejects(storage.readVerified(ref), error => error instanceof Error && "code" in error && error.code === "STORAGE_UNAVAILABLE");

  await databaseGuard(target, "sg_ops_restore");
  const loaded = await fileStore.load(backupId, backupKey), opened = openInventoryBoundDatabaseBackup(loaded.envelope, backupKey);
  try { invoke(["exec", "-i", pgId!, "pg_restore", "-U", "postgres", "-d", "sg_ops_restore", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"], opened.dump); }
  finally { opened.dump.fill(0); }
  const result = await inspectMaintenanceRestore(source, target, storage, opened.manifest.inventory);
  assert.deepEqual(opened.manifest.metadata.migrationFiles, migrationFiles, "backup metadata names and hashes must match the exact migration bytes applied to source");
  assert.equal(objectDeleteAcknowledged, true);
  assert.equal((await source.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL revoked FROM socialgrowth_product.provider_sessions WHERE session_id=$1", [providerSessionId])).rows[0]?.revoked, true);
  assert.equal((await target.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL revoked FROM socialgrowth_product.provider_sessions WHERE session_id=$1", [providerSessionId])).rows[0]?.revoked, false);
  assert.equal((await source.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL revoked FROM socialgrowth_product.installation_sessions WHERE session_id=$1", [installationSessionId])).rows[0]?.revoked, true);
  assert.equal((await target.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL revoked FROM socialgrowth_product.installation_sessions WHERE session_id=$1", [installationSessionId])).rows[0]?.revoked, false);
  assert.equal((await source.query<{ ended: boolean }>("SELECT ended_at IS NOT NULL ended FROM socialgrowth_product.device_associations WHERE association_id=$1", [associationId])).rows[0]?.ended, true);
  assert.equal((await target.query<{ ended: boolean }>("SELECT ended_at IS NOT NULL ended FROM socialgrowth_product.device_associations WHERE association_id=$1", [associationId])).rows[0]?.ended, false);
  assert.equal((await source.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL revoked FROM socialgrowth_product.local_participation_runs WHERE run_id=$1", [participationRunId])).rows[0]?.revoked, true);
  assert.equal((await target.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL revoked FROM socialgrowth_product.local_participation_runs WHERE run_id=$1", [participationRunId])).rows[0]?.revoked, false);
  assert.equal((await target.query<{ calls: { status: string }[] }>("SELECT record->'calls' calls FROM socialgrowth_product.phone_control_journals WHERE device_id=$1", [deviceId])).rows[0]?.calls[0]?.status, "unknown");
  assert.equal(result.databaseMatchesBackup, true);
  const expectedNewTables = ["business_plan_guard", "business_plan_records", "business_plan_revisions", "business_plan_tasks", "business_plan_outbox", "business_plan_commands", "business_plan_outbox_impacts", "metric_snapshot_report_heads", "metric_snapshot_history", "business_plan_task_attempts", "project_lifecycle_intents", "material_withdrawal_intents", "business_plan_task_cancellations", "project_review_cycles"];
  const inventoryTableNames = opened.manifest.inventory.tables.map(table => table.table);
  assert.ok(expectedNewTables.every(name => inventoryTableNames.includes(name)), "all tables introduced by migrations 0031–0036 are included in the captured inventory");
  const tableSchema = async (pool: Pool) => (await pool.query<{ table_name: string; column_name: string; ordinal_position: number; data_type: string; is_nullable: string; column_default: string | null; is_identity: string; identity_generation: string | null }>(
    `SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='socialgrowth_product' AND table_name=ANY($1::text[]) ORDER BY table_name COLLATE "C",ordinal_position`, [expectedNewTables])).rows;
  const sourceNewTableSchema = await tableSchema(source), restoredNewTableSchema = await tableSchema(target);
  assert.ok(expectedNewTables.every(name => sourceNewTableSchema.some(column => column.table_name === name)), "all tables introduced by migrations 0031–0036 exist in the source schema");
  assert.deepEqual(restoredNewTableSchema, sourceNewTableSchema, "migration 0031–0036 table definitions match after empty-target restore");
  const newTableRows = async (pool: Pool) => Promise.all(expectedNewTables.map(async table => ({ table,
    rows: Number((await pool.query(`SELECT count(*)::text AS count FROM socialgrowth_product.${table}`)).rows[0]?.count) })));
  const sourceNewTableRows = await newTableRows(source), restoredNewTableRows = await newTableRows(target);
  assert.deepEqual(sourceNewTableRows, expectedNewTables.map(table => ({ table, rows: table === "business_plan_guard" ? 1 : 0 })), "tables added by migrations 0031–0036 contain only migration-owned singleton data in this schema-only fixture");
  assert.deepEqual(restoredNewTableRows, sourceNewTableRows, "migration 0031–0036 table row inventory matches; empty tables do not prove business data recovery");
  assert.equal(result.currentAuthorityMatchesRestore, false, "source session revocation after backup must differ from restored authority");
  assert.equal(result.currentControlMatchesRestore, true, "unchanged unresolved holder journal must remain exactly in the restored state");
  assert.equal(result.currentHasActiveOrUnknownControl, true, "persisted unknown call/holder must remain classified unresolved");
  assert.equal(result.currentQueueRows, 1, "pending outbox remains visible; this does not prove consumer stop");
  assert.equal((await target.query<{ nextId: string }>("INSERT INTO socialgrowth_product.maintenance_identity_fixture DEFAULT VALUES RETURNING fixture_id::text AS \"nextId\"")).rows[0]?.nextId, "2", "restored identity sequence state advances beyond the captured row");
  assert.equal(result.currentObjectReferencesMatchRestore, true, "database references remain, while the independently stored object was deleted");
  assert.equal(result.restoredObjectsVerified, 0); assert.equal(result.restoredObjectsUnverified, 1);
  assert.equal(result.consumersStopped, "unknown"); assert.equal(result.physicalFence, "unknown");
  assert.equal(result.executionAllowed, false); assert.equal(result.publicationAllowed, false); assert.equal(result.holderReleaseAllowed, false);
  opened.dump.fill(0); backupKey.key.fill(0);
  await adminDb.end(); adminDb = undefined;
});

after(async () => {
  try {
    await source?.end(); await target?.end(); await adminDb?.end(); storage?.close(); admin?.destroy();
    if (directory) {
      const entries = await readdir(directory), expectedFile = `${backupId.toLowerCase()}.sgbackup.json`;
      assert.ok(entries.length === 0 || entries.length === 1 && entries[0] === expectedFile);
      if (entries.length === 1) await unlink(join(directory, expectedFile));
      await rmdir(directory);
    }
    if (pgId) { pgPort ||= ownedFacts(pgId).NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort ?? ""; guard(pgId, { name: pgName, image: pgImage, port: pgPort, containerPort: "5432/tcp" }); text(["stop", pgId]); assert.ok(!text(["ps", "-aq"]).includes(pgId)); }
    if (s3Id) { s3Port ||= ownedFacts(s3Id).NetworkSettings.Ports["9000/tcp"]?.[0]?.HostPort ?? ""; guard(s3Id, { name: minioName, image: s3Image, port: s3Port, containerPort: "9000/tcp" }); text(["stop", s3Id]); assert.ok(!text(["ps", "-aq"]).includes(s3Id)); }
  } finally { backupKey.key.fill(0); }
});
