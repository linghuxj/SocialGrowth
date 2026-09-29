import { z } from "zod";

const backendConfigSchema = z.object({
  SG_PRODUCT_BACKEND_HOST: z.string().min(1).default("127.0.0.1"),
  SG_PRODUCT_BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(4320),
});

const operatorRuntimeConfigSchema = z.object({
  SG_PRODUCT_AUTH_PEPPER: z.string().min(32),
  SG_PRODUCT_DATABASE_URL: z.string().min(1),
});

export type BackendConfig = z.infer<typeof backendConfigSchema>;
export type OperatorRuntimeConfig = z.infer<typeof operatorRuntimeConfigSchema>;

export function readBackendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BackendConfig {
  return backendConfigSchema.parse(environment);
}

export function readOperatorRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperatorRuntimeConfig {
  return operatorRuntimeConfigSchema.parse(environment);
}
