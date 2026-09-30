import type { Readable } from "node:stream";
export const materialHttpMaxBytes = 16 * 1024 * 1024;
export const materialHttpReadTimeoutMs = 15000;
export class MaterialByteTransportError extends Error {
  constructor(readonly code: "INVALID_BYTES" | "INCOMPLETE_BYTES" | "BODY_TIMEOUT") { super(code); }
}
// Bounded private HTTP buffer, not a presigned URL, multipart/object uploader,
// decoder or media eligibility check. Failure closes the incomplete transport;
// the client must keep its original ticket/key rather than assume any success.
export async function readMaterialByteStream(source: Readable, expectedBytes: number, maxBytes = materialHttpMaxBytes, timeoutMs = materialHttpReadTimeoutMs): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maxBytes || !Number.isSafeInteger(maxBytes) || maxBytes < 1
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new MaterialByteTransportError("INVALID_BYTES");
  const deadline = performance.now() + timeoutMs, chunks: Buffer[] = []; let count = 0, completed = false;
  const timer = setTimeout(() => source.destroy(new MaterialByteTransportError("BODY_TIMEOUT")), timeoutMs);
  try {
    for await (const value of source) {
      if (performance.now() >= deadline) throw new MaterialByteTransportError("BODY_TIMEOUT");
      if (!(value instanceof Uint8Array)) throw new MaterialByteTransportError("INVALID_BYTES");
      const chunk = Buffer.from(value); count += chunk.length;
      if (count > expectedBytes || count > maxBytes) throw new MaterialByteTransportError("INVALID_BYTES");
      chunks.push(chunk);
    }
    if (performance.now() >= deadline) throw new MaterialByteTransportError("BODY_TIMEOUT");
    if (count !== expectedBytes) throw new MaterialByteTransportError("INCOMPLETE_BYTES");
    completed = true; return Buffer.concat(chunks, count);
  } catch (error) {
    if (error instanceof MaterialByteTransportError) throw error;
    throw new MaterialByteTransportError("INCOMPLETE_BYTES");
  } finally { clearTimeout(timer); if (!completed) source.destroy(); }
}
