import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test from "node:test";
import { enrollmentChallengeSchema } from "@socialgrowth/product-contracts";

import {
  AdmissionError,
  challengeSigningBytes,
  confirmFormalPermission as confirmFormalPermissionCore,
  confirmReclamation as confirmReclamationCore,
  confirmRestriction as confirmRestrictionCore,
  consumeProof,
  createAdmissionRecord,
  issueChallenge,
  requestFormalPermission,
  requestReclamation,
  type AdmissionAuthority,
  type AdmissionRecord,
  type ObservedSource,
  type RestrictionEvidence,
  type AdmissionEvidenceScope,
} from "./network-admission-core.js";

const now = "2026-09-30T10:00:00.000Z";
test("CT-05 signing bytes retain the Android golden tuple and original UUID spelling", () => {
  const id = "018F47AC-7A69-7DB4-A572-8C62F3650191";
  const challenge = enrollmentChallengeSchema.parse({
    protocolVersion: "2026-09-30.admission-v1", purpose: "network_node_binding",
    challengeId: id, enrollmentId: id, deviceId: id, installationId: id,
    installationGeneration: "9007199254740993", enrollmentGeneration: "1",
    node: { nodeId: "node-A", nodeKey: "key-A", networkRevision: 1 },
    nonce: "A".repeat(43), issuedAt: "2026-09-30T10:00:00.0000000001Z", expiresAt: "2026-09-30T10:01:00Z",
  });
  assert.equal(createHash("sha256").update(challengeSigningBytes(challenge)).digest("hex"),
    "f9ae23f75612797357faae891c2af105a509d6c222dd1781774748e7b2574387");
});
const later = (ms: number) => new Date(Date.parse(now) + ms).toISOString();
const authority: AdmissionAuthority = {
  deviceId: randomUUID(), installationId: randomUUID(), installationGeneration: "1",
  enrollmentGeneration: "1", ownershipVersion: "9007199254740993", eligible: true,
};
const source: ObservedSource = {
  node: { nodeId: "node-A", nodeKey: "node-key-A", networkRevision: 1 }, observedAt: now,
};
const restriction: Omit<RestrictionEvidence, keyof AdmissionEvidenceScope> = {
  evidenceId: "restriction-probe-1", policyRevision: 1, networkRevision: 1, checkedAt: now,
  independentVerifierReachable: true, adbDenied: true, otherPhonesDenied: true,
  operatorServicesDenied: true, businessEgressDenied: true, additiveRulesChecked: true,
};
const formal = {
  evidenceId: "formal-probe-2", policyRevision: 2, checkedAt: now,
  requiredPathsVerified: true, forbiddenPathsDenied: true,
};

function scope(record: AdmissionRecord): AdmissionEvidenceScope {
  return {
    enrollmentId: record.enrollmentId, deviceId: record.authority.deviceId,
    installationId: record.authority.installationId, enrollmentGeneration: record.authority.enrollmentGeneration,
  };
}
function confirmRestriction(r: AdmissionRecord, v: number, a: AdmissionAuthority, e: typeof restriction, time: string) {
  return confirmRestrictionCore(r, v, a, { ...scope(r), ...e }, time);
}
function confirmFormalPermission(r: AdmissionRecord, v: number, a: AdmissionAuthority, s: ObservedSource, e: typeof formal, time: string) {
  return confirmFormalPermissionCore(r, v, a, s, { ...scope(r), node: r.node!, ...e }, time);
}
function confirmReclamation(r: AdmissionRecord, v: number, e: { credentialRevoked: boolean; nodeAccessRevoked: boolean }) {
  return confirmReclamationCore(r, v, {
    ...scope(r), node: r.node, reclamationId: r.reclamationId!, evidenceId: "reclamation-probe-1", checkedAt: now, ...e,
  }, now);
}

function fixture() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const record = createAdmissionRecord(authority, keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"), now);
  const restricted = confirmRestriction(record, record.version, authority, restriction, now);
  const challenged = issueChallenge(restricted, restricted.version, authority, source, now);
  assert.ok(challenged.challenge);
  const proof = {
    challengeId: challenged.challenge.challengeId,
    signature: sign("sha256", challengeSigningBytes(challenged.challenge), {
      key: keys.privateKey, dsaEncoding: "ieee-p1363",
    }).toString("base64url"),
  };
  return { keys, record, restricted, challenged, proof };
}

