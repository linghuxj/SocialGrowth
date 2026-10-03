import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isIP, Server, Socket } from "node:net";
import { Server as TlsServer } from "node:tls";
import { promisify } from "node:util";
import type { EndpointAuthority } from "./endpoint-report-core.js";
import type { EndpointReportSourceVerifier } from "./endpoint-report-journal.js";

const run = promisify(execFile);
const maximumAgeMs = 3000;

/** Only direct Tailnet addresses; never LAN, subnet routes or claimed headers. */
export function tailnetAddress(value: string): string | null {
  const address = value.startsWith("::ffff:") ? value.slice(7) : value;
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127 ? address : null;
  }
  if (isIP(address) !== 6 || address.includes("%")) return null;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  return normalized.startsWith("fd7a:115c:a1e0:") ? normalized : null;
}

interface Connection {
  socket: Socket; peer: string; remotePort: number;
  local: string; localPort: number;
}

export interface TrustedTailnetConnections {
  transportFor(socket: Socket): object | null;
  peerOf(handle: object): string | null;
}

/** Handles come exclusively from this listener's accepted sockets. A body,
 * header, socket-shaped object, or another listener cannot become a transport.
 * A Serve/proxy listener is intentionally unsupported until separately trusted.
 */
export class DirectTailnetConnections implements TrustedTailnetConnections {
  private readonly sockets = new WeakMap<Socket, object>();
  private readonly connections = new WeakMap<object, Connection>();
  private open = true;
  constructor(server: Server, localAddresses: readonly string[]) {
    const allowed = new Set(localAddresses.map(tailnetAddress));
    if (!allowed.size || allowed.has(null)) throw new Error("TAILNET_LISTENER_CONFIGURATION_INVALID");
    const event = server instanceof TlsServer ? "secureConnection" : "connection";
    const accepted = (socket: Socket) => {
      const peer = tailnetAddress(socket.remoteAddress ?? "");
      const local = tailnetAddress(socket.localAddress ?? "");
      if (!this.open || !peer || !local || !allowed.has(local) || !socket.remotePort || !socket.localPort) return;
      const handle = Object.freeze({});
      this.sockets.set(socket, handle);
      this.connections.set(handle, { socket, peer, local, remotePort: socket.remotePort, localPort: socket.localPort });
      socket.once("close", () => { this.connections.delete(handle); this.sockets.delete(socket); });
    };
    server.prependListener(event, accepted);
    server.once("close", () => { this.open = false; server.removeListener(event, accepted); });
  }
  transportFor(socket: Socket): object | null { return this.sockets.get(socket) ?? null; }
  peerOf(handle: object): string | null {
    const c = this.connections.get(handle);
    if (!this.open || !c || c.socket.destroyed || c.socket.remotePort !== c.remotePort || c.socket.localPort !== c.localPort
      || tailnetAddress(c.socket.remoteAddress ?? "") !== c.peer || tailnetAddress(c.socket.localAddress ?? "") !== c.local) return null;
    return c.peer;
  }
}

export interface TailnetWhoIsPort { lookup(address: string, signal: AbortSignal): Promise<unknown> }
/** Server-owned current policy/binding revision, never request input. The real
 * policy adapter must supply it; null does not borrow an enrollment's revision.
 */
export interface TailnetRevisionPort {
  read(signal: AbortSignal): Promise<{ revision: number; observedAt: string } | null>;
}

/** Explicit official CLI -> authenticated platform LocalAPI. Read-only, no
 * shell, fallback daemon, network URL, login, policy writes or raw error text.
 */
