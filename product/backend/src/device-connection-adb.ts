import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isIP, createServer, type Server, type Socket } from "node:net";

export interface AdbTarget {
  address: string;
  pairingPort: number;
  connectPort: number;
}

export type AdbPairResult = "paired" | "unknown";
export type AdbConnectResult = { state: "connected"; hardwareSerial: string } | { state: "unknown" };

const outputLimit = 8192;
const portValid = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 65535;

export function adbEndpoint(address: string, port: number): string {
  if (!portValid(port) || isIP(address) === 0 || address.includes("%")) throw new Error("ADB_TARGET_INVALID");
  return isIP(address) === 6 ? `[${address}]:${port}` : `${address}:${port}`;
}

/** Talks only to the configured center ADB server. Pair codes are read from
 * stdin, never included in argv, environment, returned values, or logs. */
export class DeviceConnectionAdb {
  private readonly bridges = new Map<string, { server: Server; endpoint: string; validUntil: number; sockets: Set<Socket>; children: Set<ChildProcessWithoutNullStreams> }>();
  private readonly bridgeTimer = setInterval(() => {
    for (const [target, bridge] of this.bridges) if (Date.now() >= bridge.validUntil) this.closeBridge(target);
  }, 1000).unref();
  constructor(private readonly executable: string, private readonly adbUserHome: string, private readonly timeoutMs = 8000, private readonly tailscaleCli: string | null = null) {
    if (!isAbsolute(executable) || !isAbsolute(adbUserHome) || (tailscaleCli !== null && !isAbsolute(tailscaleCli)) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
      throw new Error("ADB_CONFIGURATION_INVALID");
    }
  }

  async pair(target: AdbTarget, pairingCode: string): Promise<AdbPairResult> {
    const endpoint = await this.transportEndpoint(target.address, target.pairingPort);
    if (!/^\d{6}$/.test(pairingCode)) return "unknown";
    const pair = await this.run(["pair", endpoint], pairingCode);
    return pair.kind === "ok" && pair.stdout.includes(`Successfully paired to ${endpoint} [guid=`) ? "paired" : "unknown";
  }

  async connectAndVerify(address: string, port: number): Promise<AdbConnectResult> {
    let endpoint: string;
    try { endpoint = await this.transportEndpoint(address, port); } catch { return { state: "unknown" }; }
    const previous = await this.run(["-s", endpoint, "get-state"]);
    if (previous.kind !== "ok" || previous.stdout.trim() !== "device") await this.run(["disconnect", endpoint]);
    const connected = await this.run(["connect", endpoint]);
    if (connected.kind !== "ok") return { state: "unknown" };
    const devices = await this.run(["devices"]);
    if (devices.kind !== "ok" || !devices.stdout.split(/\r?\n/).some(line => {
      const [serial, state] = line.trim().split(/\s+/, 2);
      return serial === endpoint && state === "device";
    })) return { state: "unknown" };
    const state = await this.run(["-s", endpoint, "get-state"]);
    if (state.kind !== "ok" || state.stdout.trim() !== "device") return { state: "unknown" };
    const hardware = await this.run(["-s", endpoint, "shell", "getprop", "ro.serialno"]);
    const serial = hardware.stdout.trim();
    return hardware.kind === "ok" && /^[A-Za-z0-9_-]{4,128}$/.test(serial)
      ? { state: "connected", hardwareSerial: serial } : { state: "unknown" };
  }

