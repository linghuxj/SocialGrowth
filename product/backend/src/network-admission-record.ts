import { z } from "zod";
import {
  admissionGenerationSchema,
  enrollmentChallengeSchema,
  nodeIdentitySchema,
  timestampSchema,
  uuidSchema,
} from "@socialgrowth/product-contracts";

import type { AdmissionRecord } from "./network-admission-core.js";

const authoritySchema = z.strictObject({
  deviceId: uuidSchema, installationId: uuidSchema,
  installationGeneration: admissionGenerationSchema, enrollmentGeneration: admissionGenerationSchema,
  ownershipVersion: z.string().regex(/^[0-9]{1,19}$/), eligible: z.boolean(),
});
const restrictionSchema = z.strictObject({
  enrollmentId: uuidSchema, deviceId: uuidSchema, installationId: uuidSchema, enrollmentGeneration: admissionGenerationSchema,
  evidenceId: z.string().min(1).max(128), policyRevision: z.int().min(1), networkRevision: z.int().min(1),
  checkedAt: timestampSchema, independentVerifierReachable: z.boolean(), adbDenied: z.boolean(),
  otherPhonesDenied: z.boolean(), operatorServicesDenied: z.boolean(), businessEgressDenied: z.boolean(),
  additiveRulesChecked: z.boolean(),
});
const recordSchema = z.strictObject({
  enrollmentId: uuidSchema, authority: authoritySchema, version: z.int().min(0),
  createdAt: timestampSchema, expiresAt: timestampSchema,
  publicKeySpki: z.string().regex(/^[A-Za-z0-9_-]{100,256}$/),
  phase: z.enum(["awaiting_restriction", "restricted", "proof_verified", "permission_pending", "admitted", "reclaim_pending", "reclaimed"]),
  restriction: restrictionSchema.nullable(), challenge: enrollmentChallengeSchema.nullable(),
  proofDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), node: nodeIdentitySchema.nullable(),
  formalPolicyRevision: z.int().min(1).nullable(), formalEvidenceId: z.string().min(1).max(128).nullable(),
  reclaimReason: z.string().min(1).max(128).nullable(), reclamationId: uuidSchema.nullable(), credentialRevoked: z.boolean(), nodeAccessRevoked: z.boolean(),
});

export function parseAdmissionRecord(input: unknown): AdmissionRecord {
  const r = recordSchema.parse(input);
  if (Date.parse(r.expiresAt) <= Date.parse(r.createdAt)) throw new Error("Invalid persisted admission lifetime");
  if (r.challenge && (r.challenge.enrollmentId !== r.enrollmentId
    || r.challenge.deviceId !== r.authority.deviceId || r.challenge.installationId !== r.authority.installationId
    || r.challenge.installationGeneration !== r.authority.installationGeneration
    || r.challenge.enrollmentGeneration !== r.authority.enrollmentGeneration
    || Date.parse(r.challenge.expiresAt) > Date.parse(r.expiresAt))) {
    throw new Error("Invalid persisted challenge binding");
  }
  if (r.restriction && (r.restriction.enrollmentId !== r.enrollmentId
    || r.restriction.deviceId !== r.authority.deviceId || r.restriction.installationId !== r.authority.installationId
    || r.restriction.enrollmentGeneration !== r.authority.enrollmentGeneration)) throw new Error("Invalid persisted restriction binding");
  if (["restricted", "proof_verified", "permission_pending", "admitted"].includes(r.phase) && !r.restriction) {
    throw new Error("Missing persisted restriction evidence");
  }
  if (["proof_verified", "permission_pending", "admitted"].includes(r.phase) && (!r.node || !r.proofDigest || r.challenge)) {
    throw new Error("Missing persisted proof evidence");
  }
  if (["permission_pending", "admitted"].includes(r.phase) && !r.formalPolicyRevision) throw new Error("Missing persisted policy intention");
  if (r.phase === "admitted" && !r.formalEvidenceId) throw new Error("Missing persisted formal path evidence");
  if (["reclaim_pending", "reclaimed"].includes(r.phase) && (!r.reclaimReason || !r.reclamationId || r.challenge)) throw new Error("Invalid persisted reclamation");
  if (r.phase === "reclaimed" && (!r.credentialRevoked || !r.nodeAccessRevoked)) throw new Error("Incomplete persisted reclamation");
  return r;
}
