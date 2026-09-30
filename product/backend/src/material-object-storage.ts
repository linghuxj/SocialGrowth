import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";

export class MaterialStorageError extends Error {
  constructor(readonly code: "CONFIGURATION_REQUIRED" | "INPUT_INVALID" | "STORAGE_UNAVAILABLE" | "OBJECT_CONFLICT" | "OBJECT_INTEGRITY_FAILED", readonly retryable = false) { super(code); }
}
const contentType = z.enum(["application/octet-stream", "video/mp4", "image/jpeg", "image/png", "image/webp"]);
const configSchema = z.strictObject({
  storageLocationId: uuidSchema, endpoint: z.url(), region: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/), forcePathStyle: z.boolean(),
  accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1), sessionToken: z.string().min(1).optional(),
  maxObjectBytes: z.int().min(1).max(128 * 1024 * 1024), requestTimeoutMs: z.int().min(1).max(300000),
}).superRefine((v, ctx) => {
  let u: URL;
  try { u = new URL(v.endpoint); } catch { ctx.addIssue({ code: "custom", path: ["endpoint"], message: "Invalid trusted endpoint" }); return; }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "") || !["https:", "http:"].includes(u.protocol)
    || (u.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(u.hostname))) ctx.addIssue({ code: "custom", path: ["endpoint"], message: "Trusted endpoint must be HTTPS or loopback HTTP without path/credentials" });
});
export type MaterialStorageConfig = z.infer<typeof configSchema>;
const inputSchema = z.strictObject({ projectId: uuidSchema, objectId: uuidSchema, contentType });
const refSchema = z.strictObject({
  storageLocationId: uuidSchema, storageBindingDigest: z.string().regex(/^[a-f0-9]{64}$/), projectId: uuidSchema, objectId: uuidSchema,
  key: z.string().regex(/^projects\/[a-f0-9-]{36}\/objects\/[a-f0-9-]{36}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.int().min(1), contentType,
});
export type MaterialObjectReference = z.infer<typeof refSchema>;

// Internal byte-storage adapter only. No upload HTTP, model, media admission,
// executor or public URL. Caller MUST authenticate/authorize and durably pin IDs
// before using it; successful bytes do not prove media validity or eligibility.
export class MaterialObjectStorage {
  #client: S3Client;
  #config: MaterialStorageConfig;
  #binding: string;
  constructor(input: unknown) {
    const parsed = configSchema.safeParse(input);
    if (!parsed.success) throw new MaterialStorageError("CONFIGURATION_REQUIRED");
    this.#config = { ...parsed.data, storageLocationId: parsed.data.storageLocationId.toLowerCase(), endpoint: new URL(parsed.data.endpoint).origin };
    const c = this.#config;
    this.#binding = createHash("sha256").update(JSON.stringify({ endpoint: c.endpoint, region: c.region, bucket: c.bucket, forcePathStyle: c.forcePathStyle })).digest("hex");
    this.#client = new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: c.forcePathStyle, maxAttempts: 2,
      // Never fall back to developer ambient credentials/profile/metadata.
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}) } });
  }
  close(): void { this.#client.destroy(); }
  binding(): { storageLocationId: string; storageBindingDigest: string; maxObjectBytes: number } {
    return { storageLocationId: this.#config.storageLocationId, storageBindingDigest: this.#binding, maxObjectBytes: this.#config.maxObjectBytes };
  }
  private validate(reference: unknown): MaterialObjectReference {
    const parsed = refSchema.safeParse(reference);
    if (!parsed.success) throw new MaterialStorageError("INPUT_INVALID");
    const r = parsed.data;
    if (r.storageLocationId !== this.#config.storageLocationId || r.storageBindingDigest !== this.#binding || r.bytes > this.#config.maxObjectBytes
      || r.key !== `projects/${r.projectId}/objects/${r.objectId}`) throw new MaterialStorageError("INPUT_INVALID");
    return r;
  }
  async put(input: unknown, bytes: Uint8Array): Promise<MaterialObjectReference> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success || !(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > this.#config.maxObjectBytes) throw new MaterialStorageError("INPUT_INVALID");
    // Copy prevents later caller mutation changing what the request hashes/sends.
    const body = Buffer.from(bytes), projectId = parsed.data.projectId.toLowerCase(), objectId = parsed.data.objectId.toLowerCase();
    const reference = this.validate({ storageLocationId: this.#config.storageLocationId, storageBindingDigest: this.#binding, projectId, objectId,
      key: `projects/${projectId}/objects/${objectId}`, sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length, contentType: parsed.data.contentType });
    try {
      await this.#client.send(new PutObjectCommand({ Bucket: this.#config.bucket, Key: reference.key, Body: body,
        ContentLength: reference.bytes, ContentType: reference.contentType, ChecksumSHA256: Buffer.from(reference.sha256, "hex").toString("base64"), IfNoneMatch: "*" }),
      { abortSignal: AbortSignal.timeout(this.#config.requestTimeoutMs) });
    } catch (error) {
      const status = typeof error === "object" && error !== null && "$metadata" in error && typeof error.$metadata === "object" && error.$metadata !== null && "httpStatusCode" in error.$metadata ? error.$metadata.httpStatusCode : null;
      if (status !== 412) throw new MaterialStorageError("STORAGE_UNAVAILABLE", true);
      // An earlier same-ID write may have succeeded with its response lost.
      // 412 alone is NOT success: verify full bytes + size + declared type.
      try { await this.readVerified(reference); }
      catch (e) { if (e instanceof MaterialStorageError && e.code === "OBJECT_INTEGRITY_FAILED") throw new MaterialStorageError("OBJECT_CONFLICT"); throw e; }
      return reference;
    }
    // PUT acknowledgement is not enough to claim byte integrity persisted.
    await this.readVerified(reference);
    return reference;
  }
  async readVerified(reference: unknown): Promise<Buffer> {
    const r = this.validate(reference), controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.#config.requestTimeoutMs);
    let body: Readable | undefined;
    try {
      const response = await this.#client.send(new GetObjectCommand({ Bucket: this.#config.bucket, Key: r.key }), { abortSignal: controller.signal });
      if (!(response.Body instanceof Readable)) throw new MaterialStorageError("OBJECT_INTEGRITY_FAILED");
      body = response.Body;
      if (response.ContentLength !== r.bytes || response.ContentType !== r.contentType) throw new MaterialStorageError("OBJECT_INTEGRITY_FAILED");
      const hash = createHash("sha256"), chunks: Buffer[] = []; let count = 0;
      for await (const value of body) {
        if (!(value instanceof Uint8Array)) throw new MaterialStorageError("OBJECT_INTEGRITY_FAILED");
        const chunk = Buffer.from(value); count += chunk.length;
        if (count > r.bytes || count > this.#config.maxObjectBytes) throw new MaterialStorageError("OBJECT_INTEGRITY_FAILED");
        chunks.push(chunk); hash.update(chunk);
      }
      if (count !== r.bytes || hash.digest("hex") !== r.sha256) throw new MaterialStorageError("OBJECT_INTEGRITY_FAILED");
      return Buffer.concat(chunks, count);
    } catch (error) {
      if (error instanceof MaterialStorageError) throw error;
      throw new MaterialStorageError("STORAGE_UNAVAILABLE", true);
    } finally { clearTimeout(timer); body?.destroy(); }
  }
}
