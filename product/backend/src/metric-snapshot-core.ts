import { z } from "zod";
import { compareTimestamps, projectLabelSchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const content = z.strictObject({ kind: z.literal("content"), publicationId: id, taskId: id, contentUnitId: id, variantId: id });
const account = z.strictObject({ kind: z.literal("account") });
const schema = z.strictObject({ snapshotId: id, sourceId: id, sourceReportId: id, definitionId: id,
  projectId: id, identityId: id, platform: z.enum(["facebook", "youtube"]), subject: z.discriminatedUnion("kind", [content, account]),
  revision: z.int().min(1), replacesSnapshotId: id.nullable(),
  measurement: z.enum(["cumulative", "interval"]), value: z.string().max(256).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/).nullable(),
  availability: z.enum(["available", "missing", "delayed"]), missingReason: z.enum(["permission_unavailable", "source_unavailable", "no_data", "unknown_cutoff", "unknown_coverage"]).nullable(),
  sourceTimeZone: projectLabelSchema.nullable(), coverage: z.strictObject({ startsAt: time, endsAt: time }).nullable(),
  statisticsCutoffAt: time.nullable(), collectedAt: time,
}).superRefine((v, ctx) => {
  if ((v.revision === 1) !== (v.replacesSnapshotId === null)
    || (v.availability === "available" && (v.value === null || v.missingReason !== null))
    || (v.availability === "missing" && v.value !== null)
    || (v.availability !== "available" && v.missingReason === null)
    || (v.coverage && compareTimestamps(v.coverage.startsAt, v.coverage.endsAt)! >= 0)
    || (v.statisticsCutoffAt && compareTimestamps(v.statisticsCutoffAt, v.collectedAt)! > 0)
    || (v.coverage && v.statisticsCutoffAt && compareTimestamps(v.coverage.endsAt, v.statisticsCutoffAt)! > 0)) ctx.addIssue({ code: "custom", message: "Inconsistent metric snapshot" });
});
export type MetricSnapshot = z.infer<typeof schema>;
export class MetricSnapshotError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "CORRUPT_HISTORY" | "SNAPSHOT_ID_REUSED" | "CORRECTION_STALE" | "REPORT_SCOPE_CHANGED") { super(code); }
}
const key = (v: MetricSnapshot) => `${v.sourceId}/${v.sourceReportId}`;
const scope = (v: MetricSnapshot) => JSON.stringify({ sourceId: v.sourceId, sourceReportId: v.sourceReportId, definitionId: v.definitionId,
  projectId: v.projectId, identityId: v.identityId, platform: v.platform, subject: v.subject, measurement: v.measurement });
function fail(code: MetricSnapshotError["code"]): never { throw new MetricSnapshotError(code); }
function latest(rows: MetricSnapshot[], matches: (row: MetricSnapshot) => boolean): MetricSnapshot | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i]!)) return rows[i];
  return undefined;
}
function checkAppend(history: MetricSnapshot[], row: MetricSnapshot, corrupt: boolean): void {
  const previous = latest(history, v => key(v) === key(row));
  if (previous) {
    if (scope(previous) !== scope(row)) fail(corrupt ? "CORRUPT_HISTORY" : "REPORT_SCOPE_CHANGED");
    if (row.replacesSnapshotId !== previous.snapshotId || previous.revision === Number.MAX_SAFE_INTEGER || row.revision !== previous.revision + 1
      || compareTimestamps(row.collectedAt, previous.collectedAt)! < 0) fail(corrupt ? "CORRUPT_HISTORY" : "CORRECTION_STALE");
  } else if (row.revision !== 1 || row.replacesSnapshotId !== null) fail(corrupt ? "CORRUPT_HISTORY" : "CORRECTION_STALE");
}
// INTERNAL supplemental model only. Source/definition permissions and content
// publication/task linkage must be resolved by a future trusted central producer.
// UUIDs, imported data or model claims are not proof of a real publication.
export function parseMetricHistory(input: unknown): MetricSnapshot[] {
  const parsed = z.array(schema).safeParse(input);
  if (!parsed.success) return fail("CORRUPT_HISTORY");
  const result: MetricSnapshot[] = [], ids = new Set<string>();
  for (const row of parsed.data) {
    if (ids.has(row.snapshotId)) fail("CORRUPT_HISTORY");
    checkAppend(result, row, true); result.push(row); ids.add(row.snapshotId);
  }
  return result;
}
export function appendMetricSnapshot(history: unknown, input: unknown): { history: MetricSnapshot[]; changed: boolean } {
  const records = parseMetricHistory(history), parsed = schema.safeParse(input);
  if (!parsed.success) return fail("INPUT_INVALID");
  const row = parsed.data, existing = records.find(v => v.snapshotId === row.snapshotId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(row)) fail("SNAPSHOT_ID_REUSED");
    return { history: records, changed: false }; // Preserve all corrections, not old output as new data.
  }
  checkAppend(records, row, false); records.push(row); return { history: records, changed: true };
}
// Deliberately select one specified source report, not "newest collected" across
// cutoffs/definitions or the sum/delta of unrelated cumulative observations.
export function readMetricReport(history: unknown, sourceId: string, sourceReportId: string): MetricSnapshot | null {
  const source = id.safeParse(sourceId), report = id.safeParse(sourceReportId);
  if (!source.success || !report.success) return fail("INPUT_INVALID");
  return latest(parseMetricHistory(history), v => v.sourceId === source.data && v.sourceReportId === report.data) ?? null;
}
