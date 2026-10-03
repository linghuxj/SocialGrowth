import { z } from "zod";
import { compareTimestamps, requestMetadataSchema, requestTraceSchema, timestampSchema, uuidSchema } from "./common.js";
import { productErrorResponseSchema } from "./errors.js";
import { materialUploadContentTypeSchema } from "./material-upload.js";
import { materialWithdrawalViewSchema } from "./project-lifecycle.js";
const text = (max: number) => z.string().min(1).max(max).refine(v => v.trim() === v && !Array.from(v).some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127));
const uniqueIds = (ids: string[]) => new Set(ids.map(id => id.toLowerCase())).size === ids.length;
export const materialHumanIdentitySchema = z.strictObject({ mediaKind: z.enum(["video", "image_text"]), businessKind: z.enum(["product", "drama"]),
  businessEntityId: uuidSchema, seriesId: uuidSchema.nullable(), episodeNumber: z.int().min(1).nullable() }).refine(v =>
  (v.seriesId === null) === (v.episodeNumber === null) && (v.seriesId === null || (v.mediaKind === "video" && v.businessKind === "drama")), "Invalid explicit episode identity");
const humanDeclarationFields = { name: text(150), description: text(5000), businessFacts: text(5000), sourceStatement: text(5000),
  sourceEvidenceIds: z.array(uuidSchema).min(1).max(20), firstUseDeclaration: z.literal("declared_not_previously_published") };
export const materialHumanDeclarationSchema = z.strictObject({ ...humanDeclarationFields, expectedApprovedDirectionId: uuidSchema.nullable().optional(),
  expectedApprovedProjectVersion: z.int().min(0).nullable().optional(), contentRulesReviewed: z.boolean().optional() })
  .refine(v => uniqueIds(v.sourceEvidenceIds), "Duplicate evidence identity");
export const materialHumanDeclarationViewSchema = z.strictObject({ ...humanDeclarationFields, expectedApprovedDirectionId: uuidSchema.nullable(),
  expectedApprovedProjectVersion: z.int().min(0).nullable(), contentRulesReviewed: z.boolean() }).refine(v => uniqueIds(v.sourceEvidenceIds), "Duplicate evidence identity");
export const saveMaterialDeclarationRequestSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: uuidSchema, contentUnitId: uuidSchema,
  sourceId: uuidSchema, sourceRecordId: uuidSchema, identity: materialHumanIdentitySchema, variantId: uuidSchema,
  languageTag: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/).max(100), expectedCurrentRevision: z.int().min(0).max(1000),
  declaration: materialHumanDeclarationSchema, objectIds: z.array(uuidSchema).min(1).max(20) }).refine(v => uniqueIds(v.objectIds) && (v.identity.mediaKind !== "video" || v.objectIds.length === 1), "Invalid explicit object list");
const objectView = z.strictObject({ objectId: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.int().min(1).max(128 * 1024 * 1024), contentType: materialUploadContentTypeSchema });
export const materialEligibilityReasonSchema = z.enum(["direction_not_approved", "approved_direction_stale", "language_not_targeted", "no_approved_content_form",
  "scope_confirmation_missing", "scope_confirmation_stale", "content_rules_need_human_check", "source_record_conflict", "exact_sha_collision"]);
const fields = { projectId: uuidSchema, contentUnitId: uuidSchema, sourceId: uuidSchema, sourceRecordId: uuidSchema, identity: materialHumanIdentitySchema,
  variantId: uuidSchema, languageTag: z.string().regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/).max(100), currentRevision: z.int().min(1).max(1000),
  declaration: materialHumanDeclarationViewSchema, objects: z.array(objectView).min(1).max(20),
  recordedAt: timestampSchema.refine(v => !v.startsWith("0000-"), "Invalid recorded year"), status: z.enum(["pending_validation", "candidate"]),
  candidateAllowed: z.boolean(), eligibilityReason: materialEligibilityReasonSchema.nullable(), publicationAllowed: z.literal(false),
  withdrawal: materialWithdrawalViewSchema.nullable() };
