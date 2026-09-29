import { z } from "zod";

import { timestampSchema, uuidSchema, versionedFactSchema } from "./common.js";

const deviceStateSchema = z.enum([
  "unassociated",
  "associated_pending_access",
  "access_ready",
  "paused",
  "exit_pending",
  "exited",
]);

export const operatorDeviceViewSchema = z.strictObject({
  ...versionedFactSchema.shape,
  deviceId: uuidSchema,
  installationId: uuidSchema,
  providerId: uuidSchema.nullable(),
  state: deviceStateSchema,
  lastObservedAt: timestampSchema.nullable(),
});

export const providerDeviceViewSchema = z.strictObject({
  ...versionedFactSchema.shape,
  deviceId: uuidSchema,
  displayName: z.string().min(1),
  state: deviceStateSchema.exclude(["unassociated"]),
  lastObservedAt: timestampSchema.nullable(),
});

export const installationSelfViewSchema = z.strictObject({
  ...versionedFactSchema.shape,
  installationId: uuidSchema,
  deviceId: uuidSchema.nullable(),
  state: deviceStateSchema,
  providerDisplayName: z.string().min(1).nullable(),
});

export type OperatorDeviceView = z.infer<typeof operatorDeviceViewSchema>;
export type ProviderDeviceView = z.infer<typeof providerDeviceViewSchema>;
export type InstallationSelfView = z.infer<
  typeof installationSelfViewSchema
>;
