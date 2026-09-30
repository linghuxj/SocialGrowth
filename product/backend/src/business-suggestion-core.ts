import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { ContentQuotaError, parseContentQuota, reserveContentQuota } from "./content-quota-core.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const version = z.int().min(1);
const text = z.string().trim().min(1).max(4000);
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const form = z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]);
const approval = z.strictObject({ approvalId: id, version, goalId: id, directionId: id });
const publication = z.strictObject({ taskId: id, contentUnitId: id, variantId: id, identityId: id, form, scheduledAt: time, title: text, caption: text });
const change = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("schedule"), publication }),
  z.strictObject({ kind: z.literal("cancel"), taskId: id, expectedVersion: version, reason: text }),
  z.strictObject({ kind: z.literal("reschedule"), taskId: id, expectedVersion: version, scheduledAt: time, reason: text }),
]);
const contextSchema = z.strictObject({ projectId: id, factSetId: id, factSetVersion: version, observedAt: time,
  projectState: z.enum(["active", "paused", "ended"]), approval: approval.nullable(),
  approvedWindow: z.strictObject({ startsAt: time, endsAt: time }).nullable(),
  approvedForms: z.array(form).max(4), approvedLanguages: z.array(text).max(50),
  // Central references only. UUIDs/versions do not establish actual truth.
  facts: z.array(z.strictObject({ factId: id, version, kind: z.enum(["goal", "material", "task", "metric"]), availability: z.enum(["available", "missing", "delayed"]) })).max(1000),
  materials: z.array(z.strictObject({ variantId: id, contentUnitId: id, materialVersion: version, language: text,
    state: z.enum(["candidate", "withdrawn", "needs_correction"]) })).max(1000),
  tasks: z.array(z.strictObject({ taskId: id, version, state: z.enum(["not_started", "in_platform_flow", "submission_unknown", "verified", "cancelled"]),
    contentUnitId: id, variantId: id, identityId: id, form, scheduledAt: time })).max(1000), quota: z.unknown(),
});
const common = { suggestionId: id, projectId: id, factSetId: id, factSetVersion: version, approval: approval.nullable(),
  basis: z.array(z.strictObject({ factId: id, version })).min(1).max(1000), explanation: text, limitations: z.array(text).max(100) };
