import { z } from "zod";

import {
  compareTimestamps,
  requestMetadataSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";
import { sessionSummarySchema } from "./identity.js";

export const installationCredentialSchema = z
  .string()
  .regex(/^sginst_v1_[A-Za-z0-9_-]{43}$/);

export const bootstrapInstallationRequestSchema = z.strictObject({
  metadata: requestMetadataSchema,
  installationCredential: installationCredentialSchema,
});

export const installationIdentitySchema = z.strictObject({
  installationId: uuidSchema,
  generation: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.literal("active"),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).superRefine((value, context) => {
  const order = compareTimestamps(value.updatedAt, value.createdAt);
  if (order !== null && order < 0) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Installation update cannot predate creation",
    });
  }
});

export const installationAuthResponseSchema = z.strictObject({
  installation: installationIdentitySchema,
  session: sessionSummarySchema,
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  createdNewInstallation: z.boolean(),
}).superRefine((value, context) => {
  const order = compareTimestamps(value.session.createdAt, value.session.expiresAt);
  if (order !== null && order >= 0) {
    context.addIssue({
      code: "custom",
      path: ["session", "expiresAt"],
      message: "Installation session must expire after creation",
    });
  }
});

export type BootstrapInstallationRequest = z.infer<
  typeof bootstrapInstallationRequestSchema
>;
export type InstallationIdentity = z.infer<typeof installationIdentitySchema>;
export type InstallationAuthResponse = z.infer<
  typeof installationAuthResponseSchema
>;
