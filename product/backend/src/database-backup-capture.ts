import type { Pool } from "pg";
import { metadataSchema, type DatabaseBackupKey } from "./database-backup-envelope.js";
import { sealInventoryBoundDatabaseBackup } from "./database-backup-inventory-envelope.js";
import { withDatabaseInventorySnapshot } from "./database-restore-inventory.js";

// Trusted server maintenance port only, not HTTP/config. It MUST dump the same
// source with this exact snapshot while the callback is alive. Successful Buffer
// return transfers ownership; on rejection the port must clear its own buffers.
export type DatabaseSnapshotArchive = (snapshotId: string) => Promise<Buffer>;
export class DatabaseBackupCaptureError extends Error {
  constructor(readonly code: "DATABASE_BACKUP_CAPTURE_INVALID" | "DATABASE_BACKUP_CAPTURE_UNAVAILABLE") { super(code); }
}
// Prepare only; the caller separately saves this exact envelope under its original
// ID. Never redump/reseal automatically after an ambiguous file write. This does
// not establish trustworthy SQL, migration provenance or current action authority.
export async function captureInventoryBoundDatabaseBackup(pool: Pool | null = null, archive: DatabaseSnapshotArchive | null = null, inputMetadata: unknown = null, inputKey: DatabaseBackupKey | null = null) {
  let key: DatabaseBackupKey | undefined, dump: Buffer | undefined, capturing = false;
  try {
    if (!pool || typeof archive !== "function" || !inputKey) throw new DatabaseBackupCaptureError("DATABASE_BACKUP_CAPTURE_UNAVAILABLE");
    const metadata = metadataSchema.parse(structuredClone(inputMetadata));
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(inputKey.keyId) || !Buffer.isBuffer(inputKey.key) || inputKey.key.length !== 32) throw new DatabaseBackupCaptureError("DATABASE_BACKUP_CAPTURE_INVALID");
    key = { keyId: inputKey.keyId, key: Buffer.from(inputKey.key) };
    capturing = true;
    const inventory = await withDatabaseInventorySnapshot(pool, async snapshot => {
      const fixed = structuredClone(snapshot.inventory);
      dump = await archive(snapshot.snapshotId);
      return fixed;
    });
    capturing = false;
    // Only after the actual read-only COMMIT has returned successfully. No file
    // side effect inside the snapshot transaction, including on lost COMMIT ACK.
    return sealInventoryBoundDatabaseBackup(dump, metadata, inventory, key);
  } catch (error) {
    if (error instanceof DatabaseBackupCaptureError) throw error;
    throw new DatabaseBackupCaptureError(capturing ? "DATABASE_BACKUP_CAPTURE_UNAVAILABLE" : "DATABASE_BACKUP_CAPTURE_INVALID");
  } finally { key?.key.fill(0); if (Buffer.isBuffer(dump)) dump.fill(0); }
}
