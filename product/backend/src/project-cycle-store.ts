import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { compareTimestamps, directionApprovalSchema, projectPlanningInputsSchema, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
import { appendProjectCycle, parseProjectCycles, ProjectCycleError, type ProjectCycle } from "./project-cycle-core.js";

const s = "socialgrowth_product";
const DAY_SECONDS = 86_400;
const VERIFIED_YEAR_MIN = 2000;
const VERIFIED_YEAR_MAX = 2099;
const MAX_DAYS_PER_WINDOW = 366;

export type ProjectCycleAppendResult =
  | { state: "created"; cycle: ProjectCycle }
  | { state: "unchanged"; cycle: ProjectCycle }
  | { state: "unresolved"; reason: "approved_inputs_missing" | "calendar_runtime_unavailable" | "outside_verified_calendar_range" | "civil_boundary_ambiguous" | "previous_window_elapsed" };

/** A later approved configuration may align to the prior end only while that
 * boundary is still current. Both values must come from the database clock/source. */
export function nextCycleBoundary(previousEndsAt: string, approvedAt: string): string | null {
  const end = timestampSchema.safeParse(previousEndsAt), approved = timestampSchema.safeParse(approvedAt);
  if (!end.success || !approved.success || end.data.startsWith("0000-") || approved.data.startsWith("0000-")) return null;
  return compareTimestamps(approved.data, end.data)! <= 0 ? end.data : null;
}

type Civil = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function serial(c: Civil): number {
  const d = new Date(0);
  d.setUTCFullYear(c.year, c.month - 1, c.day);
  d.setUTCHours(c.hour, c.minute, c.second, 0);
  return d.getTime() / 1000;
}
function civilFromSerial(seconds: number): Civil {
  const d = new Date(seconds * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}
function sameCivil(a: Civil, b: Civil): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
    && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

function parseInstant(value: string): { seconds: number; fraction: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return null;
  const fields = m.slice(1, 7).map(Number);
  const [year, month, day, hour, minute, second] = fields as [number, number, number, number, number, number];
  const local = { year, month, day, hour, minute, second };
  if (year < VERIFIED_YEAR_MIN || year > VERIFIED_YEAR_MAX || !sameCivil(civilFromSerial(serial(local)), local)) return null;
  const offset = m[8] === "Z" ? 0 : (m[9] === "+" ? 1 : -1) * (Number(m[10]) * 60 + Number(m[11]));
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 14 * 60) return null;
  return { seconds: serial(local) - offset * 60, fraction: m[7] ?? "" };
}

function isoUtc(seconds: number, fraction: string): string {
  const whole = new Date(seconds * 1000).toISOString().slice(0, 19);
  return `${whole}${fraction ? `.${fraction}` : ""}Z`;
}

export function resolveProjectCycleWindow(start: string, days: number, timeZone: string): { startsAt: string; endsAt: string } | null {
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_DAYS_PER_WINDOW
    || !projectPlanningInputsSchema.shape.businessTimeZone.safeParse(timeZone).success) return null;
  const instant = parseInstant(start);
  if (!instant) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", { timeZone, hourCycle: "h23", year: "numeric",
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return null; }
  const civilAt = (seconds: number): Civil | null => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(p => [p.type, p.value]));
    const civil = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour),
      minute: Number(parts.minute), second: Number(parts.second) };
    return Object.values(civil).every(Number.isSafeInteger) && civil.hour <= 23 ? civil : null;
  };
  const first = civilAt(instant.seconds);
  if (!first) return null;
  const target = civilFromSerial(serial(first) + days * DAY_SECONDS);
  if (target.year < VERIFIED_YEAR_MIN || target.year > VERIFIED_YEAR_MAX) return null;

  // Resolve the target wall-clock instant from real ICU offsets and require
  // exactly one round-trip. A DST gap yields no candidates; a fold yields two.
  // No earlier/later guess is made for either case.
  const localSeconds = serial(target), offsets = new Set<number>();
  for (let hour = -72; hour <= 72; hour++) {
    const probe = localSeconds + hour * 3600;
    const probeCivil = civilAt(probe);
    if (!probeCivil) return null;
    offsets.add(serial(probeCivil) - probe);
  }
  const candidates = [...offsets].map(offset => localSeconds - offset)
    .filter(candidate => {
      const roundTrip = civilAt(candidate);
      return roundTrip !== null && sameCivil(roundTrip, target);
    });
  if (candidates.length !== 1) return null;
  const startOffset = serial(first) - instant.seconds;
  // Requirements have not confirmed how an interval should behave when its
  // business zone changes offset. Fail closed for the entire window rather
  // than choosing elapsed-time or civil-time DST semantics implicitly.
  for (let probe = instant.seconds + 3600; probe < candidates[0]!; probe += 3600) {
    const local = civilAt(probe);
    if (!local || serial(local) - probe !== startOffset) return null;
  }
  const endCivil = civilAt(candidates[0]!);
  if (!endCivil || serial(endCivil) - candidates[0]! !== startOffset) return null;
  const startYear = civilAt(instant.seconds)?.year;
  const endYear = civilAt(candidates[0]!)?.year;
  if (!startYear || !endYear || startYear < VERIFIED_YEAR_MIN || endYear > VERIFIED_YEAR_MAX) return null;
  return { startsAt: isoUtc(instant.seconds, instant.fraction), endsAt: isoUtc(candidates[0]!, instant.fraction) };
}

