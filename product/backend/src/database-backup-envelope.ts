import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const format = "2026-10-01.database-backup-v1";
export const maxDatabaseBackupBytes = 128 * 1024 * 1024; // Bounded in-memory component, NOT a production capacity target.
const sha = z.string().regex(/^[a-f0-9]{64}$/), keyId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const metadataSchema = z.strictObject({ backupId: uuidSchema, createdAt: timestampSchema.max(512).refine(v => !v.startsWith("0000-")), postgresMajor: z.literal(17),
  migrationFiles: z.array(z.strictObject({ name: z.string().max(150).regex(/^[0-9]{4}_[a-z0-9_]+\.sql$/), sha256: sha })).min(1).max(1000)
}).refine(v => v.migrationFiles.every((f, i) => i === 0 || f.name > v.migrationFiles[i - 1]!.name));
const manifestSchema = z.strictObject({ metadata: metadataSchema, keyId, dumpBytes: z.int().min(5).max(maxDatabaseBackupBytes), dumpSha256: sha,
  scope: z.literal("single_database_archive"), requiresReconciliation: z.literal(true), executionAllowed: z.literal(false), publicationAllowed: z.literal(false) });
const envelopeSchema = z.strictObject({ format: z.literal(format), manifest: manifestSchema,
  nonce: z.string().length(16), tag: z.string().length(24), ciphertext: z.string().min(8).max(Math.ceil(maxDatabaseBackupBytes / 3) * 4) });
export type DatabaseBackupMetadata = z.infer<typeof metadataSchema>;
export type DatabaseBackupEnvelope = z.infer<typeof envelopeSchema>;
export interface DatabaseBackupKey { keyId: string; key: Buffer }
export class DatabaseBackupError extends Error { constructor() { super("DATABASE_BACKUP_INVALID"); } }
function validKey(input: DatabaseBackupKey | null): DatabaseBackupKey {
  if (!input || !keyId.safeParse(input.keyId).success || !Buffer.isBuffer(input.key) || input.key.length !== 32) throw new DatabaseBackupError();
  return { keyId: input.keyId, key: Buffer.from(input.key) };
}
function isArchive(b: Buffer) { return b.length >= 5 && b.length <= maxDatabaseBackupBytes && b.subarray(0, 5).equals(Buffer.from("PGDMP")); }
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}
const aad = (manifest: DatabaseBackupEnvelope["manifest"]) => Buffer.from(canonical({ format, manifest }));
function base64(value: string, bytes: number) { const b = Buffer.from(value, "base64"); if (b.length !== bytes || b.toString("base64") !== value) throw new DatabaseBackupError(); return b; }
// SERVER MAINTENANCE COMPONENT ONLY. No route, runner, fs writes, pg_restore,
// scheduler or action permit. A trusted archive may execute SQL on restoration;
// encryption/magic/hash do not establish a trustworthy database source.
export function sealDatabaseBackup(input: unknown, metadata: unknown, keyInput: DatabaseBackupKey | null = null): DatabaseBackupEnvelope {
  let key: DatabaseBackupKey | undefined, dump: Buffer | undefined;
  try {
    key = validKey(keyInput); if (!Buffer.isBuffer(input) || !isArchive(input)) throw new DatabaseBackupError();
    dump = Buffer.from(input); const m = metadataSchema.parse(metadata), nonce = randomBytes(12);
    const manifest = manifestSchema.parse({ metadata: m, keyId: key.keyId, dumpBytes: dump.length, dumpSha256: createHash("sha256").update(dump).digest("hex"),
      scope: "single_database_archive", requiresReconciliation: true, executionAllowed: false, publicationAllowed: false });
    const cipher = createCipheriv("aes-256-gcm", key.key, nonce, { authTagLength: 16 }); cipher.setAAD(aad(manifest));
    const ciphertext = Buffer.concat([cipher.update(dump), cipher.final()]);
    return envelopeSchema.parse({ format, manifest, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  } catch { throw new DatabaseBackupError(); } finally { key?.key.fill(0); dump?.fill(0); }
}
export function openDatabaseBackup(input: unknown, keyInput: DatabaseBackupKey | null = null) {
  let key: DatabaseBackupKey | undefined;
  try {
    key = validKey(keyInput); const envelope = envelopeSchema.parse(input), m = envelope.manifest;
    if (key.keyId !== m.keyId) throw new DatabaseBackupError();
    const nonce = base64(envelope.nonce, 12), tag = base64(envelope.tag, 16), cipher = base64(envelope.ciphertext, m.dumpBytes);
    const decipher = createDecipheriv("aes-256-gcm", key.key, nonce, { authTagLength: 16 }); decipher.setAAD(aad(m)); decipher.setAuthTag(tag);
    const dump = Buffer.concat([decipher.update(cipher), decipher.final()]);
    if (!isArchive(dump) || createHash("sha256").update(dump).digest("hex") !== m.dumpSha256) throw new DatabaseBackupError();
    return { dump, manifest: structuredClone(m) }; // Sensitive plaintext for authorized maintenance only; never log/HTTP-return.
  } catch { throw new DatabaseBackupError(); } finally { key?.key.fill(0); }
}
