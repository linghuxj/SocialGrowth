import { z } from "zod";

import {
  requestMetadataSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";

export const invitationStatusSchema = z.enum([
  "active",
  "expired",
  "exhausted",
  "revoked",
]);

export const invitationCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const createInvitationRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  maxUses: z.int().min(1).max(10_000),
  expiresAt: timestampSchema,
});

export const invitationRegistrationProgressSchema = z.strictObject({
  providerId: uuidSchema,
  displayName: z.string().min(1).max(100),
  registeredAt: timestampSchema,
  associatedDeviceCount: z.int().nonnegative(),
});

const invitationBaseShape = {
  invitationId: uuidSchema,
  maxUses: z.int().min(1),
  consumedUses: z.int().nonnegative(),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
  evaluatedAt: timestampSchema,
  createdByOperatorId: uuidSchema,
  factVersion: z.int().nonnegative(),
  registrations: z.array(invitationRegistrationProgressSchema),
};

const availableInvitationViewSchema = z.strictObject({
  ...invitationBaseShape,
  status: z.enum(["active", "expired", "exhausted"]),
  revokedAt: z.null(),
  revokedByOperatorId: z.null(),
});

const revokedInvitationViewSchema = z.strictObject({
  ...invitationBaseShape,
  status: z.literal("revoked"),
  revokedAt: timestampSchema,
  revokedByOperatorId: uuidSchema,
});

const invitationViewStructureSchema = z.discriminatedUnion("status", [
  availableInvitationViewSchema,
  revokedInvitationViewSchema,
]);

type InvitationViewStructure = z.infer<typeof invitationViewStructureSchema>;

function exactTimestampParts(timestamp: string): { fraction: string; seconds: bigint } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(timestamp);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6] || !match[8]) {
    return null;
  }
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(Number(match[4]), Number(match[5]), Number(match[6]), 0);
  const offsetMinutes = match[8] === "Z"
    ? 0
    : (match[9] === "+" ? 1 : -1) * (Number(match[10]) * 60 + Number(match[11]));
  return {
    seconds: BigInt(date.getTime() / 1000 - offsetMinutes * 60),
    fraction: match[7] ?? "",
  };
}

function compareTimestamps(left: string, right: string): number | null {
  const leftParts = exactTimestampParts(left);
  const rightParts = exactTimestampParts(right);
  if (!leftParts || !rightParts) return null;
  if (leftParts.seconds !== rightParts.seconds) {
    return leftParts.seconds < rightParts.seconds ? -1 : 1;
  }
  const width = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  return leftParts.fraction.padEnd(width, "0").localeCompare(
    rightParts.fraction.padEnd(width, "0"),
  );
}

function validateInvitationSemantics(
  invitation: InvitationViewStructure,
  context: z.RefinementCtx,
): void {
  const invalid = (message: string, path: Array<string | number>) => {
      context.addIssue({ code: "custom", message, path });
    };

    const expiresAfterCreation = compareTimestamps(invitation.expiresAt, invitation.createdAt);
    const evaluationAfterCreation = compareTimestamps(invitation.evaluatedAt, invitation.createdAt);
    if (expiresAfterCreation === null || evaluationAfterCreation === null) return;
    if (expiresAfterCreation <= 0) {
      invalid("Invitation must expire after creation", ["expiresAt"]);
    }
    if (evaluationAfterCreation < 0) {
      invalid("Invitation cannot be evaluated before creation", ["evaluatedAt"]);
    }
    if (invitation.consumedUses > invitation.maxUses) {
      invalid("Invitation consumption exceeds its limit", ["consumedUses"]);
    }
    if (invitation.registrations.length !== invitation.consumedUses) {
      invalid("Invitation registrations must be the complete consumed set", ["registrations"]);
    }
    const providerIds = new Set(invitation.registrations.map(({ providerId }) => providerId));
    if (providerIds.size !== invitation.registrations.length) {
      invalid("Invitation registrations must contain unique providers", ["registrations"]);
    }
    for (const [index, registration] of invitation.registrations.entries()) {
      const registrationAfterCreation = compareTimestamps(registration.registeredAt, invitation.createdAt);
      const registrationBeforeEvaluation = compareTimestamps(registration.registeredAt, invitation.evaluatedAt);
      if (registrationAfterCreation === null || registrationBeforeEvaluation === null) return;
      if (registrationAfterCreation < 0 || registrationBeforeEvaluation > 0) {
        invalid("Registration time is outside the invitation observation window", ["registrations", index, "registeredAt"]);
      }
    }

    if (invitation.status === "revoked") {
      const revocationAfterCreation = compareTimestamps(invitation.revokedAt, invitation.createdAt);
      const revocationBeforeEvaluation = compareTimestamps(invitation.revokedAt, invitation.evaluatedAt);
      if (revocationAfterCreation === null || revocationBeforeEvaluation === null) return;
      if (revocationAfterCreation < 0) {
        invalid("Invitation cannot be revoked before creation", ["revokedAt"]);
      }
      if (revocationBeforeEvaluation > 0) {
        invalid("Invitation revocation is outside the observation window", ["revokedAt"]);
      }
      return;
    }

    const expirationAtEvaluation = compareTimestamps(invitation.expiresAt, invitation.evaluatedAt);
    if (expirationAtEvaluation === null) return;
    const expectedStatus = expirationAtEvaluation <= 0
      ? "expired"
      : invitation.consumedUses === invitation.maxUses
        ? "exhausted"
        : "active";
    if (invitation.status !== expectedStatus) {
      invalid("Invitation status contradicts the evaluated facts", ["status"]);
    }
}

export const invitationViewSchema = invitationViewStructureSchema.superRefine(
  validateInvitationSemantics,
);

export const invitationAccessSchema = z.strictObject({
  code: invitationCodeSchema,
});

export const createInvitationResponseSchema = z.strictObject({
  invitation: invitationViewSchema,
  access: invitationAccessSchema,
});

export const listInvitationsResponseSchema = z.strictObject({
  invitations: z.array(invitationViewSchema),
});

export const revokeInvitationRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  invitationId: uuidSchema,
  expectedFactVersion: z.int().nonnegative(),
});

export const revokeInvitationResponseSchema = z.strictObject({
  invitation: revokedInvitationViewSchema.superRefine(validateInvitationSemantics),
});

export const registerProviderRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  invitationCode: z.string().min(8).max(128),
  phoneVerificationId: uuidSchema,
  displayName: z.string().trim().min(1).max(100),
});

export const registerProviderResponseSchema = z.strictObject({
  providerId: uuidSchema,
  invitationId: uuidSchema,
  registeredAt: timestampSchema,
});

export type CreateInvitationRequest = z.infer<
  typeof createInvitationRequestSchema
>;
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;
export type InvitationView = z.infer<typeof invitationViewSchema>;
export type ListInvitationsResponse = z.infer<typeof listInvitationsResponseSchema>;
export type RevokeInvitationRequest = z.infer<typeof revokeInvitationRequestSchema>;
export type RevokeInvitationResponse = z.infer<typeof revokeInvitationResponseSchema>;
export type RegisterProviderRequest = z.infer<
  typeof registerProviderRequestSchema
>;
