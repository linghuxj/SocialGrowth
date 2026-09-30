import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";

import {
  admissionProtocolVersion,
  admissionGenerationSchema,
  enrollmentChallengeSchema,
  enrollmentProofSchema,
  nodeIdentitySchema,
  uuidSchema,
  type EnrollmentChallenge,
  type EnrollmentProof,
  type NodeIdentity,
} from "@socialgrowth/product-contracts";

export type AdmissionFailure =
  | "STALE_FACT"
  | "AUTHORITY_CHANGED"
  | "EXPIRED"
  | "INVALID_PHASE"
  | "INVALID_EVIDENCE"
  | "INVALID_PROOF"
  | "SOURCE_MISMATCH";

export class AdmissionError extends Error {
  constructor(readonly code: AdmissionFailure) {
    // Never include a signature, challenge payload, source address or raw error.
    super(`Network admission rejected: ${code}`);
  }
}

export interface AdmissionAuthority {
  deviceId: string;
  installationId: string;
  installationGeneration: string;
  enrollmentGeneration: string;
  ownershipVersion: string;
  eligible: boolean;
}

export interface AdmissionEvidenceScope {
  enrollmentId: string;
  deviceId: string;
  installationId: string;
  enrollmentGeneration: string;
}

export interface RestrictionEvidence extends AdmissionEvidenceScope {
  evidenceId: string;
  policyRevision: number;
  networkRevision: number;
  checkedAt: string;
  independentVerifierReachable: boolean;
  adbDenied: boolean;
  otherPhonesDenied: boolean;
  operatorServicesDenied: boolean;
  businessEgressDenied: boolean;
  additiveRulesChecked: boolean;
}

export interface FormalPermissionEvidence extends AdmissionEvidenceScope {
  node: NodeIdentity;
  evidenceId: string;
  policyRevision: number;
  checkedAt: string;
  requiredPathsVerified: boolean;
  forbiddenPathsDenied: boolean;
}

export interface ReclamationEvidence extends AdmissionEvidenceScope {
  reclamationId: string;
  node: NodeIdentity | null;
  evidenceId: string;
  checkedAt: string;
  credentialRevoked: boolean;
  nodeAccessRevoked: boolean;
}

export interface AdmissionRecord {
  enrollmentId: string;
  authority: AdmissionAuthority;
  version: number;
  createdAt: string;
  expiresAt: string;
  publicKeySpki: string;
  phase: "awaiting_restriction" | "restricted" | "proof_verified"
    | "permission_pending" | "admitted" | "reclaim_pending" | "reclaimed";
  restriction: RestrictionEvidence | null;
  challenge: EnrollmentChallenge | null;
  proofDigest: string | null;
  node: NodeIdentity | null;
  formalPolicyRevision: number | null;
  formalEvidenceId: string | null;
  reclaimReason: string | null;
  reclamationId: string | null;
  credentialRevoked: boolean;
  nodeAccessRevoked: boolean;
}

// Internal control-plane evidence only. No HTTP request may supply these values.
// The real verifier must resolve the socket peer through trusted LocalAPI;
// accepting a node ID, IP, X-Forwarded-For or a client flag is not an adapter.
export interface ObservedSource {
  node: NodeIdentity;
  observedAt: string;
}

function instant(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new AdmissionError("INVALID_EVIDENCE");
  return result;
}

function recent(observedAt: string, now: string, maximumAgeMs: number): void {
  const age = instant(now) - instant(observedAt);
  if (age < 0 || age >= maximumAgeMs) throw new AdmissionError("INVALID_EVIDENCE");
}

function publicKey(value: string) {
  try {
    if (!/^[A-Za-z0-9_-]{100,256}$/.test(value)) throw new Error();
    const key = createPublicKey({
      key: Buffer.from(value, "base64url"), format: "der", type: "spki",
    });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error();
    }
    if (key.export({ format: "der", type: "spki" }).toString("base64url") !== value) {
      throw new Error();
    }
    return key;
  } catch {
    throw new AdmissionError("INVALID_PROOF");
  }
}

