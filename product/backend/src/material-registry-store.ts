import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { compareTimestamps, timestampSchema, uuidSchema, materialLibraryQuerySchema, directionApprovalSchema, projectPlanningInputsSchema } from "@socialgrowth/product-contracts";
import { materialSaveSchema, materialDeclarationSchema, materialIdentitySchema, materialObjectReferenceSchema, canonicalMaterial, type MaterialSave } from "./material-registry-core.js";
import { OperatorAuthService, type OperatorSessionContext } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { appendMaterialRevisionChanged } from "./business-plan-task-impact-writer.js";
const s = "socialgrowth_product", stale = () => new ProductTransactionError("FACT_VERSION_STALE", "Material identity, revision or source changed");
export class MaterialRegistryError extends Error {
  constructor(readonly code: "VERIFIER_UNAVAILABLE" | "INVALID_OBJECTS" | "CORRUPT_HISTORY") { super(code); }
}
// Server-owned actual bytes/manifest resolver. Never a caller URL or model port.
// It must use protected registered location/config + full byte integrity, not
// merely echo IDs. No media eligibility, copyright or execution grant implied.
export interface MaterialObjectVerifier { verify(input: { projectId: string; objectIds: string[] }, signal: AbortSignal): Promise<unknown> }
interface UnitRow { content_unit_id: string; project_id: string; source_id: string; source_record_id: string; identity: unknown }
interface VariantRow { variant_id: string; content_unit_id: string; project_id: string; language_tag: string; current_revision: string }
interface RevisionRow { revision: string; declaration: unknown; object_references: unknown; status: string; recorded_by_operator_id: string; recorded_at: string }
const invalid = (): never => { throw new MaterialRegistryError("CORRUPT_HISTORY"); };
async function fresh(c: PoolClient, a: OperatorSessionContext): Promise<string> {
  const r = (await c.query<{ now: string }>(`WITH t AS MATERIALIZED(SELECT clock_timestamp() now)
    SELECT to_char(t.now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') now FROM ${s}.operator_sessions x CROSS JOIN t
    WHERE x.session_id=$1 AND x.operator_id=$2 AND x.revoked_at IS NULL AND x.expires_at>t.now`, [a.sessionId, a.operator.operatorId])).rows[0];
  if (!r) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator session expired"); return r.now;
}
export class MaterialRegistryStore {
  constructor(private readonly pool: Pool, private readonly auth: OperatorAuthService, private readonly verifier: MaterialObjectVerifier | null = null) {}
  private async tx<T>(token: string, csrf: string | null, fn: (c: PoolClient, a: OperatorSessionContext) => Promise<T>): Promise<T> {
    let c: PoolClient; try { c = await this.pool.connect(); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Material registry unavailable", true); }
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='10s'");
      await c.query(`LOCK TABLE ${s}.operators IN SHARE ROW EXCLUSIVE MODE`);
      const a = await this.auth.authenticateSessionInTransaction(c, token, csrf ?? undefined, csrf !== null);
      if ((await c.query(`SELECT 1 FROM ${s}.material_registry_guard FOR UPDATE`)).rowCount !== 1) invalid();
      await fresh(c, a); const result = await fn(c, a); await fresh(c, a); await c.query("COMMIT"); return result;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { throw new ProductTransactionError("INTERNAL_ERROR", "Material registry unavailable", true); }
      if (e instanceof ProductTransactionError || e instanceof MaterialRegistryError) throw e;
      throw new ProductTransactionError("INTERNAL_ERROR", "Material registry unavailable", true);
    } finally { c.release(); }
  }
  private async project(c: PoolClient, id: string) {
    if (!(await c.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [id])).rowCount) throw stale();
  }
  // Duplicate checks are scoped to manifests already bound by an immutable
  // material revision. Uploads that have not been declared are not evidence
  // of reuse. Historical revisions still count; a corrected/retired variant
  // cannot make a previously bound exact SHA look new again.
  private async shaCollision(c: PoolClient, contentUnitId: string, sha256s: string[]) {
    if (!sha256s.length) return false;
    const result = await c.query<{ collision: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM ${s}.material_variant_revisions r
      JOIN ${s}.material_variants v ON v.variant_id=r.variant_id
      CROSS JOIN LATERAL jsonb_array_elements(r.object_references) ref
      JOIN ${s}.material_object_manifests m ON m.object_id=(ref.value->>'objectId')::uuid
      WHERE v.content_unit_id<>$1 AND m.reference->>'sha256'=ANY($2::text[])
    ) collision`, [contentUnitId, [...new Set(sha256s)]]);
    return result.rows[0]?.collision === true;
  }
  private async eligibilityReason(c: PoolClient, unit: UnitRow, languageTag: string, declaration: z.infer<typeof materialDeclarationSchema>, sha256s: string[]) {
    const sourceRows = await c.query(`SELECT count(*)::int n FROM ${s}.material_content_units WHERE source_id=$1 AND source_record_id=$2`, [unit.source_id, unit.source_record_id]);
    if (sourceRows.rows[0]?.n !== 1) return "source_record_conflict" as const;
    const ctx = (await c.query<{ fact_version: string; phase: string; draft_version: string | null; inputs: unknown; approval: unknown }>(`SELECT p.fact_version::text,p.phase,d.draft_version::text,d.inputs,a.record approval
      FROM ${s}.projects p LEFT JOIN ${s}.project_planning_drafts d ON d.project_id=p.project_id
      LEFT JOIN ${s}.project_direction_approvals a ON a.project_id=p.project_id WHERE p.project_id=$1 FOR SHARE OF p`, [unit.project_id])).rows[0];
    if (!ctx?.approval) return "direction_not_approved" as const;
    const approval = directionApprovalSchema.safeParse(ctx.approval);
    if (!approval.success) return invalid();
    const currentInputs = projectPlanningInputsSchema.safeParse(ctx.inputs);
    if (!currentInputs.success || ctx.phase !== "preparing" || ctx.draft_version === null
      || Number(ctx.fact_version) !== approval.data.proposal.projectVersion + 1
      || Number(ctx.draft_version) !== approval.data.proposal.draftVersion
      || canonicalMaterial(currentInputs.data) !== canonicalMaterial(approval.data.proposal.scope.inputs)) return "approved_direction_stale" as const;
    const submittedApprovalId = declaration.expectedApprovedDirectionId;
    const submittedVersion = declaration.expectedApprovedProjectVersion;
    if (submittedApprovalId === null || submittedVersion === null) return "scope_confirmation_missing" as const;
    if (submittedApprovalId.toLowerCase() !== approval.data.approvalId.toLowerCase() || submittedVersion !== Number(ctx.fact_version)) return "scope_confirmation_stale" as const;
    if (!approval.data.proposal.scope.inputs.targetLanguages.some(value => value.toLowerCase() === languageTag.toLowerCase())) return "language_not_targeted" as const;
    const forms = approval.data.proposal.scope.inputs.contentForms;
    const allowed = unit.identity && (() => {
      const identity = materialIdentitySchema.parse(unit.identity);
      return identity.mediaKind === "video" ? forms.some(form => ["facebook_video", "youtube_shorts", "youtube_video"].includes(form))
        : forms.includes("facebook_image_text");
    })();
    if (!allowed) return "no_approved_content_form" as const;
    if (!declaration.contentRulesReviewed) return "content_rules_need_human_check" as const;
    if (await this.shaCollision(c, unit.content_unit_id, sha256s)) return "exact_sha_collision" as const;
    return null;
  }
  private async load(c: PoolClient, variantId: string) {
    const v = (await c.query<VariantRow>(`SELECT *,current_revision::text FROM ${s}.material_variants WHERE variant_id=$1`, [variantId])).rows[0];
    if (!v) return null;
    const u = (await c.query<UnitRow>(`SELECT * FROM ${s}.material_content_units WHERE content_unit_id=$1`, [v.content_unit_id])).rows[0];
    if (!u || u.project_id !== v.project_id || !uuidSchema.safeParse(u.source_id).success || !uuidSchema.safeParse(u.source_record_id).success
      || !z.string().regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/).max(100).safeParse(v.language_tag).success) return invalid();
    const identity = materialIdentitySchema.parse(u.identity);
    const rows = (await c.query<RevisionRow>(`SELECT revision::text,declaration,object_references,status,recorded_by_operator_id,recorded_at
      FROM ${s}.material_variant_revisions r WHERE variant_id=$1 ORDER BY r.revision LIMIT 1001`, [variantId])).rows;
    if (!rows.length || rows.length > 1000 || String(rows.length) !== v.current_revision) return invalid();
    const parsedObjects = rows.map(row => z.array(materialObjectReferenceSchema).min(1).max(20).parse(row.object_references));
    const objectIds = [...new Set(parsedObjects.flatMap(objects => objects.map(o => o.objectId)))];
    const manifests = (await c.query<{ object_id: string; reference: unknown; project_id: string }>(`SELECT object_id,reference,project_id FROM ${s}.material_object_manifests WHERE object_id=ANY($1::uuid[])`, [objectIds])).rows;
    const pinnedById = new Map(manifests.map(row => [row.object_id, row]));
    let previous: string | null = null;
    const revisions = [];
    for (const [i, row] of rows.entries()) {
      const declaration = materialDeclarationSchema.parse(row.declaration), objects = parsedObjects[i]!;
      if (row.revision !== String(i + 1) || row.status !== "pending_validation" || !timestampSchema.safeParse(row.recorded_at).success || row.recorded_at.startsWith("0000-")
        || (previous && compareTimestamps(previous, row.recorded_at)! > 0) || (identity.mediaKind === "video" && objects.length !== 1)
        || objects.some(o => (identity.mediaKind === "video" && o.contentType.startsWith("image/")) || (identity.mediaKind === "image_text" && o.contentType === "video/mp4"))
        || new Set(objects.map(o => o.objectId)).size !== objects.length || new Set(declaration.sourceEvidenceIds).size !== declaration.sourceEvidenceIds.length) return invalid();
      for (const o of objects) {
        const pinned = pinnedById.get(o.objectId);
        if (!pinned || o.projectId !== v.project_id || pinned.project_id !== v.project_id || canonicalMaterial(pinned.reference) !== canonicalMaterial(o)) return invalid();
      }
      previous = row.recorded_at; revisions.push({ revision: i + 1, declaration, objects, status: "pending_validation" as const, recordedAt: row.recorded_at, recordedByOperatorId: row.recorded_by_operator_id });
    }
    const currentObjects = parsedObjects.at(-1)!;
    const reason = await this.eligibilityReason(c, u, v.language_tag, revisions.at(-1)!.declaration, currentObjects.map(o => o.sha256));
    const currentStatus = reason === null ? "candidate" as const : "pending_validation" as const;
    return { contentUnitId: u.content_unit_id, projectId: u.project_id, sourceId: u.source_id, sourceRecordId: u.source_record_id, identity,
      variantId: v.variant_id, languageTag: v.language_tag, currentRevision: rows.length, revisions, status: currentStatus,
      candidateAllowed: reason === null, eligibilityReason: reason, publicationAllowed: false as const };
  }
  async read(token: string, projectId: string, variantId: string) {
    if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(variantId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid material locator");
    return this.tx(token, null, async c => { await this.project(c, projectId.toLowerCase()); const saved = await this.load(c, variantId.toLowerCase());
      if (!saved || saved.projectId !== projectId.toLowerCase()) throw stale(); return saved; });
  }
  async list(token: string, projectId: string, input: unknown) {
    const p = materialLibraryQuerySchema.safeParse(input), project = uuidSchema.safeParse(projectId);
    if (!p.success || !project.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid material library query");
    const id = project.data.toLowerCase(), cursor = p.data.afterVariantId?.toLowerCase() ?? null;
    return this.tx(token, null, async c => {
      await this.project(c, id);
      if (cursor && (await c.query(`SELECT 1 FROM ${s}.material_variants WHERE variant_id=$1 AND project_id=$2`, [cursor, id])).rowCount !== 1) throw stale();
      const rows = (await c.query<{ variant_id: string }>(`SELECT variant_id FROM ${s}.material_variants WHERE project_id=$1 AND ($2::uuid IS NULL OR variant_id>$2) ORDER BY variant_id LIMIT $3`, [id, cursor, p.data.pageSize + 1])).rows;
      const page = rows.slice(0, p.data.pageSize), materials = [];
      // Authenticate/project/guard remain held for one DB-only consistent page.
      // Validate full histories for selected variants; no object IO or grants.
      for (const row of page) { const saved = await this.load(c, row.variant_id); if (!saved || saved.projectId !== id) return invalid(); materials.push(saved); }
      return { projectId: id, materials, nextAfterVariantId: rows.length > p.data.pageSize ? page.at(-1)!.variant_id : null };
    });
  }
  // Internal consistent read for services already holding the authenticated
  // material guard and project lock in their own transaction. Keeping this
  // projection here prevents business planning from reimplementing candidate
  // eligibility or treating declarations as externally verified rights.
  async listCurrentForBusinessPlan(c: PoolClient, projectId: string) {
    const rows = await c.query<{ variant_id: string }>(`SELECT variant_id FROM ${s}.material_variants WHERE project_id=$1 ORDER BY variant_id LIMIT 1001`, [projectId]);
    if (rows.rows.length > 1000) throw new ProductTransactionError("INPUT_INVALID", "Project material inventory exceeds the bounded planning read");
    const materials = [];
    for (const row of rows.rows) {
      const material = await this.load(c, row.variant_id);
      if (!material || material.projectId !== projectId) throw new ProductTransactionError("INTERNAL_ERROR", "Material facts are inconsistent", true);
      materials.push(material);
    }
    return materials;
  }
  // HTTP authentication preflight also runs when storage is unconfigured.
  // It does not grant a lease: save/read reauthenticate in their own tx.
  async authorizeWrite(token: string, csrf: string, projectId: string) {
    if (!uuidSchema.safeParse(projectId).success) throw new ProductTransactionError("INPUT_INVALID", "Invalid material project");
    await this.tx(token, csrf, async c => { await this.project(c, projectId.toLowerCase()); });
  }
  private async verify(r: MaterialSave) {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = performance.now() + 3000;
      const raw = await Promise.race([this.verifier!.verify({ projectId: r.projectId, objectIds: [...r.objectIds] }, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new MaterialRegistryError("VERIFIER_UNAVAILABLE")); }, 3000); })]);
      // Capture the winning evidence BEFORE finally aborts a source callback.
      const objects = z.array(materialObjectReferenceSchema).max(20).parse(structuredClone(raw));
      if (performance.now() >= deadline || controller.signal.aborted) throw new MaterialRegistryError("VERIFIER_UNAVAILABLE");
      if (objects.length !== r.objectIds.length || objects.some((o, i) => o.objectId !== r.objectIds[i] || o.projectId !== r.projectId)) throw new MaterialRegistryError("INVALID_OBJECTS");
      if (objects.some(o => (r.identity.mediaKind === "video" && o.contentType.startsWith("image/"))
        || (r.identity.mediaKind === "image_text" && o.contentType === "video/mp4"))) throw new MaterialRegistryError("INVALID_OBJECTS");
      return objects;
    } catch (e) { if (e instanceof MaterialRegistryError) throw e; throw new MaterialRegistryError("VERIFIER_UNAVAILABLE"); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  async save(token: string, csrf: string, input: unknown) {
    const p = materialSaveSchema.safeParse(input); if (!p.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid material declaration");
    if (!this.verifier) throw new MaterialRegistryError("VERIFIER_UNAVAILABLE");
    const r = p.data, { requestId: _requestId, ...metadata } = r.metadata;
    r.declaration.sourceEvidenceIds.sort(); // Evidence references are a set; image objects remain ordered.
    const digestPayload = { ...r, metadata };
    const digest = createHash("sha256").update(canonicalMaterial(digestPayload)).digest();
    // A pre-confirmation client may replay its original request after upgrade.
    // Only the all-default confirmation is equivalent to that legacy request;
    // any supplied approval binding or positive confirmation remains distinct.
    const legacyDigest = r.declaration.expectedApprovedDirectionId === null && r.declaration.expectedApprovedProjectVersion === null && !r.declaration.contentRulesReviewed
      ? createHash("sha256").update(canonicalMaterial({ ...digestPayload, declaration: (() => {
        const declaration = { ...r.declaration } as Record<string, unknown>;
        delete declaration.expectedApprovedDirectionId; delete declaration.expectedApprovedProjectVersion; delete declaration.contentRulesReviewed;
        return declaration;
      })() })).digest() : null;
    const command = async (c: PoolClient, actorId: string) => (await c.query<{ payload_digest: Buffer; variant_id: string }>(`SELECT payload_digest,variant_id FROM ${s}.material_registry_commands WHERE actor_id=$1 AND request_key=$2`, [actorId, metadata.idempotencyKey])).rows[0];
    const replay = async (c: PoolClient, actorId: string) => {
      const old = await command(c, actorId); if (!old) return null;
      if ((!old.payload_digest.equals(digest) && !(legacyDigest && old.payload_digest.equals(legacyDigest))) || old.variant_id !== r.variantId) throw new ProductTransactionError("IDEMPOTENCY_KEY_REUSED", "Material request key belongs to different inputs");
      const saved = await this.load(c, r.variantId); if (!saved || saved.projectId !== r.projectId) return invalid(); return { ...saved, changed: false, replayed: true };
    };
    // Authenticate actual actor/project, release all locks BEFORE object IO.
    const old = await this.tx(token, csrf, async (c, a) => { await this.project(c, r.projectId); return replay(c, a.operator.operatorId); });
    if (old) return old;
    const objects = await this.verify(r);
    return this.tx(token, csrf, async (c, a) => {
      await this.project(c, r.projectId); const repeated = await replay(c, a.operator.operatorId); if (repeated) return repeated;
      const unit = (await c.query<UnitRow>(`SELECT * FROM ${s}.material_content_units WHERE content_unit_id=$1 OR (source_id=$2 AND source_record_id=$3)`, [r.contentUnitId, r.sourceId, r.sourceRecordId])).rows;
      if (unit.length > 1 || (unit[0] && (unit[0].content_unit_id !== r.contentUnitId || unit[0].project_id !== r.projectId || unit[0].source_id !== r.sourceId || unit[0].source_record_id !== r.sourceRecordId || canonicalMaterial(unit[0].identity) !== canonicalMaterial(r.identity)))) throw stale();
      const current = await this.load(c, r.variantId);
      if (current && (current.projectId !== r.projectId || current.contentUnitId !== r.contentUnitId || current.languageTag !== r.languageTag)) throw stale();
      if (!current && (await c.query(`SELECT 1 FROM ${s}.material_variants WHERE content_unit_id=$1 AND language_tag=$2`, [r.contentUnitId, r.languageTag])).rowCount) throw stale();
      if (!unit.length && r.identity.seriesId && (await c.query(`SELECT 1 FROM ${s}.material_content_units WHERE identity->>'seriesId'=$1 AND
        (project_id<>$2 OR identity->>'businessEntityId'<>$3 OR identity->>'episodeNumber'=$4)`, [r.identity.seriesId, r.projectId, r.identity.businessEntityId, String(r.identity.episodeNumber)])).rowCount) throw stale();
      if (r.expectedCurrentRevision !== (current?.currentRevision ?? 0)) throw stale();
      const last = current?.revisions.at(-1), unchanged = last && canonicalMaterial(last.declaration) === canonicalMaterial(r.declaration) && canonicalMaterial(last.objects) === canonicalMaterial(objects);
      if (!unchanged) {
        const revision = (current?.currentRevision ?? 0) + 1; if (revision > 1000) throw stale();
        const now = await fresh(c, a); if (last && compareTimestamps(now, last.recordedAt)! < 0) throw stale();
        if (!unit.length) await this.affected(c, `INSERT INTO ${s}.material_content_units(content_unit_id,project_id,source_id,source_record_id,identity) VALUES($1,$2,$3,$4,$5)`, [r.contentUnitId, r.projectId, r.sourceId, r.sourceRecordId, r.identity]);
        for (const o of objects) {
          const pinned = (await c.query<{ reference: unknown }>(`SELECT reference FROM ${s}.material_object_manifests WHERE object_id=$1`, [o.objectId])).rows[0];
          if (pinned) { if (canonicalMaterial(pinned.reference) !== canonicalMaterial(o)) throw stale(); }
          else await this.affected(c, `INSERT INTO ${s}.material_object_manifests(object_id,project_id,reference) VALUES($1,$2,$3)`, [o.objectId, r.projectId, o]);
        }
        if (!current) await this.affected(c, `INSERT INTO ${s}.material_variants(variant_id,content_unit_id,project_id,language_tag,current_revision) VALUES($1,$2,$3,$4,$5)`, [r.variantId, r.contentUnitId, r.projectId, r.languageTag, revision]);
        else await this.affected(c, `UPDATE ${s}.material_variants SET current_revision=$2 WHERE variant_id=$1 AND current_revision=$3`, [r.variantId, revision, revision - 1]);
        await this.affected(c, `INSERT INTO ${s}.material_variant_revisions(variant_id,revision,declaration,object_references,recorded_by_operator_id,recorded_at) VALUES($1,$2,$3,$4,$5,$6)`, [r.variantId, revision, r.declaration, JSON.stringify(objects), a.operator.operatorId, now]);
        const reason = await this.eligibilityReason(c, { content_unit_id: r.contentUnitId, project_id: r.projectId, source_id: r.sourceId, source_record_id: r.sourceRecordId, identity: r.identity }, r.languageTag, r.declaration, objects.map(o => o.sha256));
        await this.affected(c, `INSERT INTO ${s}.audit_records(audit_record_id,actor_type,actor_id,action,object_type,object_id,request_id,facts) VALUES($1,'operator',$2,'material.declaration_saved','material_variant',$3,$4,$5)`, [randomUUID(), a.operator.operatorId, r.variantId, r.metadata.requestId, { revision, status: reason === null ? "candidate" : "pending_validation", eligibilityReason: reason }]);
      }
      await this.affected(c, `INSERT INTO ${s}.material_registry_commands(actor_id,request_key,payload_digest,variant_id) VALUES($1,$2,$3,$4)`, [a.operator.operatorId, metadata.idempotencyKey, digest, r.variantId]);
      const saved = await this.load(c, r.variantId); if (!saved) return invalid();
      if (!unchanged) {
        const project = (await c.query<{ fact_version: string }>(`SELECT fact_version::text FROM ${s}.projects WHERE project_id=$1`, [r.projectId])).rows[0];
        if (!project) throw stale();
        await appendMaterialRevisionChanged(c, { projectId: r.projectId, variantId: r.variantId,
          projectVersion: Number(project.fact_version), materialRevision: saved.currentRevision });
      }
      return { ...saved, changed: !unchanged, replayed: false };
    });
  }
  async saveBatch(token: string, csrf: string, input: unknown) {
    const parsed = z.strictObject({ items: z.array(z.unknown()).min(1).max(50) }).safeParse(input);
    if (!parsed.success) throw new ProductTransactionError("INPUT_INVALID", "Invalid explicit material batch");
    const results = [];
    // Independent explicit items; a rejected item never blocks later items.
    // No cross-page selection, auto grouping or all-or-nothing success claim.
    for (const [index, item] of parsed.data.items.entries()) {
      try { results.push({ index, outcome: "saved" as const, material: await this.save(token, csrf, item) }); }
      catch (e) {
        const code = e instanceof MaterialRegistryError || e instanceof ProductTransactionError ? e.code : "INTERNAL_ERROR";
        results.push({ index, outcome: "rejected" as const, error: { code, retryable: e instanceof ProductTransactionError ? e.retryable : code === "VERIFIER_UNAVAILABLE" } });
      }
    }
    return { results }; // Saved means declaration saved; candidate is selection eligibility, never publication authorization.
  }
  private async affected(c: PoolClient, sql: string, values: unknown[]) { if ((await c.query(sql, values)).rowCount !== 1) throw new ProductTransactionError("INTERNAL_ERROR", "Material registry unavailable", true); }
}
