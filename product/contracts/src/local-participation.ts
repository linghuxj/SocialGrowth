import { z } from "zod";
import { requestIdSchema, idempotencyKeySchema, timestampSchema, uuidSchema } from "./common.js";
import { admissionGenerationSchema } from "./network-admission.js";
export const participationProtocolVersion = "2026-10-02.participation-v1" as const;
const base = { protocolVersion: z.literal(participationProtocolVersion),
  requestId: requestIdSchema, requestKey: idempotencyKeySchema };
export const participationScopeSchema = z.strictObject({
  deviceId: uuidSchema, associationId: uuidSchema, installationId: uuidSchema,
  installationGeneration: admissionGenerationSchema,
  deviceFactVersion: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  controlGeneration: admissionGenerationSchema.nullable(),
});
export const participationChallengeRequestSchema = z.strictObject({ ...base, runId: uuidSchema });
export const participationRunRequestSchema = z.strictObject({ ...base, runId: uuidSchema });
export const participationRunSchema = z.strictObject({
  protocolVersion: z.literal(participationProtocolVersion), runId: uuidSchema,
  scope: participationScopeSchema, startedAt: timestampSchema,
  actionPermissionGranted: z.literal(false), stopConfirmed: z.literal(false),
});
export const participationChallengeSchema = z.strictObject({
  protocolVersion: z.literal(participationProtocolVersion), challengeId: uuidSchema,
  sequence: admissionGenerationSchema, runId: uuidSchema, scope: participationScopeSchema,
  issuedAt: timestampSchema, expiresAt: timestampSchema,
}).refine(v => Date.parse(v.expiresAt) - Date.parse(v.issuedAt) === 6000, "Challenge lifetime must be six seconds");
export const participationConfirmRequestSchema = z.strictObject({ ...base, runId: uuidSchema, challengeId: uuidSchema });
export const participationWithdrawRequestSchema = participationRunRequestSchema;
export const participationReceiptSchema = z.strictObject({
  protocolVersion: z.literal(participationProtocolVersion), receiptId: uuidSchema,
  scope: participationScopeSchema, runId: uuidSchema, sequence: admissionGenerationSchema,
  state: z.enum(["active", "withdrawn"]), checkedAt: timestampSchema, validUntil: timestampSchema,
  actionPermissionGranted: z.literal(false), stopConfirmed: z.literal(false),
}).refine(v => Date.parse(v.validUntil) - Date.parse(v.checkedAt) === (v.state === "active" ? 10000 : 0), "Receipt lifetime must match its state");
export type ParticipationScope = z.infer<typeof participationScopeSchema>;
export type ParticipationChallenge = z.infer<typeof participationChallengeSchema>;
export type ParticipationReceipt = z.infer<typeof participationReceiptSchema>;
export type ParticipationRun = z.infer<typeof participationRunSchema>;
