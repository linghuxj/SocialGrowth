import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyProjectPlanningInputs } from "@socialgrowth/product-contracts";
import { planningFormOf, planningInputOf } from "./project-planning-editor.js";
test("blank form roundtrips nulls and empty lists without business defaults", () => {
  const empty = emptyProjectPlanningInputs(); assert.deepEqual(planningInputOf(planningFormOf()), empty);
  const f = planningFormOf(); f.trafficMinimumPerCycle = "0"; f.tailObservationDays = "0";
  assert.equal(planningInputOf(f).trafficMinimumPerCycle, 0); assert.equal(planningInputOf(f).reviewIntervalDays, null);
});
test("form preserves comma editing but rejects missing list elements and duplicates instead of silently widening scope", () => {
  const f = planningFormOf(); for (const raw of ["es,", "es,,pt", "es,es"]) assert.throws(() => planningInputOf({ ...f, targetLanguages: raw }));
  assert.deepEqual(planningInputOf({ ...f, targetLanguages: "es， pt\nen" }).targetLanguages, ["es", "pt", "en"]);
});
test("integer bounds, time-zone casing and full offset timestamps close instead of coercing unknowns", () => {
  const f = planningFormOf(); for (const raw of ["1.5", "-1", "1e3", "01", " ", "9007199254740992"]) assert.throws(() => planningInputOf({ ...f, maxPublicationsPerDay: raw }));
  assert.throws(() => planningInputOf({ ...f, businessTimeZone: "asia/shanghai" })); assert.throws(() => planningInputOf({ ...f, firstCycleStartsAt: "2026-10-02T10:00:00" }));
  assert.throws(() => planningInputOf({ ...f, windowStart: "2026-10-02T00:00:00Z" }));
  assert.throws(() => planningInputOf({ ...f, windowStart: "2026-10-02T00:00:00Z", windowEnd: "2026-10-02T00:00:00Z" }));
  assert.equal(planningInputOf({ ...f, firstCycleStartsAt: "2026-10-02T08:00:00+08:00" }).firstCycleStartsAt, "2026-10-02T08:00:00+08:00");
});