function rejects(operation: () => unknown, code: AdmissionError["code"]) {
  assert.throws(operation, (error: unknown) => error instanceof AdmissionError && error.code === code);
}

test("restricted connection precedes proof and formal path evidence precedes admission", () => {
  const { record, challenged, proof } = fixture();
  rejects(() => issueChallenge(record, 0, authority, source, now), "INVALID_PHASE");
  const verified = consumeProof(challenged, challenged.version, authority, source, proof, now);
  assert.equal(verified.phase, "proof_verified");
  assert.equal(verified.challenge, null);
  assert.match(verified.proofDigest!, /^[a-f0-9]{64}$/);
  assert.equal(verified.formalEvidenceId, null);
  const pending = requestFormalPermission(verified, verified.version, authority, source, 2, now);
  assert.equal(pending.phase, "permission_pending");
  const admitted = confirmFormalPermission(pending, pending.version, authority, source, formal, now);
  assert.equal(admitted.phase, "admitted");
  assert.equal(admitted.formalEvidenceId, formal.evidenceId);
  assert.equal("executionReady" in admitted, false);
  assert.equal("adbAuthorized" in admitted, false);
  assert.equal(record.phase, "awaiting_restriction");
  assert.equal(challenged.phase, "restricted");
});

test("every required restriction predicate fails closed, including additive grants", () => {
  const { record } = fixture();
  const predicates = ["independentVerifierReachable", "adbDenied", "otherPhonesDenied", "operatorServicesDenied", "businessEgressDenied", "additiveRulesChecked"] as const;
  for (const predicate of predicates) {
    rejects(() => confirmRestriction(record, 0, authority, { ...restriction, [predicate]: false }, now), "INVALID_EVIDENCE");
  }
  for (const patch of [{ policyRevision: 0 }, { networkRevision: 0 }, { evidenceId: "" }, { checkedAt: later(1) }, { checkedAt: later(-60_000) }]) {
    rejects(() => confirmRestriction(record, 0, authority, { ...restriction, ...patch }, now), "INVALID_EVIDENCE");
  }
});

test("retry returns current challenge; atomic caller must CAS the version for competing consumption", () => {
  const { challenged, proof } = fixture();
  assert.equal(issueChallenge(challenged, challenged.version, authority, source, now), challenged);
  const next = consumeProof(challenged, challenged.version, authority, source, proof, now);
  rejects(() => consumeProof(next, challenged.version, authority, source, proof, now), "STALE_FACT");
  rejects(() => consumeProof(next, next.version, authority, source, proof, now), "INVALID_PHASE");
});

test("wrong challenge, wrong key, modified binding and malformed signatures are rejected", () => {
  const { challenged, proof } = fixture();
  rejects(() => consumeProof(challenged, challenged.version, authority, source, { ...proof, challengeId: randomUUID() }, now), "INVALID_PROOF");
  const other = fixture();
  rejects(() => consumeProof(challenged, challenged.version, authority, source, { ...proof, signature: other.proof.signature }, now), "INVALID_PROOF");
  for (const signature of ["A".repeat(86), "not-base64", `${proof.signature.slice(0, -1)}!`]) {
    rejects(() => consumeProof(challenged, challenged.version, authority, source, { ...proof, signature }, now), "INVALID_PROOF");
  }
  const changed: AdmissionRecord = { ...challenged, challenge: { ...challenged.challenge!, enrollmentGeneration: "2" } };
  rejects(() => consumeProof(changed, changed.version, authority, source, proof, now), "INVALID_PROOF");
});

test("node ID, node key and network revision are independently pinned at proof and permission", () => {
  const { challenged, proof } = fixture();
  const verified = consumeProof(challenged, challenged.version, authority, source, proof, now);
  const pending = requestFormalPermission(verified, verified.version, authority, source, 2, now);
  for (const patch of [{ nodeId: "node-B" }, { nodeKey: "node-key-B" }, { networkRevision: 2 }]) {
    const wrong = { ...source, node: { ...source.node, ...patch } };
    rejects(() => consumeProof(challenged, challenged.version, authority, wrong, proof, now), "SOURCE_MISMATCH");
    rejects(() => requestFormalPermission(verified, verified.version, authority, wrong, 2, now), "SOURCE_MISMATCH");
    rejects(() => confirmFormalPermission(pending, pending.version, authority, wrong, formal, now), "SOURCE_MISMATCH");
  }
});

