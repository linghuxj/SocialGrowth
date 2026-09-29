import { z } from "zod";

const backendConfigSchema = z.object({
  SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: z.string().min(32).optional(),
  SG_PRODUCT_BACKEND_HOST: z.string().min(1).default("127.0.0.1"),
  SG_PRODUCT_BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(4320),
  SG_PRODUCT_SMS_MODE: z
    .enum(["unavailable", "development_capture"])
    .default("unavailable"),
  SG_PRODUCT_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
}).superRefine((config, context) => {
  if (config.SG_PRODUCT_SMS_MODE === "development_capture") {
    if (!config.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN) {
      context.addIssue({
        code: "custom",
        message: "Development SMS capture requires an access token",
        path: ["SG_PRODUCT_DEVELOPMENT_SMS_TOKEN"],
      });
    }
    if (!["127.0.0.1", "::1", "localhost"].includes(config.SG_PRODUCT_BACKEND_HOST)) {
      context.addIssue({
        code: "custom",
        message: "Development SMS capture requires a loopback backend host",
        path: ["SG_PRODUCT_BACKEND_HOST"],
      });
    }
  } else if (config.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN) {
    context.addIssue({
      code: "custom",
      message: "Development SMS token is only valid in development capture mode",
      path: ["SG_PRODUCT_DEVELOPMENT_SMS_TOKEN"],
    });
  }
});

const operatorRuntimeConfigSchema = z.object({
  SG_PRODUCT_AUTH_PEPPER: z.string().min(32),
  SG_PRODUCT_DATABASE_URL: z.string().min(1),
  SG_PRODUCT_SMS_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
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
