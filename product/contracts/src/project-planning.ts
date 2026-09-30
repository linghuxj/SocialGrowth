import { z } from "zod";
import { compareTimestamps, requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";
import { projectLabelSchema } from "./project.js";

// Human planning inputs, NOT an executable approved scope or an AI proposal.
// Empty arrays/null mean not configured, NEVER unrestricted or a demo default.
export const projectPlanningInputsSchema = z.strictObject({
  preOpeningGoal: projectLabelSchema.nullable(),
  postOpeningGoal: projectLabelSchema.nullable(),
  postOpeningPriority: z.enum(["revenue_first", "traffic_first", "balanced"]).nullable(),
  targetCountries: z.array(projectLabelSchema).max(50),
  targetLanguages: z.array(projectLabelSchema).max(50),
  contentForms: z.array(z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"])).max(4),
  contentRules: projectLabelSchema.nullable(),
  businessTimeZone: z.string().max(100).regex(/^(?:UTC|[A-Za-z_]+\/(?:[A-Za-z0-9_+-]+\/)*[A-Za-z0-9_+-]+)$/).nullable(),
  firstCycleStartsAt: timestampSchema.nullable(),
  reviewIntervalDays: z.int().min(1).nullable(),
  trafficMinimumPerCycle: z.int().min(0).nullable(),
  observationWindowHours: z.int().min(1).nullable(),
  tailObservationDays: z.int().min(0).nullable(),
  maxPublicationsPerDay: z.int().min(1).nullable(),
  publishingWindow: z.strictObject({ startsAt: timestampSchema, endsAt: timestampSchema }).nullable(),
}).superRefine((v, ctx) => {
  for (const key of ["targetCountries", "targetLanguages", "contentForms"] as const) {
    if (new Set(v[key]).size !== v[key].length) ctx.addIssue({ code: "custom", path: [key], message: "Duplicate planning input" });
  }
  if (v.businessTimeZone !== null) {
    try { new Intl.DateTimeFormat("en", { timeZone: v.businessTimeZone }).format(0); }
    catch { ctx.addIssue({ code: "custom", path: ["businessTimeZone"], message: "Unknown business time zone" }); }
  }
  if (v.publishingWindow && timestampSchema.safeParse(v.publishingWindow.startsAt).success && timestampSchema.safeParse(v.publishingWindow.endsAt).success
    && compareTimestamps(v.publishingWindow.startsAt, v.publishingWindow.endsAt) !== -1) ctx.addIssue({ code: "custom", path: ["publishingWindow"], message: "Publication window must be ordered, end exclusive" });
});
export type ProjectPlanningInputs = z.infer<typeof projectPlanningInputsSchema>;
export function emptyProjectPlanningInputs(): ProjectPlanningInputs {
  return { preOpeningGoal: null, postOpeningGoal: null, postOpeningPriority: null, targetCountries: [], targetLanguages: [], contentForms: [], contentRules: null,
    businessTimeZone: null, firstCycleStartsAt: null, reviewIntervalDays: null, trafficMinimumPerCycle: null, observationWindowHours: null,
    tailObservationDays: null, maxPublicationsPerDay: null, publishingWindow: null };
}
export const projectPlanningDraftViewSchema = z.strictObject({
  projectId: uuidSchema, projectFactVersion: z.int().min(0), draftVersion: z.int().min(0),
  inputs: projectPlanningInputsSchema, status: z.literal("unapproved_draft"),
  savedAt: timestampSchema.nullable(), savedByOperatorId: uuidSchema.nullable(),
}).superRefine((v, ctx) => {
  if ((v.draftVersion === 0) !== (v.savedAt === null && v.savedByOperatorId === null)
    || (v.savedAt === null) !== (v.savedByOperatorId === null)) ctx.addIssue({ code: "custom", message: "Draft save provenance is inconsistent" });
  if (v.draftVersion === 0 && JSON.stringify(v.inputs) !== JSON.stringify(emptyProjectPlanningInputs())) ctx.addIssue({ code: "custom", message: "Unsaved draft cannot claim stored inputs" });
});
export const projectPlanningResponseSchema = z.strictObject({ draft: projectPlanningDraftViewSchema });
export const saveProjectPlanningRequestSchema = z.strictObject({
  metadata: requestMetadataSchema, projectId: uuidSchema, expectedProjectVersion: z.int().min(0), expectedDraftVersion: z.int().min(0), inputs: projectPlanningInputsSchema,
});
export type ProjectPlanningDraftView = z.infer<typeof projectPlanningDraftViewSchema>;