interface PersistedCycle extends ProjectCycle {
  cycle_number: string;
  approval_id: string;
  project_version: string;
}

/**
 * Writes only immutable review-window facts derived from the approved direction.
 * It does not observe external metrics, assign Tasks, or claim review completion.
 */
export class ProjectCycleStore {
  async appendApprovedConfiguration(c: PoolClient, approvalInput: unknown): Promise<ProjectCycleAppendResult> {
    const approval = directionApprovalSchema.parse(approvalInput);
    const projectId = uuidSchema.parse(approval.proposal.projectId).toLowerCase();
    const project = (await c.query<{ fact_version: string }>(
      `SELECT fact_version::text FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
    const projectVersion = approval.proposal.projectVersion + 1;
    if (!project || Number(project.fact_version) !== projectVersion) throw new ProjectCycleError("BOUNDARY_STALE");
    const inputs = projectPlanningInputsSchema.parse(approval.proposal.scope.inputs);
    if (!inputs.businessTimeZone || !inputs.firstCycleStartsAt || inputs.reviewIntervalDays === null || inputs.trafficMinimumPerCycle === null)
      return { state: "unresolved", reason: "approved_inputs_missing" };
    const tzdataVersion = process.versions.tz;
    const icuVersion = process.versions.icu;
    if (!tzdataVersion || !icuVersion) return { state: "unresolved", reason: "calendar_runtime_unavailable" };

    const rawHistory = (await c.query<PersistedCycle>(`SELECT cycle_id AS "cycleId",project_id AS "projectId",config_version::text AS "configVersion",
      business_time_zone AS "businessTimeZone",starts_at AS "startsAt",ends_at AS "endsAt",traffic_minimum AS "trafficMinimum",
      cycle_number::text,approval_id,project_version::text FROM ${s}.project_review_cycles
      WHERE project_id=$1 ORDER BY cycle_number FOR UPDATE`, [projectId])).rows;
    const history = parseProjectCycles(rawHistory.map(row => ({ cycleId: row.cycleId, projectId: row.projectId,
      configVersion: Number(row.configVersion), businessTimeZone: row.businessTimeZone, startsAt: row.startsAt,
      endsAt: row.endsAt, trafficMinimum: row.trafficMinimum })));
    const previous = history.at(-1);
    if (previous?.configVersion === projectVersion) {
      const existing = rawHistory.at(-1)!;
      if (existing.approval_id !== approval.approvalId) throw new ProjectCycleError("BOUNDARY_STALE");
      return { state: "unchanged", cycle: previous };
    }
    if (previous && previous.configVersion > projectVersion) throw new ProjectCycleError("BOUNDARY_STALE");

    let start = inputs.firstCycleStartsAt;
    if (previous) {
      // confirmedAt was captured from PostgreSQL clock_timestamp() while the
      // approval transaction held the shared source locks.
      const nextStart = nextCycleBoundary(previous.endsAt, approval.confirmedAt);
      if (!nextStart) return { state: "unresolved", reason: "previous_window_elapsed" };
      start = nextStart;
    }
    if (inputs.reviewIntervalDays > MAX_DAYS_PER_WINDOW) return { state: "unresolved", reason: "outside_verified_calendar_range" };
    const window = resolveProjectCycleWindow(start, inputs.reviewIntervalDays, inputs.businessTimeZone);
    if (!window) {
      const parsedStart = parseInstant(start);
      if (!parsedStart || parsedStart.seconds < Date.UTC(VERIFIED_YEAR_MIN, 0, 1) / 1000
        || parsedStart.seconds >= Date.UTC(VERIFIED_YEAR_MAX + 1, 0, 1) / 1000)
        return { state: "unresolved", reason: "outside_verified_calendar_range" };
      return { state: "unresolved", reason: "civil_boundary_ambiguous" };
    }
    const cycle: ProjectCycle = { cycleId: randomUUID(), projectId, configVersion: projectVersion,
      businessTimeZone: inputs.businessTimeZone, startsAt: window.startsAt, endsAt: window.endsAt,
      trafficMinimum: inputs.trafficMinimumPerCycle };
    const appended = appendProjectCycle(history, cycle, previous?.cycleId ?? null);
    if (!appended.changed) return { state: "unchanged", cycle: appended.cycles.at(-1)! };
    const number = appended.cycles.length;
    await c.query(`INSERT INTO ${s}.project_review_cycles(cycle_id,project_id,cycle_number,config_version,approval_id,project_version,
      business_time_zone,starts_at,ends_at,traffic_minimum,approved_inputs,icu_version,tzdata_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [cycle.cycleId, projectId, number, projectVersion, approval.approvalId,
      projectVersion, cycle.businessTimeZone, cycle.startsAt, cycle.endsAt, cycle.trafficMinimum, inputs, icuVersion, tzdataVersion]);
    return { state: "created", cycle };
  }
}
