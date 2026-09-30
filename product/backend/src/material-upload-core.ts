import { z } from "zod";
import { requestMetadataSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { materialObjectReferenceSchema } from "./material-registry-core.js";
const id = uuidSchema.transform(v => v.toLowerCase());
export const materialUploadPrepareSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: id, objectId: id,
  sha256: materialObjectReferenceSchema.shape.sha256, bytes: materialObjectReferenceSchema.shape.bytes, contentType: materialObjectReferenceSchema.shape.contentType });
export const materialUploadCommandSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: id, objectId: id });
export const materialUploadDescriptorSchema = materialObjectReferenceSchema;
export class MaterialUploadError extends Error {
  constructor(readonly code: "CONFIGURATION_REQUIRED" | "INVALID_BYTES" | "STORAGE_UNAVAILABLE" | "OBJECT_CONFLICT" | "CORRUPT_TICKET", readonly retryable = false) { super(code); }
}
