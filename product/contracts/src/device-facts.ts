import { z } from "zod";

import { timestampSchema, uuidSchema, versionedFactSchema } from "./common.js";
import { deviceStateSchema } from "./status.js";

export const operatorProviderFactSchema = z.strictObject({
  providerId: uuidSchema,
  displayName: z.string().trim().min(1).max(100),
  phoneLastFour: z.string().regex(/^[0-9]{4}$/),
  status: z.enum(["active", "disabled"]),
});

export const operatorDeviceFactSchema = z.strictObject({
  ...versionedFactSchema.shape,
  deviceId: uuidSchema,
  providerId: uuidSchema,
  displayName: z.string().trim().min(1).max(100),
  state: deviceStateSchema.exclude(["unassociated"]),
  connectionState: z.literal("unknown"),
  lastConfirmedAt: z.null(),
});

export const listOperatorDeviceFactsResponseSchema = z.strictObject({
  readAt: timestampSchema,
  providers: z.array(operatorProviderFactSchema),
  devices: z.array(operatorDeviceFactSchema),
});

export type ListOperatorDeviceFactsResponse = z.infer<
  typeof listOperatorDeviceFactsResponseSchema
>;
