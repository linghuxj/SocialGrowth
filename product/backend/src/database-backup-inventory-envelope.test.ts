import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { DatabaseBackupError, sealDatabaseBackup, openDatabaseBackup } from "./database-backup-envelope.js";
import { sealInventoryBoundDatabaseBackup, openInventoryBoundDatabaseBackup } from "./database-backup-inventory-envelope.js";
const fixture = () => ({ dump: Buffer.from("PGDMPsynthetic-not-a-real-archive"), key: { keyId: "synthetic-v2-only", key: randomBytes(32) },
  metadata: { backupId: randomUUID(), createdAt: "2026-10-01T00:00:00Z", postgresMajor: 17, migrationFiles: [{ name: "0001_identity_and_device.sql", sha256: "a".repeat(64) }] },
  inventory: { format: "2026-10-01.database-inventory-v1", postgresMajor: 17, tables: [{ table: "synthetic", rows: 0, bytes: 0, sha256: "b".repeat(64) }],
    definitions: { relations: "c".repeat(64), columns: "c".repeat(64), constraints: "c".repeat(64), triggers: "c".repeat(64), indexes: "c".repeat(64), functions: "c".repeat(64), policies: "c".repeat(64) } } });
const invalid = (e: unknown) => e instanceof DatabaseBackupError && e.message === "DATABASE_BACKUP_INVALID" && !("cause" in e) && !("input" in e);
test("v2 binds limited inventory and actual bytes, clones callers and retains false permissions", () => {
  const f = fixture(), before = structuredClone(f.inventory), copy = Buffer.from(f.dump), keyCopy = Buffer.from(f.key.key);
  const sealed = sealInventoryBoundDatabaseBackup(f.dump, f.metadata, f.inventory, f.key), opened = openInventoryBoundDatabaseBackup(sealed, f.key);
  assert.deepEqual(opened.dump, f.dump); assert.deepEqual(opened.manifest.inventory, before); assert.equal(opened.manifest.inventoryScope, "socialgrowth_product");
  assert.equal(opened.manifest.requiresReconciliation, true); assert.equal(opened.manifest.executionAllowed, false); assert.equal(opened.manifest.publicationAllowed, false);
  assert.deepEqual(f.dump, copy); assert.deepEqual(f.key.key, keyCopy); sealed.manifest.inventory.tables[0]!.rows = 1; assert.deepEqual(f.inventory, before); assert.deepEqual(opened.manifest.inventory, before); opened.dump.fill(0);
});
test("tampering with every inventory fingerprint or row count is authenticated and not an editable sidecar", () => {
  const f = fixture(), sealed = sealInventoryBoundDatabaseBackup(f.dump, f.metadata, f.inventory, f.key);
  for (const field of Object.keys(f.inventory.definitions) as (keyof typeof f.inventory.definitions)[]) {
    const changed = structuredClone(sealed); changed.manifest.inventory.definitions[field] = "d".repeat(64); assert.throws(() => openInventoryBoundDatabaseBackup(changed,f.key), invalid);
  }
  const changed = structuredClone(sealed); changed.manifest.inventory.tables[0]!.rows = 1; assert.throws(() => openInventoryBoundDatabaseBackup(changed,f.key), invalid);
  const other = fixture(), swapped = sealInventoryBoundDatabaseBackup(other.dump, other.metadata, other.inventory, f.key); swapped.manifest = structuredClone(sealed.manifest); assert.throws(() => openInventoryBoundDatabaseBackup(swapped,f.key), invalid);
});
test("nonce randomness, wrong key/id, ciphertext/tag/metadata and strict fields fail without raw detail", () => {
  const f = fixture(), a = sealInventoryBoundDatabaseBackup(f.dump,f.metadata,f.inventory,f.key), b = sealInventoryBoundDatabaseBackup(f.dump,f.metadata,f.inventory,f.key); assert.notEqual(a.nonce,b.nonce);
  for (const key of [null, { ...f.key, key: randomBytes(32) }, { ...f.key, keyId: "other" }]) assert.throws(() => openInventoryBoundDatabaseBackup(a,key),invalid);
  for (const patch of [{ tag: randomBytes(16).toString("base64") }, { ciphertext: randomBytes(f.dump.length).toString("base64") }, { format: "future" },
    { nonce: "!".repeat(16) }, { token: "synthetic-forbidden" }, { manifest: { ...a.manifest, metadata: { ...a.manifest.metadata, backupId: randomUUID() } } }]) assert.throws(() => openInventoryBoundDatabaseBackup({ ...a, ...patch },f.key),invalid);
});
test("v1 and v2 remain strict separate formats, old v1 cannot pretend to authenticate an added inventory", () => {
  const f = fixture(), v1 = sealDatabaseBackup(f.dump,f.metadata,f.key), v2 = sealInventoryBoundDatabaseBackup(f.dump,f.metadata,f.inventory,f.key);
  assert.throws(() => openInventoryBoundDatabaseBackup(v1,f.key),invalid); assert.throws(() => openDatabaseBackup(v2,f.key),invalid);
  assert.throws(() => openDatabaseBackup({ ...v1, manifest: { ...v1.manifest, inventory: f.inventory } },f.key),invalid);
  assert.deepEqual(openDatabaseBackup(v1,f.key).dump,f.dump);
});
test("missing key or invalid inventory/metadata/archive closes before any filesystem or restore call", () => {
  const f = fixture(); assert.throws(() => sealInventoryBoundDatabaseBackup(f.dump,f.metadata,f.inventory),invalid);
  for (const inventory of [{ ...f.inventory, executionAllowed: true }, { ...f.inventory, tables: [] }, { ...f.inventory, postgresMajor: 18 }]) assert.throws(() => sealInventoryBoundDatabaseBackup(f.dump,f.metadata,inventory,f.key),invalid);
  assert.throws(() => sealInventoryBoundDatabaseBackup(Buffer.from("not-archive"),f.metadata,f.inventory,f.key),invalid);
  assert.throws(() => sealInventoryBoundDatabaseBackup(f.dump,{ ...f.metadata, password: "synthetic-forbidden" },f.inventory,f.key),invalid);
});
