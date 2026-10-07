import { z } from "zod";
import { admissionGenerationSchema } from "./network-admission.js";
import { uuidSchema } from "./common.js";

// Independent CT-06 protocol; not sent by the deployed B1 clients.
export const controlProtocolVersion = "2026-09-30.control-v1" as const;
export const actionPurposeSchema = z.enum(["business", "recovery_check", "exit_cleanup", "operator_takeover"]);
export const phoneActionKindSchema = z.enum(["read_screen", "navigate", "write_input", "submit_login", "submit_publication", "remove_content", "sign_out"]);
export const phoneActionRequestBaseSchema = z.strictObject({
  protocolVersion: z.literal(controlProtocolVersion),
  deviceId: uuidSchema,
  holderId: uuidSchema,
  controlGeneration: admissionGenerationSchema,
  authorizationId: uuidSchema,
  taskAttemptId: uuidSchema,
  actionId: uuidSchema,
  purpose: actionPurposeSchema,
  kind: phoneActionKindSchema,
  fieldRef: z.enum(["login", "password"]).optional(),
  targetViewIdResourceName: z.string().min(1).max(256).regex(/^[A-Za-z0-9_.]+:id\/[A-Za-z0-9_]+$/).optional(),
});
export const phoneActionRequestSchema = phoneActionRequestBaseSchema.superRefine((request, context) => {
  if (request.kind === "write_input") {
    if (!request.fieldRef || request.targetViewIdResourceName !== undefined) context.addIssue({ code: "custom", message: "write_input requires exactly one credential field reference" });
  } else if (request.kind === "submit_login") {
    if (request.fieldRef !== undefined || !request.targetViewIdResourceName) context.addIssue({ code: "custom", message: "submit_login requires exactly one scoped view ID" });
  } else if (request.fieldRef !== undefined || request.targetViewIdResourceName !== undefined) {
    context.addIssue({ code: "custom", message: "non-login action cannot carry a sensitive target" });
  }
});
export const phoneHolderRequestSchema = phoneActionRequestBaseSchema.omit({ actionId: true, kind: true, fieldRef: true, targetViewIdResourceName: true });
export type PhoneActionRequest = z.infer<typeof phoneActionRequestSchema>;
export type ActionPurpose = z.infer<typeof actionPurposeSchema>;
