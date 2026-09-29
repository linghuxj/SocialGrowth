import { z } from "zod";

export const productEnvironmentSchema = z.literal("product");

export const healthResponseSchema = z.object({
  environment: productEnvironmentSchema,
  service: z.string().min(1),
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
