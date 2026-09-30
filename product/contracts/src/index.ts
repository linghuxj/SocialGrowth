import { z } from "zod";

export * from "./action-permission.js";
export * from "./association.js";
export * from "./common.js";
export * from "./device-facts.js";
export * from "./device-assistance.js";
export * from "./errors.js";
export * from "./identity.js";
export * from "./installation-auth.js";
export * from "./invitation.js";
export * from "./network-admission.js";
export * from "./operator.js";
export * from "./provider-auth.js";
export * from "./project.js";
export * from "./project-planning.js";
export * from "./registry.js";
export * from "./status.js";

export const productEnvironmentSchema = z.literal("product");

export const livenessResponseSchema = z.object({
  environment: productEnvironmentSchema,
  service: z.string().min(1),
  status: z.literal("alive"),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
