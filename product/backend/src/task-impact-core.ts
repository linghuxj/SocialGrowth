import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { parseContentQuota } from "./content-quota-core.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const version = z.int().min(1);
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const window = z.strictObject({ startsAt: time, endsAt: time });
const task = z.strictObject({ taskId: id, version, contentUnitId: id, variantId: id, materialVersion: version, identityId: id,
  platform: z.enum(["facebook", "youtube"]), state: z.enum(["not_started", "in_platform_flow", "submission_unknown", "verified", "cancelled"]),
  approval: z.enum(["valid", "revoked", "unknown"]), window });
const schema = z.strictObject({ projectId: id, projectVersion: version, phase: z.enum(["draft", "active", "paused", "ended"]),
  materials: z.array(z.strictObject({ variantId: id, version, state: z.enum(["candidate", "withdrawn", "needs_correction"]) })).max(1000),
  tasks: z.array(task).max(1000), quota: z.unknown() });
const common = { changeId: id, projectId: id, expectedProjectVersion: version };
const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("material_corrected"), variantId: id, expectedMaterialVersion: version, newMaterialVersion: version }),
  z.strictObject({ ...common, kind: z.literal("material_withdrawn"), variantId: id, expectedMaterialVersion: version }),
  z.strictObject({ ...common, kind: z.literal("project_paused") }),
  z.strictObject({ ...common, kind: z.literal("project_ended") }),
  z.strictObject({ ...common, kind: z.literal("project_resumed") }),
]);
export type TaskImpactSnapshot = z.infer<typeof schema>;
export type TaskImpactDecision = "pause_for_material_recheck" | "cancel_unsubmitted_preserve_quota" | "hold_unstarted_publication"
  | "request_safe_stop_and_inspect" | "verify_original_submission" | "preserve_verified_history" | "preserve_cancelled_history"
  | "recheck_original_task" | "operator_attention";
export class TaskImpactError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "FACTS_INVALID" | "FACTS_STALE" | "PROJECT_ENDED" | "RESUME_NOT_APPLICABLE") { super(code); }
}
function fail(code: TaskImpactError["code"]): never { throw new TaskImpactError(code); }
function parse(input: unknown) {
  const p = schema.safeParse(input); if (!p.success) return fail("FACTS_INVALID");
  const s = p.data;
  if (new Set(s.materials.map(v => v.variantId)).size !== s.materials.length || new Set(s.tasks.map(v => v.taskId)).size !== s.tasks.length) return fail("FACTS_INVALID");
  let quota; try { quota = parseContentQuota(s.quota); } catch { return fail("FACTS_INVALID"); }
  if (quota.units.some(v => v.projectId !== s.projectId) || quota.identities.some(v => v.projectId !== s.projectId)
    || quota.slots.length !== s.tasks.length) return fail("FACTS_INVALID");
  for (const material of s.materials) if (!quota.variants.some(v => v.variantId === material.variantId)) return fail("FACTS_INVALID");
  for (const t of s.tasks) {
    const slot = quota.slots.find(v => v.taskId === t.taskId), material = s.materials.find(v => v.variantId === t.variantId);
    const expectedSlot = t.state === "verified" ? "published_verified" : t.state === "submission_unknown" ? "submission_unknown" : "reserved";
    if (!slot || !material || t.materialVersion > material.version || slot.contentUnitId !== t.contentUnitId || slot.variantId !== t.variantId
      || slot.identityId !== t.identityId || slot.platform !== t.platform || slot.state !== expectedSlot
      || compareTimestamps(t.window.startsAt, t.window.endsAt)! >= 0) return fail("FACTS_INVALID");
  }
  return { ...s, quota };
}
// INTERNAL pure impact classification. Event scope/versions are not proof of
// operator confirmation, current producer facts, actual stopping or submission.
// No task mutation/queue/HTTP/phone, publication deletion or resource release.
export function classifyTaskImpact(snapshotInput: unknown, eventInput: unknown, evaluatedAt: string) {
  const s = parse(snapshotInput), p = eventSchema.safeParse(eventInput), clock = time.safeParse(evaluatedAt);
  if (!p.success || !clock.success) return fail("INPUT_INVALID"); const event = p.data;
  if (event.projectId !== s.projectId || event.expectedProjectVersion !== s.projectVersion) return fail("FACTS_STALE");
  if (event.kind === "project_resumed") {
    if (s.phase === "ended") return fail("PROJECT_ENDED"); if (s.phase !== "paused") return fail("RESUME_NOT_APPLICABLE");
  }
  if (event.kind === "material_corrected" || event.kind === "material_withdrawn") {
    const material = s.materials.find(v => v.variantId === event.variantId);
    if (!material || material.version !== event.expectedMaterialVersion) return fail("FACTS_STALE");
    if (event.kind === "material_corrected" && event.newMaterialVersion <= material.version) return fail("INPUT_INVALID");
  }
  const selected = s.tasks.filter(t => event.kind === "material_corrected" || event.kind === "material_withdrawn" ? t.variantId === event.variantId : true);
  const decisions = selected.map(t => {
    const material = s.materials.find(v => v.variantId === t.variantId)!;
    let decision: TaskImpactDecision, reasons: string[] = [];
    if (t.state === "verified") decision = "preserve_verified_history";
    else if (t.state === "cancelled") decision = "preserve_cancelled_history";
    else if (t.state === "submission_unknown") decision = "verify_original_submission";
    else if (t.state === "in_platform_flow") decision = "request_safe_stop_and_inspect";
    else if (event.kind === "project_resumed") {
      if (t.approval !== "valid") reasons.push("approval_not_valid");
      if (material.state !== "candidate" || t.materialVersion !== material.version) reasons.push("material_not_current_candidate");
      if (compareTimestamps(clock.data, t.window.endsAt)! >= 0) reasons.push("window_expired");
      decision = reasons.length ? "operator_attention" : "recheck_original_task";
    } else if (event.kind === "project_ended" || event.kind === "material_withdrawn" || material.state === "withdrawn" || s.phase === "ended") {
      decision = "cancel_unsubmitted_preserve_quota";
    } else if (event.kind === "material_corrected") decision = "pause_for_material_recheck";
    else decision = "hold_unstarted_publication";
    if (t.state === "submission_unknown") reasons.push("result_unknown_never_resubmit");
    if (t.state === "in_platform_flow") reasons.push("actual_state_and_safe_stop_unproven");
    return { taskId: t.taskId, expectedTaskVersion: t.version, decision, reasons, originalMaterialVersion: t.materialVersion,
      originalWindow: structuredClone(t.window) };
  });
  return { stage: "impact_advisory_only" as const, changeId: event.changeId, projectId: s.projectId, expectedProjectVersion: s.projectVersion,
    evaluatedAt: clock.data, decisions, unchangedQuota: s.quota, executionAllowed: false as const, deletionAllowed: false as const,
    resourceReleaseAllowed: false as const,
    pendingChecks: ["current_facts_and_event_authority", "atomic_task_revision_and_outbox", "actual_safe_stop_or_submission_verification", "current_grant_material_resource_window_and_dependencies"] };
}
