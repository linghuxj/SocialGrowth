import { z } from "zod";

export const productEnvironmentSchema = z.literal("product");

export const livenessResponseSchema = z.object({
  environment: productEnvironmentSchema,
  service: z.string().min(1),
  status: z.literal("alive"),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
