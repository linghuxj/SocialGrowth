import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import test from "node:test";

import { createAdmissionRecord, requestReclamation } from "./network-admission-core.js";
import { parseAdmissionRecord } from "./network-admission-record.js";

function fixture() {
  return createAdmissionRecord({
    deviceId: randomUUID(), installationId: randomUUID(), installationGeneration: "1",
    enrollmentGeneration: "1", ownershipVersion: "1", eligible: true,
  }, generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }).toString("base64url"), "2026-09-30T10:00:00Z");
}

test("database snapshot parser rejects unknown fields and incomplete formal evidence", () => {
  const r = fixture();
  assert.deepEqual(parseAdmissionRecord(r), r);
  for (const patch of [{ authority: { ...r.authority, installationGeneration: 1 } },
    { phase: "admitted" }, { extraCredential: "not-allowed" }, { version: 9007199254740992 },
    { expiresAt: r.createdAt }]) {
    assert.throws(() => parseAdmissionRecord({ ...r, ...patch }));
  }
});

test("reclaimed snapshot requires bound reclamation and both independent completion facts", () => {
  const r = requestReclamation(fixture(), 0, "expired");
  assert.equal(parseAdmissionRecord(r).phase, "reclaim_pending");
  assert.throws(() => parseAdmissionRecord({ ...r, phase: "reclaimed", credentialRevoked: true }));
  assert.throws(() => parseAdmissionRecord({ ...r, reclamationId: null }));
  assert.equal(parseAdmissionRecord({ ...r, phase: "reclaimed", credentialRevoked: true, nodeAccessRevoked: true }).phase, "reclaimed");
});
