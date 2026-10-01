import { uploadMaterialBytesCommandSchema, materialUploadTicketViewSchema, uploadMaterialBytesResponseSchema } from "@socialgrowth/product-contracts";
import { ProductApiError, OperatorWriteSessionChangedError, prepareOperatorMaterialBytes } from "./operator-api.js";
import { materialUploadHTTPMaxBytes } from "./material-upload-api.js";
export type MaterialBytesResult = ReturnType<typeof uploadMaterialBytesResponseSchema.parse>;
export class MaterialBytesClientError extends Error {
  constructor(readonly code: "MATERIAL_BYTES_CLIENT_INVALID" | "MATERIAL_BYTES_CLIENT_PROTOCOL_INVALID" | "MATERIAL_BYTES_CLIENT_UNAVAILABLE") { super(code); }
}
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// Explicit caller-owned in-memory bytes and original command, not a File UI,
// local cache, media decoder or admission decision. The ticket is a declared
// descriptor, not permission: backend still checks Cookie/auth/current binding.
export class PreparedMaterialBytes {
  #send: () => Promise<MaterialBytesResult>;
  #bytes: Uint8Array<ArrayBuffer>;
  #expectedSHA: string;
  constructor(rawTicket: unknown, rawCommand: unknown, rawBytes: Uint8Array) {
    const t = materialUploadTicketViewSchema.safeParse(rawTicket), c = uploadMaterialBytesCommandSchema.safeParse(rawCommand);
    if (!t.success || !c.success || !(rawBytes instanceof Uint8Array) || rawBytes.byteLength < 1 || rawBytes.byteLength > materialUploadHTTPMaxBytes
      || t.data.bytes !== rawBytes.byteLength || !sameId(t.data.projectId, c.data.projectId) || !sameId(t.data.objectId, c.data.objectId)) throw new MaterialBytesClientError("MATERIAL_BYTES_CLIENT_INVALID");
    if (![c.data.metadata.requestId, c.data.metadata.idempotencyKey].every(v => /^[\x20-\x7E]+$/.test(v) && v.trim() === v)) throw new MaterialBytesClientError("MATERIAL_BYTES_CLIENT_INVALID");
    const ticket = t.data; this.#bytes = new Uint8Array(rawBytes); this.#expectedSHA = ticket.sha256;
    // Capture original session synchronously BEFORE the asynchronous digest.
    // Blob clones the stable byte view and remains immutable across retries.
    this.#send = prepareOperatorMaterialBytes(c.data, this.#bytes, { parse(raw: unknown) {
      try {
        const result = uploadMaterialBytesResponseSchema.parse(raw);
        if (!sameId(result.projectId, ticket.projectId) || !sameId(result.objectId, ticket.objectId) || result.sha256 !== ticket.sha256 || result.bytes !== ticket.bytes
          || result.contentType !== ticket.contentType) throw new Error();
        return result;
      } catch { throw new MaterialBytesClientError("MATERIAL_BYTES_CLIENT_PROTOCOL_INVALID"); }
    } });
  }
  async send(): Promise<MaterialBytesResult> {
    try {
      const digest = await crypto.subtle.digest("SHA-256", this.#bytes);
      const sha = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      if (sha !== this.#expectedSHA) throw new MaterialBytesClientError("MATERIAL_BYTES_CLIENT_INVALID");
      return await this.#send();
    } catch (error) {
      if (error instanceof ProductApiError || error instanceof OperatorWriteSessionChangedError || error instanceof MaterialBytesClientError) throw error;
      throw new MaterialBytesClientError("MATERIAL_BYTES_CLIENT_UNAVAILABLE");
    }
  }
}
