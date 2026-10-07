import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseScreenshotStorageConfig, readScreenshotStorageConfig, type ScreenshotStorageConfig } from "./screenshot-config.js";

export interface ScreenshotStoreOptions {
  storage?: ScreenshotStorageConfig;
  pythonPath?: string;
}
export interface StepMetadata { workerId: string; deviceId: string; sessionId: string; step: number; }

export class ScreenshotStore {
  private readonly config: ScreenshotStorageConfig | null;
  private readonly client: S3Client | null;
  private readonly pythonPath: string;
  private bucketChecked = false;
  constructor(options: ScreenshotStoreOptions = {}) {
    this.config = options.storage ? parseScreenshotStorageConfig(options.storage) : readScreenshotStorageConfig();
    const c = this.config;
    this.client = c ? new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: c.forcePathStyle,
      maxAttempts: 1, credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey,
        ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}) },
      ...(c.provider === "oss_s3" ? { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" } : {}),
    }) : null;
    if (c?.provider === "oss_s3") this.client!.middlewareStack.add(next => async args => {
      const request = args.request as { headers: Record<string, string> };
      request.headers["x-oss-content-sha256"] = "UNSIGNED-PAYLOAD";
      return next(args);
    }, { step: "build", name: "ossScreenshotCompatibility" });
    const paths = [options.pythonPath, process.env.SG_PYTHON_PATH,
      resolve("integrations/google-artemis/.venv/bin/python"), resolve("../../integrations/google-artemis/.venv/bin/python"),
      resolve("../integrations/google-artemis/.venv/bin/python")].filter((p): p is string => Boolean(p));
    this.pythonPath = paths.find(p => existsSync(p)) ?? "python3";
  }
  close(): void { this.client?.destroy(); }
  async ensureBucket(): Promise<void> {
    if (!this.config || !this.client) throw new Error("SCREENSHOT_STORAGE_NOT_CONFIGURED");
    if (this.bucketChecked) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }),
        { abortSignal: AbortSignal.timeout(this.config.requestTimeoutMs) });
      this.bucketChecked = true;
    } catch { throw new Error("SCREENSHOT_STORAGE_UNAVAILABLE"); }
    // Existing buckets only. Never create infrastructure as a side effect of a screenshot.
  }
  async convertPngToWebp(pngBuffer: Buffer, quality = 80): Promise<Buffer> {
    return new Promise<Buffer>((resolve) => {
      try {
        const script = `
import sys, io
from PIL import Image
try:
    data = sys.stdin.buffer.read()
    if not data:
        sys.exit(1)
    img = Image.open(io.BytesIO(data))
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=${quality}, method=4)
    sys.stdout.buffer.write(out.getvalue())
except Exception:
    sys.exit(1)
`;
        const child = spawn(this.pythonPath, ["-c", script], {
          stdio: ["pipe", "pipe", "ignore"],
        });

        const chunks: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

        child.on("error", () => resolve(pngBuffer));
        child.on("close", (code) => {
          if (code === 0 && chunks.length > 0) {
            resolve(Buffer.concat(chunks));
          } else {
            resolve(pngBuffer);
          }
        });

        child.stdin.write(pngBuffer);
        child.stdin.end();
      } catch {
        resolve(pngBuffer);
      }
    });
  }

  async uploadScreenshot(imageBuffer: Buffer, meta: StepMetadata,
    options: { compressWebp?: boolean } = { compressWebp: true }
  ): Promise<{ imageKey: string; contentType: string; size: number }> {
    await this.ensureBucket();
    let body = imageBuffer, contentType = "image/png", ext = "png";
    if (options.compressWebp) {
      const converted = await this.convertPngToWebp(imageBuffer);
      if (converted !== imageBuffer && converted.length > 0) { body = converted; contentType = "image/webp"; ext = "webp"; }
    }
    const imageKey = `screenshots/${meta.workerId}/${meta.deviceId}/${meta.sessionId}/step_${meta.step}.${ext}`;
    const c = this.config!;
    try {
      await this.client!.send(new PutObjectCommand({ Bucket: c.bucket, Key: imageKey, Body: body, ContentType: contentType,
        ...(c.provider === "oss_s3" ? { ContentMD5: createHash("md5").update(body).digest("base64") } : {}),
      }), { abortSignal: AbortSignal.timeout(c.requestTimeoutMs) });
    } catch { throw new Error("SCREENSHOT_STORAGE_UPLOAD_UNCONFIRMED"); }
    return { imageKey, contentType, size: body.length };
  }
  async getScreenshot(imageKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    await this.ensureBucket();
    const c = this.config!, signal = AbortSignal.timeout(c.requestTimeoutMs);
    try {
      const result = await this.client!.send(new GetObjectCommand({ Bucket: c.bucket, Key: imageKey }), { abortSignal: signal });
      if (!result.Body) throw new Error("SCREENSHOT_STORAGE_UNAVAILABLE");
      const body = result.Body;
      const abort = () => { if (body instanceof Readable) body.destroy(new Error("SCREENSHOT_STORAGE_TIMEOUT")); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        if (signal.aborted) { abort(); signal.throwIfAborted(); }
        const buffer = Buffer.from(await body.transformToByteArray());
        signal.throwIfAborted();
        return { buffer, contentType: result.ContentType || (imageKey.endsWith(".webp") ? "image/webp" : "image/png") };
      } finally { signal.removeEventListener("abort", abort); }
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw new Error("SCREENSHOT_STORAGE_UNAVAILABLE");
    }
  }
}
