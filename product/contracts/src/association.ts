import { z } from "zod";

import {
  contractVersionSchema,
  requestMetadataSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";
import { providerDeviceViewSchema } from "./status.js";

export const associationCodeSchema = z
  .string()
  .regex(/^sgassoc_v1_[A-Za-z0-9_-]{43}$/);

export const associationQrPayloadSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  associationCode: associationCodeSchema,
});

export const createAssociationSessionRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  deviceLabel: z.string().trim().min(1).max(100),
});

export const createAssociationSessionResponseSchema = z.strictObject({
  associationSessionId: uuidSchema,
  associationCode: associationCodeSchema,
  expiresAt: timestampSchema,
  replacedPreviousSession: z.boolean(),
});

export const inspectAssociationCodeRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  associationCode: associationCodeSchema,
});

export const associationSessionViewSchema = z.strictObject({
  associationSessionId: uuidSchema,
  expiresAt: timestampSchema,
  installation: z.strictObject({
    installationId: uuidSchema,
    deviceLabel: z.string().min(1).max(100),
  }),
});

export const confirmAssociationRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  associationSessionId: uuidSchema,
  expectedInstallationId: uuidSchema,
});

export const confirmAssociationResponseSchema = z.strictObject({
  associationId: uuidSchema,
  providerId: uuidSchema,
  installationId: uuidSchema,
  deviceId: uuidSchema,
  confirmedAt: timestampSchema,
  state: z.literal("associated_pending_access"),
});

export const queryAssociationResultRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  associationSessionId: uuidSchema,
  expectedInstallationId: uuidSchema,
});

export const associationResultResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("pending"),
    associationSessionId: uuidSchema,
    installationId: uuidSchema,
    expiresAt: timestampSchema,
  }),
  z.strictObject({
    status: z.literal("associated"),
    result: confirmAssociationResponseSchema,
  }),
]);

export const installationStateRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
});

export const listProviderDevicesRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
});

export const listProviderDevicesResponseSchema = z.strictObject({
  devices: z.array(providerDeviceViewSchema),
});

export type ConfirmAssociationRequest = z.infer<
  typeof confirmAssociationRequestSchema
>;
export type AssociationQrPayload = z.infer<typeof associationQrPayloadSchema>;
export type QueryAssociationResultRequest = z.infer<
  typeof queryAssociationResultRequestSchema
>;
