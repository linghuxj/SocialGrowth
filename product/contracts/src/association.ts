import { z } from "zod";

import {
  requestMetadataSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";

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

export type ConfirmAssociationRequest = z.infer<
  typeof confirmAssociationRequestSchema
>;
