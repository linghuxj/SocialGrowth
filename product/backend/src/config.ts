import { z } from "zod";

const backendConfigSchema = z.object({
  SG_PRODUCT_BACKEND_HOST: z.string().min(1).default("127.0.0.1"),
  SG_PRODUCT_BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(4320),
});

export type BackendConfig = z.infer<typeof backendConfigSchema>;

export function readBackendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BackendConfig {
  return backendConfigSchema.parse(environment);
}
