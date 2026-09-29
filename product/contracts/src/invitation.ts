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

export const createInvitationRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  maxUses: z.int().min(1).max(10_000),
  expiresAt: timestampSchema,
});

export const invitationViewSchema = z.strictObject({
  invitationId: uuidSchema,
  code: z.string().min(8).max(128),
  maxUses: z.int().positive(),
  consumedUses: z.int().nonnegative(),
  expiresAt: timestampSchema,
  status: invitationStatusSchema,
  createdByOperatorId: uuidSchema,
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
export type RegisterProviderRequest = z.infer<
  typeof registerProviderRequestSchema
>;