function validObjects(v: { identity: { mediaKind: string }; objects: { objectId: string; contentType: string }[]; status: string; candidateAllowed: boolean; eligibilityReason: string | null }) {
  return uniqueIds(v.objects.map(o => o.objectId)) && (v.identity.mediaKind !== "video" || v.objects.length === 1)
    && v.objects.every(o => v.identity.mediaKind === "video" ? !o.contentType.startsWith("image/") : o.contentType !== "video/mp4")
    && ((v.status === "candidate") === v.candidateAllowed) && ((v.status === "candidate") === (v.eligibilityReason === null));
}
export const materialCurrentViewSchema = z.strictObject(fields).refine(validObjects, "Invalid explicit current object list");
export const saveMaterialDeclarationResponseSchema = z.strictObject({ ...fields, changed: z.boolean(), replayed: z.boolean() }).refine(v => validObjects(v) && !(v.changed && v.replayed), "Inconsistent material save result");
// Each item has its own metadata/idempotency key; the envelope is a trace only.
// Unknown items are intentionally validated independently, not eager all-or-none.
export const batchMaterialDeclarationsRequestSchema = z.strictObject({ metadata: requestTraceSchema, projectId: uuidSchema, items: z.array(z.unknown()).min(1).max(50) });
export const batchMaterialDeclarationsResponseSchema = z.strictObject({ projectId: uuidSchema, results: z.array(z.discriminatedUnion("outcome", [
  z.strictObject({ index: z.int().min(0).max(49), outcome: z.literal("saved"), material: saveMaterialDeclarationResponseSchema }),
  z.strictObject({ index: z.int().min(0).max(49), outcome: z.literal("rejected"), error: productErrorResponseSchema.shape.error }),
])).min(1).max(50) }).refine(v => v.results.every((r, index) => r.index === index && (r.outcome !== "saved" || r.material.projectId.toLowerCase() === v.projectId.toLowerCase())), "Invalid explicit batch results");
export const materialHistoryQuerySchema = z.strictObject({ afterRevision: z.int().min(0).max(1000), pageSize: z.int().min(1).max(50) });
const revisionView = z.strictObject({ revision: fields.currentRevision, declaration: materialHumanDeclarationViewSchema, objects: fields.objects, recordedAt: fields.recordedAt, status: z.literal("pending_validation") });
export const materialHistoryResponseSchema = z.strictObject({ current: materialCurrentViewSchema, revisions: z.array(revisionView).max(50), nextAfterRevision: fields.currentRevision.nullable() }).refine(v => {
  const last = v.revisions.at(-1);
  if (v.nextAfterRevision !== (last && last.revision < v.current.currentRevision ? last.revision : null)) return false;
  if (!v.revisions.every((r, i) => r.revision <= v.current.currentRevision && (!i || r.revision === v.revisions[i - 1]!.revision + 1)
    && validObjects({ identity: v.current.identity, objects: r.objects, status: "pending_validation", candidateAllowed: false, eligibilityReason: "direction_not_approved" })
    && compareTimestamps(r.recordedAt, v.current.recordedAt)! <= 0
    && (!i || compareTimestamps(v.revisions[i - 1]!.recordedAt, r.recordedAt)! <= 0))) return false;
  return !last || last.revision !== v.current.currentRevision || (compareTimestamps(last.recordedAt, v.current.recordedAt) === 0
    && JSON.stringify(last.declaration) === JSON.stringify(v.current.declaration) && JSON.stringify(last.objects) === JSON.stringify(v.current.objects));
}, "Inconsistent material history page");
export const materialLibraryQuerySchema = z.strictObject({ afterVariantId: uuidSchema.nullable(), pageSize: z.int().min(1).max(50) });
export const materialLibraryResponseSchema = z.strictObject({ projectId: uuidSchema, materials: z.array(materialCurrentViewSchema).max(50), nextAfterVariantId: uuidSchema.nullable() }).refine(v =>
  v.materials.every((m, i) => m.projectId.toLowerCase() === v.projectId.toLowerCase() && (!i || v.materials[i - 1]!.variantId.toLowerCase() < m.variantId.toLowerCase()))
  && (v.nextAfterVariantId === null || v.nextAfterVariantId.toLowerCase() === v.materials.at(-1)?.variantId.toLowerCase()), "Inconsistent material library page");
