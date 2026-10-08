import { lstat, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseScreenshotStorageConfig } from "./storage/screenshot-config.js";
import { requireFact, RuntimeError } from "./contracts.js";

export interface AppDownload { url: string; headers: Record<string, string>; }
export interface AppDownloads {
  download(key: string, sha256: string, bytes: number): Promise<AppDownload>;
}
interface SignedRequest {
  protocol: string; hostname: string; port?: number; path: string;
  query?: Record<string, string | string[] | null>; headers: Record<string, string>;
}
function signedDownload(request: SignedRequest): AppDownload {
  const url = new URL(`${request.protocol}//${request.hostname}${request.port ? `:${request.port}` : ""}${request.path}`);
  for (const [key, values] of Object.entries(request.query ?? {})) {
    for (const value of Array.isArray(values) ? values : [values]) url.searchParams.append(key, value ?? "");
  }
  requireFact(url.protocol === "https:" && Boolean(request.headers.authorization), "APP_DOWNLOAD_SIGNATURE_REQUIRED");
  return { url: url.href, headers: { ...request.headers } };
}
/** Private operator configuration. No bucket creation, ambient credentials or model URLs. */
export class AppPackageCloud implements AppDownloads {
  constructor(private readonly configPath: string) {}
  async download(key: string, sha256: string, bytes: number): Promise<AppDownload> {
    requireFact(key.startsWith(`phone-apps/${sha256}/`) && /^phone-apps\/[a-f0-9]{64}\/[A-Za-z0-9_.-]+\.apk$/.test(key), "APK_OBJECT_INVALID");
    const stat = await lstat(this.configPath);
    requireFact(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 16384, "APP_STORAGE_PRIVATE_FILE_REQUIRED");
    const config = parseScreenshotStorageConfig(JSON.parse(await readFile(this.configPath, "utf8")));
    requireFact(new URL(config.endpoint).protocol === "https:", "APP_STORAGE_HTTPS_REQUIRED");
    const clientConfig = { endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
      maxAttempts: 1, credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}) },
      requestChecksumCalculation: "WHEN_REQUIRED" as const, responseChecksumValidation: "WHEN_REQUIRED" as const };
    const client = new S3Client(clientConfig);
    const headers: Record<string, string> = config.provider === "oss_s3" ? { "x-oss-content-sha256": "UNSIGNED-PAYLOAD" } : {};
    if (config.provider === "oss_s3") client.middlewareStack.add(next => async args => {
      const request = args.request as { headers: Record<string, string> };
      Object.assign(request.headers, headers);
      return next(args);
    }, { step: "build", name: "ossAppDownloadCompatibility" });
    try {
      const object = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(config.requestTimeoutMs) });
      requireFact(object.ContentLength === bytes, "APK_OBJECT_SIZE_MISMATCH");
      if (config.provider === "oss_s3") {
        // OSS explicitly permits APK downloads authenticated by an Authorization
        // header. Public endpoint query presigning is rejected for these objects.
        // Capture the SDK's exact signed GET without sending it or disclosing keys.
        let grant: AppDownload | undefined;
        const signingClient = new S3Client({ ...clientConfig, requestHandler: {
          handle: async (request: SignedRequest) => {
            grant = signedDownload(request);
            return { response: { statusCode: 200, headers: {}, body: Readable.from([]) } };
          },
        } });
        signingClient.middlewareStack.add(next => async args => {
          Object.assign((args.request as SignedRequest).headers, headers);
          return next(args);
        }, { step: "build", name: "ossApkHeaderSignature" });
        try {
          await signingClient.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
          requireFact(grant !== undefined, "APP_DOWNLOAD_SIGNATURE_REQUIRED");
          return grant;
        } finally { signingClient.destroy(); }
      }
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: 900, unhoistableHeaders: new Set(Object.keys(headers)) });
      return { url, headers };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      // SDK errors can contain signed URLs; never forward them into traces or Web.
      throw new RuntimeError("APP_DOWNLOAD_UNAVAILABLE", 503);
    } finally { client.destroy(); }
  }
}
