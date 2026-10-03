import { z } from "zod";
import { contractVersionSchema, requestMetadataSchema, timestampSchema, uuidSchema } from "./common.js";

export const providerDeviceControlCommandRequestSchema = z.strictObject({ metadata: requestMetadataSchema });
export const installationSelfControlCommandRequestSchema = z.strictObject({ metadata: requestMetadataSchema });

export const deviceControlIntentSchema = z.enum(["active", "pause_requested", "paused", "resume_requested", "exit_pending", "exited"]);
export const deviceControlStopSchema = z.enum(["not_requested", "requested", "confirmed", "unknown"]);
export const deviceControlSnapshotSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  deviceId: uuidSchema,
  requestId: z.string().min(8).max(128).nullable(),
  intent: deviceControlIntentSchema,
  controlVersion: z.int().nonnegative().nullable(),
  controlGeneration: z.string().regex(/^[1-9][0-9]{0,18}$/).nullable(),
  stop: deviceControlStopSchema,
  unresolvedActionCount: z.int().nonnegative(),
  checkedAt: timestampSchema,
}).superRefine((snapshot, context) => {
  if (snapshot.stop !== "not_requested" && (snapshot.controlVersion === null || snapshot.controlGeneration === null)) {
    context.addIssue({ code: "custom", message: "A stop state requires a durable journal generation", path: ["controlGeneration"] });
  }
  if (snapshot.stop === "confirmed" && snapshot.unresolvedActionCount !== 0) {
    context.addIssue({ code: "custom", message: "Confirmed stop cannot retain unresolved actions", path: ["unresolvedActionCount"] });
  }
});
export type DeviceControlSnapshot = z.infer<typeof deviceControlSnapshotSchema>;