function sameNode(left: NodeIdentity, right: NodeIdentity): boolean {
  return left.nodeId === right.nodeId && left.nodeKey === right.nodeKey
    && left.networkRevision === right.networkRevision;
}

function evidenceScope(record: AdmissionRecord, scope: AdmissionEvidenceScope): void {
  if (scope.enrollmentId !== record.enrollmentId || scope.deviceId !== record.authority.deviceId
    || scope.installationId !== record.authority.installationId
    || scope.enrollmentGeneration !== record.authority.enrollmentGeneration) throw new AdmissionError("INVALID_EVIDENCE");
}

function guard(record: AdmissionRecord, expectedVersion: number, authority: AdmissionAuthority, now: string): void {
  if (expectedVersion !== record.version) throw new AdmissionError("STALE_FACT");
  if (!authority.eligible || !record.authority.eligible
    || authority.deviceId !== record.authority.deviceId
    || authority.installationId !== record.authority.installationId
    || authority.installationGeneration !== record.authority.installationGeneration
    || authority.enrollmentGeneration !== record.authority.enrollmentGeneration
    || authority.ownershipVersion !== record.authority.ownershipVersion) {
    throw new AdmissionError("AUTHORITY_CHANGED");
  }
  if (instant(now) < instant(record.createdAt)) throw new AdmissionError("INVALID_EVIDENCE");
  if (instant(now) >= instant(record.expiresAt)) throw new AdmissionError("EXPIRED");
}

export function createAdmissionRecord(
  authority: AdmissionAuthority,
  publicKeySpki: string,
  now: string,
  enrollmentLifetimeMs = 600_000,
): AdmissionRecord {
  if (!authority.eligible) throw new AdmissionError("AUTHORITY_CHANGED");
  if (!Number.isSafeInteger(enrollmentLifetimeMs) || enrollmentLifetimeMs <= 0 || enrollmentLifetimeMs > 600_000) {
    throw new AdmissionError("INVALID_EVIDENCE");
  }
  publicKey(publicKeySpki);
  uuidSchema.parse(authority.deviceId);
  uuidSchema.parse(authority.installationId);
  admissionGenerationSchema.parse(authority.installationGeneration);
  admissionGenerationSchema.parse(authority.enrollmentGeneration);
  if (!/^[0-9]{1,19}$/.test(authority.ownershipVersion)) throw new AdmissionError("INVALID_EVIDENCE");
  return {
    enrollmentId: randomUUID(), authority: { ...authority }, version: 0,
    createdAt: now, expiresAt: new Date(instant(now) + enrollmentLifetimeMs).toISOString(),
    publicKeySpki, phase: "awaiting_restriction", restriction: null,
    challenge: null, proofDigest: null, node: null, formalPolicyRevision: null,
    formalEvidenceId: null, reclaimReason: null, reclamationId: null,
    credentialRevoked: false, nodeAccessRevoked: false,
  };
}

export function confirmRestriction(
  record: AdmissionRecord, expectedVersion: number, authority: AdmissionAuthority,
  evidence: RestrictionEvidence, now: string,
): AdmissionRecord {
  guard(record, expectedVersion, authority, now);
  if (record.phase !== "awaiting_restriction") throw new AdmissionError("INVALID_PHASE");
  evidenceScope(record, evidence);
  if (!evidence.evidenceId || !Number.isSafeInteger(evidence.policyRevision) || evidence.policyRevision <= 0
    || !Number.isSafeInteger(evidence.networkRevision) || evidence.networkRevision <= 0
    || !evidence.independentVerifierReachable || !evidence.adbDenied
    || !evidence.otherPhonesDenied || !evidence.operatorServicesDenied
    || !evidence.businessEgressDenied || !evidence.additiveRulesChecked) {
    throw new AdmissionError("INVALID_EVIDENCE");
  }
  recent(evidence.checkedAt, now, 60_000);
  return { ...record, version: record.version + 1, phase: "restricted", restriction: { ...evidence } };
}

