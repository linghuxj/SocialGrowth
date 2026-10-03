import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type MetricSnapshot } from "./metric-snapshot-core.js";
import { evaluateObservationPair, evaluateObservationWindow, ObservationWindowError, parseObservationWindow, selectObservationPolicy, type ObservationConfig, type ObservationWindow } from "./observation-window-core.js";
const code = (c: string) => (e: unknown) => e instanceof ObservationWindowError && e.code === c;
function fixture() {
  const config: ObservationConfig = { projectId: randomUUID(), configVersion: 1, defaultWindow: { kind: "exact_hours", hours: 24 }, overrides: [] };
  const window: ObservationWindow = { windowId: randomUUID(), projectId: config.projectId, configVersion: 1, identityId: randomUUID(), platform: "facebook", form: "facebook_video",
    publicationId: randomUUID(), taskId: randomUUID(), contentUnitId: randomUUID(), variantId: randomUUID(), publishedAt: "2026-09-01T12:00:00Z", startsAt: "2026-09-01T12:00:00Z", endsAt: "2026-09-02T12:00:00Z", policy: config.defaultWindow, calendar: null };
  const snapshot: MetricSnapshot = { snapshotId: randomUUID(), sourceId: randomUUID(), sourceReportId: randomUUID(), definitionId: randomUUID(), projectId: config.projectId, identityId: window.identityId, platform: window.platform,
    subject: { kind: "content", publicationId: window.publicationId, taskId: window.taskId, contentUnitId: window.contentUnitId, variantId: window.variantId }, revision: 1, replacesSnapshotId: null,
    measurement: "interval", value: "0", availability: "available", missingReason: null, sourceTimeZone: "UTC", coverage: { startsAt: window.startsAt, endsAt: window.endsAt }, statisticsCutoffAt: window.endsAt, collectedAt: window.endsAt };
  const input = () => ({ config, window, history: [snapshot], sourceId: snapshot.sourceId, reportId: snapshot.sourceReportId });
  const read = (history: unknown = [snapshot], clock = "2026-09-03T00:00:00Z") => evaluateObservationWindow(config, window, history, snapshot.sourceId, snapshot.sourceReportId, clock);
  return { config, window, snapshot, input, read };
}
function daily(f: ReturnType<typeof fixture>, boundaries = ["2026-09-02T00:00:00Z", "2026-09-03T00:00:00Z"]) {
  f.config.defaultWindow = { kind: "platform_days", days: 1 }; f.window.policy = f.config.defaultWindow;
  f.window.startsAt = boundaries[0]!; f.window.endsAt = boundaries[1]!;
  f.window.calendar = { calendarId: randomUUID(), sourceTimeZone: "UTC", publicationDayStartsAt: "2026-09-01T00:00:00Z", publicationDayEndsAt: boundaries[0]!, boundaries };
  f.snapshot.coverage = { startsAt: f.window.startsAt, endsAt: f.window.endsAt }; f.snapshot.statisticsCutoffAt = f.window.endsAt; f.snapshot.collectedAt = f.window.endsAt;
}
test("project default and exact form overrides stay explicit and never substitute seven-day review cadence", () => {
  const f = fixture(); f.config.overrides = [{ form: "youtube_shorts", window: { kind: "platform_days", days: 2 } }];
  assert.deepEqual(selectObservationPolicy(f.config, "facebook_video"), { kind: "exact_hours", hours: 24 }); assert.deepEqual(selectObservationPolicy(f.config, "youtube_shorts"), { kind: "platform_days", days: 2 });
  for (const patch of [{ overrides: [...f.config.overrides, ...f.config.overrides] }, { defaultWindow: null }, { defaultWindow: { kind: "exact_hours", hours: 0 } }, { defaultWindow: { kind: "platform_days", days: 367 } }, { permissionGranted: true }]) assert.throws(() => selectObservationPolicy({ ...f.config, ...patch }, "youtube_shorts"), code("INPUT_INVALID"));
});
test("exact hourly bounds start at actual publication and preserve arbitrary fraction and equivalent offsets", () => {
  const f = fixture(), fraction = `.${"0".repeat(150)}1`;
  f.window.publishedAt = f.window.startsAt = `2026-09-01T12:00:00${fraction}Z`; f.window.endsAt = `2026-09-02T20:00:00${fraction}+08:00`;
  assert.equal(parseObservationWindow(f.config, f.window).endsAt, f.window.endsAt);
  for (const patch of [{ endsAt: `2026-09-02T12:00:00.${"0".repeat(150)}2Z` }, { startsAt: "2026-09-01T12:00:00Z" }, { configVersion: 2 }, { platform: "youtube" }, { policy: { kind: "exact_hours", hours: 48 } }, { calendar: {} }]) assert.throws(() => parseObservationWindow(f.config, { ...f.window, ...patch }), code(patch.calendar ? "INPUT_INVALID" : "WINDOW_INVALID"));
});
test("full platform days exclude and preserve the first partial day instead of manufacturing hourly observations", () => {
  const f = fixture(); daily(f); const read = f.read();
  assert.equal(read.stage, "ready_for_evidence_review"); assert.deepEqual(read.partialPublicationDay, { startsAt: f.window.publishedAt, endsAt: f.window.startsAt });
  f.snapshot.measurement = "cumulative"; assert.ok(f.read().reasons.includes("cumulative_partial_day_not_separable"));
});
test("publication at a proven source day boundary has no partial day, and unknown/gapped day shapes fail closed", () => {
  const f = fixture(); daily(f); f.window.publishedAt = f.window.calendar!.publicationDayStartsAt; f.window.startsAt = f.window.publishedAt; f.window.endsAt = f.window.calendar!.publicationDayEndsAt;
  f.window.calendar!.boundaries = [f.window.startsAt, f.window.endsAt]; f.snapshot.coverage = { startsAt: f.window.startsAt, endsAt: f.window.endsAt };
  assert.equal(f.read().partialPublicationDay, null);
  for (const patch of [{ calendar: null }, { calendar: { ...f.window.calendar, boundaries: [f.window.startsAt, f.window.startsAt] } }, { startsAt: "2026-09-01T01:00:00Z" }, { publishedAt: f.window.calendar!.publicationDayEndsAt }]) assert.throws(() => parseObservationWindow(f.config, { ...f.window, ...patch }), code("WINDOW_INVALID"));
});
test("ending time alone cannot make missing, delayed, unknown-cutoff or mismatched coverage data ready", () => {
  const f = fixture(); assert.equal(f.read([]).stage, "data_insufficient"); assert.equal(f.read([], "2026-09-01T13:00:00Z").stage, "observing");
  for (const patch of [{ availability: "missing", value: null, missingReason: "no_data" }, { availability: "delayed", value: null, missingReason: "source_unavailable" }, { statisticsCutoffAt: null }, { sourceTimeZone: null }, { coverage: null }, { coverage: { startsAt: "2026-09-01T00:00:00Z", endsAt: f.window.endsAt } }, { collectedAt: "2026-09-04T00:00:00Z" }]) assert.equal(f.read([{ ...f.snapshot, ...patch }]).stage, "data_insufficient");
  assert.throws(() => f.read([{ ...f.snapshot, availability: "delayed", value: "0", missingReason: "source_unavailable" }]), code("METRIC_INVALID"));
  assert.equal(f.read().stage, "ready_for_evidence_review"); assert.equal(f.read().snapshotId, f.snapshot.snapshotId);
});
test("account-level data, wrong publication/task/identity and source calendar never become content evidence", () => {
  const f = fixture();
  for (const patch of [{ subject: { kind: "account" } }, { subject: { ...f.snapshot.subject, publicationId: randomUUID() } }, { identityId: randomUUID() }, { projectId: randomUUID() }, { platform: "youtube" }]) assert.ok(f.read([{ ...f.snapshot, ...patch }]).reasons.includes("publication_scope_unproven"));
  daily(f); f.snapshot.sourceTimeZone = "Asia/Shanghai"; assert.ok(f.read().reasons.includes("source_calendar_mismatch"));
});
test("explicit corrections select the requested report and never add cumulative snapshots or turn missing into zero", () => {
  const f = fixture(), correction = { ...f.snapshot, snapshotId: randomUUID(), revision: 2, replacesSnapshotId: f.snapshot.snapshotId, availability: "missing", value: null, missingReason: "no_data" };
  assert.equal(f.read([f.snapshot, correction]).stage, "data_insufficient"); assert.equal(f.read([f.snapshot, correction]).snapshotId, correction.snapshotId);
  assert.throws(() => f.read([{ ...f.snapshot, permissionGranted: true }]), code("METRIC_INVALID"));
});
test("same configured platform-day count does not align differing actual hours or publication ages", () => {
  const a = fixture(), b = fixture(); daily(a); daily(b, ["2026-09-02T00:00:00Z", "2026-09-02T23:00:00Z"]);
  b.config.projectId = b.window.projectId = b.snapshot.projectId = a.config.projectId; b.snapshot.sourceId = a.snapshot.sourceId; b.snapshot.definitionId = a.snapshot.definitionId; b.window.calendar!.calendarId = a.window.calendar!.calendarId;
  assert.ok(evaluateObservationPair(a.input(), b.input(), "2026-09-04T00:00:00Z").reasons.includes("duration_or_age_mismatch"));
  b.window.endsAt = b.window.calendar!.boundaries[1] = a.window.endsAt; b.snapshot.coverage!.endsAt = b.snapshot.statisticsCutoffAt = b.snapshot.collectedAt = b.window.endsAt; b.window.publishedAt = "2026-09-01T13:00:00Z";
  assert.ok(evaluateObservationPair(a.input(), b.input(), "2026-09-04T00:00:00Z").reasons.includes("duration_or_age_mismatch"));
});
test("alignment only reaches evidence review and requires source, metric, platform and form identity", () => {
  const a = fixture(), b = fixture(); b.config.projectId = b.window.projectId = b.snapshot.projectId = a.config.projectId; b.snapshot.sourceId = a.snapshot.sourceId; b.snapshot.definitionId = a.snapshot.definitionId;
  assert.equal(evaluateObservationPair(a.input(), b.input(), "2026-09-04T00:00:00Z").alignedForEvidenceReview, true);
  b.snapshot.definitionId = randomUUID(); assert.ok(evaluateObservationPair(a.input(), b.input(), "2026-09-04T00:00:00Z").reasons.includes("metric_definition_mismatch"));
  assert.equal(evaluateObservationPair(a.input(), a.input(), "2026-09-04T00:00:00Z").alignedForEvidenceReview, false);
  assert.throws(() => evaluateObservationPair({ ...a.input(), stage: "ready_for_evidence_review" }, b.input(), "2026-09-04T00:00:00Z"), code("INPUT_INVALID"));
});
test("input and original partial-day history remain unchanged; no scheduler, comparison proof, permission or task is produced", () => {
  const f = fixture(); daily(f); const before = structuredClone(f.input()), result = f.read(); assert.deepEqual(f.input(), before);
  for (const name of ["permissionGranted", "comparable", "tasks", "cancelDailyPlan", "grant"]) assert.equal(name in result, false);
  assert.throws(() => f.read([], "0000-01-01T00:00:00Z"), code("INPUT_INVALID"));
});
test("a later cumulative cutoff cannot masquerade as the value at the exact window endpoint", () => {
  const f = fixture(); f.snapshot.measurement = "cumulative"; assert.equal(f.read().stage, "ready_for_evidence_review");
  f.snapshot.statisticsCutoffAt = f.snapshot.collectedAt = "2026-09-03T00:00:00Z";
  assert.ok(f.read().reasons.includes("cumulative_endpoint_missing"));
});
test("source days may have different lengths but never imply proven DST or same post-publication age", () => {
  const f = fixture(); f.config.defaultWindow = { kind: "platform_days", days: 2 }; f.window.policy = f.config.defaultWindow;
  f.window.startsAt = "2026-09-02T00:00:00Z"; f.window.endsAt = "2026-09-03T23:00:00Z";
  f.window.calendar = { calendarId: randomUUID(), sourceTimeZone: "fixture-source-calendar", publicationDayStartsAt: "2026-09-01T00:00:00Z", publicationDayEndsAt: f.window.startsAt, boundaries: [f.window.startsAt, "2026-09-03T00:00:00Z", f.window.endsAt] };
  assert.equal(parseObservationWindow(f.config, f.window).policy.kind, "platform_days");
  assert.throws(() => parseObservationWindow(f.config, { ...f.window, calendar: { ...f.window.calendar, boundaries: [f.window.startsAt, f.window.endsAt] } }), code("WINDOW_INVALID"));
  assert.throws(() => parseObservationWindow(f.config, { ...f.window, publishedAt: "0000-01-01T00:00:00Z" }), code("INPUT_INVALID"));
});
