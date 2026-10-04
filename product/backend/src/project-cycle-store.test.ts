import assert from "node:assert/strict";
import { test } from "node:test";
import { nextCycleBoundary, resolveProjectCycleWindow } from "./project-cycle-store.js";

test("project cycle windows preserve the approved instant and advance local days in fixed-offset zones", () => {
  assert.deepEqual(resolveProjectCycleWindow("2026-10-04T02:30:00.123+08:00", 7, "Asia/Shanghai"), {
    startsAt: "2026-10-03T18:30:00.123Z", endsAt: "2026-10-10T18:30:00.123Z",
  });
  assert.deepEqual(resolveProjectCycleWindow("2026-10-04T02:30:00.123Z", 7, "UTC"), {
    startsAt: "2026-10-04T02:30:00.123Z", endsAt: "2026-10-11T02:30:00.123Z",
  });
});

test("a local boundary through a DST gap or fold remains unresolved", () => {
  assert.equal(resolveProjectCycleWindow("2026-03-01T07:30:00Z", 7, "America/New_York"), null);
  assert.equal(resolveProjectCycleWindow("2026-10-25T05:30:00Z", 7, "America/New_York"), null);
});

test("a window crossing a time-zone offset transition stays unresolved even when its end time is unique", () => {
  assert.equal(resolveProjectCycleWindow("2026-03-07T17:00:00Z", 2, "America/New_York"), null);
});

test("unverified range, excessive interval and invalid zones fail closed", () => {
  assert.equal(resolveProjectCycleWindow("2099-12-31T23:00:00Z", 1, "UTC"), null);
  assert.equal(resolveProjectCycleWindow("2026-01-01T00:00:00Z", 367, "UTC"), null);
  assert.equal(resolveProjectCycleWindow("2026-01-01T00:00:00Z", 1, "GMT+8"), null);
});

test("a later approved configuration cannot make an elapsed prior boundary retroactive", () => {
  assert.equal(nextCycleBoundary("2026-10-04T11:59:59.999999Z", "2026-10-04T12:00:00.000001Z"), null);
  assert.equal(nextCycleBoundary("2026-10-04T12:00:00.000001Z", "2026-10-04T12:00:00.000001Z"), "2026-10-04T12:00:00.000001Z");
  assert.equal(nextCycleBoundary("bad", "2026-10-04T12:00:00Z"), null);
});
