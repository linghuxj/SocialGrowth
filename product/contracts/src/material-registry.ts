import { z } from "zod";
import { requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";
import { materialUploadContentTypeSchema } from "./material-upload.js";
const text = (max: number) => z.string().min(1).max(max).refine(v => v.trim() === v && !Array.from(v).some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127));
const uniqueIds = (ids: string[]) => new Set(ids.map(id => id.toLowerCase())).size === ids.length;
export const materialHumanIdentitySchema = z.strictObject({ mediaKind: z.enum(["video", "image_text"]), businessKind: z.enum(["product", "drama"]),
  businessEntityId: uuidSchema, seriesId: uuidSchema.nullable(), episodeNumber: z.int().min(1).nullable() }).refine(v =>
  (v.seriesId === null) === (v.episodeNumber === null) && (v.seriesId === null || (v.mediaKind === "video" && v.businessKind === "drama")), "Invalid explicit episode identity");
export const materialHumanDeclarationSchema = z.strictObject({ name: text(150), description: text(5000), businessFacts: text(5000), sourceStatement: text(5000),
  sourceEvidenceIds: z.array(uuidSchema).min(1).max(20), firstUseDeclaration: z.literal("declared_not_previously_published") }).refine(v => uniqueIds(v.sourceEvidenceIds), "Duplicate evidence identity");
export const saveMaterialDeclarationRequestSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: uuidSchema, contentUnitId: uuidSchema,
  sourceId: uuidSchema, sourceRecordId: uuidSchema, identity: materialHumanIdentitySchema, variantId: uuidSchema,
  languageTag: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/).max(100), expectedCurrentRevision: z.int().min(0).max(1000),
  declaration: materialHumanDeclarationSchema, objectIds: z.array(uuidSchema).min(1).max(20) }).refine(v => uniqueIds(v.objectIds) && (v.identity.mediaKind !== "video" || v.objectIds.length === 1), "Invalid explicit object list");
const objectView = z.strictObject({ objectId: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.int().min(1).max(128 * 1024 * 1024), contentType: materialUploadContentTypeSchema });
const fields = { projectId: uuidSchema, contentUnitId: uuidSchema, sourceId: uuidSchema, sourceRecordId: uuidSchema, identity: materialHumanIdentitySchema,
  variantId: uuidSchema, languageTag: z.string().regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/).max(100), currentRevision: z.int().min(1).max(1000),
  declaration: materialHumanDeclarationSchema, objects: z.array(objectView).min(1).max(20),
  recordedAt: timestampSchema.refine(v => !v.startsWith("0000-"), "Invalid recorded year"), status: z.literal("pending_validation"), candidateAllowed: z.literal(false), publicationAllowed: z.literal(false) };
function validObjects(v: { identity: { mediaKind: string }; objects: { objectId: string; contentType: string }[] }) {
  return uniqueIds(v.objects.map(o => o.objectId)) && (v.identity.mediaKind !== "video" || v.objects.length === 1)
    && v.objects.every(o => v.identity.mediaKind === "video" ? !o.contentType.startsWith("image/") : o.contentType !== "video/mp4");
}
export const materialCurrentViewSchema = z.strictObject(fields).refine(validObjects, "Invalid explicit current object list");
export const saveMaterialDeclarationResponseSchema = z.strictObject({ ...fields, changed: z.boolean(), replayed: z.boolean() }).refine(v => validObjects(v) && !(v.changed && v.replayed), "Inconsistent material save result");
