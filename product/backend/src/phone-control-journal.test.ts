import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ActionPermissionError, parsePhoneControlRecord } from "./action-permission-core.js";

test("persisted control boundary rejects malformed and false-stopped records without echoing values", () => {
  const record = { deviceId: randomUUID(), version: 0, controlGeneration: "1", holderId: null, disposition: "stop_requested",
    stopRequestId: randomUUID(), calls: [], stopEvidenceId: null };
  assert.deepEqual(parsePhoneControlRecord(record), record);
  for (const input of ["fixture-secret", { ...record, calls: null }, { ...record, permissionGranted: true },
    { ...record, disposition: "stopped" }, { ...record, controlGeneration: 1 }, { ...record, version: 0.5 }]) {
    assert.throws(() => parsePhoneControlRecord(input), (error: unknown) => {
      assert.ok(error instanceof ActionPermissionError);
      assert.equal(error.code, "INVALID_BOUNDARY");
      assert.equal(error.cause, undefined);
      assert.ok(!error.message.includes("fixture-secret"));
      return true;
    });
  }
});
