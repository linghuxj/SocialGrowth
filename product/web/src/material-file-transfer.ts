import { contractVersion, uuidSchema, materialUploadContentTypeSchema } from "@socialgrowth/product-contracts";
import { captureOperatorWriteSession, newIdempotencyKey } from "./operator-api.js";
import { PreparedMaterialUploadTicket, materialUploadHTTPMaxBytes } from "./material-upload-api.js";
import { PreparedMaterialBytes, type MaterialBytesResult } from "./material-bytes-api.js";

export class MaterialFileTransfer {
  readonly objectId = crypto.randomUUID();
  #checkSession: () => void;
  #file: File;
  #projectId: string;
  #preparing: Promise<void> | null = null;
  #ticket: PreparedMaterialUploadTicket | null = null;
  #bytes: Uint8Array<ArrayBuffer> | null = null;
  #write: PreparedMaterialBytes | null = null;
  #running = false;
  constructor(projectId: string, file: File) {
    this.#projectId = uuidSchema.parse(projectId);
    if (!(file instanceof File) || file.size < 1 || file.size > materialUploadHTTPMaxBytes || !materialUploadContentTypeSchema.safeParse(file.type).success) {
      throw new Error("请选择支持的 MP4/JPEG/PNG/WebP 成品，单文件目前最多 16 MiB");
    }
    this.#file = file; this.#checkSession = captureOperatorWriteSession(); this.#checkSession();
  }
  async #prepare(): Promise<void> {
    this.#checkSession();
    const bytes = new Uint8Array(await this.#file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    this.#checkSession();
    const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    this.#bytes = bytes;
    this.#ticket = new PreparedMaterialUploadTicket({ projectId: this.#projectId, objectId: this.objectId, sha256,
      bytes: bytes.byteLength, contentType: this.#file.type,
      metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() } });
  }
  async send(): Promise<MaterialBytesResult> {
    if (this.#running) throw new Error("该文件正在上传，请等待原请求");
    this.#running = true;
    try {
      this.#checkSession();
      this.#preparing ??= this.#prepare(); await this.#preparing;
      if (!this.#write) {
        const { changed: _changed, replayed: _replayed, ...ticket } = await this.#ticket!.send(); this.#checkSession();
        // The byte seam accepts the strict descriptor view, not the ticket
        // command envelope. Do not weaken either response schema to join them.
        this.#write = new PreparedMaterialBytes(ticket, { projectId: this.#projectId, objectId: this.objectId,
          metadata: { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() } }, this.#bytes!);
      }
      // A failed/unknown send retains original File, object, descriptor, keys
      // and session. Explicit retry does not allocate another object.
      return await this.#write.send();
    } finally { this.#running = false; }
  }
}
