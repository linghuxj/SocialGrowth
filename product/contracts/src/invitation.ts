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

export const invitationViewSchema = z.discriminatedUnion("status", [
  availableInvitationViewSchema,
  revokedInvitationViewSchema,
]);

export const invitationAccessSchema = z.strictObject({
  code: invitationCodeSchema,
  registrationPath: z.string().regex(/^\/provider\/register\?invitation=[A-Za-z0-9_-]{43}$/),
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
  invitation: revokedInvitationViewSchema,
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
