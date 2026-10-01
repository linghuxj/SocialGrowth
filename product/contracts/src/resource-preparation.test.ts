import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { contractVersion, uuidSchema } from "./common.js";
import { registerMediaIdentityRequestSchema, registerMediaIdentityResponseSchema, reserveResourcePreparationRequestSchema, resourcePreparationResponseSchema } from "./resource-preparation.js";
const id = "a0000000-0000-4000-8000-000000000001";
const metadata = { contractVersion, requestId: "request-resources", idempotencyKey: "resource_preparation_key" };
const registration = { accountId: id, identityId: id, platform: "facebook", canonicalAccountRef: "operator_declared_login", canonicalIdentityRef: "operator_declared_page" };
test("media references are canonical-format declarations, not credentials or platform verification", () => {
  const input = { metadata, expectedResourceVersion: 0, registration };
  registerMediaIdentityRequestSchema.parse(input);
  for (const change of [{ actorId: id }, { registration: { ...registration, password: "never-accepted" } },
    { registration: { ...registration, canonicalIdentityRef: "https://fixture.invalid/page" } },
    { registration: { ...registration, identityId: id.toUpperCase() } }, { registration: { ...registration, platformVerified: true } },
    { metadata: { ...metadata, idempotencyKey: "has space key--000" } }, { metadata: { ...metadata, idempotencyKey: metadata.idempotencyKey + "\n" } },
    { registration: { ...registration, canonicalAccountRef: registration.canonicalAccountRef + "\n" } }, { expectedResourceVersion: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(registerMediaIdentityRequestSchema.safeParse({ ...input, ...change }).success, false);
  }
});
test("single-pattern preparation IDs preserve installed UUID grammar without allOf or case widening", () => {
  const schema = registerMediaIdentityRequestSchema.shape.registration.shape.identityId;
  for (const value of [id, id.toUpperCase(), "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "a0000000-0000-9000-8000-000000000001", "a0000000-0000-4000-7000-000000000001", "a0000000-0000-4000-8000-00000000000g",
    id + "\n", ...Array.from({ length: 100 }, () => randomUUID())]) {
    assert.equal(schema.safeParse(value).success, uuidSchema.safeParse(value).success && value === value.toLowerCase() && !/[\r\n]/.test(value), value);
  }
});
test("all registration responses stay unverified and disallow changed replay in JSON Schema", () => {
  const response = { contractVersion, version: 1, registration, changed: true, replayed: false,
    state: "registered_unverified", actionPermissionGranted: false, acceptanceStarted: false };
  registerMediaIdentityResponseSchema.parse(response);
  registerMediaIdentityResponseSchema.parse({ ...response, changed: false, replayed: true });
  for (const patch of [{ state: "verified" }, { actionPermissionGranted: true }, { acceptanceStarted: true },
    { replayed: true }, { credential: "forbidden" }, { registration: { ...registration, canonicalAccountRef: "secret\nline" } }]) {
    assert.equal(registerMediaIdentityResponseSchema.safeParse({ ...response, ...patch }).success, false);
  }
});
test("resource preparation requests and pending-only snapshots cannot declare execution or acceptance", () => {
  const input = { metadata, expectedResourceVersion: 0, expectedProjectVersion: 0, expectedDeviceVersion: 0,
    reservation: { projectId: id, deviceId: id, identityIds: [id] } };
  reserveResourcePreparationRequestSchema.parse(input);
  for (const patch of [{ reservation: { ...input.reservation, identityIds: [] } }, { reservation: { ...input.reservation, identityIds: [id, id, id] } },
    { ready: true }, { expectedDeviceVersion: -1 }]) assert.equal(reserveResourcePreparationRequestSchema.safeParse({ ...input, ...patch }).success, false);
  const binding = { identityId: id, accountId: id, platform: "facebook", deviceId: id, projectId: id, state: "pending_initialization" };
  const view = { contractVersion, version: 0, replayed: false, actionPermissionGranted: false, acceptanceStarted: false,
    snapshot: { accounts: [{ accountId: id, platform: "facebook" }], identities: [{ identityId: id, accountId: id, platform: "facebook" }],
      phones: [{ deviceId: id, projectId: id }], accountUses: [{ accountId: id, projectId: id }], bindings: [binding] } };
  resourcePreparationResponseSchema.parse(view);
  for (const patch of [{ actionPermissionGranted: true }, { acceptanceStarted: true }, { acceptedAt: "2026-10-01T00:00:00Z" },
    { snapshot: { ...view.snapshot, bindings: [{ ...binding, state: "ready" }] } }]) assert.equal(resourcePreparationResponseSchema.safeParse({ ...view, ...patch }).success, false);
});