test("every current authority field is checked again before upgrade and acknowledgement", () => {
  const { challenged, proof } = fixture();
  const verified = consumeProof(challenged, challenged.version, authority, source, proof, now);
  const pending = requestFormalPermission(verified, verified.version, authority, source, 2, now);
  for (const patch of [
    { eligible: false }, { deviceId: randomUUID() }, { installationId: randomUUID() },
    { installationGeneration: "2" }, { enrollmentGeneration: "2" }, { ownershipVersion: "9007199254740994" },
  ]) {
    const current = { ...authority, ...patch };
    rejects(() => consumeProof(challenged, challenged.version, current, source, proof, now), "AUTHORITY_CHANGED");
    rejects(() => requestFormalPermission(verified, verified.version, current, source, 2, now), "AUTHORITY_CHANGED");
    rejects(() => confirmFormalPermission(pending, pending.version, current, source, formal, now), "AUTHORITY_CHANGED");
  }
});

test("stale/future source observations and exact expiry boundary are not accepted", () => {
  const { record, challenged, proof } = fixture();
  for (const observedAt of [later(-10_000), later(1)]) {
    rejects(() => consumeProof(challenged, challenged.version, authority, { ...source, observedAt }, proof, now), "INVALID_EVIDENCE");
  }
  rejects(() => consumeProof(challenged, challenged.version, authority, { ...source, observedAt: later(60_000) }, proof, later(60_000)), "EXPIRED");
  rejects(() => confirmRestriction(record, 0, authority, { ...restriction, checkedAt: record.expiresAt }, record.expiresAt), "EXPIRED");
  rejects(() => confirmRestriction(record, 0, authority, restriction, later(-1)), "INVALID_EVIDENCE");
});

test("expiry permits a new challenge but old signatures cannot consume it", () => {
  const { challenged, proof } = fixture();
  // Fresh restriction is required; normally obtained by the trusted policy worker.
  const refreshed = { ...challenged, restriction: { ...scope(challenged), ...restriction, checkedAt: later(60_000) } };
  const next = issueChallenge(refreshed, refreshed.version, authority, { ...source, observedAt: later(60_000) }, later(60_000));
  assert.notEqual(next.challenge!.challengeId, proof.challengeId);
  rejects(() => consumeProof(next, next.version, authority, { ...source, observedAt: later(60_000) }, proof, later(60_000)), "INVALID_PROOF");
  rejects(() => issueChallenge(refreshed, refreshed.version, authority, {
    node: { ...source.node, nodeId: "node-B" }, observedAt: later(60_000),
  }, later(60_000)), "SOURCE_MISMATCH");
  assert.deepEqual(requestReclamation(refreshed, refreshed.version, "expired").node, source.node);
});

test("a proof cannot be consumed before the challenge issuance time", () => {
  const f = fixture();
  const challenged = issueChallenge(f.restricted, f.restricted.version, authority, {
    ...source, observedAt: later(1000),
  }, later(1000));
  const proof = {
    challengeId: challenged.challenge!.challengeId,
    signature: sign("sha256", challengeSigningBytes(challenged.challenge!), {
      key: f.keys.privateKey, dsaEncoding: "ieee-p1363",
    }).toString("base64url"),
  };
  rejects(() => consumeProof(challenged, challenged.version, authority, source, proof, now), "INVALID_EVIDENCE");
});

test("restriction, formal and reclamation receipts cannot be reused across enrollments or nodes", () => {
  const f = fixture(), other = fixture();
  rejects(() => confirmRestrictionCore(f.record, 0, authority, { ...scope(other.record), ...restriction }, now), "INVALID_EVIDENCE");
  const verified = consumeProof(f.challenged, f.challenged.version, authority, source, f.proof, now);
  const pending = requestFormalPermission(verified, verified.version, authority, source, 2, now);
  const evidence = { ...scope(pending), ...formal, node: source.node };
  rejects(() => confirmFormalPermissionCore(pending, pending.version, authority, source, { ...evidence, enrollmentId: other.record.enrollmentId }, now), "INVALID_EVIDENCE");
  rejects(() => confirmFormalPermissionCore(pending, pending.version, authority, source, { ...evidence, node: { ...source.node, nodeKey: "wrong-key" } }, now), "INVALID_EVIDENCE");
  const reclaiming = requestReclamation(pending, pending.version, "exited");
  const receipt = {
    ...scope(reclaiming), node: reclaiming.node, reclamationId: reclaiming.reclamationId!,
    evidenceId: "reclaim-probe", checkedAt: now, credentialRevoked: true, nodeAccessRevoked: true,
  };
  for (const patch of [
    { enrollmentId: other.record.enrollmentId }, { deviceId: randomUUID() },
    { installationId: randomUUID() }, { enrollmentGeneration: "2" },
    { reclamationId: randomUUID() }, { node: null }, { checkedAt: later(-60_000) },
  ]) {
    rejects(() => confirmReclamationCore(reclaiming, reclaiming.version, { ...receipt, ...patch }, now), "INVALID_EVIDENCE");
  }
  assert.equal(confirmReclamationCore(reclaiming, reclaiming.version, receipt, now).phase, "reclaimed");
});

