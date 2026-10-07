import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { sealDatabaseBackup, openDatabaseBackup, DatabaseBackupError, maxDatabaseBackupBytes } from "./database-backup-envelope.js";
const metadata = () => ({ backupId: randomUUID(), createdAt: "2026-10-01T00:00:00.123456789Z", postgresMajor: 17,
  migrationFiles: [{ name: "0001_identity_and_device.sql", sha256: "a".repeat(64) }] });
const fixture = () => ({ dump: Buffer.from("PGDMPsynthetic-secret-only-not-an-actual-archive"), metadata: metadata(), key: { keyId: "synthetic-v1", key: randomBytes(32) } });
const invalid = (e: unknown) => e instanceof DatabaseBackupError && e.message === "DATABASE_BACKUP_INVALID" && !e.cause;
test("authenticated envelope roundtrip is private, nondeterministic, never a restoration/execution permit", () => {
  const f = fixture(), before = Buffer.from(f.key.key), a = sealDatabaseBackup(f.dump, f.metadata, f.key), b = sealDatabaseBackup(f.dump, f.metadata, f.key);
  assert.notEqual(a.nonce, b.nonce); assert.notEqual(a.ciphertext, b.ciphertext); assert.ok(!JSON.stringify(a).includes("synthetic-secret-only"));
  assert.deepEqual(openDatabaseBackup(a, f.key).dump, f.dump); assert.equal(a.manifest.requiresReconciliation, true); assert.equal(a.manifest.executionAllowed, false); assert.equal(a.manifest.publicationAllowed, false); assert.deepEqual(f.key.key, before);
});
test("default/missing/wrong key or key identity closes safely, without exposing payload or causes", () => {
  const f = fixture(), envelope = sealDatabaseBackup(f.dump, f.metadata, f.key);
  for (const key of [null, { ...f.key, key: randomBytes(31) }, { ...f.key, key: randomBytes(32) }, { ...f.key, keyId: "other" }]) assert.throws(() => openDatabaseBackup(envelope, key), invalid);
  assert.throws(() => sealDatabaseBackup(f.dump, f.metadata), invalid);
});
test("manifest tampering, crypto tampering, extra secret/permission fields and incompatible version are all denied", () => {
  const f = fixture(), e = sealDatabaseBackup(f.dump, f.metadata, f.key);
  for (const changed of [ { ...e, manifest: { ...e.manifest, metadata: { ...e.manifest.metadata, backupId: randomUUID() } } },
    { ...e, manifest: { ...e.manifest, dumpSha256: "b".repeat(64) } }, { ...e, manifest: { ...e.manifest, executionAllowed: true } },
    { ...e, nonce: randomBytes(12).toString("base64") }, { ...e, tag: randomBytes(16).toString("base64") }, { ...e, ciphertext: randomBytes(f.dump.length).toString("base64") },
    { ...e, password: "must-not-echo" }, { ...e, format: "future" }, { ...e, ciphertext: e.ciphertext + "\n" } ]) assert.throws(() => openDatabaseBackup(changed, f.key), invalid);
});
test("strict bounded archive/metadata shape, exact bytes and canonical base64 do not claim applied migrations or valid SQL", () => {
  const f = fixture(); for(const dump of [null, "PGDMP", Buffer.alloc(4), Buffer.from("plain-sql"), Buffer.alloc(maxDatabaseBackupBytes + 1)]) assert.throws(() => sealDatabaseBackup(dump, f.metadata, f.key), invalid);
  for(const metadata of [{ ...f.metadata, createdAt: "0000-01-01T00:00:00Z" }, { ...f.metadata, postgresMajor: 18 }, { ...f.metadata, migrationFiles: [] },
    { ...f.metadata, migrationFiles: [...f.metadata.migrationFiles, ...f.metadata.migrationFiles] }, { ...f.metadata, databaseUrl: "private" }]) assert.throws(() => sealDatabaseBackup(f.dump, metadata, f.key), invalid);
  const e = sealDatabaseBackup(f.dump, f.metadata, f.key); assert.throws(() => openDatabaseBackup({ ...e, manifest: { ...e.manifest, dumpBytes: f.dump.length + 1 } }, f.key), invalid);
  const returned = openDatabaseBackup(e, f.key); returned.dump.fill(0); returned.manifest.metadata.backupId = randomUUID(); assert.deepEqual(openDatabaseBackup(e, f.key).dump, f.dump); assert.deepEqual(e.manifest.metadata, f.metadata);
});
