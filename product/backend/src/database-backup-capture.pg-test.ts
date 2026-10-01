import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, realpath, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { captureInventoryBoundDatabaseBackup, DatabaseBackupCaptureError } from "./database-backup-capture.js";
import { openInventoryBoundDatabaseBackup } from "./database-backup-inventory-envelope.js";
import { EncryptedDatabaseBackupFileStore } from "./database-backup-file-store.js";
import { withDatabaseInventorySnapshot, compareDatabaseRestoreInventories } from "./database-restore-inventory.js";
import type { DatabaseBackupMetadata } from "./database-backup-envelope.js";
const cid = process.env.SG_PRODUCT_TEST_CAPTURE_CONTAINER_ID, volume = process.env.SG_PRODUCT_TEST_CAPTURE_VOLUME, cluster = process.env.SG_PRODUCT_TEST_CAPTURE_CLUSTER;
if (!cid || !/^[a-f0-9]{64}$/.test(cid) || !volume || !/^[a-f0-9]{64}$/.test(volume) || !cluster || !/^[0-9]{19}$/.test(cluster) || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires owned isolated snapshot-capture fixture");
const docker = (args: string[], input?: Buffer) => execFileSync("docker", args, { input, timeout: 30000, maxBuffer: 128 * 1024 * 1024 });
const connect = (db: string) => new Pool({ connectionString: `postgresql://sg_capture:synthetic-capture-drill-only-00001@127.0.0.1:32879/${db}`, max: 2 });
const source = connect("sg_capture_source"), target = connect("sg_capture_restore"), bootstrap = connect("postgres");
const schema = "socialgrowth_product", operatorId = randomUUID(), projectId = randomUUID(); let targetCreated = false, metadata: DatabaseBackupMetadata;
const key = { keyId: "synthetic-snapshot-capture", key: randomBytes(32) };
async function guard() {
  const ids = docker(["ps", "-aq"]).toString().trim().split(/\s+/);
  const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Running":{{json .State.Running}},"AutoRemove":{{json .HostConfig.AutoRemove}},"Ports":{{json .NetworkSettings.Ports}},"Mounts":{{json .Mounts}}}';
  const all: { Id: string; Name: string; Image: string; Running: boolean; AutoRemove: boolean; Ports: unknown; Mounts: { Type: string; Name: string; Destination: string }[] }[] = docker(["inspect", "--format", format, ...ids]).toString().trim().split("\n").map(v => JSON.parse(v));
  const own = all.find(v => v.Id === cid); assert.ok(own); assert.equal(own.Name, "/sg-wp27-capture-pg"); assert.equal(own.Running, true); assert.equal(own.AutoRemove, true);
  assert.equal(own.Image, "sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74"); assert.deepEqual(own.Ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "32879" }] });
  assert.equal(own.Mounts.length, 1); assert.equal(own.Mounts[0]!.Type, "volume"); assert.equal(own.Mounts[0]!.Name, volume); assert.equal(own.Mounts[0]!.Destination, "/var/lib/postgresql/data"); assert.equal(all.filter(v => v.Mounts.some(m => m.Name === volume)).length, 1);
  assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "socialgrowth.fixture"}}', cid!]).toString().trim(), "wp27-snapshot-capture");
  assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "socialgrowth.owner"}}', cid!]).toString().trim(), "wp27-capture-author-stage6-4e1827e");
  assert.equal(docker(["exec", cid!, "psql", "-U", "sg_capture", "-d", "sg_capture_source", "-Atc", "SELECT system_identifier FROM pg_control_system()"]).toString().trim(), cluster);
  for (const [pool, db] of [[source, "sg_capture_source"], [bootstrap, "postgres"], ...(targetCreated ? [[target, "sg_capture_restore"]] : [])] as [Pool, string][]) assert.deepEqual((await pool.query("SELECT current_database() db,current_user usr,system_identifier::text cluster FROM pg_control_system()")).rows[0], { db, usr: "sg_capture", cluster });
}
const inventory = (pool: Pool) => withDatabaseInventorySnapshot(pool, async value => value.inventory);
const rawDump = (snapshot: string) => docker(["exec", cid!, "pg_dump", "-U", "sg_capture", "-d", "sg_capture_source", "-Fc", "--no-owner", "--no-acl", `--snapshot=${snapshot}`]);
const fixed = (e: unknown): e is DatabaseBackupCaptureError => e instanceof DatabaseBackupCaptureError && e.message === e.code && !("cause" in e);
before(async () => {
  await guard(); await source.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await guard(); if (!(await bootstrap.query("SELECT 1 FROM pg_database WHERE datname='sg_capture_restore'")).rowCount) await bootstrap.query("CREATE DATABASE sg_capture_restore"); targetCreated = true;
  await guard(); await target.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url), files = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort();
  for (const file of files) { await guard(); await source.query(await readFile(new URL(file, dir), "utf8")); }
  metadata = { backupId: randomUUID(), createdAt: new Date().toISOString(), postgresMajor: 17, migrationFiles: await Promise.all(files.map(async name => ({ name, sha256: createHash("sha256").update(await readFile(new URL(name, dir))).digest("hex") }))) };
  await guard(); await source.query(`INSERT INTO ${schema}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Capture fixture','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await guard(); await source.query(`INSERT INTO ${schema}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Capture snapshot original','company_owned',$2)`, [projectId, operatorId]);
});
after(async () => {
  try { await guard(); await source.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); if (targetCreated) { await guard(); await target.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } }
  finally { key.key.fill(0); await target.end(); await source.end(); await bootstrap.end(); }
});
test("real same-snapshot capture fixes async key/metadata, clears returned dump, stores ciphertext and restores original 66-table inventory", async () => {
  const originalMetadata = structuredClone(metadata), localKey = { keyId: key.keyId, key: Buffer.from(key.key) }, stableKey = { keyId: key.keyId, key: Buffer.from(key.key) };
  let transferred: Buffer | undefined, calls = 0;
  const envelope = await captureInventoryBoundDatabaseBackup(source, async snapshot => {
    calls++; assert.match(snapshot, /^[0-9A-Fa-f-]{1,100}$/); await guard();
    docker(["exec", cid!, "psql", "-U", "sg_capture", "-d", "sg_capture_source", "-Atc", `UPDATE ${schema}.projects SET name='Capture source now newer' WHERE project_id='${projectId}'`]);
    metadata.backupId = randomUUID(); metadata.migrationFiles[0]!.sha256 = "e".repeat(64); localKey.key.fill(0); localKey.keyId = "changed-after-await";
    transferred = rawDump(snapshot); assert.ok(transferred.length > 5); return transferred;
  }, metadata, localKey);
  assert.equal(calls, 1); assert.ok(transferred); assert.ok(transferred.every(v => v === 0)); assert.deepEqual(envelope.manifest.metadata, originalMetadata); assert.equal(envelope.manifest.inventory.tables.length, 66); assert.equal(envelope.manifest.keyId, stableKey.keyId);
  const dir = await realpath(await mkdtemp(join(tmpdir(), "sg-capture-file-"))), identity = await lstat(dir);
  try {
    const saved = await new EncryptedDatabaseBackupFileStore({ directory: dir }).save(envelope, stableKey); assert.equal(saved.status, "stored");
    const loaded = await new EncryptedDatabaseBackupFileStore({ directory: dir }).load(originalMetadata.backupId, stableKey); assert.equal(loaded.envelopeSha256, saved.envelopeSha256);
    assert.deepEqual(await readdir(dir), [`${originalMetadata.backupId}.sgbackup.json`]); const opened = openInventoryBoundDatabaseBackup(loaded.envelope, stableKey);
    try { await guard(); docker(["exec", "-i", cid!, "pg_restore", "-U", "sg_capture", "-d", "sg_capture_restore", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"], opened.dump); } finally { opened.dump.fill(0); }
    assert.equal(compareDatabaseRestoreInventories(envelope.manifest.inventory, await inventory(target)).sameSchemaAndRows, true);
    assert.equal(compareDatabaseRestoreInventories(envelope.manifest.inventory, await inventory(source)).sameSchemaAndRows, false);
    assert.equal(envelope.manifest.requiresReconciliation, true); assert.equal(envelope.manifest.executionAllowed, false); assert.equal(envelope.manifest.publicationAllowed, false);
  } finally {
    const current = await lstat(dir); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino); assert.equal(current.uid, process.getuid!()); assert.ok(current.isDirectory()); await rm(dir, { recursive: true });
    localKey.key.fill(0); stableKey.key.fill(0); metadata = originalMetadata;
  }
});
test("actual read-only COMMIT then lost ACK returns no envelope or file, clears real dump and releases actual pool", async () => {
  let commits = 0, transferred: Buffer | undefined, saves = 0;
  const faulty = { connect: async () => {
    const client = await source.connect(); return new Proxy(client, { get(actual, property) {
      if (property === "query") return async (sql: string, ...args: unknown[]) => {
        const result: unknown = await Reflect.apply(actual.query, actual, [sql, ...args]);
        if (sql === "COMMIT") { commits++; throw new Error("synthetic-sensitive-commit-response-loss"); } return result;
      };
      const value: unknown = Reflect.get(actual, property, actual); return typeof value === "function" ? value.bind(actual) : value;
    } });
  } } as unknown as Pool;
  await assert.rejects((async () => { const envelope = await captureInventoryBoundDatabaseBackup(faulty, async snapshot => { await guard(); transferred = rawDump(snapshot); return transferred; }, metadata, key); saves++; return envelope; })(), e => fixed(e) && e.code === "DATABASE_BACKUP_CAPTURE_UNAVAILABLE");
  assert.equal(commits, 1); assert.equal(saves, 0); assert.ok(transferred); assert.ok(transferred.every(v => v === 0)); assert.equal(source.idleCount, source.totalCount); assert.equal((await source.query("SHOW transaction_isolation")).rows[0].transaction_isolation, "read committed"); await inventory(source);
});
test("actual pg_dump output truncated by trusted callback is rejected after capture and owned returned bytes are cleared", async () => {
  let transferred: Buffer | undefined;
  await assert.rejects(captureInventoryBoundDatabaseBackup(source, async snapshot => {
    await guard(); const raw = rawDump(snapshot); try { transferred = Buffer.from(raw.subarray(0, 4)); return transferred; } finally { raw.fill(0); }
  }, metadata, key), e => fixed(e) && e.code === "DATABASE_BACKUP_CAPTURE_INVALID");
  assert.ok(transferred); assert.ok(transferred.every(v => v === 0)); assert.equal(source.idleCount, source.totalCount); await inventory(source);
});
test("actual unsupported source relation closes before archive callback and leaves no prepared envelope", async () => {
  await guard(); await source.query(`CREATE VIEW ${schema}.capture_unsupported AS SELECT 1 AS value`); let calls = 0;
  try { await assert.rejects(captureInventoryBoundDatabaseBackup(source, async snapshot => { calls++; return rawDump(snapshot); }, metadata, key), e => fixed(e) && e.code === "DATABASE_BACKUP_CAPTURE_UNAVAILABLE"); assert.equal(calls, 0); }
  finally { await guard(); await source.query(`DROP VIEW ${schema}.capture_unsupported`); }
  assert.equal(source.idleCount, source.totalCount); await inventory(source);
});
