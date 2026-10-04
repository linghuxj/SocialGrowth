import { z } from "zod";
import { requestMetadataSchema, requestIdSchema, timestampSchema, uuidSchema } from "./common.js";
import { projectPlanningInputsSchema } from "./project-planning.js";

const intervalDays = z.int().min(1).max(366);
const trafficMinimum = z.int().min(0);
const zone = projectPlanningInputsSchema.shape.businessTimeZone.unwrap();

export const projectCycleCurrentFactSchema = z.strictObject({
  cycleId: uuidSchema,
  cycleNumber: z.int().min(1),
  configVersion: z.int().min(1),
  businessTimeZone: zone,
  reviewIntervalDays: intervalDays,
  trafficMinimumPerCycle: trafficMinimum,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
});

export const projectCycleNextConfigurationSchema = z.strictObject({
  configurationRevision: z.int().min(1),
  basedOnCycleId: uuidSchema,
  businessTimeZone: zone,
  reviewIntervalDays: intervalDays,
  trafficMinimumPerCycle: trafficMinimum,
  effectiveStartsAt: timestampSchema,
  projectedEndsAt: timestampSchema,
  confirmedByOperatorId: uuidSchema,
  confirmedAt: timestampSchema,
  requestId: requestIdSchema,
});

export const projectCycleOriginSchema = z.union([
  z.strictObject({ kind: z.literal("initial_direction_approval"), approvalId: uuidSchema }),
  z.strictObject({ kind: z.literal("confirmed_next_configuration"), configurationRevision: z.int().min(1) }),
  z.strictObject({ kind: z.literal("carry_forward"), predecessorCycleId: uuidSchema }),
]);

export const projectCycleCurrentReadFactSchema = projectCycleCurrentFactSchema.extend({
  recordedAt: timestampSchema,
  origin: projectCycleOriginSchema,
});

export const projectCycleConfigurationApplicationSchema = z.strictObject({
  state: z.enum(["pending", "applied", "unresolved"]),
  materializedCycleId: uuidSchema.nullable(),
  reason: z.enum([
    "predecessor_missing",
    "source_missing",
    "configuration_already_consumed",
    "calendar_runtime_unavailable",
    "outside_verified_calendar_range",
    "civil_boundary_ambiguous",
    "window_preview_mismatch",
    "project_ended",
    "tail_window_unconfigured",
  ]).nullable(),
}).superRefine((value, ctx) => {
  if ((value.state === "applied") !== (value.materializedCycleId !== null)) {
    ctx.addIssue({ code: "custom", path: ["materializedCycleId"], message: "Only an applied configuration names its unique successor cycle" });
  }
  if ((value.state === "unresolved") !== (value.reason !== null)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Only an unresolved configuration includes a reason" });
  }
});

// GET-only projection. Keep the persisted POST receipt schema above immutable.
export const projectCycleNextConfigurationReadSchema = projectCycleNextConfigurationSchema.extend({
  application: projectCycleConfigurationApplicationSchema,
});

export const projectCycleConfigurationUnresolvedReasonSchema = z.enum([
  "current_cycle_missing",
  "current_cycle_stale",
  "previous_window_elapsed",
  "calendar_runtime_unavailable",
  "outside_verified_calendar_range",
  "civil_boundary_ambiguous",
]);

export const projectCycleConfigurationReadResponseSchema = z.strictObject({
  contractVersion: requestMetadataSchema.shape.contractVersion,
  projectId: uuidSchema,
  observedAt: timestampSchema,
  configurationRevision: z.int().min(0),
  currentCycle: projectCycleCurrentReadFactSchema.nullable(),
  nextConfiguration: projectCycleNextConfigurationReadSchema.nullable(),
  // A confirmed next configuration is not a materialized successor cycle.
  nextCycle: z.null(),
  executionAllowed: z.literal(false),
  publicationAllowed: z.literal(false),
});

export const saveProjectCycleConfigurationRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  expectedConfigurationRevision: z.int().min(0),
  businessTimeZone: zone,
  reviewIntervalDays: intervalDays,
  trafficMinimumPerCycle: trafficMinimum,
});

export const saveProjectCycleConfigurationReceiptSchema = z.strictObject({
  projectId: uuidSchema,
  outcome: z.enum(["confirmed", "unchanged", "unresolved"]),
  configurationRevision: z.int().min(0),
  nextConfiguration: projectCycleNextConfigurationSchema.nullable(),
  reason: projectCycleConfigurationUnresolvedReasonSchema.nullable(),
  requestId: requestIdSchema,
  replayed: z.boolean(),
  recordedAt: timestampSchema,
  executionAllowed: z.literal(false),
  publicationAllowed: z.literal(false),
}).superRefine((receipt, ctx) => {
  if ((receipt.outcome === "unresolved") !== (receipt.reason !== null)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Only unresolved results include a reason" });
  }
  if ((receipt.outcome === "confirmed" || receipt.outcome === "unchanged") && receipt.nextConfiguration === null) {
    ctx.addIssue({ code: "custom", path: ["nextConfiguration"], message: "Confirmed config receipt requires the authoritative config fact" });
  }
});

export const projectCycleConfigurationCommandReadResponseSchema = z.strictObject({
  status: z.enum(["not_found", "found"]),
  projectId: uuidSchema,
  requestId: requestIdSchema.nullable(),
  receipt: saveProjectCycleConfigurationReceiptSchema.nullable(),
}).superRefine((view, ctx) => {
  if (view.status === "found" ? view.receipt === null || view.requestId !== view.receipt.requestId
    : view.receipt !== null || view.requestId !== null) {
    ctx.addIssue({ code: "custom", message: "Command lookup status and receipt must agree" });
  }
  if (view.receipt?.replayed) ctx.addIssue({ code: "custom", path: ["receipt", "replayed"], message: "Command lookup returns the original receipt" });
});

export type ProjectCycleCurrentFact = z.infer<typeof projectCycleCurrentFactSchema>;
export type ProjectCycleNextConfiguration = z.infer<typeof projectCycleNextConfigurationSchema>;
export type ProjectCycleOrigin = z.infer<typeof projectCycleOriginSchema>;
export type ProjectCycleCurrentReadFact = z.infer<typeof projectCycleCurrentReadFactSchema>;
export type ProjectCycleConfigurationApplication = z.infer<typeof projectCycleConfigurationApplicationSchema>;
export type ProjectCycleNextConfigurationRead = z.infer<typeof projectCycleNextConfigurationReadSchema>;
export type ProjectCycleConfigurationReadResponse = z.infer<typeof projectCycleConfigurationReadResponseSchema>;
export type SaveProjectCycleConfigurationRequest = z.infer<typeof saveProjectCycleConfigurationRequestSchema>;
export type SaveProjectCycleConfigurationReceipt = z.infer<typeof saveProjectCycleConfigurationReceiptSchema>;
export type ProjectCycleConfigurationCommandReadResponse = z.infer<typeof projectCycleConfigurationCommandReadResponseSchema>;
