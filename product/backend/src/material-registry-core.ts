import { z } from "zod";
import { requestMetadataSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
const text = (max: number) => z.string().min(1).max(max).refine(v => v.trim() === v && !Array.from(v).some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127));
export const materialIdentitySchema = z.strictObject({ mediaKind: z.enum(["video", "image_text"]), businessKind: z.enum(["product", "drama"]),
  businessEntityId: id, seriesId: id.nullable(), episodeNumber: z.int().min(1).nullable() }).superRefine((v, c) => {
  if ((v.seriesId === null) !== (v.episodeNumber === null) || (v.seriesId !== null && (v.mediaKind !== "video" || v.businessKind !== "drama"))) c.addIssue({ code: "custom", message: "Invalid explicit episode identity" });
});
export const materialDeclarationSchema = z.strictObject({ name: text(150), description: text(5000), businessFacts: text(5000),
  sourceStatement: text(5000), sourceEvidenceIds: z.array(id).min(1).max(20), firstUseDeclaration: z.literal("declared_not_previously_published") });
export const materialSaveSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: id, contentUnitId: id, sourceId: id, sourceRecordId: id,
  identity: materialIdentitySchema, variantId: id, languageTag: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/).max(100).transform(v => v.toLowerCase()),
  expectedCurrentRevision: z.int().min(0).max(1000), declaration: materialDeclarationSchema, objectIds: z.array(id).min(1).max(20) }).superRefine((v, c) => {
  if (new Set(v.objectIds).size !== v.objectIds.length || new Set(v.declaration.sourceEvidenceIds).size !== v.declaration.sourceEvidenceIds.length
    || (v.identity.mediaKind === "video" && v.objectIds.length !== 1)) c.addIssue({ code: "custom", message: "Invalid explicit object/evidence list" });
});
export const materialObjectReferenceSchema = z.strictObject({ storageLocationId: id, storageBindingDigest: z.string().regex(/^[a-f0-9]{64}$/), projectId: id, objectId: id,
  key: z.string().regex(/^projects\/[a-f0-9-]{36}\/objects\/[a-f0-9-]{36}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.int().min(1).max(128 * 1024 * 1024),
  contentType: z.enum(["application/octet-stream", "video/mp4", "image/jpeg", "image/png", "image/webp"]) }).superRefine((v, c) => {
  if (v.key !== `projects/${v.projectId}/objects/${v.objectId}`) c.addIssue({ code: "custom", message: "Object scope mismatch" });
});
export type MaterialSave = z.infer<typeof materialSaveSchema>;
export function canonicalMaterial(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalMaterial).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalMaterial(v)}`).join(",")}}`;
}
