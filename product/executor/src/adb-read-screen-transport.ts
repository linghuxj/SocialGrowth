import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import { phoneActionRequestSchema, timestampSchema, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import type { PhoneFenceTransport, PhoneTransportTicket } from "./phone-action-fence.js";

// Internal immutable construction, never an HTTP body or worker environment
// switch. Current network/target/installation authority is still required by
// the caller's broker and fence. This seals ONE transport, not the raw SDK.
const bindingSchema = phoneActionRequestSchema.omit({ actionId: true, kind: true }).extend({
  serial: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  host: z.string().refine(v => isIP(v) !== 0 && !["0.0.0.0", "::"].includes(v)),
  port: z.int().min(1).max(65535),
  binaryPath: z.string().refine(isAbsolute), binarySha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AdbReadScreenBinding = z.infer<typeof bindingSchema>;
const ticketSchema = phoneActionRequestSchema.extend({ serial: bindingSchema.shape.serial,
  checkedAt: timestampSchema, validUntil: timestampSchema, replayed: z.literal(false) });
export class AdbReadScreenError extends Error {
  constructor(readonly code: "INVALID_BOUNDARY" | "DENIED" | "READ_UNCONFIRMED") {
    super(`ADB read rejected: ${code}`);
  }
}
function reject(code: AdbReadScreenError["code"]): never { throw new AdbReadScreenError(code); }
const digest = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const maxBytes = 16 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(v: Buffer): number {
  let c = 0xffffffff; for (const b of v) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Complete PNG framing/CRC, bounded dimensions, no missing data or trailing
// bytes. The SDK's 1px headless fallback is explicitly refused. This does not
// independently prove App identity or that pixels describe an authorized App.
function screenSize(png: Buffer): { width: number; height: number } {
  if (png.length > maxBytes || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) reject("READ_UNCONFIRMED");
  let pos = 8, width = 0, height = 0, channels = 0, sawData = false, dataEnded = false;
  const compressed: Buffer[] = [];
  while (pos + 12 <= png.length) {
    const length = png.readUInt32BE(pos), end = pos + 12 + length;
    if (end > png.length || length > maxBytes) reject("READ_UNCONFIRMED");
    const type = png.toString("ascii", pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(png.subarray(pos + 4, end - 4)) !== png.readUInt32BE(end - 4)) reject("READ_UNCONFIRMED");
    if (pos === 8) {
      if (type !== "IHDR" || length !== 13) reject("READ_UNCONFIRMED");
      width = png.readUInt32BE(pos + 8); height = png.readUInt32BE(pos + 12);
      channels = png[pos + 17] === 2 ? 3 : png[pos + 17] === 6 ? 4 : 0;
      if (width <= 1 || height <= 1 || !channels || (width * channels + 1) * height > 64 * 1024 * 1024
        || png[pos + 16] !== 8 || png[pos + 18] !== 0 || png[pos + 19] !== 0 || png[pos + 20] !== 0) reject("READ_UNCONFIRMED");
    } else if (type === "IHDR") reject("READ_UNCONFIRMED");
    if (type === "IDAT") {
      if (dataEnded || length === 0) reject("READ_UNCONFIRMED");
      sawData = true;
      compressed.push(png.subarray(pos + 8, end - 4));
    } else if (sawData) dataEnded = true;
    if (type === "IEND") {
      if (length !== 0 || end !== png.length || !sawData) reject("READ_UNCONFIRMED");
      const rowBytes = width * channels + 1, expected = rowBytes * height;
      const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
      if (decoded.length !== expected) reject("READ_UNCONFIRMED");
      for (let row = 0; row < height; row++) if (decoded[row * rowBytes]! > 4) reject("READ_UNCONFIRMED");
      return { width, height };
    }
    pos = end;
  }
  reject("READ_UNCONFIRMED");
}
export interface AdbScreenCapture { png: Buffer; sha256: string; width: number; height: number }

// start is deliberately synchronous through spawn: no await, shell, queued
// callback, discovery, alternate endpoint/serial or fallback. The result settles
// only on child close; timeout/overflow/nonzero/malformed data remain UNKNOWN in
// PhoneActionFence. Killing a client is never recorded as a stopped device.
export class AdbReadScreenTransport implements PhoneFenceTransport<AdbScreenCapture> {
  private readonly binding: Readonly<AdbReadScreenBinding>;
  private readonly fileIdentity: string;
  constructor(raw: AdbReadScreenBinding, private readonly now = () => Date.now()) {
    const parsed = bindingSchema.safeParse(raw);
    if (!parsed.success || parsed.data.purpose !== "business") reject("INVALID_BOUNDARY");
    this.binding = Object.freeze(parsed.data);
    this.fileIdentity = this.binaryIdentity();
  }
  private binaryIdentity(): string {
    try {
      const b = this.binding, f = lstatSync(b.binaryPath);
      if (!f.isFile() || f.isSymbolicLink() || realpathSync(b.binaryPath) !== b.binaryPath || f.size > 32 * 1024 * 1024
        || (f.mode & 0o022) !== 0 || (f.mode & 0o111) === 0 || (process.getuid && ![0, process.getuid()].includes(f.uid))
        || digest(readFileSync(b.binaryPath)) !== b.binarySha256) reject("INVALID_BOUNDARY");
      return `${f.dev}:${f.ino}:${f.size}:${f.mtimeMs}`;
    } catch { reject("INVALID_BOUNDARY"); }
  }
  start(raw: PhoneActionRequest, serial: string, rawTicket: Readonly<PhoneTransportTicket>): Promise<AdbScreenCapture> {
    const parsed = phoneActionRequestSchema.safeParse(raw), proof = ticketSchema.safeParse(rawTicket), b = this.binding;
    if (!parsed.success || !proof.success) reject("DENIED");
    const r = parsed.data, t = proof.data;
    if (r.kind !== "read_screen" || serial !== b.serial || t.serial !== b.serial
      || Object.entries(r).some(([k, v]) => t[k as keyof PhoneTransportTicket] !== v)
      || ["protocolVersion", "deviceId", "holderId", "authorizationId", "taskAttemptId", "controlGeneration", "purpose"].some(k => r[k as keyof PhoneActionRequest] !== b[k as keyof AdbReadScreenBinding])) reject("DENIED");
    if (this.binaryIdentity() !== this.fileIdentity) reject("INVALID_BOUNDARY");
    const time = this.now();
    if (Date.parse(t.checkedAt) > time || Date.parse(t.validUntil) <= time || Date.parse(t.validUntil) - Date.parse(t.checkedAt) > 2000) reject("DENIED");
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(b.binaryPath, ["-H", b.host, "-P", String(b.port), "-s", b.serial, "exec-out", "screencap", "-p"], {
        shell: false, stdio: ["ignore", "pipe", "pipe"],
        env: { ADB_SERVER_SOCKET: `tcp:${isIP(b.host) === 6 ? `[${b.host}]` : b.host}:${b.port}`, ADB_HOST: b.host, ADB_PORT: String(b.port) },
      });
    } catch { reject("READ_UNCONFIRMED"); }
    return new Promise((resolve, deny) => {
      const chunks: Buffer[] = []; let size = 0, failed = false;
      const fail = () => { failed = true; chunks.length = 0; try { child.kill("SIGKILL"); } catch { /* never infer device stop */ } };
      const timer = setTimeout(fail, 3000);
      child.stdout!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) fail(); else if (!failed) chunks.push(chunk); });
      // Never retain, report or persist raw ADB stderr (may contain identities).
      child.stderr!.on("data", () => undefined);
      child.once("error", () => { failed = true; });
      child.stdout!.once("error", fail); child.stderr!.once("error", fail);
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (failed || code !== 0 || signal !== null) { deny(new AdbReadScreenError("READ_UNCONFIRMED")); return; }
        try { const png = Buffer.concat(chunks); resolve({ png, sha256: digest(png), ...screenSize(png) }); }
        catch { deny(new AdbReadScreenError("READ_UNCONFIRMED")); }
        finally { chunks.length = 0; }
      });
    });
  }
}
