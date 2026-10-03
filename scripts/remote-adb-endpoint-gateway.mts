import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import { chmod, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticEndpointState, DiagnosticObservationExpired } from "./remote-adb-diagnostic-state.mts";
import { diagnosticProxySource } from "./remote-adb-proxy-header.mts";
import { DiagnosticSourceUnavailable, requireLiveDiagnosticNode } from "./remote-adb-source-observation.mts";

/** Owned foreground Tailnet diagnostic gateway, not the formal admission API.
 * Serve source metadata is trusted only through a private Unix listener, or
 * through a loopback socket verified as owned by the pinned real daemon.
 * WhoIs then authenticates the source node. No client-selected IP or business grant.
 */
let stage = "configuration";
async function main() {
  assert.equal(process.env.SG_DIAGNOSTIC_REMOTE_ADB, "authorized");
  const target = process.env.SG_DIAGNOSTIC_TAILNET_IP;
  const deviceId = process.env.SG_DIAGNOSTIC_PRODUCT_DEVICE_ID;
  assert.match(target ?? "", /^100\.(?:[6-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/);
  assert.match(deviceId ?? "", /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const dir = resolve(".runtime/product-local-live"), socket = resolve(dir, "ep.sock"), file = resolve(dir, "endpoint-report.json");
  const privateDir = await lstat(dir); assert.ok(privateDir.isDirectory() && !privateDir.isSymbolicLink() && (privateDir.mode & 0o077) === 0);
  try { await lstat(socket); throw new Error("Socket already exists; inspect original owner before recovery"); }
  catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "ENOENT") throw e; }
  const configStat = await lstat(resolve(dir, "config.json")); assert.equal(configStat.mode & 0o077, 0);
  const config = JSON.parse(await readFile(resolve(dir, "config.json"), "utf8")) as { databasePassword: string; authPepper: string };
  const cli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale", run = promisify(execFile);
  interface Node { ID: number; Key: string; Addresses: string[]; Online?: boolean }
  async function whois(address: string) {
    const result = await run(cli, ["whois", "--json", address], { timeout: 5000, maxBuffer: 256 * 1024 }).catch(() => null);
    if (!result) throw new DiagnosticSourceUnavailable();
    const { stdout } = result;
    const node = (JSON.parse(stdout) as { Node: Node }).Node;
    assert.ok(node && node.ID && node.Key && node.Addresses.some(a => a.split("/")[0] === target));
    return node;
  }
  stage = "source_node";
  const pinned = await whois(target!);
  requireLiveDiagnosticNode(pinned, pinned);
  const localStatus = JSON.parse((await run(cli, ["status", "--json"], { timeout: 5000 })).stdout) as { TailscaleIPs: string[] };
  assert.ok(Array.isArray(localStatus.TailscaleIPs) && localStatus.TailscaleIPs.length > 0);
  interface SqlPool { query<T>(sql: string, values: unknown[]): Promise<{ rows: T[] }>; end(): Promise<void> }
  const { Pool } = createRequire(resolve("product/backend/package.json"))("pg") as {
    Pool: new (options: { connectionString: string; max: number }) => SqlPool;
  };
  const pool = new Pool({ connectionString: `postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/sg_product_local_live`, max: 2 });
  stage = "auth_module";
  const module = await import(pathToFileURL(resolve("product/backend/dist/installation-auth-service.js")).href) as {
    InstallationAuthService: new (pool: SqlPool, pepper: string) => {
      authenticate(token: string): Promise<{ installationId: string; installationGeneration: bigint }>;
    };
  };
  const auth = new module.InstallationAuthService(pool, config.authPepper);
  stage = "installation_scope";
  const pinnedInstallation = (await pool.query<{ installation_id: string; generation: string }>(
    `SELECT i.installation_id, i.generation::text FROM socialgrowth_product.installations i
     JOIN socialgrowth_product.device_associations a ON a.installation_id=i.installation_id
     WHERE a.device_id=$1 AND a.ended_at IS NULL AND i.status='active'`, [deviceId])).rows;
  assert.equal(pinnedInstallation.length, 1);
  const state = new DiagnosticEndpointState();
  let active = 0, stopping = false;
  let saves = Promise.resolve();
  async function save() {
    const { fresh, ...snapshot } = state.snapshot();
    const data = { ...snapshot, freshAtWrite: fresh, deviceId, sourceNodeId: String(pinned.ID), sourceTailnetIp: target,
      installationId: pinnedInstallation[0]!.installation_id, installationGeneration: pinnedInstallation[0]!.generation,
      evidenceScope: "authenticated_diagnostic_not_formal_admission" };
    saves = saves.then(async () => {
      const temp = file + ".tmp";
      await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file);
    });
    await saves;
  }
  const paths = new Set(["/api/installation/state", "/api/installation/participation/start", "/api/installation/participation/challenge",
    "/api/installation/participation/confirm", "/api/installation/participation/withdraw"]);
  const proxyTls = process.env.SG_DIAGNOSTIC_PROXY_TLS === "authorized";
  const daemonExecutable = "/Applications/Tailscale.app/Contents/PlugIns/IPNExtension.appex/Contents/MacOS/IPNExtension";
  let daemonPid = "", daemonStart = "";
  if (proxyTls) {
    daemonPid = (await run("pgrep", ["-x", "IPNExtension"], { timeout: 3000 })).stdout.trim();
    assert.match(daemonPid, /^\d+$/);
    assert.equal((await run("ps", ["-p", daemonPid, "-o", "comm="], { timeout: 3000 })).stdout.trim(), daemonExecutable);
    daemonStart = (await run("ps", ["-p", daemonPid, "-o", "lstart="], { timeout: 3000 })).stdout.trim();
  }
  const sources = new WeakMap<object, string>();
  const server = createServer((req, res) => {
    active++;
    let requestStage = "transport";
    void (async () => {
      assert.ok(!stopping && active <= 4 && req.method === "POST");
      // This header has provenance only through the owned Serve Unix listener.
      // Serve sets it from c.SrcAddr, replacing a caller-supplied value.
      const source = proxyTls ? sources.get(req.socket) : req.headers["x-forwarded-for"];
      assert.ok(typeof source === "string" && pinned.Addresses.some(a => a.split("/")[0] === source));
      requestStage = "node_identity";
      const observed = await whois(String(source));
      requireLiveDiagnosticNode(observed, pinned);
      const authorization = req.headers.authorization;
      requestStage = "installation_auth";
      assert.ok(typeof authorization === "string" && /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization));
      const installation = await auth.authenticate(authorization.slice(7));
      assert.equal(installation.installationId, pinnedInstallation[0]!.installation_id);
      assert.equal(String(installation.installationGeneration), pinnedInstallation[0]!.generation);
      const rows = await pool.query<{ device_id: string; generation: string }>(
        `SELECT a.device_id, i.generation::text FROM socialgrowth_product.device_associations a
         JOIN socialgrowth_product.installations i ON i.installation_id=a.installation_id
         JOIN socialgrowth_product.devices d ON d.device_id=a.device_id
         JOIN socialgrowth_product.providers p ON p.provider_id=a.provider_id
         WHERE a.installation_id=$1 AND a.ended_at IS NULL AND d.device_id=$2
           AND d.state IN ('associated_pending_access','access_ready') AND p.status='active'`, [installation.installationId, deviceId]);
      assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0]!.generation, String(installation.installationGeneration));
      requestStage = "payload";
      let body = "";
      for await (const bytes of req) { body += String(bytes); assert.ok(Buffer.byteLength(body) <= 8192); }
      const parsed: unknown = JSON.parse(body);
      if (req.url === "/diagnostics/endpoint/epoch") {
        assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
        const v = parsed as Record<string, unknown>; assert.deepEqual(Object.keys(v), ["requestId"]);
        const epoch = state.begin(String(v.requestId)); await save();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ epoch }));
      } else if (req.url === "/diagnostics/endpoint/report") {
        const receipt = state.accept(parsed); await save();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(receipt));
      } else {
        assert.ok(paths.has(req.url ?? ""));
        const response = await fetch(`http://127.0.0.1:4320${req.url}`, {
          method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body,
          signal: AbortSignal.timeout(10000), redirect: "error",
        });
        const responseBody = await response.text(); assert.ok(responseBody.length <= 65536);
        res.writeHead(response.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(responseBody);
      }
    })().catch((error: unknown) => {
      const expired = error instanceof DiagnosticObservationExpired && requestStage === "payload" && req.url === "/diagnostics/endpoint/report";
      const unavailable = error instanceof DiagnosticSourceUnavailable && requestStage === "node_identity";
      const code = expired ? "DIAGNOSTIC_OBSERVATION_EXPIRED" : unavailable ? "DIAGNOSTIC_SOURCE_UNAVAILABLE" : "DIAGNOSTIC_SCOPE_REJECTED";
      if (!res.headersSent) res.writeHead(expired ? 409 : unavailable ? 503 : 403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: { code } }));
      // No request/headers/body/token, SQL, source address or platform error text.
      console.error(JSON.stringify({ event: "endpoint_diagnostic_request_rejected", stage: requestStage, code }));
    }).finally(() => { active--; });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const listener = proxyTls ? createTcpServer(raw => {
    // Only a stream owned by the pinned Serve daemon can supply this PROXY line.
    // HTTP headers and any IP in JSON have no source authority here.
    let prefix = Buffer.alloc(0);
    let handshakeStage = "proxy_prefix";
    raw.setTimeout(10000, () => raw.destroy());
    const receive = (bytes: Buffer) => {
      prefix = Buffer.concat([prefix, bytes]);
      const end = prefix.indexOf("\r\n");
      if (end < 0) { if (prefix.length > 108) raw.destroy(); return; }
      raw.pause(); raw.removeListener("data", receive);
      void (async () => {
        // Serve currently disallows PROXY protocol with Unix targets. Restrict
        // its loopback TCP replacement to sockets created by the pinned real
        // daemon process; a local caller cannot manufacture source authority.
        handshakeStage = "daemon_socket_owner";
        const listing = (await run("lsof", ["-nP", "-iTCP:4343", "-sTCP:ESTABLISHED", "-Fpn"], { timeout: 3000 })).stdout;
        let processId = ""; const owners = new Set<string>();
        for (const line of listing.split("\n")) {
          if (line.startsWith("p")) processId = line.slice(1);
          if (line === `n127.0.0.1:${raw.remotePort}->127.0.0.1:4343`) owners.add(processId);
        }
        assert.deepEqual([...owners], [daemonPid]);
        handshakeStage = "daemon_lifetime";
        assert.equal((await run("ps", ["-p", daemonPid, "-o", "lstart="], { timeout: 3000 })).stdout.trim(), daemonStart);
        assert.ok(end <= 106);
        handshakeStage = "proxy_source";
        const source = diagnosticProxySource(prefix.subarray(0, end).toString("ascii"),
          pinned.Addresses.map(a => a.split("/")[0]!), localStatus.TailscaleIPs);
        handshakeStage = "tls";
        if (prefix.length > end + 2) raw.unshift(prefix.subarray(end + 2));
        const tls = new TLSSocket(raw, { isServer: true, secureContext });
        tls.on("error", () => { console.error('{"event":"diagnostic_tls_handshake_rejected"}'); raw.destroy(); });
        tls.once("secure", () => { sources.set(tls, source); server.emit("connection", tls); });
        tls.resume();
      })().catch(() => { console.error(JSON.stringify({ event: "diagnostic_proxy_origin_rejected", stage: handshakeStage })); raw.destroy(); });
    };
    raw.on("data", receive); raw.on("error", () => raw.destroy());
  }) : server;
  let secureContext: ReturnType<typeof createSecureContext>;
  if (proxyTls) {
    const keyPath = resolve(dir, "diagnostic-tls-key.pem"), keyStat = await lstat(keyPath);
    assert.ok(keyStat.isFile() && !keyStat.isSymbolicLink() && (keyStat.mode & 0o077) === 0);
    secureContext = createSecureContext({ key: await readFile(keyPath), cert: await readFile(resolve(dir, "diagnostic-tls-cert.pem")), minVersion: "TLSv1.2" });
  }
  const stop = () => { if (stopping) return; stopping = true; listener.close(); server.closeAllConnections(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const timer = setTimeout(stop, 60 * 60_000);
  try {
    stage = "socket_listener";
    await new Promise<void>((yes, no) => { listener.once("error", no); if (proxyTls) listener.listen(4343, "127.0.0.1", yes); else listener.listen(socket, yes); });
    if (!proxyTls) await chmod(socket, 0o600); await save();
    console.log(JSON.stringify({ event: "endpoint_diagnostic_gateway_ready", transport: proxyTls ? "loopback_tls_with_pinned_daemon_proxy_source" : "private_unix_socket", formalAdmission: false }));
    await new Promise<void>(yes => listener.once("close", yes));
  } finally {
    clearTimeout(timer); stop(); await pool.end();
    // Clear freshness on shutdown; never leave a fresh candidate for a reader.
    state.begin("00000000-0000-0000-0000-000000000001"); await save();
    await unlink(socket).catch(() => undefined);
  }
}
await main().catch((error: unknown) => { console.error(JSON.stringify({ event: "endpoint_diagnostic_gateway_unavailable", stage, code: error instanceof Error && "code" in error ? error.code : "CHECK_REJECTED" })); process.exitCode = 1; });