export const businessSuggestionSchema = z.discriminatedUnion("decision", [
  z.strictObject({ ...common, decision: z.literal("maintain"), taskIds: z.array(id).max(1000) }),
  z.strictObject({ ...common, decision: z.literal("adjust"), changes: z.array(change).min(1).max(1000) }),
  z.strictObject({ ...common, decision: z.literal("insufficient_data"), missingFactIds: z.array(id).min(1).max(1000), taskIds: z.array(id).max(1000) }),
  z.strictObject({ ...common, decision: z.literal("requires_operator_confirmation"), proposedDirection: text }),
]);
export type BusinessSuggestionContext = z.infer<typeof contextSchema>;
export type BusinessSuggestion = z.infer<typeof businessSuggestionSchema>;
export class BusinessSuggestionError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "FACTS_INVALID" | "FACTS_STALE" | "APPROVAL_REQUIRED" | "OUT_OF_SCOPE" | "TASK_NOT_MUTABLE" | "DATA_INSUFFICIENT" | "QUOTA_CONFLICT") { super(code); }
}
function fail(code: BusinessSuggestionError["code"]): never { throw new BusinessSuggestionError(code); }
function unique<T>(values: T[], key: (v: T) => string, code: BusinessSuggestionError["code"]) {
  if (new Set(values.map(key)).size !== values.length) fail(code);
}
const platformOf = (value: z.infer<typeof form>) => value.startsWith("facebook_") ? "facebook" as const : "youtube" as const;
export function parseBusinessSuggestionContext(input: unknown): BusinessSuggestionContext {
  const c = contextSchema.safeParse(input); if (!c.success) return fail("FACTS_INVALID");
  const context = c.data;
  unique(context.facts, v => v.factId, "FACTS_INVALID"); unique(context.materials, v => v.variantId, "FACTS_INVALID");
  unique(context.tasks, v => v.taskId, "FACTS_INVALID"); unique(context.approvedForms, v => v, "FACTS_INVALID"); unique(context.approvedLanguages, v => v, "FACTS_INVALID");
  let quota;
  try { quota = parseContentQuota(context.quota); } catch { return fail("FACTS_INVALID"); }
  if (quota.units.some(u => u.projectId !== context.projectId) || quota.identities.some(i => i.projectId !== context.projectId)) return fail("FACTS_INVALID");
  for (const m of context.materials) if (!quota.variants.some(v => v.variantId === m.variantId && v.contentUnitId === m.contentUnitId)) return fail("FACTS_INVALID");
  for (const task of context.tasks) {
    const unit = quota.units.find(v => v.contentUnitId === task.contentUnitId);
    if (!unit || (unit.mediaKind === "image_text") !== (task.form === "facebook_image_text") || !quota.slots.some(v => v.taskId === task.taskId && v.contentUnitId === task.contentUnitId && v.variantId === task.variantId
      && v.identityId === task.identityId && v.platform === platformOf(task.form))) return fail("FACTS_INVALID");
  }
  if (context.approvedWindow && compareTimestamps(context.approvedWindow.startsAt, context.approvedWindow.endsAt)! >= 0) return fail("FACTS_INVALID");
  return { ...context, quota };
}
// INTERNAL pure suggestion check ONLY. No model call, approved-fact producer,
// persistence, task dispatch or execution permit. Inputs must later be resolved
// centrally and rechecked atomically when revisions become effective.
export function checkBusinessSuggestion(contextInput: unknown, suggestionInput: unknown, evaluatedAt: string) {
  const context = parseBusinessSuggestionContext(contextInput), p = businessSuggestionSchema.safeParse(suggestionInput), clock = time.safeParse(evaluatedAt);
  if (!p.success || !clock.success) return fail("INPUT_INVALID"); const suggestion = p.data;
  unique(suggestion.basis, v => v.factId, "INPUT_INVALID");
  if (compareTimestamps(context.observedAt, clock.data)! > 0 || suggestion.projectId !== context.projectId
    || suggestion.factSetId !== context.factSetId || suggestion.factSetVersion !== context.factSetVersion) return fail("FACTS_STALE");
  if (JSON.stringify(suggestion.approval) !== JSON.stringify(context.approval)) return fail("FACTS_STALE");
  for (const ref of suggestion.basis) {
    if (!context.facts.some(v => v.factId === ref.factId && v.version === ref.version)) return fail("FACTS_STALE");
  }
  let quota = parseContentQuota(context.quota);
  const checkTasks = (ids: string[]) => { unique(ids, v => v, "INPUT_INVALID"); if (ids.some(taskId => !context.tasks.some(t => t.taskId === taskId))) fail("FACTS_STALE"); };
  if (suggestion.decision === "maintain" || suggestion.decision === "insufficient_data") checkTasks(suggestion.taskIds);
  if (suggestion.decision === "insufficient_data") {
    unique(suggestion.missingFactIds, v => v, "INPUT_INVALID");
    if (suggestion.missingFactIds.some(factId => !context.facts.some(v => v.factId === factId && v.availability !== "available"))) return fail("FACTS_STALE");
  }
  if (suggestion.decision === "adjust") {
    if (!context.approval) return fail("APPROVAL_REQUIRED");
    if (context.projectState !== "active" || !context.approvedWindow || !context.approvedForms.length || !context.approvedLanguages.length) return fail("OUT_OF_SCOPE");
    if (suggestion.basis.some(ref => context.facts.find(v => v.factId === ref.factId)!.availability !== "available")) return fail("DATA_INSUFFICIENT");
    unique(suggestion.changes, v => v.kind === "schedule" ? v.publication.taskId : v.taskId, "INPUT_INVALID");
    const inWindow = (scheduledAt: string) => {
      if (compareTimestamps(scheduledAt, clock.data)! < 0 || compareTimestamps(scheduledAt, context.approvedWindow!.startsAt)! < 0
        || compareTimestamps(scheduledAt, context.approvedWindow!.endsAt)! >= 0) fail("OUT_OF_SCOPE");
    };
    const candidate = (value: { variantId: string; contentUnitId: string; form: z.infer<typeof form> }) => {
      const material = context.materials.find(m => m.variantId === value.variantId);
      if (!context.approvedForms.includes(value.form) || !material || material.contentUnitId !== value.contentUnitId
        || material.state !== "candidate" || !context.approvedLanguages.includes(material.language)) fail("OUT_OF_SCOPE");
    };
    for (const action of suggestion.changes) {
      if (action.kind !== "schedule") {
        const current = context.tasks.find(v => v.taskId === action.taskId);
        if (!current || current.version !== action.expectedVersion) return fail("FACTS_STALE");
        const slot = quota.slots.find(v => v.taskId === current.taskId)!;
        if (current.state !== "not_started" || slot.state !== "reserved") return fail("TASK_NOT_MUTABLE");
        if (action.kind === "reschedule") { candidate(current); inWindow(action.scheduledAt); }
        // Cancellation is a proposed revision, NEVER quota release/reuse.
      } else {
        const v = action.publication;
        if (context.tasks.some(t => t.taskId === v.taskId)) return fail("FACTS_STALE");
        candidate(v);
        const unit = quota.units.find(u => u.contentUnitId === v.contentUnitId);
        if (!unit || (unit.mediaKind === "image_text") !== (v.form === "facebook_image_text")) return fail("OUT_OF_SCOPE");
        inWindow(v.scheduledAt);
        try {
          const reservation = reserveContentQuota(quota, { contentUnitId: v.contentUnitId, variantId: v.variantId, identityId: v.identityId, taskId: v.taskId, platform: platformOf(v.form) });
          if (!reservation.changed) return fail("QUOTA_CONFLICT"); // An old slot is never a newly planned task, even if omitted from task projection.
          quota = reservation.snapshot;
        }
        catch (e) { if (e instanceof ContentQuotaError) return fail("QUOTA_CONFLICT"); throw e; }
      }
    }
  }
  // Never interpreted as executable, even when shape and subset checks pass.
  return { suggestion, tentativeQuota: quota, stage: "checked_advisory_only" as const,
    pendingChecks: ["current_facts_and_approval", "copy_factuality", "resource_and_file_readiness", "frequency_and_traffic_minimum", "series_execution_dependency", "metric_comparability", "atomic_task_revision", "action_permission"] };
}
