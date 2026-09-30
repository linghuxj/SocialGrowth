import { z } from "zod";
import { admissionGenerationSchema } from "./network-admission.js";
import { uuidSchema } from "./common.js";

// Independent CT-06 protocol; not sent by the deployed B1 clients.
export const controlProtocolVersion = "2026-09-30.control-v1" as const;
export const actionPurposeSchema = z.enum(["business", "recovery_check", "exit_cleanup", "operator_takeover"]);
export const phoneActionKindSchema = z.enum(["read_screen", "navigate", "write_input", "submit_publication", "remove_content", "sign_out"]);
export const phoneActionRequestSchema = z.strictObject({
  protocolVersion: z.literal(controlProtocolVersion),
  deviceId: uuidSchema,
  holderId: uuidSchema,
  controlGeneration: admissionGenerationSchema,
  authorizationId: uuidSchema,
  taskAttemptId: uuidSchema,
  actionId: uuidSchema,
  purpose: actionPurposeSchema,
  kind: phoneActionKindSchema,
});
export type PhoneActionRequest = z.infer<typeof phoneActionRequestSchema>;
export type ActionPurpose = z.infer<typeof actionPurposeSchema>;
