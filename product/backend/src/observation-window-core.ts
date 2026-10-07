import { z } from "zod";
import { compareTimestamps, projectLabelSchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { readMetricReport } from "./metric-snapshot-core.js";
const id = uuidSchema.transform(v => v.toLowerCase());
const time = timestampSchema.refine(v => !v.startsWith("0000-"));
const policy = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("exact_hours"), hours: z.int().min(1) }), z.strictObject({ kind: z.literal("platform_days"), days: z.int().min(1).max(366) })]);
const form = z.enum(["facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"]);
const configSchema = z.strictObject({ projectId: id, configVersion: z.int().min(1), defaultWindow: policy, overrides: z.array(z.strictObject({ form, window: policy })).max(4) })
  .refine(v => new Set(v.overrides.map(o => o.form)).size === v.overrides.length);
const windowSchema = z.strictObject({ windowId: id, projectId: id, configVersion: z.int().min(1), identityId: id, platform: z.enum(["facebook", "youtube"]), form,
  publicationId: id, taskId: id, contentUnitId: id, variantId: id, publishedAt: time, startsAt: time, endsAt: time, policy,
  // Only a trusted source-calendar producer can establish real full days/DST.
  calendar: z.strictObject({ calendarId: id, sourceTimeZone: projectLabelSchema, publicationDayStartsAt: time, publicationDayEndsAt: time, boundaries: z.array(time).min(2).max(367) }).nullable(),
});
export type ObservationConfig = z.infer<typeof configSchema>;
export type ObservationWindow = z.infer<typeof windowSchema>;
export class ObservationWindowError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "WINDOW_INVALID" | "METRIC_INVALID") { super(code); }
}
function fail(code: ObservationWindowError["code"]): never { throw new ObservationWindowError(code); }
const equal = (a: string, b: string) => compareTimestamps(a, b) === 0;
// Convert only whole calendar seconds through Date; never truncate a fraction.
function ticks(value: string, width: number): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)!;
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3])); date.setUTCHours(Number(match[4]), Number(match[5]), Number(match[6]), 0);
  const offset = match[8] === "Z" ? 0 : (match[9] === "+" ? 1 : -1) * (Number(match[10]) * 60 + Number(match[11]));
  return BigInt(date.getTime() / 1000 - offset * 60) * 10n ** BigInt(width) + BigInt((match[7] ?? "").padEnd(width, "0") || "0");
}
function widthOf(times: string[]): number { return Math.max(0, ...times.map(t => /\.(\d+)/.exec(t)?.[1]?.length ?? 0)); }
function sameDuration(a: string, b: string, c: string, d: string): boolean {
  const width = widthOf([a, b, c, d]); return ticks(b, width) - ticks(a, width) === ticks(d, width) - ticks(c, width);
}
export function selectObservationPolicy(input: unknown, inputForm: unknown) {
  const parsed = configSchema.safeParse(input), parsedForm = form.safeParse(inputForm);
  if (!parsed.success || !parsedForm.success) return fail("INPUT_INVALID");
  return parsed.data.overrides.find(o => o.form === parsedForm.data)?.window ?? parsed.data.defaultWindow;
}
export function parseObservationWindow(config: unknown, input: unknown): ObservationWindow {
  const c = configSchema.safeParse(config), w = windowSchema.safeParse(input);
  if (!c.success || !w.success) return fail("INPUT_INVALID");
  const row = w.data, selected = selectObservationPolicy(c.data, row.form);
  if (row.projectId !== c.data.projectId || row.configVersion !== c.data.configVersion || JSON.stringify(row.policy) !== JSON.stringify(selected)
    || row.form.startsWith("facebook_") !== (row.platform === "facebook") || compareTimestamps(row.startsAt, row.endsAt)! >= 0) fail("WINDOW_INVALID");
  if (row.policy.kind === "exact_hours") {
    const width = widthOf([row.startsAt, row.endsAt]);
    if (row.calendar !== null || !equal(row.startsAt, row.publishedAt) || ticks(row.endsAt, width) - ticks(row.startsAt, width) !== BigInt(row.policy.hours) * 3600n * 10n ** BigInt(width)) fail("WINDOW_INVALID");
  } else {
    const cal = row.calendar;
    if (!cal || cal.boundaries.length !== row.policy.days + 1 || compareTimestamps(cal.publicationDayStartsAt, row.publishedAt)! > 0
      || compareTimestamps(row.publishedAt, cal.publicationDayEndsAt)! >= 0 || compareTimestamps(cal.publicationDayStartsAt, cal.publicationDayEndsAt)! >= 0) fail("WINDOW_INVALID");
    const start = equal(row.publishedAt, cal.publicationDayStartsAt) ? cal.publicationDayStartsAt : cal.publicationDayEndsAt;
    if (!equal(row.startsAt, start) || !equal(row.startsAt, cal.boundaries[0]!) || !equal(row.endsAt, cal.boundaries.at(-1)!)
      || cal.boundaries.some((b, i) => i > 0 && compareTimestamps(cal.boundaries[i - 1]!, b)! >= 0)) fail("WINDOW_INVALID");
  }
  return row;
}
export type ObservationReadiness = { window: ObservationWindow; stage: "observing" | "data_insufficient" | "ready_for_evidence_review"; reasons: string[]; snapshotId: string | null; metric: { sourceId: string; sourceReportId: string; definitionId: string; measurement: string; sourceTimeZone: string | null } | null; partialPublicationDay: { startsAt: string; endsAt: string } | null };
// INTERNAL pure guard, not proof of source authorization, calendar approval,
// publication or evidence sufficiency. No scheduler, model or execution grant.
export function evaluateObservationWindow(config: unknown, input: unknown, history: unknown, sourceId: string, reportId: string, evaluatedAt: string): ObservationReadiness {
  const window = parseObservationWindow(config, input), clock = time.safeParse(evaluatedAt);
  if (!clock.success) return fail("INPUT_INVALID");
  let snapshot;
  try { snapshot = readMetricReport(history, sourceId, reportId); } catch { return fail("METRIC_INVALID"); }
  const reasons: string[] = [];
  if (compareTimestamps(clock.data, window.endsAt)! < 0) reasons.push("window_not_ended");
  if (!snapshot) reasons.push("observation_missing");
  else {
    const s = snapshot.subject;
    if (snapshot.projectId !== window.projectId || snapshot.identityId !== window.identityId || snapshot.platform !== window.platform || s.kind !== "content"
      || s.publicationId !== window.publicationId || s.taskId !== window.taskId || s.contentUnitId !== window.contentUnitId || s.variantId !== window.variantId) reasons.push("publication_scope_unproven");
    if (snapshot.availability !== "available" || snapshot.value === null) reasons.push("data_unavailable");
    if (snapshot.sourceTimeZone === null) reasons.push("source_timezone_unknown");
    if (compareTimestamps(snapshot.collectedAt, clock.data)! > 0) reasons.push("observation_from_future");
    // A superset/cumulative lifetime cannot be proportionally split into a window.
    if (!snapshot.coverage || !equal(snapshot.coverage.startsAt, window.startsAt) || !equal(snapshot.coverage.endsAt, window.endsAt)) reasons.push("exact_coverage_missing");
    if (!snapshot.statisticsCutoffAt || compareTimestamps(snapshot.statisticsCutoffAt, window.endsAt)! < 0) reasons.push("cutoff_insufficient");
    if (window.calendar && snapshot.sourceTimeZone !== window.calendar.sourceTimeZone) reasons.push("source_calendar_mismatch");
    if (snapshot.measurement === "cumulative" && !equal(window.startsAt, window.publishedAt)) reasons.push("cumulative_partial_day_not_separable");
    if (snapshot.measurement === "cumulative" && (!snapshot.statisticsCutoffAt || !equal(snapshot.statisticsCutoffAt, window.endsAt))) reasons.push("cumulative_endpoint_missing");
  }
  return { window, stage: reasons.includes("window_not_ended") ? "observing" : reasons.length ? "data_insufficient" : "ready_for_evidence_review", reasons,
    snapshotId: snapshot?.snapshotId ?? null, metric: snapshot ? { sourceId: snapshot.sourceId, sourceReportId: snapshot.sourceReportId, definitionId: snapshot.definitionId, measurement: snapshot.measurement, sourceTimeZone: snapshot.sourceTimeZone } : null,
    partialPublicationDay: window.calendar && !equal(window.startsAt, window.publishedAt) ? { startsAt: window.publishedAt, endsAt: window.startsAt } : null };
}
const observationInput = z.strictObject({ config: z.unknown(), window: z.unknown(), history: z.unknown(), sourceId: id, reportId: id });
export function evaluateObservationPair(leftInput: unknown, rightInput: unknown, evaluatedAt: string) {
  const l = observationInput.safeParse(leftInput), r = observationInput.safeParse(rightInput);
  if (!l.success || !r.success) return fail("INPUT_INVALID");
  const evaluate = (v: z.infer<typeof observationInput>) => evaluateObservationWindow(v.config, v.window, v.history, v.sourceId, v.reportId, evaluatedAt);
  const left = evaluate(l.data), right = evaluate(r.data);
  const a = left.window, b = right.window, reasons: string[] = [];
  if (left.stage !== "ready_for_evidence_review" || right.stage !== "ready_for_evidence_review") reasons.push("not_ready");
  if (a.windowId === b.windowId || a.publicationId === b.publicationId) reasons.push("same_observation");
  if (a.projectId !== b.projectId || a.platform !== b.platform || a.form !== b.form || JSON.stringify(a.policy) !== JSON.stringify(b.policy)) reasons.push("window_definition_mismatch");
  if (!sameDuration(a.startsAt, a.endsAt, b.startsAt, b.endsAt) || !sameDuration(a.publishedAt, a.startsAt, b.publishedAt, b.startsAt)) reasons.push("duration_or_age_mismatch");
  if (a.calendar?.sourceTimeZone !== b.calendar?.sourceTimeZone || a.calendar?.calendarId !== b.calendar?.calendarId) reasons.push("source_calendar_mismatch");
  if (!left.metric || !right.metric || left.metric.sourceId !== right.metric.sourceId || left.metric.definitionId !== right.metric.definitionId
    || left.metric.measurement !== right.metric.measurement || left.metric.sourceTimeZone !== right.metric.sourceTimeZone) reasons.push("metric_definition_mismatch");
  if (left.snapshotId !== null && left.snapshotId === right.snapshotId || left.metric && right.metric && left.metric.sourceId === right.metric.sourceId && left.metric.sourceReportId === right.metric.sourceReportId) reasons.push("same_metric_observation");
  return { left, right, alignedForEvidenceReview: reasons.length === 0, reasons };
}
