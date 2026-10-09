import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { PilotDeviceNetworkScope } from "./device-connection-network.js";

export type BootstrapScope = PilotDeviceNetworkScope & { associationId: string };
export type BootstrapNetwork = BootstrapScope & { mode: "bootstrap"; sessionId: string; observedAt: string };
type Purpose = "pairing" | "connect";
const frame = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("data"), id: z.string().uuid(), data: z.string().max(44_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }),
  z.strictObject({ type: z.literal("ack"), id: z.string().uuid() }),
  z.strictObject({ type: z.literal("close"), id: z.string().uuid() }),
]);
interface Stream { socket: Socket; port: number; purpose: Purpose; waiting: boolean; receiving: boolean; timer: NodeJS.Timeout; pump: () => void }
interface Session {
  id: string; scope: BootstrapScope; ws: WebSocket; token: string; checkedAt: number; bornAt: number;
  checking: boolean; pong: boolean; servers: Map<Purpose, Server>; ports: Map<Purpose, number>;
  endpoints: { pairing: number | null; connect: number | null; at: number }; streams: Map<string, Stream>;
}
const same = (a: BootstrapScope, b: BootstrapScope) => JSON.stringify(a) === JSON.stringify(b);
const send = (ws: WebSocket, message: unknown) => {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 512_000) throw new Error("BOOTSTRAP_BACKPRESSURE");
  ws.send(JSON.stringify(message));
};

/** Ephemeral, installation-authenticated ADB relay. Local listeners are NEVER
 * published. Frames contain only stream IDs; callers cannot select addresses.
 * Each direction permits one 32 KiB chunk until acknowledged by the sink. */
