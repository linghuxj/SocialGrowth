import { z } from "zod";
import { requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";

const version = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveVersion = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const windowSchema = z.strictObject({ startsAt: timestampSchema, endsAt: timestampSchema });

export const businessPlanTaskSchema = z.strictObject({
  taskId: uuidSchema,
  revision: positiveVersion,
  contentUnitId: uuidSchema,
  variantId: uuidSchema,
  materialRevision: positiveVersion,
  identityId: uuidSchema,
  platform: z.enum(["facebook", "youtube"]),
  form: z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]),
  languageTag: z.string().regex(/^[a-z]{2,8}(-[a-z0-9]{1,8})*$/),
  scheduledAt: timestampSchema,
  state: z.literal("pending_current_checks"),
});

export const businessPlanCurrentViewSchema = z.strictObject({
  projectId: uuidSchema,
  currentScope: z.strictObject({
    projectVersion: version,
    approvalId: uuidSchema.nullable(),
    window: windowSchema.nullable(),
  }),
  plan: z.strictObject({
    planId: uuidSchema,
    revision: positiveVersion,
    projectVersion: version,
    approvalId: uuidSchema,
    window: windowSchema,
    scopeState: z.enum(["current", "stale"]),
    recordedAt: timestampSchema,
  }).nullable(),
  tasks: z.array(businessPlanTaskSchema),
  executionAllowed: z.literal(false),
  publicationAllowed: z.literal(false),
}).superRefine((value, ctx) => {
  if (value.plan === null && value.tasks.length) ctx.addIssue({ code: "custom", message: "Tasks require a current plan record" });
  if (value.plan && value.plan.projectVersion > value.currentScope.projectVersion) ctx.addIssue({ code: "custom", message: "Plan cannot be ahead of current project facts" });
});

export const readBusinessPlanResponseSchema = businessPlanCurrentViewSchema;

export const arrangeBusinessPlanRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  expectedProjectVersion: version,
  expectedApprovalId: uuidSchema,
  expectedPlanRevision: version,
});

export const arrangeBusinessPlanResponseSchema = businessPlanCurrentViewSchema.extend({
  outcome: z.enum(["planned", "unchanged", "insufficient_data", "direction_confirmation_required"]),
  requestId: uuidSchema,
});

export type BusinessPlanTask = z.infer<typeof businessPlanTaskSchema>;
export type BusinessPlanCurrentView = z.infer<typeof businessPlanCurrentViewSchema>;
export type ArrangeBusinessPlanRequest = z.infer<typeof arrangeBusinessPlanRequestSchema>;
