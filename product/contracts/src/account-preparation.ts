import { z } from "zod";
import { requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";
import { executionLibraryVersion, preparationOperationIdSchema, preparationTargetSchema } from "./execution-library.js";

const ref = z.string().regex(/^[A-Za-z0-9_-]{1,150}$(?![\s\S])/);
const version = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const metadata = requestMetadataSchema.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$(?![\s\S])/) });
export const accountPreparationIntentSchema = z.strictObject({
  accountId: uuidSchema.nullable(), deviceId: uuidSchema.nullable(), parentLoginRef: ref.nullable().optional(),
  mode: z.enum(["check_only", "prepare_if_missing"]), target: preparationTargetSchema,
  scopeRef: ref, allowTrustedInstall: z.boolean(), allowIdentityCreation: z.boolean(),
});
export const requestAccountPreparationSchema = z.strictObject({ metadata,
  protocolVersion: z.literal(executionLibraryVersion), projectId: uuidSchema,
  expectedProjectVersion: version, expectedResourceVersion: version,
  intent: accountPreparationIntentSchema.extend({ accountId: uuidSchema, deviceId: uuidSchema, parentLoginRef: z.null().optional() }),
});
export const recheckAccountPreparationSchema = z.strictObject({ metadata,
  protocolVersion: z.literal(executionLibraryVersion), projectId: uuidSchema, taskId: uuidSchema, expectedTaskVersion: version,
  expectedResourceVersion: version, selectedAccountId: uuidSchema.nullable(), selectedDeviceId: uuidSchema.nullable(),
});
// A durable admission review, NOT a device dispatch or a caller permission.
export const reviewAccountPreparationExecutionSchema = z.strictObject({ metadata,
  protocolVersion: z.literal(executionLibraryVersion), projectId: uuidSchema, taskId: uuidSchema,
  expectedTaskVersion: version, expectedResourceVersion: version,
});
export const accountPreparationExecutionReviewSchema = z.strictObject({
  reviewId: uuidSchema, projectId: uuidSchema, taskId: uuidSchema, taskVersion: version, resourceVersion: version,
  reviewedBy: uuidSchema, reviewedAt: timestampSchema, state: z.literal("blocked"),
  nextOperationId: preparationOperationIdSchema.nullable(), blockers: z.array(ref).min(1).max(20),
  actionPermissionGranted: z.literal(false), dispatchCreated: z.literal(false), publicationAllowed: z.literal(false),
});
export const accountPreparationOriginalOperationSchema = z.strictObject({
  taskId: uuidSchema, taskVersion: version, taskAttemptId: uuidSchema, operationId: preparationOperationIdSchema,
  traceId: uuidSchema.nullable(), claimedAt: timestampSchema,
  latestObservation: z.strictObject({ state: z.enum(["running", "launch_unknown", "reported", "needs_human", "result_unknown", "stop_unconfirmed"]),
    receivedAt: timestampSchema, evidenceIds: z.array(uuidSchema).max(20) }).nullable(),
  identityVerified: z.literal(false), publicationAllowed: z.literal(false),
});
export const accountPreparationTaskViewSchema = z.strictObject({
  taskId: uuidSchema, projectId: uuidSchema, taskVersion: version, intent: accountPreparationIntentSchema,
  selectedAccountId: uuidSchema.nullable(), selectedDeviceId: uuidSchema.nullable(),
  state: z.enum(["waiting_resources", "waiting_executor", "needs_reconciliation"]),
  nextOperationId: preparationOperationIdSchema.nullable(), blockers: z.array(ref).min(1).max(10),
  requestedBy: uuidSchema, requestedAt: timestampSchema, checkedAt: timestampSchema,
  actionPermissionGranted: z.literal(false), publicationAllowed: z.literal(false), acceptanceStarted: z.literal(false),
});
export const accountPreparationWorkspaceSchema = z.strictObject({
  protocolVersion: z.literal(executionLibraryVersion), projectId: uuidSchema,
  projectVersion: version, resourceVersion: version,
  tasks: z.array(accountPreparationTaskViewSchema).max(50),
  accounts: z.array(z.strictObject({ accountId: uuidSchema, platform: z.enum(["facebook", "youtube"]) })).max(100),
  devices: z.array(z.strictObject({ deviceId: uuidSchema })).max(100),
  executionReviews: z.array(accountPreparationExecutionReviewSchema).max(50),
  originalOperations: z.array(accountPreparationOriginalOperationSchema).max(100),
});
export type AccountPreparationIntent = z.infer<typeof accountPreparationIntentSchema>;
export type AccountPreparationTaskView = z.infer<typeof accountPreparationTaskViewSchema>;
export type AccountPreparationWorkspace = z.infer<typeof accountPreparationWorkspaceSchema>;
export type AccountPreparationExecutionReview = z.infer<typeof accountPreparationExecutionReviewSchema>;
