import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DatabaseBackupError, maxDatabaseBackupBytes, metadataSchema, type DatabaseBackupKey } from "./database-backup-envelope.js";
import { inventorySchema } from "./database-restore-inventory.js";
const format = "2026-10-01.database-backup-v2", keyId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const manifestSchema = z.strictObject({ metadata: metadataSchema, inventory: inventorySchema, inventoryScope: z.literal("socialgrowth_product"), keyId,
  dumpBytes: z.int().min(5).max(maxDatabaseBackupBytes), dumpSha256: z.string().regex(/^[a-f0-9]{64}$/), scope: z.literal("single_database_archive"),
  requiresReconciliation: z.literal(true), executionAllowed: z.literal(false), publicationAllowed: z.literal(false) });
const envelopeSchema = z.strictObject({ format: z.literal(format), manifest: manifestSchema, nonce: z.string().length(16), tag: z.string().length(24),
  ciphertext: z.string().min(8).max(Math.ceil(maxDatabaseBackupBytes / 3) * 4) });
export type InventoryBoundDatabaseBackup = z.infer<typeof envelopeSchema>;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
const aad = (manifest: InventoryBoundDatabaseBackup["manifest"]) => Buffer.from(canonical({ format, manifest }));
function keyCopy(input: DatabaseBackupKey | null) {
  if (!input || !keyId.safeParse(input.keyId).success || !Buffer.isBuffer(input.key) || input.key.length !== 32) throw new DatabaseBackupError();
  return { keyId: input.keyId, key: Buffer.from(input.key) };
}
const archive = (dump: Buffer) => dump.length >= 5 && dump.length <= maxDatabaseBackupBytes && dump.subarray(0,5).equals(Buffer.from("PGDMP"));
function base64(value: string, bytes: number) { const b = Buffer.from(value, "base64"); if (b.length !== bytes || b.toString("base64") !== value) throw new DatabaseBackupError(); return b; }
// V2 authenticates the limited inventory IN THE SAME AAD as the real dump.
// It does not prove capture/dump used the same source snapshot, approve SQL,
// grant a maintenance identity, restore or clear current-fact reconciliation.
// No route/runner/scheduler/fs/consumer. V1 remains a separate unchanged format.
export function sealInventoryBoundDatabaseBackup(input: unknown, metadata: unknown, inventory: unknown, keyInput: DatabaseBackupKey | null = null): InventoryBoundDatabaseBackup {
  let key: ReturnType<typeof keyCopy> | undefined, dump: Buffer | undefined;
  try {
    key = keyCopy(keyInput); if (!Buffer.isBuffer(input) || !archive(input)) throw new DatabaseBackupError(); dump = Buffer.from(input);
    const manifest = manifestSchema.parse({ metadata, inventory, inventoryScope: "socialgrowth_product", keyId: key.keyId, dumpBytes: dump.length,
      dumpSha256: createHash("sha256").update(dump).digest("hex"), scope: "single_database_archive", requiresReconciliation: true, executionAllowed: false, publicationAllowed: false });
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key.key, nonce, { authTagLength: 16 }); cipher.setAAD(aad(manifest));
    const ciphertext = Buffer.concat([cipher.update(dump), cipher.final()]);
    return envelopeSchema.parse({ format, manifest, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  } catch { throw new DatabaseBackupError(); } finally { key?.key.fill(0); dump?.fill(0); }
}
export function openInventoryBoundDatabaseBackup(input: unknown, keyInput: DatabaseBackupKey | null = null) {
  let key: ReturnType<typeof keyCopy> | undefined, dump: Buffer | undefined;
  try {
    key = keyCopy(keyInput); const envelope = envelopeSchema.parse(input), m = envelope.manifest;
    if (key.keyId !== m.keyId) throw new DatabaseBackupError(); const decipher = createDecipheriv("aes-256-gcm", key.key, base64(envelope.nonce,12), { authTagLength: 16 });
    decipher.setAAD(aad(m)); decipher.setAuthTag(base64(envelope.tag,16));
    // Keep partial plaintext local and clear it even if final authentication
    // fails; this is not an OS/JS exhaustive-memory-erasure guarantee.
    const partial = decipher.update(base64(envelope.ciphertext,m.dumpBytes));
    try { dump = Buffer.concat([partial, decipher.final()]); } finally { partial.fill(0); }
    if (!archive(dump) || createHash("sha256").update(dump).digest("hex") !== m.dumpSha256) throw new DatabaseBackupError();
    const output = { dump, manifest: structuredClone(m) }; dump = undefined; return output;
  } catch { throw new DatabaseBackupError(); } finally { key?.key.fill(0); dump?.fill(0); }
}
