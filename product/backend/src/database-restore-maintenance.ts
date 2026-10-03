import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { captureInventoryBoundDatabaseBackup, DatabaseBackupCaptureError, type DatabaseSnapshotArchive } from "./database-backup-capture.js";
import { EncryptedDatabaseBackupFileStore, DatabaseBackupFileError } from "./database-backup-file-store.js";
import type { DatabaseBackupKey, DatabaseBackupMetadata } from "./database-backup-envelope.js";
import { MaterialObjectStorage, type MaterialObjectReference } from "./material-object-storage.js";
import { compareDatabaseRestoreInventories, withDatabaseInventorySnapshot, type DatabaseRestoreInventory } from "./database-restore-inventory.js";

const schema = "socialgrowth_product";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type AuthoritySnapshot = {
  inventory: DatabaseRestoreInventory;
  auth: string;
  control: string;
  queue: string;
  references: MaterialObjectReference[];
  activeOrUnknownControls: number;
  queueRows: number;
};

async function snapshot(pool: Pool): Promise<AuthoritySnapshot> {
  return withDatabaseInventorySnapshot(pool, async ({ inventory, query }) => {
    // These are current persisted facts used by the existing authorization paths.
    // Hash in memory; never return/log session identifiers, control records, or tokens.
    const providers = (await query(`SELECT provider_id,status FROM ${schema}.providers ORDER BY provider_id`)).rows;
    const providerSessions = (await query(`SELECT session_id,provider_id,expires_at,revoked_at FROM ${schema}.provider_sessions ORDER BY session_id`)).rows;
    const operators = (await query(`SELECT operator_id,status,credential_version FROM ${schema}.operators ORDER BY operator_id`)).rows;
    const operatorSessions = (await query(`SELECT session_id,operator_id,credential_version,expires_at,revoked_at,revoked_reason FROM ${schema}.operator_sessions ORDER BY session_id`)).rows;
    const installationSessions = (await query(`SELECT session_id,installation_id,expires_at,revoked_at FROM ${schema}.installation_sessions ORDER BY session_id`)).rows;
    const installations = (await query(`SELECT installation_id,generation,status FROM ${schema}.installations ORDER BY installation_id`)).rows;
    const associations = (await query(`SELECT association_id,device_id,installation_id,ended_at FROM ${schema}.device_associations ORDER BY association_id`)).rows;
    const participations = (await query(`SELECT run_id,device_id,installation_id,association_id,session_id,installation_generation,revoked_at FROM ${schema}.local_participation_runs ORDER BY run_id`)).rows;
    const auth = digest({ providers, providerSessions, operators, operatorSessions, installationSessions, installations, associations, participations });

    const journals = (await query(`SELECT device_id,version,control_generation,disposition,holder_id,record FROM ${schema}.phone_control_journals ORDER BY device_id`)).rows as { disposition: string; holder_id: string | null; record: { calls?: { status?: string }[] } }[];
    const grants = (await query(`SELECT holder_id,device_id,control_generation,granted_version,granted_at,record FROM ${schema}.phone_control_holder_grants ORDER BY holder_id`)).rows;
    const control = digest({ journals, grants });
    const activeOrUnknownControls = journals.filter((row: { disposition: string; holder_id: string | null; record: { calls?: { status?: string }[] } }) =>
      row.disposition !== "stopped" || row.holder_id !== null || !Array.isArray(row.record?.calls)
      || row.record.calls.some(call => call.status !== "ended")).length;

    // The outbox is a durable queue source, not a consumer liveness signal.
    const queueRows = (await query(`SELECT message_id,task_id,revision,delivery_token,attempts,queue_observed_at FROM ${schema}.task_recheck_outbox ORDER BY message_id`)).rows;
    const queue = digest(queueRows);
    const references = ((await query(`SELECT reference FROM ${schema}.material_object_manifests ORDER BY object_id`)).rows as { reference: MaterialObjectReference }[])
      .map(row => row.reference);
    return { inventory, auth, control, queue, references, activeOrUnknownControls, queueRows: queueRows.length };
  });
}

