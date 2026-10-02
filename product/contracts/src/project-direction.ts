import { z } from "zod";
import { requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";
import { projectPlanningInputsSchema, type ProjectPlanningInputs } from "./project-planning.js";
const version = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(4000);
export const directionIdentitySchema = z.strictObject({ platform: z.enum(["facebook", "youtube"]), canonicalRef: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  declaredStage: z.enum(["before_monetization", "after_monetization"]) });
export const directionIdentitiesSchema = z.array(directionIdentitySchema).min(1).max(100).refine(v => new Set(v.map(i => `${i.platform}/${i.canonicalRef}`)).size === v.length, "Duplicate publishing identity");
// Initial strategy only. The model cannot edit the operator's bounded scope.
export const initialDirectionOutputSchema = z.strictObject({ direction: text, rationale: text, limitations: z.array(text).max(50) });
export const initialDirectionAutonomy = {
  withinScope: ["select_material", "match_identity", "schedule_time", "generate_copy", "adjust_unstarted_arrangements"],
  reconfirm: ["change_main_goal", "change_confirmed_direction", "exceed_scope"],
  constraints: ["content_platform_quota", "series_identity_order", "current_material_version", "current_phone_authorization_and_exclusivity"],
  feedback: "verified_comparable_metrics_only", execution: "task_readiness_required", beforeMonetizationPriority: "qualification_first_with_traffic",
} as const;
const autonomySchema = z.strictObject({ withinScope: z.tuple([z.literal("select_material"), z.literal("match_identity"), z.literal("schedule_time"), z.literal("generate_copy"), z.literal("adjust_unstarted_arrangements")]),
  reconfirm: z.tuple([z.literal("change_main_goal"), z.literal("change_confirmed_direction"), z.literal("exceed_scope")]),
  constraints: z.tuple([z.literal("content_platform_quota"), z.literal("series_identity_order"), z.literal("current_material_version"), z.literal("current_phone_authorization_and_exclusivity")]),
  feedback: z.literal("verified_comparable_metrics_only"), execution: z.literal("task_readiness_required"), beforeMonetizationPriority: z.literal("qualification_first_with_traffic") });
export function missingDirectionScopeFields(inputs: ProjectPlanningInputs, identities: z.infer<typeof directionIdentitiesSchema>): (keyof ProjectPlanningInputs)[] {
  const before = identities.some(i => i.declaredStage === "before_monetization"), after = identities.some(i => i.declaredStage === "after_monetization");
  return (Object.keys(inputs) as (keyof ProjectPlanningInputs)[]).filter(key => {
    if (key === "preOpeningGoal" && !before || (key === "postOpeningGoal" || key === "postOpeningPriority") && !after) return false;
    const value = inputs[key]; return value === null || Array.isArray(value) && value.length === 0;
  });
}
export const directionScopeSchema = z.strictObject({ inputs: projectPlanningInputsSchema, identities: directionIdentitiesSchema, autonomy: autonomySchema }).superRefine((v, ctx) => {
  if (missingDirectionScopeFields(v.inputs, v.identities).length) ctx.addIssue({ code: "custom", message: "Direction scope requires its applicable planning facts" });
  if (v.inputs.contentForms.some(form => !v.identities.some(i => i.platform === (form.startsWith("facebook_") ? "facebook" : "youtube")))) ctx.addIssue({ code: "custom", message: "Every content form needs an explicit identity scope" });
});
export const directionProposalSchema = z.strictObject({ proposalId: uuidSchema, projectId: uuidSchema, projectVersion: version, draftVersion: version,
  snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/), scope: directionScopeSchema, output: initialDirectionOutputSchema,
  generatedAt: timestampSchema, providerKey: z.string().min(1).max(100), modelKey: z.string().min(1).max(150), responseId: z.string().min(1).max(150) });
export const directionApprovalSchema = z.strictObject({ approvalId: uuidSchema, proposal: directionProposalSchema, confirmedByOperatorId: uuidSchema,
  confirmedByOperatorName: z.string().min(1).max(150), confirmedAt: timestampSchema, status: z.literal("approved_waiting_readiness") });
export const directionAttemptSchema = z.strictObject({ attemptId: uuidSchema, state: z.enum(["requested", "proposed", "unavailable", "facts_changed"]),
  proposalId: uuidSchema.nullable() }).refine(v => (v.state === "proposed") === (v.proposalId !== null), "Attempt result is inconsistent");
export const projectDirectionResponseSchema = z.strictObject({ projectId: uuidSchema, projectVersion: version,
  proposal: directionProposalSchema.nullable(), approval: directionApprovalSchema.nullable(), attempt: directionAttemptSchema.nullable(),
  blockers: z.array(text).max(50), executionAllowed: z.literal(false), publicationAllowed: z.literal(false) }).superRefine((v, ctx) => {
    if ([v.proposal, v.approval?.proposal].some(p => p && (p.projectId.toLowerCase() !== v.projectId.toLowerCase() || p.projectVersion > v.projectVersion))) ctx.addIssue({ code: "custom", message: "Direction belongs to different project facts" });
    if (v.approval && (v.proposal?.proposalId !== v.approval.proposal.proposalId || v.projectVersion <= v.approval.proposal.projectVersion)) ctx.addIssue({ code: "custom", message: "Approval history is inconsistent" });
  });
export const generateProjectDirectionRequestSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: uuidSchema,
  expectedProjectVersion: version, expectedDraftVersion: version, identities: directionIdentitiesSchema });
export const confirmProjectDirectionRequestSchema = z.strictObject({ metadata: requestMetadataSchema, projectId: uuidSchema,
  expectedProjectVersion: version, proposalId: uuidSchema, snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export type DirectionProposal = z.infer<typeof directionProposalSchema>;
export type ProjectDirectionView = z.infer<typeof projectDirectionResponseSchema>;
