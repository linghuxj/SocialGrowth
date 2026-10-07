import assert from "node:assert/strict";
import test from "node:test";

import { listOperatorDeviceFactsResponseSchema } from "./device-facts.js";

const providerId = "018f47ac-7a69-7db4-a572-8c62f3650192";
const deviceId = "018f47ac-7a69-7db4-a572-8c62f3650195";
const facts = {
  readAt: "2026-09-29T10:05:00Z",
  providers: [{
    providerId,
    displayName: "林先生",
    phoneLastFour: "0021",
    status: "active" as const,
  }],
  devices: [{
    deviceId,
    providerId,
    displayName: "SG-021",
    state: "associated_pending_access" as const,
    connectionState: "unknown" as const,
    lastConfirmedAt: null,
    factVersion: 1,
    updatedAt: "2026-09-29T10:00:00Z",
  }],
};

test("operator facts keep association separate from connection confirmation", () => {
  assert.equal(listOperatorDeviceFactsResponseSchema.safeParse(facts).success, true);
  assert.equal(listOperatorDeviceFactsResponseSchema.safeParse({
    ...facts,
    devices: [{ ...facts.devices[0], connectionState: "online" }],
  }).success, false);
  assert.equal(listOperatorDeviceFactsResponseSchema.safeParse({
    ...facts,
    devices: [{ ...facts.devices[0], state: "unassociated" }],
  }).success, false);
});

test("operator facts reject full phone, installation identity and credentials", () => {
  assert.equal(listOperatorDeviceFactsResponseSchema.safeParse({
    ...facts,
    providers: [{ ...facts.providers[0], phoneE164: "+8613800000021" }],
  }).success, false);
  assert.equal(listOperatorDeviceFactsResponseSchema.safeParse({
    ...facts,
    devices: [{ ...facts.devices[0], installationId: deviceId }],
  }).success, false);
  assert.equal(listOperatorDeviceFactsResponseSchema.safeParse({
    ...facts,
    devices: [{ ...facts.devices[0], sessionToken: "secret" }],
  }).success, false);
});
