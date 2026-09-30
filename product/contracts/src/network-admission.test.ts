import assert from "node:assert/strict";
import test from "node:test";

import { admissionProtocolVersion, enrollmentChallengeSchema, enrollmentProofSchema } from "./network-admission.js";

const challenge = {
  protocolVersion: admissionProtocolVersion, purpose: "network_node_binding",
  challengeId: "018f47ac-7a69-7db4-a572-8c62f3650191",
  enrollmentId: "018f47ac-7a69-7db4-a572-8c62f3650192",
  deviceId: "018f47ac-7a69-7db4-a572-8c62f3650193",
  installationId: "018f47ac-7a69-7db4-a572-8c62f3650194",
  installationGeneration: "9007199254740993", enrollmentGeneration: "1",
  node: { nodeId: "node-1", nodeKey: "node-key-1", networkRevision: 1 },
  nonce: "A".repeat(43), issuedAt: "2026-09-30T10:00:00Z", expiresAt: "2026-09-30T10:01:00Z",
};

test("CT-05 uses independently versioned, strict, lossless bindings", () => {
  assert.equal(enrollmentChallengeSchema.parse(challenge).installationGeneration, "9007199254740993");
  for (const patch of [{ purpose: "adb_pairing" }, { protocolVersion: "unknown" }, { installationGeneration: 1 }, { installationGeneration: "0" }, { enrollmentGeneration: "01" }, { nonce: "short" }, { clientIp: "100.64.0.1" }]) {
    assert.equal(enrollmentChallengeSchema.safeParse({ ...challenge, ...patch }).success, false);
  }
  assert.equal(enrollmentChallengeSchema.safeParse({ ...challenge, expiresAt: challenge.issuedAt }).success, false);
});

test("proof is a fixed P-256 signature, not client-supplied authority", () => {
  const proof = { challengeId: challenge.challengeId, signature: "A".repeat(86) };
  assert.equal(enrollmentProofSchema.safeParse(proof).success, true);
  for (const patch of [{ nodeId: "node-1" }, { eligible: true }, { algorithm: "none" }, { signature: "A".repeat(88) }]) {
    assert.equal(enrollmentProofSchema.safeParse({ ...proof, ...patch }).success, false);
  }
});
