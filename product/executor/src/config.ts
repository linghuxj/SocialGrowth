import { z } from "zod";

const executorConfigSchema = z.object({
  SG_PRODUCT_EXECUTOR_MODE: z.enum(["runtime", "disabled"]).default("runtime"),
});

export type ExecutorConfig = z.infer<typeof executorConfigSchema>;

export function readExecutorConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ExecutorConfig {
  return executorConfigSchema.parse(environment);
}

export function describeExecutorStartup(config: ExecutorConfig): string {
  return `[product-executor] mode=${config.SG_PRODUCT_EXECUTOR_MODE}; device workers require an explicit separate command`;
}