/**
 * Small trusted-maintenance composition point. It captures with the existing
 * same-snapshot producer and attempts to persist the exact encrypted envelope.
 * On an ambiguous file result it returns that original envelope for same-ID
 * reconciliation; it never recaptures or rotates the nonce to mask UNKNOWN.
 */
export async function captureAndStoreMaintenanceBackup(input: {
  pool: Pool;
  archive: DatabaseSnapshotArchive;
  metadata: DatabaseBackupMetadata;
  key: DatabaseBackupKey;
  store: EncryptedDatabaseBackupFileStore;
}) {
  let keyCopy: DatabaseBackupKey | undefined;
  let fixedMetadata: DatabaseBackupMetadata;
  try {
    fixedMetadata = structuredClone(input.metadata);
    if (!input.key || !/^[A-Za-z0-9_-]{1,100}$/.test(input.key.keyId) || !Buffer.isBuffer(input.key.key) || input.key.key.length !== 32)
      throw new Error("invalid key");
    keyCopy = { keyId: input.key.keyId, key: Buffer.from(input.key.key) };
  } catch {
    throw new DatabaseBackupCaptureError("DATABASE_BACKUP_CAPTURE_INVALID");
  }
  try {
    const envelope = await captureInventoryBoundDatabaseBackup(input.pool, input.archive, fixedMetadata, keyCopy!);
    try {
      const saved = await input.store.save(envelope, keyCopy!);
      return { state: saved.status, backupId: saved.backupId, envelope: null, saved } as const;
    } catch (error) {
      if (error instanceof DatabaseBackupFileError && error.code === "DATABASE_BACKUP_FILE_UNKNOWN") {
        return { state: "unknown" as const, backupId: envelope.manifest.metadata.backupId, envelope, saved: null };
      }
      throw error;
    }
  } finally { keyCopy?.key.fill(0); }
}

/**
 * Read-only post-restore comparison for a trusted maintenance rehearsal.
 * It never starts consumers, changes a holder, or grants execution permission.
 * Missing schema/facts and storage errors throw; callers must treat that as unknown.
 */
export async function inspectMaintenanceRestore(
  currentPool: Pool,
  restoredPool: Pool,
  objectStorage: MaterialObjectStorage,
  backupInventory: unknown,
): Promise<{
  databaseMatchesBackup: boolean;
  currentAuthorityMatchesRestore: boolean;
  currentControlMatchesRestore: boolean;
  currentQueueMatchesRestore: boolean;
  currentObjectReferencesMatchRestore: boolean;
  currentHasActiveOrUnknownControl: boolean;
  currentQueueRows: number;
  restoredObjectsVerified: number;
  restoredObjectsUnverified: number;
  consumersStopped: "unknown";
  physicalFence: "unknown";
  requiresReconciliation: true;
  executionAllowed: false;
  publicationAllowed: false;
  holderReleaseAllowed: false;
}> {
  const [current, restored] = await Promise.all([snapshot(currentPool), snapshot(restoredPool)]);
  const databaseComparison = compareDatabaseRestoreInventories(backupInventory, restored.inventory);
  let verified = 0, unverified = 0;
  for (const reference of restored.references) {
    let bytes: Buffer | undefined;
    try { bytes = await objectStorage.readVerified(reference); verified++; }
    catch { unverified++; }
    finally { bytes?.fill(0); }
  }
  return {
    databaseMatchesBackup: databaseComparison.sameSchemaAndRows,
    currentAuthorityMatchesRestore: current.auth === restored.auth,
    currentControlMatchesRestore: current.control === restored.control,
    currentQueueMatchesRestore: current.queue === restored.queue,
    currentObjectReferencesMatchRestore: digest(current.references) === digest(restored.references),
    currentHasActiveOrUnknownControl: current.activeOrUnknownControls > 0,
    currentQueueRows: current.queueRows,
    restoredObjectsVerified: verified,
    restoredObjectsUnverified: unverified,
    consumersStopped: "unknown",
    physicalFence: "unknown",
    requiresReconciliation: true,
    executionAllowed: false,
    publicationAllowed: false,
    holderReleaseAllowed: false,
  };
}
