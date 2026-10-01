import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, chmod, realpath, lstat, readdir, readFile, writeFile, symlink, link, unlink, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EncryptedDatabaseBackupFileStore, DatabaseBackupFileError, maxEncryptedBackupFileBytes } from "./database-backup-file-store.js";
import { sealInventoryBoundDatabaseBackup, openInventoryBoundDatabaseBackup } from "./database-backup-inventory-envelope.js";
const fixture = () => {
  const key = { keyId: "synthetic-file-store-only", key: randomBytes(32) }, dump = Buffer.from("PGDMPsynthetic-private-fixture-not-real-SQL");
  const metadata = { backupId: randomUUID(), createdAt: "2026-10-01T00:00:00Z", postgresMajor: 17, migrationFiles: [{ name: "0001_identity_and_device.sql", sha256: "a".repeat(64) }] };
  const inventory = { format: "2026-10-01.database-inventory-v1", postgresMajor: 17, tables: [{ table: "synthetic", rows: 0, bytes: 0, sha256: "b".repeat(64) }], definitions: { relations: "c".repeat(64), columns: "c".repeat(64), constraints: "c".repeat(64), triggers: "c".repeat(64), indexes: "c".repeat(64), functions: "c".repeat(64), policies: "c".repeat(64) } };
  return { key, dump, metadata, inventory, envelope: sealInventoryBoundDatabaseBackup(dump, metadata, inventory, key) };
};
const error = (code?: string) => (e: unknown) => e instanceof DatabaseBackupFileError && (!code || e.code === code) && e.message === e.code && !("cause" in e) && !("path" in e);
async function owned<T>(run: (dir: string, store: EncryptedDatabaseBackupFileStore) => Promise<T>) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "sg-backup-store-"))); await chmod(dir, 0o700); const identity = await lstat(dir);
  try { return await run(dir, new EncryptedDatabaseBackupFileStore({ directory: dir })); }
  finally {
    const current = await lstat(dir); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino); assert.equal(current.uid, process.getuid!()); assert.ok(current.isDirectory());
    // Only this newly created private fixture, never repository/service data.
    await chmod(dir, 0o700); await rm(dir, { recursive: true });
  }
}
test("real private filesystem stores only authenticated ciphertext and reloads without keys/plaintext on disk", async () => owned(async (dir, store) => {
  const f = fixture(), keyCopy = Buffer.from(f.key.key), envelopeCopy = structuredClone(f.envelope), receipt = await store.save(f.envelope, f.key);
  assert.equal(receipt.status, "stored"); assert.equal(receipt.requiresReconciliation, true); assert.equal(receipt.executionAllowed, false); assert.equal(receipt.publicationAllowed, false);
  const filename = `${f.metadata.backupId}.sgbackup.json`; assert.deepEqual(await readdir(dir), [filename]); const path = join(dir, filename), stat = await lstat(path);
  assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1); const bytes = await readFile(path);
  assert.equal(bytes.includes(f.dump), false); assert.equal(bytes.includes(f.key.key), false); assert.deepEqual(JSON.parse(bytes.toString()), f.envelope);
  const loaded = await new EncryptedDatabaseBackupFileStore({ directory: dir }).load(f.metadata.backupId.toUpperCase(), f.key);
  assert.equal(loaded.envelopeSha256, receipt.envelopeSha256); const opened = openInventoryBoundDatabaseBackup(loaded.envelope, f.key); assert.deepEqual(opened.dump, f.dump); opened.dump.fill(0);
  assert.deepEqual(f.key.key, keyCopy); assert.deepEqual(f.envelope, envelopeCopy); f.key.key.fill(0);
}));
test("canonical replay finds the original artifact, while same ID with new ciphertext cannot overwrite it", async () => owned(async (dir, store) => {
  const f = fixture(), first = await store.save(f.envelope, f.key), before = await readFile(join(dir, `${f.metadata.backupId}.sgbackup.json`));
  const reordered = Object.fromEntries(Object.entries(f.envelope).reverse()); assert.equal((await store.save(reordered, f.key)).status, "already_stored");
  const replacement = sealInventoryBoundDatabaseBackup(f.dump, f.metadata, f.inventory, f.key);
  await assert.rejects(store.save(replacement, f.key), error("DATABASE_BACKUP_FILE_CONFLICT")); assert.deepEqual(await readFile(join(dir, `${f.metadata.backupId}.sgbackup.json`)), before);
  assert.deepEqual(await readdir(dir), [`${f.metadata.backupId}.sgbackup.json`]); assert.equal((await store.load(f.metadata.backupId, f.key)).envelopeSha256, first.envelopeSha256); f.key.key.fill(0);
}));
test("real concurrent distinct envelopes under one backup ID commit at most one and preserve the winner", async () => owned(async (dir, store) => {
  const f = fixture(), other = sealInventoryBoundDatabaseBackup(Buffer.from("PGDMPother-synthetic-bytes"), f.metadata, f.inventory, f.key);
  const results = await Promise.allSettled([store.save(f.envelope, f.key), store.save(other, f.key)]);
  assert.equal(results.filter(v => v.status === "fulfilled").length, 1);
  for (const r of results) if (r.status === "rejected") assert.ok(error()(r.reason));
  const loaded = await store.load(f.metadata.backupId, f.key); assert.ok([f.envelope.ciphertext, other.ciphertext].includes(loaded.envelope.ciphertext));
  assert.deepEqual(await readdir(dir), [`${f.metadata.backupId}.sgbackup.json`]); f.key.key.fill(0);
}));
test("missing/default config, bad keys and authenticated-input failure do not create an artifact", async () => owned(async (dir, store) => {
  const f = fixture(); await assert.rejects(new EncryptedDatabaseBackupFileStore().save(f.envelope, f.key), error("DATABASE_BACKUP_FILE_UNAVAILABLE"));
  for (const config of [{ directory: "relative" }, { directory: `${dir}/..` }, { directory: dir, extra: true }]) await assert.rejects(new EncryptedDatabaseBackupFileStore(config).load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_UNAVAILABLE"));
  for (const key of [null, { ...f.key, key: randomBytes(31) }, { ...f.key, key: randomBytes(32) }]) await assert.rejects(store.save(f.envelope, key), error("DATABASE_BACKUP_FILE_INVALID"));
  await assert.rejects(store.save({ ...f.envelope, accessToken: "synthetic-forbidden" }, f.key), error("DATABASE_BACKUP_FILE_INVALID"));
  await assert.rejects(store.load("../../synthetic", f.key), error("DATABASE_BACKUP_FILE_INVALID")); assert.deepEqual(await readdir(dir), []); f.key.key.fill(0);
}));
test("a symlinked or group-readable maintenance directory is rejected rather than repaired", async () => owned(async (dir, store) => {
  const f = fixture(), alias = join(dir, "alias"); await symlink(dir, alias);
  await assert.rejects(new EncryptedDatabaseBackupFileStore({ directory: alias }).save(f.envelope, f.key), error("DATABASE_BACKUP_FILE_UNAVAILABLE"));
  await chmod(dir, 0o750); await assert.rejects(store.save(f.envelope, f.key), error("DATABASE_BACKUP_FILE_UNAVAILABLE")); assert.equal((await lstat(dir)).mode & 0o7777, 0o750);
  await chmod(dir, 0o700); assert.deepEqual(await readdir(dir), ["alias"]); f.key.key.fill(0);
}));
test("real final-file symlinks, hardlinks and permissive modes cannot be trusted or overwritten", async () => owned(async (dir, store) => {
  const f = fixture(), final = join(dir, `${f.metadata.backupId}.sgbackup.json`), victim = join(dir, "synthetic-existing-file"); await writeFile(victim, "preserve-existing", { mode: 0o600 }); await symlink(victim, final);
  await assert.rejects(store.load(f.metadata.backupId, f.key), error()); await assert.rejects(store.save(f.envelope, f.key), error()); assert.equal(await readFile(victim, "utf8"), "preserve-existing"); await unlink(final);
  await store.save(f.envelope, f.key); const alias = join(dir, "hardlink"); await link(final, alias); await assert.rejects(store.load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_INVALID")); await unlink(alias);
  await chmod(final, 0o640); await assert.rejects(store.load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_INVALID")); await chmod(final, 0o600); assert.equal((await store.load(f.metadata.backupId, f.key)).envelope.ciphertext, f.envelope.ciphertext);
  await unlink(final); await mkdir(final, { mode: 0o700 }); await assert.rejects(store.load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_INVALID")); await assert.rejects(store.save(f.envelope, f.key), error("DATABASE_BACKUP_FILE_INVALID")); assert.ok((await lstat(final)).isDirectory()); f.key.key.fill(0);
}));
test("actual oversized sparse file, invalid UTF8/JSON, tampered manifest and wrong filename identity fail closed", async () => owned(async (dir, store) => {
  const f = fixture(), path = join(dir, `${f.metadata.backupId}.sgbackup.json`), handle = await open(path, "wx", 0o600); await handle.truncate(maxEncryptedBackupFileBytes + 1); await handle.close();
  await assert.rejects(store.load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_INVALID"));
  for (const value of [Buffer.from([0xff]), Buffer.from("{partial"), Buffer.from(JSON.stringify({ ...f.envelope, manifest: { ...f.envelope.manifest, executionAllowed: true } }))]) { await writeFile(path, value); await assert.rejects(store.load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_INVALID")); }
  const other = fixture(); await writeFile(path, JSON.stringify(other.envelope)); await assert.rejects(store.load(f.metadata.backupId, other.key), error("DATABASE_BACKUP_FILE_INVALID")); f.key.key.fill(0); other.key.key.fill(0);
}));
test("orphan staging and unrelated files are preserved, never replayed or automatically cleaned", async () => owned(async (dir, store) => {
  const f = fixture(), orphan = `.${f.metadata.backupId}.${randomUUID()}.pending`; await writeFile(join(dir, orphan), "synthetic-partial", { mode: 0o600 }); await writeFile(join(dir, "unrelated"), "preserve", { mode: 0o600 });
  await assert.rejects(store.load(f.metadata.backupId, f.key), error("DATABASE_BACKUP_FILE_UNAVAILABLE")); await store.save(f.envelope, f.key);
  assert.equal(await readFile(join(dir, orphan), "utf8"), "synthetic-partial"); assert.equal(await readFile(join(dir, "unrelated"), "utf8"), "preserve"); assert.equal((await readdir(dir)).length, 3); f.key.key.fill(0);
}));