test("API acknowledgement alone or wrong policy revision never establishes admission", () => {
  const { challenged, proof } = fixture();
  const verified = consumeProof(challenged, challenged.version, authority, source, proof, now);
  rejects(() => requestFormalPermission(verified, verified.version, authority, source, 1, now), "INVALID_EVIDENCE");
  const pending = requestFormalPermission(verified, verified.version, authority, source, 2, now);
  for (const patch of [{ policyRevision: 3 }, { requiredPathsVerified: false }, { forbiddenPathsDenied: false }, { evidenceId: "" }, { checkedAt: later(-60_000) }]) {
    rejects(() => confirmFormalPermission(pending, pending.version, authority, source, { ...formal, ...patch }, now), "INVALID_EVIDENCE");
  }
});

test("reclamation keeps credential revocation separate from connected node access removal", () => {
  const { challenged, proof } = fixture();
  const verified = consumeProof(challenged, challenged.version, authority, source, proof, now);
  const pending = requestFormalPermission(verified, verified.version, authority, source, 2, now);
  const reclaiming = requestReclamation(pending, pending.version, "provider_exited");
  assert.equal(reclaiming.phase, "reclaim_pending");
  rejects(() => confirmFormalPermission(reclaiming, pending.version, authority, source, formal, now), "STALE_FACT");
  rejects(() => confirmFormalPermission(reclaiming, reclaiming.version, authority, source, formal, now), "INVALID_PHASE");
  const partial = confirmReclamation(reclaiming, reclaiming.version, { credentialRevoked: true, nodeAccessRevoked: false });
  assert.equal(partial.phase, "reclaim_pending");
  const unknown = confirmReclamation(partial, partial.version, { credentialRevoked: false, nodeAccessRevoked: false });
  assert.equal(unknown.credentialRevoked, true);
  assert.equal(unknown.phase, "reclaim_pending");
  const done = confirmReclamation(unknown, unknown.version, { credentialRevoked: false, nodeAccessRevoked: true });
  assert.equal(done.phase, "reclaimed");
  assert.equal(requestReclamation(done, done.version, "provider_exited"), done);
  rejects(() => requestFormalPermission(done, done.version, authority, source, 2, now), "INVALID_PHASE");
});

test("failed proof cleanup retains the restricted candidate rather than forgetting its node", () => {
  const { challenged } = fixture();
  const reclaiming = requestReclamation(challenged, challenged.version, "proof_failed");
  assert.deepEqual(reclaiming.node, source.node);
  assert.equal(reclaiming.challenge, null);
  assert.equal(reclaiming.phase, "reclaim_pending");
});

test("reclamation is possible after expiry; key curve, root format and lifetime are constrained", () => {
  const { record } = fixture();
  assert.equal(requestReclamation(record, 0, "expired").phase, "reclaim_pending");
  for (const namedCurve of ["secp384r1", "secp256k1"]) {
    const key = generateKeyPairSync("ec", { namedCurve }).publicKey.export({ type: "spki", format: "der" }).toString("base64url");
    rejects(() => createAdmissionRecord(authority, key, now), "INVALID_PROOF");
  }
  rejects(() => createAdmissionRecord(authority, "bad-key", now), "INVALID_PROOF");
  for (const duration of [0, -1, 600_001, Infinity, 1.5]) {
    rejects(() => createAdmissionRecord(authority, record.publicKeySpki, now, duration), "INVALID_EVIDENCE");
  }
});
