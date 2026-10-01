import { z } from "zod";
import { compareTimestamps, timestampSchema, uuidSchema } from "@socialgrowth/product-contracts";
const zones = ["UTC", "Asia/Shanghai", "America/New_York", "Europe/London", "Australia/Lord_Howe", "Pacific/Apia"] as const;
const inputSchema = z.strictObject({ calendarId: uuidSchema, sourceTimeZone: z.enum(zones), dayStartsAt: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  expectedTzdataVersion: z.string().regex(/^[0-9]{4}[a-z]$/), publishedAt: timestampSchema.refine(v => Number(v.slice(0, 4)) >= 2000 && Number(v.slice(0, 4)) <= 2099), days: z.int().min(1).max(366) });
export class RuntimeCalendarError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "RUNTIME_UNAVAILABLE" | "TZDATA_VERSION_CHANGED" | "CIVIL_BOUNDARY_UNRESOLVED") { super(code); }
}
type Civil = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const serial = (c: Civil) => Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) / 1000;
function shifted(c: Civil, days: number): Civil {
  const d = new Date((serial(c) + days * 86400) * 1000);
  if (d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2099) throw new RuntimeCalendarError("CIVIL_BOUNDARY_UNRESOLVED");
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: c.hour, minute: c.minute, second: c.second };
}
function utc(second: number) { return new Date(second * 1000).toISOString(); }
// INTERNAL clock-conversion component, not an approved platform-day producer.
// No source/publication authentication, TZif import, persistent history, model,
// permits or scheduler. ICU data version is explicit and never silently changes.
export function buildRuntimeSourceCalendar(input: unknown) {
  const p = inputSchema.safeParse(input); if (!p.success) throw new RuntimeCalendarError("INPUT_INVALID"); const r = p.data;
  const tzdata = process.versions.tz, icu = process.versions.icu;
  if (!tzdata || !icu) throw new RuntimeCalendarError("RUNTIME_UNAVAILABLE");
  if (r.expectedTzdataVersion !== tzdata) throw new RuntimeCalendarError("TZDATA_VERSION_CHANGED");
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", { timeZone: r.sourceTimeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { throw new RuntimeCalendarError("RUNTIME_UNAVAILABLE"); }
  function civil(second: number): Civil {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(second * 1000)).map(v => [v.type, v.value]));
    const c = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
    if (Object.values(c).some(v => !Number.isSafeInteger(v)) || c.hour > 23) throw new RuntimeCalendarError("RUNTIME_UNAVAILABLE"); return c;
  }
  function boundary(c: Civil): number {
    const local = serial(c), offsets = new Set<number>();
    // Supported six zones/2000..2099 have stable offset periods, sampled on
    // both sides (incl. date-line shifts); every candidate is round-tripped.
    // No earlier/later guess for a gap or duplicate local cutoff.
    for (let hours = -72; hours <= 72; hours++) { const second = local + hours * 3600; offsets.add(serial(civil(second)) - second); }
    const candidates = [...offsets].map(offset => local - offset).filter(second => serial(civil(second)) === local);
    if (candidates.length !== 1) throw new RuntimeCalendarError("CIVIL_BOUNDARY_UNRESOLVED"); return candidates[0]!;
  }
  // Fractions never go through Date.parse. Date is used ONLY for complete
  // seconds to locate a civil date; exact original fractions select boundaries.
  const whole = r.publishedAt.replace(/\.\d+(?=Z|[+-][0-9]{2}:[0-9]{2}$)/, ""), publishedSecond = Date.parse(whole) / 1000;
  const local = civil(publishedSecond), [hour, minute, second] = r.dayStartsAt.split(":").map(Number);
  let day = { ...local, hour: hour!, minute: minute!, second: second! };
  if (compareTimestamps(r.publishedAt, utc(boundary(day)))! < 0) day = shifted(day, -1);
  const publicationDayStartsAt = utc(boundary(day)), publicationDayEndsAt = utc(boundary(shifted(day, 1)));
  if (compareTimestamps(publicationDayStartsAt, r.publishedAt)! > 0 || compareTimestamps(r.publishedAt, publicationDayEndsAt)! >= 0) throw new RuntimeCalendarError("CIVIL_BOUNDARY_UNRESOLVED");
  const startsOnPublicationDay = compareTimestamps(r.publishedAt, publicationDayStartsAt) === 0, first = startsOnPublicationDay ? day : shifted(day, 1);
  const boundaries = Array.from({ length: r.days + 1 }, (_, index) => utc(boundary(shifted(first, index))));
  if (boundaries.some((value, index) => index > 0 && compareTimestamps(boundaries[index - 1]!, value)! >= 0)) throw new RuntimeCalendarError("CIVIL_BOUNDARY_UNRESOLVED");
  return { calendar: { calendarId: r.calendarId.toLowerCase(), sourceTimeZone: r.sourceTimeZone, publicationDayStartsAt, publicationDayEndsAt, boundaries },
    startsAt: boundaries[0]!, endsAt: boundaries.at(-1)!, partialPublicationDay: startsOnPublicationDay ? null : { startsAt: r.publishedAt, endsAt: boundaries[0]! },
    provenance: { engine: "node_icu" as const, icuVersion: icu, tzdataVersion: tzdata, dayStartsAt: r.dayStartsAt },
    sourcePolicyVerificationRequired: true as const, executionAllowed: false as const, publicationAllowed: false as const };
}
