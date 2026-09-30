import { prepareMaterialUploadRequestSchema, uploadMaterialBytesCommandSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { materialObjectReferenceSchema } from "./material-registry-core.js";
const id = uuidSchema.transform(v => v.toLowerCase());
export const materialUploadPrepareSchema = prepareMaterialUploadRequestSchema.extend({ projectId: id, objectId: id });
export const materialUploadCommandSchema = uploadMaterialBytesCommandSchema.extend({ projectId: id, objectId: id });
export const materialUploadDescriptorSchema = materialObjectReferenceSchema;
export class MaterialUploadError extends Error {
  constructor(readonly code: "CONFIGURATION_REQUIRED" | "INVALID_BYTES" | "STORAGE_UNAVAILABLE" | "OBJECT_CONFLICT" | "CORRUPT_TICKET", readonly retryable = false) { super(code); }
}
