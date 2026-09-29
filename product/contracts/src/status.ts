import { z } from "zod";

import { timestampSchema, uuidSchema, versionedFactSchema } from "./common.js";

export const deviceStateSchema = z.enum([
  "unassociated",
  "associated_pending_access",
  "access_ready",
  "paused",
  "exit_pending",
  "exited",
]);

const operatorDeviceBaseShape = {
  ...versionedFactSchema.shape,
  deviceId: uuidSchema,
  installationId: uuidSchema,
  lastObservedAt: timestampSchema.nullable(),
};

export const operatorDeviceViewSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...operatorDeviceBaseShape,
    state: z.literal("unassociated"),
    providerId: z.null(),
  }),
  z.strictObject({
    ...operatorDeviceBaseShape,
    state: deviceStateSchema.exclude(["unassociated"]),
    providerId: uuidSchema,
  }),
]);

export const providerDeviceViewSchema = z.strictObject({
  ...versionedFactSchema.shape,
  deviceId: uuidSchema,
  displayName: z.string().min(1),
  state: deviceStateSchema.exclude(["unassociated"]),
  lastObservedAt: timestampSchema.nullable(),
});

const installationBaseShape = {
  ...versionedFactSchema.shape,
  installationId: uuidSchema,
};

export const installationSelfViewSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...installationBaseShape,
    state: z.literal("unassociated"),
    deviceId: z.null(),
  }),
  z.strictObject({
    ...installationBaseShape,
    state: deviceStateSchema.exclude(["unassociated"]),
    deviceId: uuidSchema,
  }),
]);

export type OperatorDeviceView = z.infer<typeof operatorDeviceViewSchema>;
export type ProviderDeviceView = z.infer<typeof providerDeviceViewSchema>;
export type InstallationSelfView = z.infer<
  typeof installationSelfViewSchema
>;
