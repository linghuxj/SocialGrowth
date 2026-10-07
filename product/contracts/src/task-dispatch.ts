import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "./common.js";
import { materialUploadContentTypeSchema } from "./material-upload.js";
// CT-07 is independent of deployed B1 identity/control protocols. Validation
// establishes structure only, never current authority or actual platform truth.
export const taskProtocolVersion = "2026-10-01.task-v1" as const;
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const version = z.int().min(1);
const text = z.string().min(1).max(4000).refine(v => v.trim() === v && !v.includes("\u0000"));
const scope = { taskId: uuidSchema, taskRevision: version, projectId: uuidSchema, taskAttemptId: uuidSchema, deviceId: uuidSchema, identityId: uuidSchema };
export const publicationFormSchema = z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]);
export const centralPublicationTaskSchema = z.strictObject({ protocolVersion: z.literal(taskProtocolVersion), ...scope,
  kind: z.literal("publish_content"), platform: z.enum(["facebook", "youtube"]), form: publicationFormSchema,
  arrangementRevision: version, projectVersion: version, assignmentId: uuidSchema, assignmentVersion: version,
  approvalId: uuidSchema, approvalVersion: version, contentUnitId: uuidSchema, variantId: uuidSchema, materialRevision: z.int().min(1).max(1000),
  languageTag: z.string().regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/).max(100),
  objects: z.array(z.strictObject({ objectId: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.int().min(1).max(128 * 1024 * 1024), contentType: materialUploadContentTypeSchema })).min(1).max(20),
  title: text, caption: text, scheduledAt: time, window: z.strictObject({ startsAt: time, endsAt: time }),
  recovery: z.strictObject({ roundId: uuidSchema, maxAttempts: z.int().min(1).max(100), maxElapsedMs: z.int().min(1).max(3_600_000) }),
}).refine(v => (v.form.startsWith("facebook_") ? "facebook" : "youtube") === v.platform
  && compareTimestamps(v.window.startsAt, v.window.endsAt)! < 0 && compareTimestamps(v.scheduledAt, v.window.startsAt)! >= 0 && compareTimestamps(v.scheduledAt, v.window.endsAt)! < 0
  && new Set(v.objects.map(o => o.objectId.toLowerCase())).size === v.objects.length
  && (v.form === "facebook_image_text" ? v.objects.every(o => o.contentType.startsWith("image/")) : v.objects.length === 1 && !v.objects[0]!.contentType.startsWith("image/")), "Inconsistent central task boundary");
// Small opaque references only, not a copy of captions/files, URLs or action
// permits. Delivery/Redis acknowledgement/completed cannot advance publication.
export const taskDispatchNoticeSchema = z.strictObject({ protocolVersion: z.literal(taskProtocolVersion),
  messageId: uuidSchema, ...scope, purpose: z.literal("recheck_central_task"), executionAllowed: z.literal(false) });
export const taskExecutionObservationSchema = z.strictObject({ protocolVersion: z.literal(taskProtocolVersion), ...scope,
  sourceId: uuidSchema, sourceEventId: uuidSchema, occurredAt: time, receivedAt: time,
  engineState: z.enum(["running", "completed", "interrupted", "failed"]),
  publicationState: z.enum(["not_submitted", "submission_unknown", "reported_published", "reported_not_published"]),
  platformContentId: z.string().min(1).max(256).nullable(), evidenceIds: z.array(uuidSchema).max(20),
}).refine(v => compareTimestamps(v.occurredAt, v.receivedAt)! <= 0 && new Set(v.evidenceIds.map(id => id.toLowerCase())).size === v.evidenceIds.length
  && (v.publicationState === "reported_published" ? v.platformContentId !== null && v.evidenceIds.length > 0 : v.platformContentId === null)
  && (v.publicationState !== "reported_not_published" || v.evidenceIds.length > 0), "Inconsistent source observation");
export type CentralPublicationTask = z.infer<typeof centralPublicationTaskSchema>;
export type TaskDispatchNotice = z.infer<typeof taskDispatchNoticeSchema>;
export type TaskExecutionObservation = z.infer<typeof taskExecutionObservationSchema>;
