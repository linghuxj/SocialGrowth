import { constants, type Stats } from "node:fs";
import { open, lstat, realpath, link, unlink, type FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve, join } from "node:path";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";
import type { DatabaseBackupKey } from "./database-backup-envelope.js";
import { openInventoryBoundDatabaseBackup, type InventoryBoundDatabaseBackup } from "./database-backup-inventory-envelope.js";
export const maxEncryptedBackupFileBytes = 180 * 1024 * 1024; // Technical JSON bound, NOT capacity or retention/RPO/RTO.
type FileCode = "DATABASE_BACKUP_FILE_INVALID" | "DATABASE_BACKUP_FILE_UNAVAILABLE" | "DATABASE_BACKUP_FILE_CONFLICT" | "DATABASE_BACKUP_FILE_UNKNOWN";
export class DatabaseBackupFileError extends Error { constructor(readonly code: FileCode) { super(code); } }
const invalid = () => new DatabaseBackupFileError("DATABASE_BACKUP_FILE_INVALID");
const configSchema = z.strictObject({ directory: z.string().min(1).max(4096).refine(v => isAbsolute(v) && resolve(v) === v && !v.includes("\0")) });
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// Server-owned IO port; the default is the real local filesystem. Never accept
// this port from HTTP/config data. Fault checks delegate real IO then lose ACK.
export interface DatabaseBackupFileIO {
  open: typeof open; lstat: typeof lstat; realpath: typeof realpath; link: typeof link; unlink: typeof unlink;
}
const localIO: DatabaseBackupFileIO = { open, lstat, realpath, link, unlink };
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}
function keyCopy(key: DatabaseBackupKey | null) {
  if (!key || !/^[A-Za-z0-9_-]{1,100}$/.test(key.keyId) || !Buffer.isBuffer(key.key) || key.key.length !== 32) throw invalid();
  return { keyId: key.keyId, key: Buffer.from(key.key) };
}
function authenticate(input: unknown, key: DatabaseBackupKey, expectedId?: string): InventoryBoundDatabaseBackup {
  try {
    const clone: unknown = structuredClone(input), opened = openInventoryBoundDatabaseBackup(clone, key);
    try { if (expectedId && opened.manifest.metadata.backupId.toLowerCase() !== expectedId) throw invalid(); }
    finally { opened.dump.fill(0); }
    return clone as InventoryBoundDatabaseBackup; // The strict v2 parser and GCM authentication above accepted this isolated clone.
  } catch { throw invalid(); }
}
const sameInode = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const ownedMode = (s: Stats, mode: number) => typeof process.getuid === "function" && s.uid === process.getuid() && (s.mode & 0o7777) === mode;
async function directory(path: string, io: DatabaseBackupFileIO) {
  const stat = await io.lstat(path);
  if (!stat.isDirectory() || !ownedMode(stat, 0o700) || await io.realpath(path) !== path) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNAVAILABLE");
  const handle = await io.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { if (!sameInode(stat, await handle.stat())) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNAVAILABLE"); }
  catch (e) { await handle.close(); throw e; }
  return { handle, stat, path, io };
}
async function checkDirectory(d: Awaited<ReturnType<typeof directory>>) {
  const stat = await d.io.lstat(d.path);
  if (!stat.isDirectory() || !ownedMode(stat, 0o700) || !sameInode(stat, d.stat) || await d.io.realpath(d.path) !== d.path) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNAVAILABLE");
}
async function readFile(d: Awaited<ReturnType<typeof directory>>, id: string, key: DatabaseBackupKey) {
  await checkDirectory(d);
  const handle = await d.io.open(join(d.path, `${id}.sgbackup.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer | undefined;
  try {
    const before = await handle.stat();
    if (!before.isFile() || !ownedMode(before, 0o600) || before.nlink !== 1 || before.size < 1 || before.size > maxEncryptedBackupFileBytes) throw invalid();
    // Bound allocation and reads even if a trusted-owner process grows the file.
    bytes = Buffer.alloc(before.size + 1); let count = 0;
    while (count < bytes.length) { const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count); if (!bytesRead) break; count += bytesRead; }
    const after = await handle.stat();
    if (count !== before.size || !sameInode(before, after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || !ownedMode(after, 0o600) || after.nlink !== 1) throw invalid();
    await checkDirectory(d);
    const data = bytes.subarray(0, count); let input: unknown;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); } catch { throw invalid(); }
    const envelope = authenticate(input, key, id);
    return { envelope, envelopeSha256: digest(data) };
  } finally { bytes?.fill(0); await handle.close(); }
}
// TRUSTED POSIX MAINTENANCE DIRECTORY ONLY. Its canonical 0700 path/ancestors
// must be exclusively controlled by the maintenance owner. This is not openat
// protection against a hostile same-UID process or administrator path swaps.
// No HTTP, scheduler, key storage, automatic pg_restore, consumer or deletion.
export class EncryptedDatabaseBackupFileStore {
  private readonly path: string | null;
  private readonly io: DatabaseBackupFileIO;
  constructor(config: unknown = null, io: DatabaseBackupFileIO = localIO) { const parsed = configSchema.safeParse(config); this.path = parsed.success ? parsed.data.directory : null; this.io = Object.freeze({ ...io }); }
  async save(input: unknown, keyInput: DatabaseBackupKey | null = null) {
    let key: DatabaseBackupKey | undefined, d: Awaited<ReturnType<typeof directory>> | undefined, staged: FileHandle | undefined;
    let temporary: string | undefined, temporaryStat: Stats | undefined, intent = false, committed = false;
    try {
      if (!this.path) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNAVAILABLE");
      key = keyCopy(keyInput); const envelope = authenticate(input, key), id = envelope.manifest.metadata.backupId.toLowerCase();
      const bytes = Buffer.from(canonical(envelope)); if (bytes.length > maxEncryptedBackupFileBytes) throw invalid();
      d = await directory(this.path, this.io); temporary = join(d.path, `.${id}.${randomUUID()}.pending`); intent = true;
      staged = await this.io.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      temporaryStat = await staged.stat(); await staged.writeFile(bytes); await staged.sync();
      const ready = await staged.stat();
      if (!ready.isFile() || !ownedMode(ready, 0o600) || ready.nlink !== 1 || ready.size !== bytes.length || !sameInode(ready, temporaryStat)) throw invalid();
      await checkDirectory(d); let status: "stored" | "already_stored" = "stored";
      try { await this.io.link(temporary, join(d.path, `${id}.sgbackup.json`)); committed = true; }
      catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
        const existing = await readFile(d, id, key);
        if (existing.envelopeSha256 !== digest(bytes)) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_CONFLICT");
        status = "already_stored";
      }
      // No rename/overwrite. Only remove this call's exact staging inode.
      await checkDirectory(d); if (!sameInode(await this.io.lstat(temporary), temporaryStat)) throw invalid();
      await this.io.unlink(temporary); temporary = undefined; await d.handle.sync();
      return { backupId: id, envelopeSha256: digest(bytes), status, requiresReconciliation: true as const, executionAllowed: false as const, publicationAllowed: false as const };
    } catch (e) {
      if (committed) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNKNOWN");
      if (e instanceof DatabaseBackupFileError) throw e;
      throw new DatabaseBackupFileError(intent ? "DATABASE_BACKUP_FILE_UNKNOWN" : "DATABASE_BACKUP_FILE_UNAVAILABLE");
    } finally {
      key?.key.fill(0);
      if (temporary && temporaryStat && d) { try { await checkDirectory(d); if (sameInode(await this.io.lstat(temporary), temporaryStat)) await this.io.unlink(temporary); } catch { /* Error already reported; never delete a final artifact or foreign inode. */ } }
      try { await staged?.close(); } catch { /* No raw paths/configuration in errors. */ }
      try { await d?.handle.close(); } catch { /* Read-only directory descriptor. */ }
    }
  }
  async load(backupId: unknown, keyInput: DatabaseBackupKey | null = null) {
    let key: DatabaseBackupKey | undefined, d: Awaited<ReturnType<typeof directory>> | undefined;
    try {
      if (!this.path) throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNAVAILABLE");
      const id = uuidSchema.safeParse(backupId); if (!id.success) throw invalid();
      key = keyCopy(keyInput); d = await directory(this.path, this.io); return await readFile(d, id.data.toLowerCase(), key);
    } catch (e) { if (e instanceof DatabaseBackupFileError) throw e; throw new DatabaseBackupFileError("DATABASE_BACKUP_FILE_UNAVAILABLE"); }
    finally { key?.key.fill(0); try { await d?.handle.close(); } catch { /* Fixed error boundary. */ } }
  }
}