// Canonical byte sequence, with a fixed ordered tuple and domain separation.
// Android must sign exactly this representation, never JSON supplied by callers.
export function challengeSigningBytes(input: EnrollmentChallenge): Buffer {
  const c = enrollmentChallengeSchema.parse(input);
  return Buffer.from(JSON.stringify([
    c.protocolVersion, c.purpose, c.challengeId, c.enrollmentId, c.deviceId,
    c.installationId, c.installationGeneration, c.enrollmentGeneration,
    c.node.nodeId, c.node.nodeKey, c.node.networkRevision,
    c.nonce, c.issuedAt, c.expiresAt,
  ]), "utf8");
}

export function issueChallenge(
  record: AdmissionRecord, expectedVersion: number, authority: AdmissionAuthority,
  source: ObservedSource, now: string,
): AdmissionRecord {
  guard(record, expectedVersion, authority, now);
  if (record.phase !== "restricted" || !record.restriction) throw new AdmissionError("INVALID_PHASE");
  recent(record.restriction.checkedAt, now, 60_000);
  recent(source.observedAt, now, 10_000);
  const node = nodeIdentitySchema.parse(source.node);
  if (node.networkRevision !== record.restriction.networkRevision) throw new AdmissionError("SOURCE_MISMATCH");
  // An expired challenge does not erase the old node's real restricted access.
  // A different candidate requires confirmed reclamation and a new enrollment.
  if (record.challenge && !sameNode(record.challenge.node, node)) throw new AdmissionError("SOURCE_MISMATCH");
  if (record.challenge && instant(now) < instant(record.challenge.expiresAt)) {
    if (!sameNode(record.challenge.node, node)) throw new AdmissionError("SOURCE_MISMATCH");
    // Query/retry of the current challenge does not mint a second valid challenge.
    return record;
  }
  const challenge = enrollmentChallengeSchema.parse({
    protocolVersion: admissionProtocolVersion, purpose: "network_node_binding",
    challengeId: randomUUID(), enrollmentId: record.enrollmentId,
    deviceId: authority.deviceId, installationId: authority.installationId,
    installationGeneration: authority.installationGeneration,
    enrollmentGeneration: authority.enrollmentGeneration,
    node, nonce: randomBytes(32).toString("base64url"), issuedAt: now,
    expiresAt: new Date(Math.min(instant(now) + 60_000, instant(record.expiresAt))).toISOString(),
  });
  return { ...record, version: record.version + 1, challenge };
}

export function consumeProof(
  record: AdmissionRecord, expectedVersion: number, authority: AdmissionAuthority,
  source: ObservedSource, input: EnrollmentProof, now: string,
): AdmissionRecord {
  guard(record, expectedVersion, authority, now);
  if (record.phase !== "restricted" || !record.challenge) throw new AdmissionError("INVALID_PHASE");
  const challenge = record.challenge;
  const parsed = enrollmentProofSchema.safeParse(input);
  if (!parsed.success || parsed.data.challengeId !== challenge.challengeId) throw new AdmissionError("INVALID_PROOF");
  if (instant(now) >= instant(challenge.expiresAt)) throw new AdmissionError("EXPIRED");
  if (instant(now) < instant(challenge.issuedAt)) throw new AdmissionError("INVALID_EVIDENCE");
  recent(source.observedAt, now, 10_000);
  if (!sameNode(challenge.node, nodeIdentitySchema.parse(source.node))) throw new AdmissionError("SOURCE_MISMATCH");
  const bytes = challengeSigningBytes(challenge);
  const signature = Buffer.from(parsed.data.signature, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== parsed.data.signature
    || !verify("sha256", bytes, { key: publicKey(record.publicKeySpki), dsaEncoding: "ieee-p1363" }, signature)) {
    throw new AdmissionError("INVALID_PROOF");
  }
  return {
    ...record, version: record.version + 1, phase: "proof_verified",
    proofDigest: createHash("sha256").update(bytes).update(signature).digest("hex"),
    node: { ...challenge.node }, challenge: null,
  };
}

