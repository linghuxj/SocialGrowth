import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat } from "node:fs/promises";
import { createServer, isIP, type Socket, type Server } from "node:net";
import { TLSSocket, type SecureContext } from "node:tls";
import { tailnetAddress, type TrustedTailnetConnections } from "./tailscale-source-verifier.js";

const run = promisify(execFile);
const daemonExecutable = "/Applications/Tailscale.app/Contents/PlugIns/IPNExtension.appex/Contents/MacOS/IPNExtension";

/** Parse only after authenticating the actual proxy stream owner. */
export function parseServeProxySource(line: Buffer, localAddresses: readonly string[], targetPort: number): string | null {
  if (line.length > 106 || [...line].some(b => b < 32 || b > 126)) return null;
  const parts = line.toString("ascii").split(" "), source = tailnetAddress(parts[2] ?? ""), destination = tailnetAddress(parts[3] ?? "");
  if (parts.length !== 6 || parts[0] !== "PROXY" || !source || !destination
    || parts[1] !== (isIP(source) === 4 ? "TCP4" : "TCP6") || isIP(source) !== isIP(destination)
    || !localAddresses.includes(destination) || !/^[1-9]\d{0,4}$/.test(parts[4] ?? "") || Number(parts[4]) > 65535
    || parts[5] !== String(targetPort)) return null;
  return source;
}

export function soleServeSocketOwner(listing: string, remotePort: number, targetPort: number, pinnedPid: string): boolean {
  let pid = ""; const owners = new Set<string>();
  for (const line of listing.split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    if (line === `n127.0.0.1:${remotePort}->127.0.0.1:${targetPort}`) owners.add(pid);
  }
  return owners.size === 1 && owners.has(pinnedPid);
}

/** Mac Serve TCP+PROXY v1 -> TLS. Sources are minted only from connections whose
 * exact reverse socket tuple belongs to the pinned official daemon lifetime.
 * Local callers and HTTP X-Forwarded-For are rejected, not treated as Tailnet.
 * This class owns no Serve/global policy configuration and no business grants.
 */
export class PinnedServeListener implements TrustedTailnetConnections {
  readonly server: Server;
  private readonly transports = new WeakMap<Socket, object>();
  private readonly connections = new WeakMap<object, { socket: Socket; peer: string }>();
  private readonly live = new Set<Socket>();
  private open = true;
  private constructor(private readonly port: number, private readonly locals: readonly string[],
    private readonly context: SecureContext, private readonly pid: string, private readonly start: string,
    private readonly accept: (socket: TLSSocket) => void) {
    this.server = createServer(raw => this.acceptRaw(raw));
    this.server.once("close", () => { this.open = false; });
  }
  static async create(port: number, localAddresses: readonly string[], context: SecureContext, accept: (socket: TLSSocket) => void) {
    if (process.platform !== "darwin" || !Number.isInteger(port) || port < 1024 || port > 65535
      || !localAddresses.length || localAddresses.some(v => tailnetAddress(v) !== v)) throw new Error("SERVE_LISTENER_CONFIGURATION_INVALID");
    try {
      const stat = await lstat(daemonExecutable);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 || ![0, process.getuid?.()].includes(stat.uid)) throw new Error();
      const pid = (await run("/usr/bin/pgrep", ["-x", "IPNExtension"], { timeout: 2000 })).stdout.trim();
      if (!/^\d+$/.test(pid)) throw new Error();
      const executable = (await run("/bin/ps", ["-p", pid, "-o", "comm="], { timeout: 2000 })).stdout.trim();
      if (executable !== daemonExecutable) throw new Error();
      const start = (await run("/bin/ps", ["-p", pid, "-o", "lstart="], { timeout: 2000 })).stdout.trim();
      if (!start) throw new Error();
      return new PinnedServeListener(port, [...localAddresses], context, pid, start, accept);
    } catch { throw new Error("SERVE_DAEMON_UNAVAILABLE"); }
  }
  transportFor(socket: Socket): object | null { return this.open && !socket.destroyed ? this.transports.get(socket) ?? null : null; }
  peerOf(handle: object): string | null {
    const value = this.connections.get(handle);
    return this.open && value && !value.socket.destroyed ? value.peer : null;
  }
  close() { this.open = false; for (const socket of this.live) socket.destroy(); this.server.close(); }
  private acceptRaw(raw: Socket) {
    if (!this.open || this.live.size >= 16 || raw.remoteAddress !== "127.0.0.1" || raw.localAddress !== "127.0.0.1"
      || raw.localPort !== this.port || !raw.remotePort) { raw.destroy(); return; }
    this.live.add(raw); raw.once("close", () => this.live.delete(raw)); raw.on("error", () => raw.destroy());
    raw.setTimeout(5000, () => raw.destroy());
    let prefix = Buffer.alloc(0);
    const receive = (bytes: Buffer) => {
      prefix = Buffer.concat([prefix, bytes]);
      if (prefix.length > 65536) { raw.destroy(); return; }
      const end = prefix.indexOf("\r\n");
      if (end < 0) { if (prefix.length > 106) raw.destroy(); return; }
      raw.pause(); raw.removeListener("data", receive);
      const peer = parseServeProxySource(prefix.subarray(0, end), this.locals, this.port);
      if (!peer) { raw.destroy(); return; }
      void this.verifyOwner(raw).then(valid => {
        if (!valid || !this.open || raw.destroyed) { raw.destroy(); return; }
        if (prefix.length > end + 2) raw.unshift(prefix.subarray(end + 2));
        const tls = new TLSSocket(raw, { isServer: true, secureContext: this.context });
        tls.on("error", () => raw.destroy());
        tls.once("secure", () => {
          if (!this.open || raw.destroyed || tls.destroyed) { tls.destroy(); return; }
          const handle = Object.freeze({});
          this.transports.set(tls, handle); this.connections.set(handle, { socket: tls, peer });
          tls.once("close", () => { this.transports.delete(tls); this.connections.delete(handle); });
          try { this.accept(tls); } catch { tls.destroy(); }
        });
        tls.resume();
      }).catch(() => raw.destroy());
    };
    raw.on("data", receive);
  }
  private async verifyOwner(raw: Socket) {
    try {
      const listing = (await run("/usr/sbin/lsof", ["-nP", `-iTCP:${this.port}`, "-sTCP:ESTABLISHED", "-Fpn"], { timeout: 2000, maxBuffer: 65536 })).stdout;
      if (!raw.remotePort || !soleServeSocketOwner(listing, raw.remotePort, this.port, this.pid)) return false;
      const start = (await run("/bin/ps", ["-p", this.pid, "-o", "lstart="], { timeout: 2000 })).stdout.trim();
      const executable = (await run("/bin/ps", ["-p", this.pid, "-o", "comm="], { timeout: 2000 })).stdout.trim();
      return start === this.start && executable === daemonExecutable;
    } catch { return false; }
  }
}
