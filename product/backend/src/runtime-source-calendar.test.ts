import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildRuntimeSourceCalendar, RuntimeCalendarError } from "./runtime-source-calendar.js";
import { parseObservationWindow } from "./observation-window-core.js";
const fixture = (sourceTimeZone = "America/New_York", publishedAt = "2026-03-08T05:00:00Z") => ({ calendarId: randomUUID(), sourceTimeZone, dayStartsAt: "00:00:00", expectedTzdataVersion: process.versions.tz!, publishedAt, days: 1 });
const code = (value: RuntimeCalendarError["code"]) => (e: unknown) => e instanceof RuntimeCalendarError && e.code === value;
test("actual runtime New York spring/fall days are 23/25 hours, not manufactured 24h fixtures", () => {
  const spring = buildRuntimeSourceCalendar(fixture()), fall = buildRuntimeSourceCalendar(fixture("America/New_York", "2026-11-01T04:00:00Z"));
  assert.equal(spring.endsAt, "2026-03-09T04:00:00.000Z"); assert.equal(fall.endsAt, "2026-11-02T05:00:00.000Z");
  assert.equal(Date.parse(spring.endsAt) - Date.parse(spring.startsAt), 23 * 3600000); assert.equal(Date.parse(fall.endsAt) - Date.parse(fall.startsAt), 25 * 3600000);
  assert.equal(spring.provenance.tzdataVersion, process.versions.tz); assert.equal(spring.executionAllowed, false); assert.equal(spring.sourcePolicyVerificationRequired, true);
});
test("arbitrary fraction and equivalent UTC offset preserve exact first full day and partial original instant", () => {
  const publishedAt = "2026-03-08T05:00:00." + "0".repeat(511) + "1Z";
  const partial = buildRuntimeSourceCalendar(fixture("America/New_York", publishedAt)); assert.equal(partial.startsAt, "2026-03-09T04:00:00.000Z"); assert.equal(partial.partialPublicationDay!.startsAt, publishedAt);
  const exact = buildRuntimeSourceCalendar(fixture("America/New_York", "2026-03-08T13:00:00.000000000000+08:00")); assert.equal(exact.startsAt, "2026-03-08T05:00:00.000Z"); assert.equal(exact.partialPublicationDay, null);
});
test("explicit non-midnight cutoff uses containing previous day and never defaults to device/server midnight", () => {
  const f = { ...fixture("Asia/Shanghai", "2026-10-01T01:59:59.999999Z"), dayStartsAt: "10:00:00" }, r = buildRuntimeSourceCalendar(f);
  assert.equal(r.calendar.publicationDayStartsAt, "2026-09-30T02:00:00.000Z"); assert.equal(r.calendar.publicationDayEndsAt, "2026-10-01T02:00:00.000Z"); assert.equal(r.startsAt, "2026-10-01T02:00:00.000Z");
});
test("missing or duplicate DST cutoff and skipped civil date refuse instead of guessing earlier/later time", () => {
  for (const f of [{ ...fixture(), dayStartsAt: "02:30:00" }, { ...fixture("America/New_York", "2026-11-01T06:00:00Z"), dayStartsAt: "01:30:00" }, fixture("Pacific/Apia", "2011-12-29T10:00:00Z")]) assert.throws(() => buildRuntimeSourceCalendar(f), code("CIVIL_BOUNDARY_UNRESOLVED"));
});
test("actual London and half-hour Lord Howe transition durations remain exact", () => {
  const london = buildRuntimeSourceCalendar(fixture("Europe/London", "2026-03-29T00:00:00Z")); assert.equal(Date.parse(london.endsAt) - Date.parse(london.startsAt), 23 * 3600000);
  const lord = buildRuntimeSourceCalendar(fixture("Australia/Lord_Howe", "2026-10-03T13:30:00Z")); assert.equal(Date.parse(lord.endsAt) - Date.parse(lord.startsAt), 23.5 * 3600000);
});
test("runtime version drift and strict/unsupported inputs close without policy or data fallback", () => {
  assert.throws(() => buildRuntimeSourceCalendar({ ...fixture(), expectedTzdataVersion: "1900a" }), code("TZDATA_VERSION_CHANGED"));
  for (const patch of [{ sourceTimeZone: "Mars/Unknown" }, { dayStartsAt: "24:00:00" }, { days: 0 }, { days: true }, { days: 367 }, { publishedAt: "1999-12-31T23:59:59Z" }, { executionAllowed: true }]) assert.throws(() => buildRuntimeSourceCalendar({ ...fixture(), ...patch }), code("INPUT_INVALID"));
  assert.throws(() => buildRuntimeSourceCalendar({ ...fixture(), dayStartsAt: undefined }), code("INPUT_INVALID")); assert.throws(() => buildRuntimeSourceCalendar(fixture("UTC", "2099-12-31T00:00:00Z")), code("CIVIL_BOUNDARY_UNRESOLVED"));
});
test("366 actual UTC days have exact continuous boundaries across leap day, input/output isolation", () => {
  const f = { ...fixture("UTC", "2024-01-01T00:00:00Z"), days: 366 }, before = structuredClone(f), r = buildRuntimeSourceCalendar(f);
  assert.equal(r.calendar.boundaries.length, 367); assert.equal(r.endsAt, "2025-01-01T00:00:00.000Z"); assert.deepEqual(f, before);
  r.calendar.boundaries[0] = "bad"; assert.equal(buildRuntimeSourceCalendar(f).startsAt, "2024-01-01T00:00:00.000Z");
});
test("actual calendar output fits original platform-day guard but still cannot claim approved policy or verified publication", () => {
  const calendar = buildRuntimeSourceCalendar(fixture()), projectId = randomUUID(), window = { windowId: randomUUID(), projectId, configVersion: 1, identityId: randomUUID(), platform: "facebook", form: "facebook_video",
    publicationId: randomUUID(), taskId: randomUUID(), contentUnitId: randomUUID(), variantId: randomUUID(), publishedAt: "2026-03-08T05:00:00Z", startsAt: calendar.startsAt, endsAt: calendar.endsAt, policy: { kind: "platform_days", days: 1 }, calendar: calendar.calendar };
  assert.equal(parseObservationWindow({ projectId, configVersion: 1, defaultWindow: window.policy, overrides: [] }, window).endsAt, calendar.endsAt); assert.equal(calendar.publicationAllowed, false);
});
test("offset labels cannot admit a containing civil date outside the declared 2000..2099 profile", () => {
  for (const publishedAt of ["2000-01-01T00:00:00+14:00", "2099-12-31T23:59:59-14:00"])
    assert.throws(() => buildRuntimeSourceCalendar(fixture("UTC", publishedAt)), code("CIVIL_BOUNDARY_UNRESOLVED"));
  assert.equal(buildRuntimeSourceCalendar(fixture("UTC", "2000-01-01T00:00:00Z")).startsAt, "2000-01-01T00:00:00.000Z");
  assert.equal(buildRuntimeSourceCalendar(fixture("Asia/Shanghai", "2000-01-01T00:00:00+08:00")).startsAt, "1999-12-31T16:00:00.000Z");
});
test("actual ICU historical rules are retained instead of applying current DST dates to all years", () => {
  const march2006 = buildRuntimeSourceCalendar(fixture("America/New_York", "2006-03-12T05:00:00Z"));
  const april2006 = buildRuntimeSourceCalendar(fixture("America/New_York", "2006-04-02T05:00:00Z"));
  const march2007 = buildRuntimeSourceCalendar(fixture("America/New_York", "2007-03-11T05:00:00Z"));
  assert.equal(Date.parse(march2006.endsAt) - Date.parse(march2006.startsAt), 24 * 3600000);
  assert.equal(Date.parse(april2006.endsAt) - Date.parse(april2006.startsAt), 23 * 3600000);
  assert.equal(Date.parse(march2007.endsAt) - Date.parse(march2007.startsAt), 23 * 3600000);
  const apia = buildRuntimeSourceCalendar(fixture("Pacific/Apia", "2022-09-24T11:00:00Z"));
  assert.equal(Date.parse(apia.endsAt) - Date.parse(apia.startsAt), 24 * 3600000); assert.equal(apia.publicationAllowed, false);
});
