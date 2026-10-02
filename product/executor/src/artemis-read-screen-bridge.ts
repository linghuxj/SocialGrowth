import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, basename, isAbsolute } from "node:path";
import { z } from "zod";
import { phoneActionRequestSchema, uuidSchema, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import { PhoneActionFence } from "./phone-action-fence.js";
import type { AdbScreenCapture } from "./adb-read-screen-transport.js";

export const readScreenBridgeVersion = "2026-10-02.read-screen-v1";
const scopeSchema = phoneActionRequestSchema.omit({ actionId: true, kind: true }).extend({ serial: z.string().min(1).max(128) });
export type ReadScreenBridgeScope = z.infer<typeof scopeSchema>;
export interface ReadScreenBridgeAccess { socketPath: string; token: string; scopeDigest: string; serial: string }
const requestSchema = z.strictObject({ version: z.literal(readScreenBridgeVersion), requestId: uuidSchema,
  scopeDigest: z.string().regex(/^[a-f0-9]{64}$/), token: z.string().regex(/^[a-f0-9]{64}$/) });
export class ReadScreenBridgeError extends Error { constructor() { super("READ_SCREEN_BRIDGE_UNAVAILABLE"); } }

// Private task-process IPC, NOT an HTTP permission endpoint. A valid token only
// selects a fixed original scope; EVERY read still passes the durable fence and
// current central authority. No caller device, command, kind or success flags.
export class ArtemisReadScreenBridge {
  private readonly scope: Readonly<ReadScreenBridgeScope>;
  private readonly token = randomBytes(32).toString("hex");
  private readonly scopeDigest: string;
  private server: Server | null = null;
  private closing = false;
  private ownsSocket = false;
  private socketIdentity: string | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly work = new Set<Promise<void>>();
  constructor(private readonly socketPath: string, raw: ReadScreenBridgeScope,
    private readonly fence: PhoneActionFence<AdbScreenCapture>) {
    const scope = scopeSchema.safeParse(raw);
    if (!scope.success || scope.data.purpose !== "business" || !(fence instanceof PhoneActionFence)) throw new ReadScreenBridgeError();
    this.scope = Object.freeze(scope.data);
    const state = fence.snapshot();
    if (state.deviceId !== this.scope.deviceId || state.serial !== this.scope.serial) throw new ReadScreenBridgeError();
    this.scopeDigest = createHash("sha256").update(JSON.stringify(this.scope)).digest("hex");
    this.checkParent();
  }
  private checkParent(): void {
    try {
      const parent = dirname(this.socketPath), f = lstatSync(parent);
      if (!isAbsolute(this.socketPath) || Buffer.byteLength(this.socketPath) > 100 || !basename(this.socketPath)
        || realpathSync(parent) !== parent || !f.isDirectory() || f.isSymbolicLink() || (f.mode & 0o077) !== 0
        || (process.getuid && f.uid !== process.getuid())) throw new ReadScreenBridgeError();
      try { lstatSync(this.socketPath); throw new ReadScreenBridgeError(); }
      catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "ENOENT") throw e; }
    } catch { throw new ReadScreenBridgeError(); }
  }
  async listen(): Promise<ReadScreenBridgeAccess> {
    if (this.server || this.closing || !this.currentScope()) throw new ReadScreenBridgeError();
    this.checkParent();
    const server = createServer(socket => this.accept(socket)); this.server = server;
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(this.socketPath, resolve); });
      this.ownsSocket = true; chmodSync(this.socketPath, 0o600);
      const f = lstatSync(this.socketPath); if (!f.isSocket() || (f.mode & 0o077) !== 0) throw new ReadScreenBridgeError();
      this.socketIdentity = `${f.dev}:${f.ino}`;
      server.on("error", () => { this.closing = true; for (const socket of this.sockets) socket.destroy(); });
      return Object.freeze({ socketPath: this.socketPath, token: this.token, scopeDigest: this.scopeDigest, serial: this.scope.serial });
    } catch { await this.close(); throw new ReadScreenBridgeError(); }
  }
  private currentScope(): boolean {
    const state = this.fence.snapshot(), grant = state.grant;
    return state.disposition === "enabled" && grant !== null && state.controlGeneration === this.scope.controlGeneration
      && grant.allowedKinds.length === 1 && grant.allowedKinds[0] === "read_screen" && Date.parse(grant.leaseUntil) > Date.now()
      && Object.entries(this.scope).every(([key, value]) => grant[key as keyof typeof grant] === value);
  }
  private accept(socket: Socket): void {
    if (this.closing || this.sockets.size >= 16) { socket.destroy(); return; }
    this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); socket.on("error", () => undefined);
    let data = Buffer.alloc(0), accepted = false;
    const timer = setTimeout(() => socket.destroy(), 1000);
    socket.on("data", chunk => {
      if (accepted) { socket.destroy(); return; }
      data = Buffer.concat([data, chunk]);
      if (data.length > 1024) { clearTimeout(timer); socket.destroy(); return; }
      const newline = data.indexOf(10); if (newline < 0) return;
      accepted = true; clearTimeout(timer); socket.pause();
      if (newline !== data.length - 1) { socket.destroy(); return; }
      let raw: unknown; try { raw = JSON.parse(data.subarray(0, newline).toString("utf8")); } catch { socket.destroy(); return; }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== parsed.data.requestId.toLowerCase()
        || parsed.data.scopeDigest !== this.scopeDigest || !timingSafeEqual(Buffer.from(parsed.data.token), Buffer.from(this.token))) { socket.destroy(); return; }
      // requestId IS the durable original actionId. ACK loss, reconnection or a
      // host restart with the same ID cannot generate another physical read.
      const pending = this.capture(socket, parsed.data.requestId); this.work.add(pending);
      void pending.then(() => this.work.delete(pending), () => this.work.delete(pending));
    });
    socket.once("close", () => clearTimeout(timer));
  }
  private async capture(socket: Socket, actionId: string): Promise<void> {
    const { serial: _serial, ...identity } = this.scope;
    const request: PhoneActionRequest = { ...identity, actionId, kind: "read_screen" };
    try {
      const result = await this.fence.execute(request);
      if (!this.currentScope()) throw new ReadScreenBridgeError();
      if (socket.destroyed) return; // Never cache pixels or reissue a lost read.
      const header = JSON.stringify({ version: readScreenBridgeVersion, requestId: actionId, scopeDigest: this.scopeDigest,
        status: "captured", bytes: result.png.length, width: result.width, height: result.height, sha256: result.sha256 });
      socket.end(Buffer.concat([Buffer.from(header + "\n"), result.png]));
    } catch {
      if (!socket.destroyed) socket.end(JSON.stringify({ version: readScreenBridgeVersion, requestId: actionId,
        scopeDigest: this.scopeDigest, status: "unavailable", bytes: 0 }) + "\n");
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    const server = this.server;
    const closed = server ? new Promise<void>(resolve => server.close(() => resolve())) : Promise.resolve();
    // Closing IPC is not device stop. In-flight fence work remains occupied and
    // records its original outcome even when the Python client disappears.
    for (const socket of this.sockets) socket.destroy();
    await Promise.all(this.work); await closed;
    if (this.ownsSocket) {
      try { const f = lstatSync(this.socketPath); if (f.isSocket() && `${f.dev}:${f.ino}` === this.socketIdentity) unlinkSync(this.socketPath); }
      catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "ENOENT") throw new ReadScreenBridgeError(); }
    }
    this.ownsSocket = false;
  }
}