export function requestFormalPermission(
  record: AdmissionRecord, expectedVersion: number, authority: AdmissionAuthority,
  source: ObservedSource, policyRevision: number, now: string,
): AdmissionRecord {
  guard(record, expectedVersion, authority, now);
  if (record.phase !== "proof_verified" || !record.node || !record.restriction) throw new AdmissionError("INVALID_PHASE");
  recent(source.observedAt, now, 10_000);
  if (!sameNode(record.node, nodeIdentitySchema.parse(source.node))) throw new AdmissionError("SOURCE_MISMATCH");
  if (!Number.isSafeInteger(policyRevision) || policyRevision <= record.restriction.policyRevision) throw new AdmissionError("INVALID_EVIDENCE");
  return { ...record, version: record.version + 1, phase: "permission_pending", formalPolicyRevision: policyRevision };
}

export function confirmFormalPermission(
  record: AdmissionRecord, expectedVersion: number, authority: AdmissionAuthority,
  source: ObservedSource,
  evidence: FormalPermissionEvidence,
  now: string,
): AdmissionRecord {
  guard(record, expectedVersion, authority, now);
  if (record.phase !== "permission_pending" || !record.node) throw new AdmissionError("INVALID_PHASE");
  evidenceScope(record, evidence);
  recent(source.observedAt, now, 10_000);
  recent(evidence.checkedAt, now, 60_000);
  if (!sameNode(record.node, nodeIdentitySchema.parse(source.node))) throw new AdmissionError("SOURCE_MISMATCH");
  if (!sameNode(record.node, nodeIdentitySchema.parse(evidence.node))) throw new AdmissionError("INVALID_EVIDENCE");
  if (!evidence.evidenceId || evidence.policyRevision !== record.formalPolicyRevision
    || !evidence.requiredPathsVerified || !evidence.forbiddenPathsDenied) throw new AdmissionError("INVALID_EVIDENCE");
  // Network admission is NOT ADB authorization, action permission or business readiness.
  return { ...record, version: record.version + 1, phase: "admitted", formalEvidenceId: evidence.evidenceId };
}

export function requestReclamation(record: AdmissionRecord, expectedVersion: number, reason: string): AdmissionRecord {
  if (expectedVersion !== record.version) throw new AdmissionError("STALE_FACT");
  if (!reason || reason.length > 128) throw new AdmissionError("INVALID_EVIDENCE");
  if (record.phase === "reclaimed" || record.phase === "reclaim_pending") return record;
  // Reclamation remains available after expiry, exit and authority changes.
  return {
    ...record, version: record.version + 1, phase: "reclaim_pending", challenge: null,
    // A failed/unconsumed proof still has a real restricted candidate to remove.
    node: record.node ?? (record.challenge ? { ...record.challenge.node } : null),
    reclaimReason: reason, reclamationId: randomUUID(),
  };
}

export function confirmReclamation(
  record: AdmissionRecord, expectedVersion: number,
  evidence: ReclamationEvidence,
  now: string,
): AdmissionRecord {
  if (expectedVersion !== record.version) throw new AdmissionError("STALE_FACT");
  if (record.phase !== "reclaim_pending") throw new AdmissionError("INVALID_PHASE");
  evidenceScope(record, evidence);
  recent(evidence.checkedAt, now, 60_000);
  if (!evidence.evidenceId || evidence.reclamationId !== record.reclamationId
    || (record.node ? !evidence.node || !sameNode(record.node, nodeIdentitySchema.parse(evidence.node)) : evidence.node !== null)) {
    throw new AdmissionError("INVALID_EVIDENCE");
  }
  const credentialRevoked = record.credentialRevoked || evidence.credentialRevoked;
  const nodeAccessRevoked = record.nodeAccessRevoked || evidence.nodeAccessRevoked;
  return {
    ...record, version: record.version + 1, credentialRevoked, nodeAccessRevoked,
    phase: credentialRevoked && nodeAccessRevoked ? "reclaimed" : "reclaim_pending",
  };
}
