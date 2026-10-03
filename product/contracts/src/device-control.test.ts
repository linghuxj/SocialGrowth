import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { contractVersion } from "./common.js";
import { deviceControlSnapshotSchema, installationSelfControlCommandRequestSchema, providerDeviceControlCommandRequestSchema } from "./device-control.js";

test("device control command schemas require common idempotency metadata and reject body authority", () => {
  const body = { metadata: { contractVersion, requestId: "request-control-001", idempotencyKey: "control-key-0000001" } };
  assert.equal(providerDeviceControlCommandRequestSchema.safeParse(body).success, true);
  assert.equal(installationSelfControlCommandRequestSchema.safeParse(body).success, true);
  assert.equal(installationSelfControlCommandRequestSchema.safeParse({ ...body, deviceId: randomUUID() }).success, false);
  assert.equal(providerDeviceControlCommandRequestSchema.safeParse({ ...body, authorized: true }).success, false);
  assert.equal(providerDeviceControlCommandRequestSchema.safeParse({ metadata: { ...body.metadata, contractVersion: "wrong" } }).success, false);
});

test("initial control snapshot preserves unknown prior facts as null and distinguishes stop proof", () => {
  const empty = deviceControlSnapshotSchema.parse({ contractVersion, deviceId: randomUUID(), requestId: null, intent: "active",
    controlVersion: null, controlGeneration: null, stop: "not_requested", unresolvedActionCount: 0, checkedAt: "2026-10-04T12:00:00Z" });
  assert.equal(empty.requestId, null);
  for (const invalid of [
    { ...empty, stop: "confirmed", controlGeneration: null },
    { ...empty, unresolvedActionCount: -1 },
    { ...empty, requestId: "" },
  ]) assert.equal(deviceControlSnapshotSchema.safeParse(invalid).success, false);
});
