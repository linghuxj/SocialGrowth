import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "./common.js";
import { projectLabelSchema } from "./project.js";

const iso = z.toJSONSchema(timestampSchema).pattern;
if (typeof iso !== "string" || !iso.startsWith("^")) throw new Error("Expected anchored ISO timestamp grammar");
const time = z.string().regex(new RegExp(iso.replace(/^\^/, "^(?!0000-)")));
const id = uuidSchema;
const content = z.strictObject({ kind: z.literal("content"), publicationId: id, taskId: id, contentUnitId: id, variantId: id });
const account = z.strictObject({ kind: z.literal("account") });

export const metricSnapshotSchema = z.strictObject({
  snapshotId: id,
  sourceId: id,
  sourceReportId: id,
  definitionId: id,
  projectId: id,
  identityId: id,
  platform: z.enum(["facebook", "youtube"]),
  subject: z.discriminatedUnion("kind", [account, content]),
  revision: z.int().min(1),
  replacesSnapshotId: id.nullable(),
  measurement: z.enum(["cumulative", "interval"]),
  value: z.string().max(256).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/).nullable(),
  availability: z.enum(["available", "missing", "delayed"]),
  missingReason: z.enum(["permission_unavailable", "source_unavailable", "no_data", "unknown_cutoff", "unknown_coverage"]).nullable(),
  sourceTimeZone: projectLabelSchema.nullable(),
  coverage: z.strictObject({ startsAt: time, endsAt: time }).nullable(),
  statisticsCutoffAt: time.nullable(),
  collectedAt: time,
}).superRefine((v, ctx) => {
  if ((v.revision === 1) !== (v.replacesSnapshotId === null)
    || (v.availability === "available" && (v.value === null || v.missingReason !== null))
    || (v.availability === "missing" && v.value !== null)
    || (v.availability !== "available" && v.missingReason === null)
    || (v.coverage && compareTimestamps(v.coverage.startsAt, v.coverage.endsAt)! >= 0)
    || (v.statisticsCutoffAt && compareTimestamps(v.statisticsCutoffAt, v.collectedAt)! > 0)
    || (v.coverage && v.statisticsCutoffAt && compareTimestamps(v.coverage.endsAt, v.statisticsCutoffAt)! > 0)) {
    ctx.addIssue({ code: "custom", message: "Inconsistent metric snapshot" });
  }
});

export const projectFeedbackResponseSchema = z.strictObject({
  projectId: id,
  observedAt: time,
  sourceState: z.enum(["available", "not_configured", "unavailable", "unknown"]),
  sourceReasonCode: z.enum(["source_not_configured", "no_authoritative_report", "source_unavailable"]).nullable(),
  metrics: z.array(metricSnapshotSchema),
  contentAttribution: z.strictObject({ state: z.literal("unknown"), reason: z.literal("verified_task_publication_source_missing") }),
}).superRefine((v, ctx) => {
  const reasonFor: Record<typeof v.sourceState, typeof v.sourceReasonCode> = {
    available: null,
    not_configured: "source_not_configured",
    unavailable: "source_unavailable",
    unknown: "no_authoritative_report",
  };
  if (v.sourceReasonCode !== reasonFor[v.sourceState]
    || (v.sourceState === "available") !== (v.metrics.length > 0)
    || v.metrics.some(metric => metric.projectId.toLowerCase() !== v.projectId.toLowerCase())) {
    ctx.addIssue({ code: "custom", message: "Inconsistent project feedback projection" });
  }
});

export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;
export type ProjectFeedbackResponse = z.infer<typeof projectFeedbackResponseSchema>;
