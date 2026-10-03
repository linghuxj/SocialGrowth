import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { materialUploadContentTypeSchema } from "./material-upload.js";

const version = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveVersion = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const blocker = z.enum([
  "plan_missing", "plan_stale", "project_scope_changed", "material_missing", "material_revision_changed",
  "material_not_eligible", "identity_reservation_missing", "device_association_missing", "installation_missing",
  "device_paused", "stop_unconfirmed", "participation_missing", "network_not_admitted",
  "action_inspector_unavailable", "current_fact_unknown",
]);
const materialFileBindingSchema = z.strictObject({ objectId: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.int().min(1).max(128 * 1024 * 1024), contentType: materialUploadContentTypeSchema });
function orderedFiles(files: Array<{ objectId: string }>) {
  return files.every((file, index) => index === 0 || files[index - 1]!.objectId.toLowerCase() < file.objectId.toLowerCase());
}

export const businessPlanCurrentImpactReferenceSchema = z.strictObject({
  impactRevision: positiveVersion,
  reason: z.enum(["project_scope_changed", "material_revision_changed"]),
  observedProjectVersion: version,
  observedMaterialRevision: positiveVersion.nullable(),
  recordedAt: timestampSchema,
}).superRefine((value, ctx) => {
  if (value.reason === "project_scope_changed" && value.observedMaterialRevision !== null) {
    ctx.addIssue({ code: "custom", message: "Project impact must not claim a material revision" });
  }
  if (value.reason === "material_revision_changed" && value.observedMaterialRevision === null) {
    ctx.addIssue({ code: "custom", message: "Material impact must identify its revision" });
  }
});

export const businessPlanCurrentCheckTaskSchema = z.strictObject({
  taskId: uuidSchema,
  taskRevision: positiveVersion,
  planId: uuidSchema,
  planRevision: positiveVersion,
  variantId: uuidSchema,
  expectedMaterialRevision: positiveVersion,
  identityId: uuidSchema,
  platform: z.enum(["facebook", "youtube"]),
  form: z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]),
  scheduledAt: timestampSchema,
  expectedFiles: z.array(materialFileBindingSchema).max(20),
  currentFiles: z.array(materialFileBindingSchema).max(20).nullable(),
  current: z.strictObject({
    projectVersion: version.nullable(),
    approvalId: uuidSchema.nullable(),
    materialRevision: positiveVersion.nullable(),
    materialStatus: z.enum(["pending_validation", "candidate"]).nullable(),
    materialCandidateAllowed: z.boolean().nullable(),
    reservedDeviceId: uuidSchema.nullable(),
    associationCurrent: z.boolean().nullable(),
    installationGeneration: z.string().regex(/^[1-9][0-9]{0,18}$/).nullable(),
    controlIntent: z.enum(["active", "pause_requested", "paused", "resume_requested", "exit_pending", "exited"]).nullable(),
    controlStop: z.enum(["not_requested", "requested", "confirmed", "unknown"]).nullable(),
    participationCurrent: z.boolean().nullable(),
    networkAdmitted: z.boolean().nullable(),
  }),
  impactReferences: z.array(businessPlanCurrentImpactReferenceSchema).max(1000),
  blockers: z.array(blocker).min(1).max(15),
}).superRefine((value, ctx) => {
  if (!orderedFiles(value.expectedFiles) || (value.currentFiles !== null && !orderedFiles(value.currentFiles))) {
    ctx.addIssue({ code: "custom", message: "Material file manifests must be unique and objectId ordered" });
  }
  if (value.expectedFiles.length === 0 && (!value.blockers.includes("material_missing") || !value.blockers.includes("current_fact_unknown"))) {
    ctx.addIssue({ code: "custom", message: "Missing expected manifest must remain blocked" });
  }
  if (value.currentFiles === null && (!value.blockers.includes("material_missing") || !value.blockers.includes("current_fact_unknown"))) {
    ctx.addIssue({ code: "custom", message: "Missing current manifest must remain blocked" });
  }
  if (value.currentFiles !== null && JSON.stringify(value.expectedFiles) !== JSON.stringify(value.currentFiles)
    && !value.blockers.includes("material_revision_changed")) {
    ctx.addIssue({ code: "custom", message: "Different current files must remain blocked" });
  }
});

export const businessPlanCurrentChecksResponseSchema = z.strictObject({
  projectId: uuidSchema,
  checkedAt: timestampSchema,
  plan: z.strictObject({ planId: uuidSchema, revision: positiveVersion, projectVersion: version, approvalId: uuidSchema }).nullable(),
  tasks: z.array(businessPlanCurrentCheckTaskSchema).max(1000),
  executionAllowed: z.literal(false),
  publicationAllowed: z.literal(false),
});

export type BusinessPlanCurrentChecksResponse = z.infer<typeof businessPlanCurrentChecksResponseSchema>;
