import { z } from "zod";

export const id = z.string().trim().min(1).max(256);
export const instant = z.string().datetime({ offset: true });
export const platform = z.enum(["facebook", "youtube"]);
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const bindingSchema = z
  .object({
    id,
    deviceId: id,
    serial: z.string().regex(/^[A-Za-z0-9._:-]+$/),
    platform,
    accountId: id,
    platformIdentity: id,
    authorizationRef: id,
    automationScopeRef: id,
    verifiedAt: instant,
    validUntil: instant,
  })
  .strict()
  .refine((b) => !b.serial.startsWith("emulator-"), "PHYSICAL_DEVICE_REQUIRED");
export type Binding = z.infer<typeof bindingSchema>;

export const settingsSchema = z
  .object({
    scheduleId: id,
    sliceId: id,
    bindingId: id,
    mode: z.enum(["preflight", "publish"]),
    captionText: z.string().trim().min(1).max(5000),
    audience: z.literal("public"),
    aiLabel: z.boolean(),
    aiLabelReason: id,
    madeForKids: z.boolean().optional(),
    rightsRef: id,
    musicRightsRef: id,
    publishAuthorizationRef: id.optional(),
    taskTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(15 * 60 * 1000)
      .default(300000),
  })
  .strict();
export type PublishSettings = z.infer<typeof settingsSchema>;

export const receiptSchema = z
  .object({
    schemaVersion: z.literal("design-v1"),
    eventId: id,
    taskId: id,
    attemptId: id,
    deviceId: id,
    accountId: id,
    occurredAt: instant,
    executionStatus: z.enum(["accepted", "running", "blocked", "completed", "failed"]),
    publishStatus: z.enum([
      "not_submitted",
      "in_progress",
      "unknown",
      "confirmed_not_published",
      "published",
    ]),
    evidenceRefs: z.array(id).max(30),
    publishedUrl: z.string().url().optional(),
    publishedPostId: id.optional(),
    failureCode: z
      .enum([
        "EXECUTOR_NOT_CONFIGURED",
        "DEVICE_UNAVAILABLE",
        "IDENTITY_CHALLENGE",
        "TECHNICAL_FAILURE",
        "DEADLINE_EXPIRED",
        "RECEIPT_CONFLICT",
      ])
      .optional(),
    challengeType: id.optional(),
    actionRequired: z.object({
      kind: z.enum(["account", "app"]),
      reason: id,
      expectedIdentity: id.optional(),
      observedIdentity: id.optional(),
      nextAction: z.string().min(1).max(1000),
    }).strict().optional(),
    resourceStatus: z.enum(["available", "busy", "offline", "error"]),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.publishStatus === "published" &&
      (!r.evidenceRefs.length || (!r.publishedUrl && !r.publishedPostId))
    )
      ctx.addIssue({ code: "custom", message: "PUBLICATION_EVIDENCE_REQUIRED" });
    if (r.publishStatus === "confirmed_not_published" && !r.evidenceRefs.length)
      ctx.addIssue({ code: "custom", message: "NONPUBLICATION_EVIDENCE_REQUIRED" });
    if (r.executionStatus === "failed" && !r.failureCode)
      ctx.addIssue({ code: "custom", message: "FAILURE_CODE_REQUIRED" });
  });

export const commandSchema = z
  .object({
    requestId: id,
    revision: z.number().int().nonnegative(),
    method: z.enum([
      "registerClient",
      "registerAccount",
      "updateClient",
      "updateAccountProfile",
      "cancelApproval",
      "cancelSchedule",
      "saveProjectDraft",
      "activateProject",
      "grantAccountServiceRelation",
      "revokeAccountServiceRelation",
      "admitContent",
      "admitContentBatch",
      "reviewAssetFit",
      "allocateContent",
      "releaseContent",
      "createDestination",
      "updateDestination",
      "applyDestinationExit",
      "addStrategyRule",
      "generateStrategyDraft",
      "approveStrategy",
      "scheduleApproval",
      "recordMetricObservation",
      "createBasicReview",
      "confirmReview",
      "exitProject",
    ]),
    args: z.array(z.unknown()).min(1).max(5),
  })
  .strict();

export class RuntimeError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export function requireFact(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RuntimeError(code);
}