export class TailscaleCliWhoIs implements TailnetWhoIsPort {
  constructor(private readonly executable: string) {
    if (!isAbsolute(executable)) throw new Error("TAILNET_LOCAL_API_CONFIGURATION_INVALID");
  }
  async lookup(address: string, signal: AbortSignal): Promise<unknown> {
    try {
      const normalized = tailnetAddress(address);
      if (!normalized || signal.aborted) throw new Error();
      const stat = await lstat(this.executable);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0
        || (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new Error();
      const result = await run(this.executable, ["whois", "--json", normalized], {
        timeout: 2000, maxBuffer: 65536, signal, encoding: "utf8", shell: false,
      });
      if (signal.aborted) throw new Error();
      return JSON.parse(result.stdout) as unknown;
    } catch { throw new Error("TAILNET_LOCAL_API_UNAVAILABLE"); }
  }
}

export interface TailnetObservedNode { nodeId: string; nodeKey: string }
/** StableID avoids precision loss in numeric control-plane NodeID values. */
export function readTailnetNode(raw: unknown, peer: string, now = Date.now()): TailnetObservedNode | null {
  const n = raw && typeof raw === "object" && "Node" in raw ? raw.Node : null;
  if (!n || typeof n !== "object" || !("Online" in n) || n.Online !== true) return null;
  return readTailnetNodeIdentity(raw, peer, now);
}

/** Identity inventory only. LocalAPI omits Online for Self. This helper cannot
 * establish a live incoming source; admission uses readTailnetNode above.
 */
export function readTailnetNodeIdentity(raw: unknown, peer: string, now = Date.now()): TailnetObservedNode | null {
  if (!raw || typeof raw !== "object" || !("Node" in raw) || !raw.Node || typeof raw.Node !== "object") return null;
  const n = raw.Node as Record<string, unknown>;
  if (typeof n.StableID !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(n.StableID)
    || typeof n.Key !== "string" || !/^nodekey:[a-f0-9]{64}$/.test(n.Key)
    || n.Expired === true || !Array.isArray(n.Addresses) || n.Addresses.length > 256) return null;
  const normalized = tailnetAddress(peer);
  // Tailscale's zero Go time means no key expiry. Unknown expiry is not success.
  if (typeof n.KeyExpiry !== "string" || (n.KeyExpiry !== "0001-01-01T00:00:00Z"
    && (!Number.isFinite(Date.parse(n.KeyExpiry)) || Date.parse(n.KeyExpiry) <= now))) return null;
  const addresses = n.Addresses.flatMap(value => {
    if (typeof value !== "string") return [];
    const split = value.split("/");
    const ip = tailnetAddress(split[0]!);
    // Only this node's individual host addresses; not its advertised subnets.
    return ip && split.length === 2 && split[1] === (isIP(ip) === 4 ? "32" : "128") ? [ip] : [];
  });
  return normalized && addresses.includes(normalized) ? { nodeId: n.StableID, nodeKey: n.Key } : null;
}

function fresh(value: string, now: number): boolean {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now && now - at < maximumAgeMs;
}

/** Internal adapter for the existing signed endpoint journal. Registration,
 * actual WhoIs and a current server policy revision are all required; no node
 * proof, network admission, ADB authorization or action permission is created.
 */
export class TailscaleEndpointSourceVerifier implements EndpointReportSourceVerifier {
  constructor(private readonly transports: TrustedTailnetConnections,
    private readonly whois: TailnetWhoIsPort, private readonly revisions: TailnetRevisionPort | null = null) {}
  async observe(transport: object, expected: EndpointAuthority["scope"], signal: AbortSignal) {
    const peer = this.transports.peerOf(transport);
    if (!peer || !this.revisions || signal.aborted) return null;
    const startedAt = new Date().toISOString();
    const abort = new AbortController();
    const bounded = AbortSignal.any([signal, abort.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const [raw, revision] = await Promise.race([
        Promise.all([this.whois.lookup(peer, bounded), this.revisions.read(bounded)]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error()); }, 2000); }),
        new Promise<never>((_, reject) => { onAbort = () => reject(new Error()); bounded.addEventListener("abort", onAbort, { once: true });
          if (bounded.aborted) onAbort(); }),
      ]);
      const now = Date.now(), node = readTailnetNode(raw, peer, now);
      if (bounded.aborted || !node || !revision || !Number.isSafeInteger(revision.revision) || revision.revision < 1
        || !fresh(startedAt, now) || !fresh(revision.observedAt, now) || this.transports.peerOf(transport) !== peer
        || expected.node.nodeId !== node.nodeId || expected.node.nodeKey !== node.nodeKey
        || expected.node.networkRevision !== revision.revision) return null;
      return { scope: { ...structuredClone(expected), node: { ...node, networkRevision: revision.revision } }, observedAt: startedAt };
    } catch { return null; }
    finally { clearTimeout(timer); if (onAbort) bounded.removeEventListener("abort", onAbort); abort.abort(); }
  }
}
