import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { materialUploadContentTypeSchema } from "./material-upload.js";

const version = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const objectBytes = z.int().min(1).max(128 * 1024 * 1024);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.strictObject({ objectId: uuidSchema, sha256, bytes: objectBytes, contentType: materialUploadContentTypeSchema });
const taskWorkflowState = z.enum(["blocked", "queued", "claimed", "running", "submission_unknown", "verified", "not_published", "failed"]);
const operationState = z.enum(["queued", "claimed", "running", "submission_unknown", "verified", "not_published", "failed"]);
const submissionState = z.enum(["not_started", "in_progress", "unknown", "verified_published", "verified_not_published"]);
const recheckStatus = z.enum(["not_requested", "pending", "verified_recovered", "still_blocked", "unknown"]);
const blocker = z.string().min(1).max(120).refine(value => value.trim() === value);

export const businessPlanWorkflowTaskSchema = z.strictObject({
  taskId: uuidSchema,
  taskRevision: version,
  planId: uuidSchema,
  planRevision: version,
  contentUnitId: uuidSchema,
  variantId: uuidSchema,
  materialRevision: version,
  expectedFiles: z.array(file).max(20),
  identityId: uuidSchema,
  platform: z.enum(["facebook", "youtube"]),
  form: z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]),
  scheduledAt: timestampSchema,
  attempt: z.strictObject({ taskAttemptId: uuidSchema, attemptNumber: z.literal(1), state: z.literal("pending_current_checks") }).nullable(),
  operation: z.strictObject({ operationId: z.string().min(1).max(200), state: operationState }).nullable(),
  workflow: z.strictObject({
    state: taskWorkflowState,
    claimId: uuidSchema.nullable(),
    leaseUntil: timestampSchema.nullable(),
    blockers: z.array(blocker).max(64),
    submissionState,
    verifiedResult: z.strictObject({ resultId: z.string().min(1).max(200), verifiedAt: timestampSchema }).nullable(),
  }),
  assistanceTodoId: uuidSchema.nullable(),
  recheckStatus,
  recheckBlockers: z.array(blocker).max(32),
});

export const businessPlanWorkflowResponseSchema = z.strictObject({
  projectId: uuidSchema,
  checkedAt: timestampSchema,
  ports: z.strictObject({ executor: z.enum(["connected", "unconnected"]), proofVerifier: z.enum(["connected", "unconnected"]) }),
  tasks: z.array(businessPlanWorkflowTaskSchema).max(1000),
});

export type BusinessPlanWorkflowTask = z.infer<typeof businessPlanWorkflowTaskSchema>;
export type BusinessPlanWorkflowResponse = z.infer<typeof businessPlanWorkflowResponseSchema>;
