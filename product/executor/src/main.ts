import { z } from "zod";

const executorConfigSchema = z.object({
  SG_PRODUCT_EXECUTOR_MODE: z.literal("disabled").default("disabled"),
});

const config = executorConfigSchema.parse(process.env);
console.log(
  `[product-executor] mode=${config.SG_PRODUCT_EXECUTOR_MODE}; no device queue is consumed by the WP-00 scaffold`,
);
