import { z } from "zod";
import { isAbsolute } from "node:path";

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
  SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE: z.string().min(1).optional(),
  SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE: z.string().min(1).optional(),
  SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
}).superRefine((config, context) => {
  const grantValues = [config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE, config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID,
    config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS, config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS];
  if (grantValues.some(value => value !== undefined) && grantValues.some(value => value === undefined)) {
    context.addIssue({ code: "custom", message: "Media input grant signing requires an explicit complete key configuration", path: ["SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE"] });
  }
  if (config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE && !isAbsolute(config.SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE)) {
    context.addIssue({ code: "custom", message: "Media input grant signing key path must be absolute", path: ["SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE"] });
  }
  if (config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS !== undefined
    && config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS !== undefined
    && config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS <= config.SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS) {
    context.addIssue({ code: "custom", message: "Media input grant key validity range is invalid", path: ["SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS"] });
  }
});

const smsRuntimeConfigSchema = backendConfigSchema
  .and(z.object({ SG_PRODUCT_AUTH_PEPPER: z.string().min(32) }))
  .superRefine((config, context) => {
    if (
      config.SG_PRODUCT_SMS_MODE === "development_capture" &&
      config.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN === config.SG_PRODUCT_AUTH_PEPPER
    ) {
      context.addIssue({
        code: "custom",
        message: "Development SMS token must differ from the authentication pepper",
        path: ["SG_PRODUCT_DEVELOPMENT_SMS_TOKEN"],
      });
    }
  });

export type BackendConfig = z.infer<typeof backendConfigSchema>;
export type OperatorRuntimeConfig = z.infer<typeof operatorRuntimeConfigSchema>;
export type SmsRuntimeConfig = z.infer<typeof smsRuntimeConfigSchema>;

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

export function readSmsRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SmsRuntimeConfig {
  return smsRuntimeConfigSchema.parse(environment);
}
