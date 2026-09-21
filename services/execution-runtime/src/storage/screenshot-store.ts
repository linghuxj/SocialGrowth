import { createHash, createHmac } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

import { resolve } from "node:path";
import { existsSync } from "node:fs";

export interface ScreenshotStoreOptions {
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;
  region?: string;
  pythonPath?: string;
}

export interface StepMetadata {
  workerId: string;
  deviceId: string;
  sessionId: string;
  step: number;
}

export class ScreenshotStore {
  private readonly endpoint: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly pythonPath: string;
  private bucketChecked = false;

  constructor(options: ScreenshotStoreOptions = {}) {
    this.endpoint = (options.endpoint ?? process.env.SG_MINIO_ENDPOINT ?? "http://127.0.0.1:9000").replace(/\/$/, "");
    this.accessKey = options.accessKey ?? process.env.SG_MINIO_ACCESS_KEY ?? "minioadmin";
    this.secretKey = options.secretKey ?? process.env.SG_MINIO_SECRET_KEY ?? "minioadmin";
    this.bucket = options.bucket ?? process.env.SG_MINIO_BUCKET ?? "socialgrowth-screenshots";
    this.region = options.region ?? "us-east-1";

    const candidatePaths = [
      options.pythonPath,
      process.env.SG_PYTHON_PATH,
      resolve("integrations/google-artemis/.venv/bin/python"),
      resolve("../../integrations/google-artemis/.venv/bin/python"),
      resolve("../integrations/google-artemis/.venv/bin/python"),
    ].filter((p): p is string => Boolean(p));

    this.pythonPath = candidatePaths.find((p) => existsSync(p)) ?? "python3";
  }

  private sha256(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private hmac(key: Buffer | string, data: string): Buffer {
    return createHmac("sha256", key).update(data).digest();
  }

  private sign(method: string, uri: string, query: string, headers: Record<string, string>, payloadSha: string, date: Date) {
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    headers["host"] = new URL(this.endpoint).host;
    headers["x-amz-date"] = amzDate;
    headers["x-amz-content-sha256"] = payloadSha;

    const sortedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest = [
      method,
      uri,
      query,
      canonicalHeaders,
      signedHeaders,
      payloadSha,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      this.sha256(canonicalRequest),
    ].join("\n");

    const kDate = this.hmac(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, "s3");
    const kSigning = this.hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  async ensureBucket(): Promise<void> {
    if (this.bucketChecked) return;
    const now = new Date();
    const uri = `/${this.bucket}`;
    const headers: Record<string, string> = {};
    this.sign("HEAD", uri, "", headers, this.sha256(""), now);

    const headRes = await fetch(`${this.endpoint}${uri}`, {
      method: "HEAD",
      headers,
    });

    if (headRes.status === 404) {
      const putHeaders: Record<string, string> = {};
      this.sign("PUT", uri, "", putHeaders, this.sha256(""), new Date());
      const putRes = await fetch(`${this.endpoint}${uri}`, {
        method: "PUT",
        headers: putHeaders,
      });
      if (!putRes.ok && putRes.status !== 409) {
        throw new Error(`Failed to create MinIO bucket ${this.bucket}: HTTP ${putRes.status}`);
      }
    }
    this.bucketChecked = true;
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

  async uploadScreenshot(
    imageBuffer: Buffer,
    meta: StepMetadata,
    options: { compressWebp?: boolean } = { compressWebp: true }
  ): Promise<{ imageKey: string; contentType: string; size: number }> {
    await this.ensureBucket();

    let finalBuffer = imageBuffer;
    let contentType = "image/png";
    let ext = "png";

    if (options.compressWebp) {
      const webpBuffer = await this.convertPngToWebp(imageBuffer);
      if (webpBuffer !== imageBuffer && webpBuffer.length > 0) {
        finalBuffer = webpBuffer;
        contentType = "image/webp";
        ext = "webp";
      }
    }

    const imageKey = `screenshots/${meta.workerId}/${meta.deviceId}/${meta.sessionId}/step_${meta.step}.${ext}`;
    const uri = `/${this.bucket}/${imageKey}`;
    const payloadSha = this.sha256(finalBuffer);
    const headers: Record<string, string> = {
      "content-type": contentType,
      "content-length": finalBuffer.length.toString(),
    };

    this.sign("PUT", uri, "", headers, payloadSha, new Date());

    const res = await fetch(`${this.endpoint}${uri}`, {
      method: "PUT",
      headers,
      body: new Uint8Array(finalBuffer),
    });

    if (!res.ok) {
      throw new Error(`Failed to upload screenshot to MinIO ${imageKey}: HTTP ${res.status}`);
    }

    return {
      imageKey,
      contentType,
      size: finalBuffer.length,
    };
  }

  async getScreenshot(imageKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    await this.ensureBucket();
    const uri = `/${this.bucket}/${imageKey.replace(/^\//, "")}`;
    const headers: Record<string, string> = {};
    this.sign("GET", uri, "", headers, this.sha256(""), new Date());

    const res = await fetch(`${this.endpoint}${uri}`, {
      method: "GET",
      headers,
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to get screenshot from MinIO ${imageKey}: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || (imageKey.endsWith(".webp") ? "image/webp" : "image/png");

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  }
}