  // macOS GUI Tailscale can have no OS route to Tailnet addresses. Explicit
  // daemon transport uses the same authenticated network through `tailscale nc`.
  // Only server-approved address/ports reach here; each stream has a short lease.
  async renewTransport(address: string, port: number): Promise<void> {
    if (this.tailscaleCli) await this.transportEndpoint(address, port);
  }
  close(): void { clearInterval(this.bridgeTimer); for (const target of [...this.bridges.keys()]) this.closeBridge(target); }
  private closeBridge(target: string): void {
    const bridge = this.bridges.get(target);
    if (!bridge) return;
    this.bridges.delete(target);
    for (const socket of bridge.sockets) socket.destroy();
    for (const child of bridge.children) child.kill("SIGTERM");
    bridge.server.close();
  }
  private async transportEndpoint(address: string, port: number): Promise<string> {
    const target = adbEndpoint(address, port);
    if (!this.tailscaleCli) return target;
    const cli = this.tailscaleCli;
    const binary = await lstat(cli);
    if (!binary.isFile() || binary.isSymbolicLink() || (binary.mode & 0o022) !== 0
      || (binary.uid !== 0 && binary.uid !== process.getuid?.())) throw new Error("TAILNET_TRANSPORT_UNAVAILABLE");
    const current = this.bridges.get(target);
    if (current) { current.validUntil = Date.now() + 30_000; return current.endpoint; }
    if (this.bridges.size >= 100) throw new Error("TAILNET_TRANSPORT_LIMIT");
    const sockets = new Set<Socket>(), children = new Set<ChildProcessWithoutNullStreams>();
    const server = createServer(socket => {
      const bridge = this.bridges.get(target);
      if (!bridge || Date.now() >= bridge.validUntil || socket.remoteAddress !== "127.0.0.1" || sockets.size >= 4) { socket.destroy(); return; }
      sockets.add(socket);
      const child = spawn(cli, ["nc", address, String(port)], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
      children.add(child);
      socket.pipe(child.stdin); child.stdout.pipe(socket);
      child.stderr.on("data", () => { /* Never log ADB wire data or pairing secrets. */ });
      child.stdin.on("error", () => socket.destroy());
      child.stdout.on("error", () => socket.destroy());
      child.once("error", () => socket.destroy());
      child.once("close", () => { children.delete(child); socket.destroy(); });
      socket.once("error", () => child.kill("SIGTERM"));
      socket.once("close", () => { sockets.delete(socket); child.kill("SIGTERM"); });
    });
    server.on("error", () => this.closeBridge(target));
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const bound = server.address();
    if (!bound || typeof bound === "string") { server.close(); throw new Error("TAILNET_TRANSPORT_UNAVAILABLE"); }
    const endpoint = `127.0.0.1:${bound.port}`;
    this.bridges.set(target, { server, endpoint, sockets, children, validUntil: Date.now() + 30_000 });
    return endpoint;
  }

  private async run(args: string[], secret?: string): Promise<{ kind: "ok" | "unknown"; stdout: string }> {
    if (!await this.validRuntime()) return { kind: "unknown", stdout: "" };
    return new Promise(resolve => {
      let child: ChildProcessWithoutNullStreams;
      const env = { ANDROID_USER_HOME: this.adbUserHome, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
      try { child = spawn(this.executable, args, { shell: false, windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] }); }
      catch { resolve({ kind: "unknown", stdout: "" }); return; }
      const out: Buffer[] = [];
      let bytes = 0, overLimit = false, settled = false;
      const finish = (value: { kind: "ok" | "unknown"; stdout: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const capture = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > outputLimit) { overLimit = true; child.kill("SIGKILL"); return; }
        out.push(Buffer.from(chunk));
      };
      child.stdin.on("error", () => { child.kill("SIGKILL"); finish({ kind: "unknown", stdout: "" }); });
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.once("error", () => finish({ kind: "unknown", stdout: "" }));
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ kind: "unknown", stdout: "" }); }, this.timeoutMs);
      child.once("close", code => {
        const stdout = Buffer.concat(out).toString("utf8");
        if (secret && stdout.includes(secret)) { finish({ kind: "unknown", stdout: "" }); return; }
        finish(overLimit || code !== 0 ? { kind: "unknown", stdout: "" } : { kind: "ok", stdout });
      });
      if (secret !== undefined) {
        const input = Buffer.from(`${secret}\n`, "utf8");
        child.stdin.once("error", () => input.fill(0));
        child.stdin.end(input, () => input.fill(0));
      } else child.stdin.end();
    });
  }

  private async validRuntime(): Promise<boolean> {
    try {
      const [binary, home, key] = await Promise.all([lstat(this.executable), lstat(this.adbUserHome), lstat(`${this.adbUserHome}/adbkey`)]);
      return binary.isFile() && !binary.isSymbolicLink() && (binary.mode & 0o022) === 0
        && (binary.uid === 0 || binary.uid === process.getuid?.())
        && home.isDirectory() && !home.isSymbolicLink() && (home.mode & 0o022) === 0
        && (home.uid === process.getuid?.() || process.getuid?.() === 0)
        && key.isFile() && !key.isSymbolicLink() && (key.mode & 0o077) === 0 && key.uid === process.getuid?.();
    } catch { return false; }
  }
}
