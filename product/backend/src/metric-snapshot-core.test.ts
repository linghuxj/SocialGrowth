import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { appendMetricSnapshot, MetricSnapshotError, parseMetricHistory, readMetricReport, type MetricSnapshot } from "./metric-snapshot-core.js";
const code = (c: string) => (e: unknown) => e instanceof MetricSnapshotError && e.code === c;
const fixture = (): MetricSnapshot => ({ snapshotId: randomUUID(), sourceId: randomUUID(), sourceReportId: randomUUID(), definitionId: randomUUID(), projectId: randomUUID(), identityId: randomUUID(), platform: "facebook",
  subject: { kind: "content", publicationId: randomUUID(), taskId: randomUUID(), contentUnitId: randomUUID(), variantId: randomUUID() }, revision: 1, replacesSnapshotId: null,
  measurement: "cumulative", value: "9007199254740993.1234567890123456789", availability: "available", missingReason: null, sourceTimeZone: "UTC",
  coverage: { startsAt: "2026-09-29T00:00:00Z", endsAt: "2026-09-30T00:00:00Z" }, statisticsCutoffAt: "2026-09-30T00:00:00Z", collectedAt: "2026-09-30T01:00:00Z" });
const correction = (v: MetricSnapshot): MetricSnapshot => ({ ...v, snapshotId: randomUUID(), revision: v.revision + 1, replacesSnapshotId: v.snapshotId, value: "4", collectedAt: "2026-09-30T02:00:00Z" });
test("metric revisions preserve exact values, original history and idempotent replay returns all current corrections", () => {
  const row = fixture(), input: MetricSnapshot[] = [], first = appendMetricSnapshot(input, row), revised = correction(row);
  assert.deepEqual(input, []); assert.deepEqual(row.value, "9007199254740993.1234567890123456789");
  const next = appendMetricSnapshot(first.history, revised); assert.equal(first.history.length, 1); assert.equal(next.history.length, 2);
  assert.deepEqual(readMetricReport(next.history, row.sourceId, row.sourceReportId), revised);
  assert.deepEqual(appendMetricSnapshot(next.history, row), { history: next.history, changed: false });
  assert.throws(() => appendMetricSnapshot(next.history, { ...row, value: "99" }), code("SNAPSHOT_ID_REUSED"));
});
test("separate cumulative observations and source definitions are not added or treated as fresh by collection time", () => {
  const row = fixture(), olderCutoff = { ...row, snapshotId: randomUUID(), sourceReportId: randomUUID(), value: "3", statisticsCutoffAt: "2026-09-29T00:00:00Z", coverage: null, collectedAt: "2026-09-30T03:00:00Z" };
  const history = appendMetricSnapshot([row], olderCutoff).history;
  assert.equal(readMetricReport(history, row.sourceId, row.sourceReportId)?.value, row.value);
  assert.equal(readMetricReport(history, row.sourceId, olderCutoff.sourceReportId)?.value, "3");
  assert.equal(readMetricReport(history, row.sourceId, randomUUID()), null);
});
test("real zero, missing, delayed old data and unknown coverage/cutoff remain distinct", () => {
  const row = fixture();
  for (const patch of [{ value: "0" }, { value: null, availability: "missing", missingReason: "no_data" },
    { value: null, availability: "delayed", missingReason: "source_unavailable" }, { coverage: null, statisticsCutoffAt: null, sourceTimeZone: null }]) {
    const history = appendMetricSnapshot([], { ...row, ...patch }).history;
    assert.deepEqual(history[0], { ...row, ...patch });
  }
  for (const patch of [{ value: null }, { value: "0", availability: "missing", missingReason: "no_data" },
    { value: "2", availability: "delayed", missingReason: "source_unavailable" }, { availability: "delayed" }, { missingReason: "no_data" }]) assert.throws(() => appendMetricSnapshot([], { ...row, ...patch }), code("INPUT_INVALID"));
});
test("account observations cannot acquire invented content/task attribution; corrections retain original project/source scope", () => {
  const row = { ...fixture(), subject: { kind: "account" as const } }, history = appendMetricSnapshot([], row).history;
  assert.deepEqual(history[0]?.subject, { kind: "account" });
  assert.throws(() => appendMetricSnapshot([], { ...row, subject: { kind: "account", taskId: randomUUID() } }), code("INPUT_INVALID"));
  for (const patch of [{ projectId: randomUUID() }, { identityId: randomUUID() }, { definitionId: randomUUID() }, { subject: fixture().subject }, { platform: "youtube" }, { measurement: "interval" }]) assert.throws(() => appendMetricSnapshot(history, { ...correction(row), ...patch }), code("REPORT_SCOPE_CHANGED"));
});
test("missing source metadata can be explicitly corrected without relabeling or deleting the original statistics", () => {
  const row = { ...fixture(), sourceTimeZone: null, coverage: null, statisticsCutoffAt: null, value: null, availability: "missing" as const, missingReason: "unknown_coverage" as const };
  const fixed = { ...correction(row), sourceTimeZone: "Asia/Shanghai", coverage: fixture().coverage, statisticsCutoffAt: fixture().statisticsCutoffAt, availability: "available" as const, missingReason: null };
  const result = appendMetricSnapshot([row], fixed);
  assert.deepEqual(result.history[0], row); assert.deepEqual(result.history[1], fixed);
  assert.equal(readMetricReport(result.history, row.sourceId, row.sourceReportId)?.sourceTimeZone, "Asia/Shanghai");
});
test("legacy history stays readable while trusted definition metadata is immutable within one report", () => {
  const legacy = fixture();
  assert.deepEqual(parseMetricHistory([legacy])[0], legacy);
  const described = { ...fixture(), metricDefinition: { name: "播放次数", unit: "次",
    description: "平台报告的播放计数", sourceDefinition: "Facebook Insights 原始累计指标" } };
  const revised = correction(described);
  assert.deepEqual(appendMetricSnapshot([described], revised).history[1]?.metricDefinition, described.metricDefinition);
  for (const metricDefinition of [
    { ...described.metricDefinition, name: "观看次数" },
    { ...described.metricDefinition, unit: null },
    { ...described.metricDefinition, description: "另一种指标解释" },
    { ...described.metricDefinition, sourceDefinition: "另一来源口径" },
    undefined,
  ]) {
    assert.throws(() => appendMetricSnapshot([described], { ...revised, metricDefinition }), code("REPORT_SCOPE_CHANGED"));
  }
  assert.throws(() => appendMetricSnapshot([legacy], { ...correction(legacy),
    metricDefinition: described.metricDefinition }), code("REPORT_SCOPE_CHANGED"));
});
test("corrections form one nonforking chain and cannot use stale predecessor, skip revision or lose provenance", () => {
  const row = fixture(), next = correction(row), history = appendMetricSnapshot([row], next).history;
  for (const patch of [{ replacesSnapshotId: randomUUID() }, { revision: 3 }, { collectedAt: "2026-09-30T00:00:00Z" }]) assert.throws(() => appendMetricSnapshot([row], { ...next, ...patch }), code("CORRECTION_STALE"));
  assert.throws(() => appendMetricSnapshot(history, correction(row)), code("CORRECTION_STALE"));
  assert.throws(() => appendMetricSnapshot([], next), code("CORRECTION_STALE"));
});
test("actual timestamp ordering keeps microseconds and offsets, rejects future cutoff, invalid calendar and inverted coverage", () => {
  const row = fixture();
  for (const patch of [{ statisticsCutoffAt: "2026-09-30T01:00:00.000001Z" }, { collectedAt: "0000-01-01T00:00:00Z" }, { coverage: { startsAt: "2026-09-30T00:00:00.000002Z", endsAt: "2026-09-30T00:00:00.000001Z" } }, { coverage: { startsAt: "2026-09-29T00:00:00Z", endsAt: "2026-09-30T00:00:00.000001Z" } }]) assert.throws(() => appendMetricSnapshot([], { ...row, ...patch }), code("INPUT_INVALID"));
  const value = { ...row, collectedAt: "2026-09-30T08:00:00+08:00" }; assert.deepEqual(appendMetricSnapshot([], value).history[0], value);
});
test("history corruption, duplicate UUID casing and malformed decimals fail safely without returning source data", () => {
  const row = fixture();
  for (const history of [[row, { ...row, snapshotId: row.snapshotId.toUpperCase() }], [correction(row)], [row, { ...correction(row), projectId: randomUUID() }], [{ ...row, permissionGranted: true }]]) assert.throws(() => parseMetricHistory(history), code("CORRUPT_HISTORY"));
  for (const value of [0, "-1", "01", "1e9", "NaN", "1.00", "secret-fixture", "1".repeat(257)]) assert.throws(() => appendMetricSnapshot([], { ...row, value }), (e: unknown) => code("INPUT_INVALID")(e) && !String(e).includes(String(value)));
});
test("UUIDs are normalized before report identity, history is defensively copied and no execution or comparison grant exists", () => {
  const row = fixture(), mixed = { ...row, snapshotId: row.snapshotId.toUpperCase(), sourceId: row.sourceId.toUpperCase(),
    sourceReportId: row.sourceReportId.toUpperCase(), definitionId: row.definitionId.toUpperCase(), projectId: row.projectId.toUpperCase(),
    identityId: row.identityId.toUpperCase(), subject: { kind: "content" as const, publicationId: row.subject.kind === "content" ? row.subject.publicationId.toUpperCase() : "",
      taskId: row.subject.kind === "content" ? row.subject.taskId.toUpperCase() : "", contentUnitId: row.subject.kind === "content" ? row.subject.contentUnitId.toUpperCase() : "",
      variantId: row.subject.kind === "content" ? row.subject.variantId.toUpperCase() : "" } };
  const result = appendMetricSnapshot([], mixed);
  assert.deepEqual(result.history[0], row);
  const selected = readMetricReport(result.history, row.sourceId.toUpperCase(), row.sourceReportId.toUpperCase())!; selected.value = "0";
  assert.equal(result.history[0]?.value, row.value); assert.ok(!("permissionGranted" in selected)); assert.ok(!("comparable" in selected));
  const nextBase = correction(row), next = { ...nextBase, replacesSnapshotId: row.snapshotId.toUpperCase(), snapshotId: nextBase.snapshotId.toUpperCase() };
  const corrected = appendMetricSnapshot(result.history, next);
  assert.equal(corrected.history[1]?.replacesSnapshotId, row.snapshotId);
  assert.equal(readMetricReport(corrected.history, row.sourceId, row.sourceReportId)?.snapshotId, next.snapshotId.toLowerCase());
  assert.throws(() => readMetricReport(result.history, "invalid", row.sourceReportId), code("INPUT_INVALID"));
});
