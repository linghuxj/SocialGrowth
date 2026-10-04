import { z } from "zod";
import { requestIdSchema, requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";

export const projectLifecycleIntentSchema = z.enum(["pause_requested", "resume_requested", "end_requested"]);
export const projectLifecycleCommandSchema = z.enum(["pause", "resume", "end"]);
export const projectLifecycleIntentViewSchema = z.strictObject({
  projectId: uuidSchema,
  lifecycleRevision: z.int().min(0),
  intent: projectLifecycleIntentSchema.nullable(),
  requestId: requestIdSchema.nullable(),
  recordedAt: timestampSchema.nullable(),
});
export const updateProjectLifecycleIntentRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  expectedLifecycleRevision: z.int().min(0),
  intent: projectLifecycleCommandSchema,
});
export const updateProjectLifecycleIntentResponseSchema = z.strictObject({
  projectId: uuidSchema,
  lifecycleRevision: z.int().min(1),
  intent: projectLifecycleIntentSchema,
  requestId: requestIdSchema,
  recordedAt: timestampSchema,
  changed: z.boolean(),
  replayed: z.boolean(),
  impactedTaskCount: z.int().min(0),
  cancelledTaskCount: z.int().min(0),
});

export const materialWithdrawalViewSchema = z.strictObject({
  state: z.enum(["not_withdrawn", "withdrawn"]),
  materialRevision: z.int().min(1).nullable(),
  requestId: requestIdSchema.nullable(),
  recordedAt: timestampSchema.nullable(),
}).refine(v => v.state === "withdrawn"
  ? v.materialRevision !== null && v.requestId !== null && v.recordedAt !== null
  : v.materialRevision === null && v.requestId === null && v.recordedAt === null,
"Inconsistent material withdrawal facts");
export const withdrawMaterialRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  expectedMaterialRevision: z.int().min(1).max(1000),
});
export const withdrawMaterialResponseSchema = z.strictObject({
  projectId: uuidSchema,
  variantId: uuidSchema,
  materialRevision: z.int().min(1).max(1000),
  requestId: requestIdSchema,
  changed: z.boolean(),
  replayed: z.boolean(),
  impactedTaskCount: z.int().min(0),
  cancelledTaskCount: z.int().min(0),
});