export class BootstrapRelay {
  private pendingUpgrades = 0;
  private sessions = new Map<string, Session>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 48_000, perMessageDeflate: false });
  private timer?: NodeJS.Timeout;
  private authenticate?: (token: string) => Promise<BootstrapScope>;
  constructor(readonly enabled: boolean) {}
  attach(server: HttpServer, authenticate: (token: string) => Promise<BootstrapScope>): void {
    this.authenticate = authenticate;
    server.on("upgrade", (req, socket, head) => {
      socket.on("error", () => socket.destroy());
      if (!this.enabled || req.url !== "/api/installation/bootstrap" || req.headers.origin || this.sessions.size + this.pendingUpgrades >= 100) { socket.destroy(); return; }
      const match = /^Installation ([^\s]{16,2048})$/.exec(req.headers.authorization ?? "");
      if (!match) { socket.destroy(); return; }
      this.pendingUpgrades++;
      const deadline = setTimeout(() => socket.destroy(), 5000).unref();
      void authenticate(match[1]!).then(scope => {
        if (socket.destroyed) return;
        clearTimeout(deadline);
        this.wss.handleUpgrade(req, socket, head, ws => { void this.accept(ws, scope, match[1]!).catch(() => ws.terminate()); });
      }).catch(() => socket.destroy()).finally(() => { this.pendingUpgrades--; clearTimeout(deadline); });
    });
    this.timer = setInterval(() => { for (const s of this.sessions.values()) void this.check(s); }, 5000).unref();
  }
  private async accept(ws: WebSocket, scope: BootstrapScope, token: string): Promise<void> {
    const old = this.sessions.get(scope.deviceId);
    if (old) this.drop(old);
    const s: Session = { id: randomUUID(), scope, ws, token, checkedAt: Date.now(), bornAt: Date.now(), checking: false, pong: true,
      servers: new Map(), ports: new Map(), endpoints: { pairing: null, connect: null, at: 0 }, streams: new Map() };
    this.sessions.set(scope.deviceId, s);
    ws.on("error", () => this.drop(s, "SOCKET_ERROR")); ws.on("close", () => this.drop(s, "TRANSPORT_CLOSED")); ws.on("pong", () => { s.pong = true; });
    ws.on("message", (raw, binary) => {
      try {
        if (binary || this.sessions.get(scope.deviceId) !== s) throw new Error("FRAME_INVALID");
        const msg = frame.parse(JSON.parse(raw.toString()));
        const stream = s.streams.get(msg.id);
        // A close/ACK may race a local disconnect. It cannot open a stream.
        if (!stream) return;
        if (msg.type === "close") { this.closeStream(s, msg.id); return; }
        if (msg.type === "ack") {
          if (!stream.waiting) throw new Error("UNEXPECTED_ACK");
          stream.waiting = false; stream.pump(); return;
        }
        const bytes = Buffer.from(msg.data, "base64");
        if (bytes.length === 0 || bytes.length > 32768 || stream.receiving || bytes.toString("base64") !== msg.data) throw new Error("FRAME_INVALID");
        stream.receiving = true;
        stream.socket.write(bytes, () => {
          stream.receiving = false;
          try { send(ws, { type: "ack", id: msg.id }); } catch { this.drop(s); }
        });
      } catch (error) { this.drop(s, error instanceof Error && error.message === "UNEXPECTED_ACK" ? "UNEXPECTED_ACK" : "FRAME_REJECTED"); }
    });
    try {
      for (const purpose of ["pairing", "connect"] as const) {
        const listener = createServer(socket => this.open(s, purpose, socket));
        s.servers.set(purpose, listener);
        listener.on("error", () => this.drop(s));
        await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
        const address = listener.address();
        if (!address || typeof address === "string" || this.sessions.get(scope.deviceId) !== s) throw new Error("LISTENER_UNAVAILABLE");
        s.ports.set(purpose, address.port);
      }
      send(ws, { type: "ready", sessionId: s.id });
    } catch { this.drop(s); }
  }
  private open(s: Session, purpose: Purpose, socket: Socket): void {
    socket.on("error", () => socket.destroy());
    const port = s.endpoints[purpose];
    if (this.sessions.get(s.scope.deviceId) !== s || !port || Date.now() - s.endpoints.at > 15_000
      || Date.now() - s.checkedAt > 12_000 || s.streams.size >= 8 || socket.remoteAddress !== "127.0.0.1") { socket.destroy(); return; }
    const id = randomUUID();
    const stream: Stream = { socket, purpose, port, waiting: false, receiving: false,
      pump: () => {}, timer: setTimeout(() => this.closeStream(s, id), 60 * 60_000).unref() };
    s.streams.set(id, stream);
    socket.setTimeout(60_000, () => this.closeStream(s, id));
    stream.pump = () => {
      if (stream.waiting) return;
      const bytes = socket.read(Math.min(socket.readableLength, 32768)) as Buffer | null;
      if (!bytes?.length) return;
      stream.waiting = true;
      try { send(s.ws, { type: "data", id, data: bytes.toString("base64") }); } catch { this.drop(s); }
    };
    socket.on("readable", stream.pump);
    socket.once("close", () => { this.closeStream(s, id); });
    socket.once("end", () => this.closeStream(s, id));
    try { send(s.ws, { type: "open", id, purpose, port }); } catch { this.drop(s); }
  }
  private closeStream(s: Session, id: string): void {
    const stream = s.streams.get(id); if (!stream) return;
    s.streams.delete(id); clearTimeout(stream.timer); stream.socket.destroy();
    try { send(s.ws, { type: "close", id }); } catch { /* Session cleanup follows. */ }
  }
  private async check(s: Session): Promise<void> {
    if (s.checking) { if (Date.now() - s.checkedAt > 12_000) this.drop(s, "AUTHORITY_CHECK_TIMEOUT"); return; }
    if (!s.pong || Date.now() - s.bornAt > 60 * 60_000 || Date.now() - s.checkedAt > 12_000) { this.drop(s, !s.pong ? "HEARTBEAT_LOST" : "SESSION_EXPIRED"); return; }
    s.pong = false; s.ws.ping(); s.checking = true;
    try {
      const current = await this.authenticate!(s.token);
      if (!same(current, s.scope)) this.drop(s, "AUTHORITY_CHANGED"); else s.checkedAt = Date.now();
      if (s.endpoints.at && Date.now() - s.endpoints.at > 15_000) for (const id of s.streams.keys()) this.closeStream(s, id);
    } catch { this.drop(s, "AUTHORITY_UNAVAILABLE"); } finally { s.checking = false; }
  }
  current(scope: PilotDeviceNetworkScope): BootstrapNetwork | null {
    const s = this.sessions.get(scope.deviceId);
    if (!s || !s.ports.has("connect") || Date.now() - s.checkedAt > 12_000
      || Object.entries(scope).some(([key, value]) => key in s.scope && s.scope[key as keyof BootstrapScope] !== value)) return null;
    return { ...s.scope, mode: "bootstrap", sessionId: s.id, observedAt: new Date().toISOString() };
  }
  report(network: BootstrapNetwork, pairing: number | null, connect: number | null): void {
    const s = this.require(network);
    for (const [id, stream] of s.streams) if (stream.port !== (stream.purpose === "pairing" ? pairing : connect)) this.closeStream(s, id);
    s.endpoints = { pairing, connect, at: Date.now() };
  }
  target(network: BootstrapNetwork, purpose: Purpose, expectedPort: number): { address: string; port: number } {
    const s = this.require(network), port = s.ports.get(purpose);
    if (!port || s.endpoints[purpose] !== expectedPort || Date.now() - s.endpoints.at > 15_000) throw new Error("BOOTSTRAP_ENDPOINT_STALE");
    return { address: "127.0.0.1", port };
  }
  private require(network: BootstrapNetwork): Session {
    const s = this.sessions.get(network.deviceId);
    if (!s || s.id !== network.sessionId || !this.current(network)) throw new Error("BOOTSTRAP_SESSION_STALE");
    return s;
  }
  handoff(network: BootstrapNetwork): void {
    const s = this.require(network);
    send(s.ws, { type: "managed" });
    // Graceful close delivers the terminal control frame before cleanup.
    s.ws.close(1000, "managed");
    for (const id of s.streams.keys()) this.closeStream(s, id);
    for (const listener of s.servers.values()) listener.close();
    this.sessions.delete(s.scope.deviceId);
    setTimeout(() => this.drop(s), 1000).unref();
  }
  end(network: BootstrapNetwork): void { this.drop(this.require(network)); }
  private drop(s: Session, reason = "SESSION_CLOSED"): void {
    if (this.sessions.get(s.scope.deviceId) === s) {
      // Bounded diagnostic codes only; never log tokens, frames or wire bytes.
      console.info(JSON.stringify({ component: "bootstrap-relay", deviceId: s.scope.deviceId, sessionId: s.id, reason, streams: s.streams.size }));
      this.sessions.delete(s.scope.deviceId);
    }
    for (const id of s.streams.keys()) this.closeStream(s, id);
    for (const listener of s.servers.values()) listener.close();
    s.token = ""; s.ws.terminate();
  }
  onModuleDestroy(): void { clearInterval(this.timer); for (const s of this.sessions.values()) this.drop(s); this.wss.close(); }
}
