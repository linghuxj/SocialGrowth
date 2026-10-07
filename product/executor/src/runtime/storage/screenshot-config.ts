import { z } from "zod";

const schema = z.strictObject({
  provider: z.enum(["s3", "oss_s3"]),
  endpoint: z.url(), region: z.string().regex(/^[a-z0-9-]+$/),
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  forcePathStyle: z.boolean(), accessKey: z.string().min(1), secretKey: z.string().min(1),
  sessionToken: z.string().min(1).optional(),
  requestTimeoutMs: z.number().int().min(1).max(300000),
}).superRefine((config, ctx) => {
  let url: URL;
  try { url = new URL(config.endpoint); } catch { ctx.addIssue({ code: "custom", message: "Trusted storage endpoint required", path: ["endpoint"] }); return; }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !["https:", "http:"].includes(url.protocol)
    || (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    ctx.addIssue({ code: "custom", message: "Trusted storage endpoint required", path: ["endpoint"] });
  }
});
export type ScreenshotStorageConfig = z.infer<typeof schema>;
export function parseScreenshotStorageConfig(input: unknown): ScreenshotStorageConfig {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("SCREENSHOT_STORAGE_CONFIGURATION_REQUIRED");
  return parsed.data;
}
export const screenshotFields = ["PROVIDER", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "REQUEST_TIMEOUT_MS"] as const;
export function readScreenshotStorageConfig(env: NodeJS.ProcessEnv = process.env): ScreenshotStorageConfig | null {
  const mode = env.SG_SCREENSHOT_MODE ?? "unavailable";
  const fields = [...screenshotFields, "SESSION_TOKEN"];
  if (mode === "unavailable" && fields.every(key => env[`SG_SCREENSHOT_${key}`] === undefined)) return null;
  if (mode !== "configured" || !["true", "false"].includes(env.SG_SCREENSHOT_FORCE_PATH_STYLE ?? "")
    || !/^[1-9][0-9]*$/.test(env.SG_SCREENSHOT_REQUEST_TIMEOUT_MS ?? "")) throw new Error("SCREENSHOT_STORAGE_CONFIGURATION_REQUIRED");
  return parseScreenshotStorageConfig({
    provider: env.SG_SCREENSHOT_PROVIDER, endpoint: env.SG_SCREENSHOT_ENDPOINT, region: env.SG_SCREENSHOT_REGION,
    bucket: env.SG_SCREENSHOT_BUCKET, forcePathStyle: env.SG_SCREENSHOT_FORCE_PATH_STYLE === "true",
    accessKey: env.SG_SCREENSHOT_ACCESS_KEY, secretKey: env.SG_SCREENSHOT_SECRET_KEY,
    requestTimeoutMs: Number(env.SG_SCREENSHOT_REQUEST_TIMEOUT_MS),
    ...(env.SG_SCREENSHOT_SESSION_TOKEN ? { sessionToken: env.SG_SCREENSHOT_SESSION_TOKEN } : {}),
  });
}
