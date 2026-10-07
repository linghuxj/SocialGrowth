import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { compareTimestamps, materialUploadInventoryQuerySchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { materialUploadCommandSchema, materialUploadPrepareSchema, materialUploadDescriptorSchema, MaterialUploadError } from "./material-upload-core.js";
import { canonicalMaterial } from "./material-registry-core.js";
import { MaterialObjectStorage, MaterialStorageError } from "./material-object-storage.js";
import { MaterialStorageVerifier } from "./material-storage-verifier.js";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const s = "socialgrowth_product";
const stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Upload ticket or storage binding changed");
interface TicketRow { object_id: string; project_id: string; descriptor: unknown; status: string; prepared_by_operator_id: string; prepared_at: string;
  verified_object_id: string | null; verified_by_operator_id: string | null; verified_at: string | null }
interface CommandRow { kind: string; payload_digest: Buffer; object_id: string }
const corrupt = (): never => { throw new MaterialUploadError("CORRUPT_TICKET"); };
async function fresh(c: PoolClient, a: OperatorSessionContext): Promise<string> {
  const row = (await c.query<{ now: string }>(`WITH t AS MATERIALIZED(SELECT clock_timestamp() now) SELECT to_char(t.now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') now
    FROM ${s}.operator_sessions x CROSS JOIN t WHERE x.session_id=$1 AND x.operator_id=$2 AND x.revoked_at IS NULL AND x.expires_at>t.now`, [a.sessionId, a.operator.operatorId])).rows[0];
  if (!row) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired"); return row.now;
}
export class MaterialUploadStore {
  #pool: Pool; #auth: OperatorAuthService; #storage: MaterialObjectStorage | null;
  constructor(pool: Pool, auth: OperatorAuthService, storage: MaterialObjectStorage | null = null) { this.#pool = pool; this.#auth = auth; this.#storage = storage; }
  private configured(): MaterialObjectStorage { if (!this.#storage) throw new MaterialUploadError("CONFIGURATION_REQUIRED"); return this.#storage; }
  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, a: OperatorSessionContext) => Promise<T>): Promise<T> {
    let c: PoolClient; try { c = await this.#pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Upload journal unavailable", true); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const a = await this.#auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      if ((await c.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`)).rowCount !== 1) corrupt();
      await fresh(c, a); const result = await fn(c, a); await fresh(c, a); await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Upload journal unavailable", true); }
      if (e instanceof ProductTransactionError || e instanceof MaterialUploadError) throw e;
      throw new ProductTransactionError("INTERNAL_ERROR", "Upload journal unavailable", true);
    } finally { c.release(); }
  }
  private async project(c: PoolClient, projectId: string) { if (!(await c.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rowCount) throw stale(); }
  private async load(c: PoolClient, objectId: string) {
    const row = (await c.query<TicketRow>(`SELECT * FROM ${s}.material_upload_tickets WHERE object_id=$1`, [objectId])).rows[0]; if (!row) return null;
    const p = materialUploadDescriptorSchema.safeParse(row.descriptor); if (!p.success || p.data.objectId !== row.object_id || p.data.projectId !== row.project_id) return corrupt();
    const descriptor = p.data, ref = (await c.query<{ reference: unknown; project_id: string }>(`SELECT reference,project_id FROM ${s}.material_object_manifests WHERE object_id=$1`, [objectId])).rows[0];
    if (!timestampSchema.safeParse(row.prepared_at).success || row.prepared_at.startsWith("0000-") || !uuidSchema.safeParse(row.prepared_by_operator_id).success) return corrupt();
    if (row.status === "verified_bytes") {
      if (!row.verified_at || !timestampSchema.safeParse(row.verified_at).success || row.verified_at.startsWith("0000-") || row.verified_object_id !== row.object_id
        || !row.verified_by_operator_id || !uuidSchema.safeParse(row.verified_by_operator_id).success || compareTimestamps(row.prepared_at, row.verified_at)! > 0
        || !ref || ref.project_id !== row.project_id || canonicalMaterial(ref.reference) !== canonicalMaterial(descriptor)) return corrupt();
    } else if (row.status !== "pending_bytes" || row.verified_at !== null || row.verified_by_operator_id !== null || row.verified_object_id !== null || ref) return corrupt();
    return { objectId: row.object_id, projectId: row.project_id, descriptor, status: row.status as "pending_bytes" | "verified_bytes", preparedAt: row.prepared_at,
      preparedByOperatorId: row.prepared_by_operator_id, verifiedAt: row.verified_at, verifiedByOperatorId: row.verified_by_operator_id,
      candidateAllowed: false as const, publicationAllowed: false as const };
  }
  private bindingMatches(descriptor: ReturnType<typeof materialUploadDescriptorSchema.parse>, storage: MaterialObjectStorage) {
    const b = storage.binding(); if (descriptor.storageLocationId !== b.storageLocationId || descriptor.storageBindingDigest !== b.storageBindingDigest || descriptor.bytes > b.maxObjectBytes) throw stale();
  }
  private async command(c: PoolClient, a: OperatorSessionContext, key: string, kind: string, digest: Buffer, objectId: string) {
    const old = (await c.query<CommandRow>(`SELECT kind,payload_digest,object_id FROM ${s}.material_upload_commands WHERE actor_id=$1 AND request_key=$2`, [a.operator.operatorId, key])).rows[0];
    if (old && (old.kind !== kind || old.object_id !== objectId || !old.payload_digest.equals(digest))) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Upload request key belongs to different inputs"); return old;
  }
  private async affected(c: PoolClient, sql: string, values: unknown[]) { if ((await c.query(sql, values)).rowCount !== 1) throw new ProductTransactionError("INTERNAL_ERROR", "Upload journal unavailable", true); }
  private async audit(c: PoolClient, a: OperatorSessionContext, objectId: string, requestId: string, status: string) {
    await this.affected(c, `INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'material.object_upload_recorded','material_object',$3,$4,$5)`, [randomUUID(), a.operator.operatorId, objectId, requestId, { status }]);
  }
  private async remember(c: PoolClient, a: OperatorSessionContext, key: string, kind: string, digest: Buffer, objectId: string) {
    await this.affected(c, `INSERT INTO ${s}.material_upload_commands(actor_id,request_key,kind,payload_digest,object_id) VALUES($1,$2,$3,$4,$5)`, [a.operator.operatorId, key, kind, digest, objectId]);
  }
  async read(token: string, projectId: string, objectId: string) {
    if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(objectId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid upload locator");
    return this.tx(token, null, async c => { await this.project(c, projectId.toLowerCase()); const saved = await this.load(c, objectId.toLowerCase()); if (!saved || saved.projectId !== projectId.toLowerCase()) throw stale(); return saved; });
  }
  async readAnalysisBytes(token: string, csrf: string, projectId: string, objectId: string) {
    if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(objectId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid material locator");
    const ticket = await this.tx(token, csrf, async c => {
      await this.project(c, projectId.toLowerCase());
      const saved = await this.load(c, objectId.toLowerCase());
      if (!saved || saved.projectId !== projectId.toLowerCase() || saved.status !== "verified_bytes" || saved.descriptor.contentType !== "video/mp4") throw stale();
      return saved;
    });
    const bytes = await this.configured().readVerified(ticket.descriptor);
    // Recheck the authenticated object after IO; never return a cross-project object.
    await this.read(token, projectId, objectId);
    return { bytes, sha256: ticket.descriptor.sha256 };
  }
  async list(token: string, projectId: string, input: unknown) {
    const p = materialUploadInventoryQuerySchema.safeParse(input);
    if (!uuidSchema.safeParse(projectId).success || !p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid upload inventory locator");
    const project = projectId.toLowerCase(), after = p.data.afterObjectId?.toLowerCase() ?? null;
    return this.tx(token, null, async c => {
      await this.project(c, project);
      if (after && !(await c.query(`SELECT 1 FROM ${s}.material_upload_tickets WHERE project_id=$1 AND object_id=$2`, [project, after])).rowCount) throw stale();
      const rows = (await c.query<{ object_id: string }>(`SELECT object_id FROM ${s}.material_upload_tickets WHERE project_id=$1 AND ($2::uuid IS NULL OR object_id>$2::uuid) ORDER BY object_id LIMIT $3`, [project, after, p.data.pageSize + 1])).rows;
      const tickets = [];
      for (const row of rows.slice(0, p.data.pageSize)) {
        const saved = await this.load(c, row.object_id); if (!saved || saved.projectId !== project) return corrupt(); tickets.push(saved);
      }
      return { projectId: project, tickets, nextAfterObjectId: rows.length > p.data.pageSize ? tickets.at(-1)!.objectId : null };
    }); // Historical DB facts only: no configured storage or SDK IO needed.
  }
  async prepare(token: string, csrf: string, input: unknown) {
    const p = materialUploadPrepareSchema.safeParse(input); if (!p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid upload descriptor");
    const storage = this.configured(), r = p.data, b = storage.binding(); if (r.bytes > b.maxObjectBytes) throw new MaterialUploadError("INVALID_BYTES");
    const { requestId: _requestId, ...metadata } = r.metadata, digest = createHash("sha256").update(canonicalMaterial({ kind: "prepare", ...r, metadata })).digest();
    return this.tx(token, csrf, async (c, a) => {
      await this.project(c, r.projectId); const old = await this.command(c, a, metadata.idempotencyKey, "prepare", digest, r.objectId), saved = await this.load(c, r.objectId);
      const descriptor = materialUploadDescriptorSchema.parse({ storageLocationId: b.storageLocationId, storageBindingDigest: b.storageBindingDigest,
        projectId: r.projectId, objectId: r.objectId, sha256: r.sha256, bytes: r.bytes, contentType: r.contentType, key: `projects/${r.projectId}/objects/${r.objectId}` });
      if (saved) { if (saved.projectId !== r.projectId || canonicalMaterial(saved.descriptor) !== canonicalMaterial(descriptor)) throw stale(); }
      else {
        if (old) return corrupt();
        if ((await c.query(`SELECT 1 FROM ${s}.material_object_manifests WHERE object_id=$1`, [r.objectId])).rowCount) throw stale();
        const now = await fresh(c, a); await this.affected(c, `INSERT INTO ${s}.material_upload_tickets(object_id,project_id,descriptor,prepared_by_operator_id,prepared_at) VALUES($1,$2,$3,$4,$5)`, [r.objectId, r.projectId, descriptor, a.operator.operatorId, now]);
        await this.audit(c, a, r.objectId, r.metadata.requestId, "pending_bytes");
      }
      if (!old) await this.remember(c, a, metadata.idempotencyKey, "prepare", digest, r.objectId);
      const current = await this.load(c, r.objectId); if (!current) return corrupt(); return { ...current, changed: !saved, replayed: Boolean(old) };
    });
  }
  async upload(token: string, csrf: string, input: unknown, bytes: Uint8Array) {
    const p = materialUploadCommandSchema.safeParse(input); if (!p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid upload command");
    const storage = this.configured(), r = p.data;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > storage.binding().maxObjectBytes) throw new MaterialUploadError("INVALID_BYTES");
    const body = Buffer.from(bytes), sha256 = createHash("sha256").update(body).digest("hex"), { requestId: _requestId, ...metadata } = r.metadata;
    const digest = createHash("sha256").update(canonicalMaterial({ kind: "upload", ...r, metadata, sha256, bytes: body.length })).digest();
    const check = async (c: PoolClient, a: OperatorSessionContext) => {
      await this.project(c, r.projectId); const old = await this.command(c, a, metadata.idempotencyKey, "upload", digest, r.objectId), saved = await this.load(c, r.objectId);
      if (!saved || saved.projectId !== r.projectId) throw stale(); this.bindingMatches(saved.descriptor, storage);
      if (saved.descriptor.sha256 !== sha256 || saved.descriptor.bytes !== body.length) throw new MaterialUploadError("INVALID_BYTES");
      if (old && saved.status !== "verified_bytes") return corrupt(); return { saved, old };
    };
    const preflight = await this.tx(token, csrf, check);
    let reference = preflight.saved.descriptor;
    if (preflight.saved.status === "pending_bytes") {
      try { reference = materialUploadDescriptorSchema.parse(structuredClone(await storage.put({ projectId: r.projectId, objectId: r.objectId, contentType: reference.contentType }, body))); }
      catch (e) { throw new MaterialUploadError(e instanceof MaterialStorageError && e.code === "OBJECT_CONFLICT" ? "OBJECT_CONFLICT" : "STORAGE_UNAVAILABLE", !(e instanceof MaterialStorageError && e.code === "OBJECT_CONFLICT")); }
      if (canonicalMaterial(reference) !== canonicalMaterial(preflight.saved.descriptor)) throw new MaterialUploadError("OBJECT_CONFLICT");
    }
    return this.tx(token, csrf, async (c, a) => {
      const { saved, old } = await check(c, a); if (canonicalMaterial(saved.descriptor) !== canonicalMaterial(reference)) throw stale();
      let changed = false;
      if (saved.status === "pending_bytes") {
        const now = await fresh(c, a); if (compareTimestamps(now, saved.preparedAt)! < 0) throw stale();
        await this.affected(c, `INSERT INTO ${s}.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [r.objectId, r.projectId, reference]);
        await this.affected(c, `UPDATE ${s}.material_upload_tickets SET status='verified_bytes',verified_object_id=object_id,verified_by_operator_id=$2,verified_at=$3 WHERE object_id=$1 AND status='pending_bytes'`, [r.objectId, a.operator.operatorId, now]);
        await this.audit(c, a, r.objectId, r.metadata.requestId, "verified_bytes"); changed = true;
      }
      if (!old) await this.remember(c, a, metadata.idempotencyKey, "upload", digest, r.objectId);
      const current = await this.load(c, r.objectId); if (!current) return corrupt(); return { ...current, changed, replayed: Boolean(old) };
    });
  }
  async inspectForByteUpload(token: string, csrf: string, input: unknown) {
    const p = materialUploadCommandSchema.safeParse(input);
    if (!p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid upload command");
    const storage = this.configured(), r = p.data;
    return this.tx(token, csrf, async c => {
      await this.project(c, r.projectId); const saved = await this.load(c, r.objectId);
      if (!saved || saved.projectId !== r.projectId) throw stale();
      this.bindingMatches(saved.descriptor, storage); return saved;
    }); // No body/storage IO under auth or material/project locks.
  }
  objectVerifier() {
    const storage = this.configured();
    return new MaterialStorageVerifier(storage, async (projectId, objectId) => {
      const c = await this.#pool.connect();
      try {
        await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
        // Server-only manifest lookup holds only the shared data guard, never
        // auth locks; release it BEFORE the verifier downloads any bytes.
        if ((await c.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`)).rowCount !== 1) corrupt();
        const ticket = await this.load(c, objectId); await c.query("COMMIT");
        return ticket?.projectId === projectId && ticket.status === "verified_bytes" ? ticket.descriptor : undefined;
      } catch {
        try { await c.query("ROLLBACK"); } catch { throw new MaterialUploadError("STORAGE_UNAVAILABLE", true); }
        throw new MaterialUploadError("STORAGE_UNAVAILABLE", true);
      } finally { c.release(); }
    });
  }
}
