import { z } from "zod";
import { materialHumanIdentitySchema, materialHumanDeclarationSchema, saveMaterialDeclarationRequestSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
export const materialIdentitySchema = materialHumanIdentitySchema.transform(v => ({ ...v, businessEntityId: v.businessEntityId.toLowerCase(), seriesId: v.seriesId?.toLowerCase() ?? null }));
export const materialDeclarationSchema = materialHumanDeclarationSchema.transform(v => ({ ...v, sourceEvidenceIds: v.sourceEvidenceIds.map(id => id.toLowerCase()) }));
export const materialSaveSchema = saveMaterialDeclarationRequestSchema.transform(v => ({ ...v, projectId: v.projectId.toLowerCase(), contentUnitId: v.contentUnitId.toLowerCase(),
  sourceId: v.sourceId.toLowerCase(), sourceRecordId: v.sourceRecordId.toLowerCase(), variantId: v.variantId.toLowerCase(), languageTag: v.languageTag.toLowerCase(),
  identity: materialIdentitySchema.parse(v.identity), declaration: materialDeclarationSchema.parse(v.declaration), objectIds: v.objectIds.map(id => id.toLowerCase()) }));
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
