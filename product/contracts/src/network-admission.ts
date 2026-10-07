import { z } from "zod";

import { compareTimestamps, timestampSchema, uuidSchema } from "./common.js";

// CT-05 evolves independently from the deployed B1 identity contract.
export const admissionProtocolVersion = "2026-09-30.admission-v1" as const;
export const admissionGenerationSchema = z.string().regex(/^[1-9][0-9]{0,18}$/);
export const networkRevisionSchema = z.int().min(1);
export const nodeIdentitySchema = z.strictObject({
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  nodeKey: z.string().min(1).max(256),
  networkRevision: networkRevisionSchema,
});

export const enrollmentChallengeSchema = z.strictObject({
  protocolVersion: z.literal(admissionProtocolVersion),
  purpose: z.literal("network_node_binding"),
  challengeId: uuidSchema,
  enrollmentId: uuidSchema,
  deviceId: uuidSchema,
  installationId: uuidSchema,
  installationGeneration: admissionGenerationSchema,
  enrollmentGeneration: admissionGenerationSchema,
  node: nodeIdentitySchema,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
}).superRefine((value, context) => {
  const order = compareTimestamps(value.issuedAt, value.expiresAt);
  if (order !== null && order >= 0) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Challenge expiry must follow issuance" });
  }
});

export const enrollmentProofSchema = z.strictObject({
  challengeId: uuidSchema,
  // P-256 SHA-256, IEEE-P1363 r||s; not DER and not an arbitrary algorithm.
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});

export type NodeIdentity = z.infer<typeof nodeIdentitySchema>;
export type EnrollmentChallenge = z.infer<typeof enrollmentChallengeSchema>;
export type EnrollmentProof = z.infer<typeof enrollmentProofSchema>;

const admissionRequest = {
  protocolVersion: z.literal(admissionProtocolVersion),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
};
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const admissionStateRequestSchema = z.strictObject(admissionRequest);
export const admissionBeginRequestSchema = z.strictObject({ ...admissionRequest, requestKey,
  publicKeySpki: z.string().regex(/^[A-Za-z0-9_-]{100,256}$/) });
export const admissionChallengeRequestSchema = z.strictObject({ ...admissionRequest, requestKey,
  enrollmentId: uuidSchema, expectedVersion: z.int().min(0) });
export const admissionProofRequestSchema = z.strictObject({ ...admissionChallengeRequestSchema.shape, proof: enrollmentProofSchema });
export const admissionScopeSchema = z.strictObject({ deviceId: uuidSchema, installationId: uuidSchema,
  installationGeneration: admissionGenerationSchema, ownershipVersion: admissionGenerationSchema });
export const admissionSnapshotSchema = z.strictObject({
  protocolVersion: z.literal(admissionProtocolVersion), scope: admissionScopeSchema,
  enrollment: z.strictObject({ enrollmentId: uuidSchema, enrollmentGeneration: admissionGenerationSchema,
    version: z.int().min(0), phase: z.enum(["awaiting_restriction", "restricted", "proof_verified", "permission_pending", "admitted", "reclaim_pending", "reclaimed"]),
    expiresAt: timestampSchema }).nullable(),
  verifierReady: z.boolean(),
  // Snapshot/proof consumption is not a current formal permit or ADB action.
  networkAdmissionGranted: z.literal(false), actionPermissionGranted: z.literal(false),
});
export const admissionChallengeResponseSchema = z.strictObject({ ...admissionSnapshotSchema.shape, challenge: enrollmentChallengeSchema }).superRefine((value, context) => {
  const c = value.challenge, e = value.enrollment, s = value.scope;
  if (!e || e.phase !== "restricted" || c.enrollmentId !== e.enrollmentId
    || c.enrollmentGeneration !== e.enrollmentGeneration || c.deviceId !== s.deviceId
    || c.installationId !== s.installationId || c.installationGeneration !== s.installationGeneration
    || compareTimestamps(c.expiresAt, e.expiresAt) === 1) {
    context.addIssue({ code: "custom", path: ["challenge"], message: "Challenge scope does not match current enrollment" });
  }
});
export const admissionErrorResponseSchema = z.strictObject({
  protocolVersion: z.literal(admissionProtocolVersion), requestId: admissionRequest.requestId,
  error: z.strictObject({ code: z.enum(["INPUT_INVALID", "PROTOCOL_UNSUPPORTED", "AUTHENTICATION_REQUIRED", "AUTHORITY_CHANGED",
    "STALE_FACT", "EXPIRED", "INVALID_PHASE", "INVALID_EVIDENCE", "INVALID_PROOF", "SOURCE_MISMATCH", "VERIFIER_UNAVAILABLE", "INTERNAL_ERROR"]),
    retryable: z.boolean() }),
});
export type AdmissionSnapshot = z.infer<typeof admissionSnapshotSchema>;
