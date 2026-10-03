import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import {
  confirmAssociationRequestSchema,
  providerDeviceLabelRequestSchema,
  providerDeviceLabelResponseSchema,
} from "./association.js";

const id = "00000000-0000-4000-8000-00000000000a";
const metadata = { contractVersion, requestId: "device-label-request", idempotencyKey: "device-label-command-0001" };
const device = {
  deviceId: id,
  displayName: "Living room phone",
  state: "associated_pending_access",
  factVersion: 2,
  updatedAt: "2026-10-04T00:00:00Z",
  lastObservedAt: null,
};

test("association may set an optional device label without changing the response shape", () => {
  const base = { metadata, associationSessionId: id, expectedInstallationId: id };
  assert.deepEqual(confirmAssociationRequestSchema.parse(base), base);
  assert.deepEqual(confirmAssociationRequestSchema.parse({ ...base, deviceLabel: " Desk phone " }).deviceLabel, "Desk phone");
  for (const deviceLabel of ["", "  ", "x".repeat(101), null]) {
    assert.equal(confirmAssociationRequestSchema.safeParse({ ...base, deviceLabel }).success, false);
  }
});

test("provider device label command is strict and its response carries the current versioned device", () => {
  const input = { metadata, expectedFactVersion: 1, displayName: " Office phone " };
  assert.deepEqual(providerDeviceLabelRequestSchema.parse(input), { ...input, displayName: "Office phone" });
  for (const patch of [{ expectedFactVersion: -1 }, { displayName: " " }, { displayName: "x".repeat(101) }, { providerId: id }]) {
    assert.equal(providerDeviceLabelRequestSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.deepEqual(providerDeviceLabelResponseSchema.parse({ device }), { device });
  assert.equal(providerDeviceLabelResponseSchema.safeParse({ device: { ...device, providerId: id } }).success, false);
});
