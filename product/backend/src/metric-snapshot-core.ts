import { z } from "zod";
import { compareTimestamps, metricSnapshotSchema, uuidSchema, type MetricSnapshot } from "@socialgrowth/product-contracts";
const id = uuidSchema.transform(v => v.toLowerCase());
export { type MetricSnapshot } from "@socialgrowth/product-contracts";
const schema = metricSnapshotSchema;
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
export function parseMetricSnapshot(input: unknown): MetricSnapshot {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("INPUT_INVALID");
  return parsed.data;
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
