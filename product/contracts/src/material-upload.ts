import { z } from "zod";
import { compareTimestamps, requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";
const id = uuidSchema;
const iso = z.toJSONSchema(timestampSchema).pattern;
if (typeof iso !== "string" || !iso.startsWith("^")) throw new Error("Expected anchored ISO timestamp grammar");
const time = z.string().regex(new RegExp(iso.replace(/^\^/, "^(?!0000-)")));
export const materialUploadContentTypeSchema = z.enum(["application/octet-stream", "video/mp4", "image/jpeg", "image/png", "image/webp"]);
export const prepareMaterialUploadRequestSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: id, objectId: id,
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.int().min(1).max(128 * 1024 * 1024), contentType: materialUploadContentTypeSchema });
export const uploadMaterialBytesCommandSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: id, objectId: id });
const ticketFields = { projectId: id, objectId: id, sha256: prepareMaterialUploadRequestSchema.shape.sha256,
  bytes: prepareMaterialUploadRequestSchema.shape.bytes, contentType: materialUploadContentTypeSchema,
  status: z.enum(["pending_bytes", "verified_bytes"]), preparedAt: time, verifiedAt: time.nullable(),
  candidateAllowed: z.literal(false), publicationAllowed: z.literal(false) };
function validStatus(v: { status: string; preparedAt: string; verifiedAt: string | null }) {
  return (v.status === "verified_bytes") === (v.verifiedAt !== null)
    && (!v.verifiedAt || compareTimestamps(v.preparedAt, v.verifiedAt) === -1 || compareTimestamps(v.preparedAt, v.verifiedAt) === 0);
}
export const materialUploadTicketViewSchema = z.strictObject(ticketFields).refine(validStatus, "Inconsistent byte verification state");
export const prepareMaterialUploadResponseSchema = z.strictObject({ ...ticketFields, changed: z.boolean(), replayed: z.boolean() })
  .refine(v => validStatus(v) && !(v.changed && v.replayed), "Inconsistent upload result");
export const uploadMaterialBytesResponseSchema = prepareMaterialUploadResponseSchema.refine(v => v.status === "verified_bytes", "Upload acknowledgement requires verified bytes");
export type MaterialUploadTicketView = z.infer<typeof materialUploadTicketViewSchema>;
