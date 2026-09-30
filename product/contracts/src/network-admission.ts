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
