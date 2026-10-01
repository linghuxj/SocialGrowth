import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { captureInventoryBoundDatabaseBackup, DatabaseBackupCaptureError } from "./database-backup-capture.js";
const metadata = () => ({ backupId: randomUUID(), createdAt: "2026-10-01T00:00:00Z", postgresMajor: 17, migrationFiles: [{ name: "0001_identity_and_device.sql", sha256: "a".repeat(64) }] });
const fixed = (e: unknown): e is DatabaseBackupCaptureError => e instanceof DatabaseBackupCaptureError && e.message === e.code && !("cause" in e) && !("input" in e);
function unreachable() {
  let calls = 0;
  return { pool: { connect: async () => { calls++; throw new Error("synthetic-no-DB-allowed"); } } as unknown as Pool, archive: async () => { calls++; throw new Error("synthetic-no-dump-allowed"); }, count: () => calls };
}
test("capture defaults or missing pool/archive/key are closed before DB or dump side effects", async () => {
  const f = unreachable(), key = { keyId: "synthetic-capture", key: randomBytes(32) };
  await assert.rejects(captureInventoryBoundDatabaseBackup(), fixed);
  await assert.rejects(captureInventoryBoundDatabaseBackup(null, f.archive, metadata(), key), fixed);
  await assert.rejects(captureInventoryBoundDatabaseBackup(f.pool, null, metadata(), key), fixed);
  await assert.rejects(captureInventoryBoundDatabaseBackup(f.pool, f.archive, metadata()), fixed);
  assert.equal(f.count(), 0); key.key.fill(0);
});
test("invalid/duplicate migration metadata or keys cause zero connections and keep caller inputs unchanged", async () => {
  const f = unreachable(), m = metadata(), key = { keyId: "synthetic-capture", key: randomBytes(32) }, original = Buffer.from(key.key);
  for (const candidate of [{ ...m, executionAllowed: true }, { ...m, backupId: "../../synthetic" }, { ...m, postgresMajor: 18 }, { ...m, migrationFiles: [...m.migrationFiles, ...m.migrationFiles] }]) await assert.rejects(captureInventoryBoundDatabaseBackup(f.pool, f.archive, candidate, key), fixed);
  for (const candidate of [{ ...key, key: randomBytes(31) }, { ...key, keyId: "synthetic secret/forbidden" }]) await assert.rejects(captureInventoryBoundDatabaseBackup(f.pool, f.archive, m, candidate), fixed);
  assert.equal(f.count(), 0); assert.deepEqual(key.key, original); assert.equal(m.migrationFiles.length, 1); key.key.fill(0); original.fill(0);
});
test("unexpected DB connection failure is fixed and cannot leak underlying secret or call archive", async () => {
  const f = unreachable(), key = { keyId: "synthetic-capture", key: randomBytes(32) };
  await assert.rejects(captureInventoryBoundDatabaseBackup(f.pool, f.archive, metadata(), key), e => fixed(e) && e.code === "DATABASE_BACKUP_CAPTURE_UNAVAILABLE");
  assert.equal(f.count(), 1); key.key.fill(0);
});
