import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createSecureContext } from "node:tls";
import { X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PinnedServeListener } from "../product/backend/src/tailscale-serve-listener.js";
import { TailscaleCliWhoIs, readTailnetNode, tailnetAddress } from "../product/backend/src/tailscale-source-verifier.js";

/** Temporary transport preflight for the independent verifier. Not a completed
 * enrollment API. No installation token, pairing, DB, policy writes or business
 * forwarding. Missing restriction/revision producers always block upgrades.
 */
async function privateFile(path: string) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    assert.ok(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0 && stat.size < 16384);
    return await fd.readFile();
  } finally { await fd.close(); }
}
let stage = "configuration";
async function main() {
  assert.equal(process.env.SG_PRODUCT_VERIFIER_PREFLIGHT, "authorized");
  const minutes = Number(process.env.SG_PRODUCT_VERIFIER_PREFLIGHT_MINUTES ?? "15");
  assert.ok(Number.isInteger(minutes) && minutes >= 1 && minutes <= 60);
  const cli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale", run = promisify(execFile);
  const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/tailnet-proposal-20261003");
  await mkdir(output, { mode: 0o700, recursive: true });
  stage = "existing_serve_scope";
  const current = JSON.parse((await run(cli, ["serve", "status", "--json"], { timeout: 3000 })).stdout);
  assert.deepEqual(current, {}); // Preserve every other Serve owner.
  const prefs = JSON.parse((await run(cli, ["debug", "prefs"], { timeout: 3000 })).stdout) as Record<string, unknown>;
  assert.equal(prefs.WantRunning, true); assert.equal(prefs.ShieldsUp, false);
  const status = JSON.parse((await run(cli, ["status", "--json"], { timeout: 3000 })).stdout) as { BackendState: string; TailscaleIPs: string[]; Self: { DNSName: string } };
  assert.equal(status.BackendState, "Running");
  assert.ok(status.TailscaleIPs.length && status.TailscaleIPs.every(v => tailnetAddress(v) === v));
  stage = "diagnostic_tls";
  const key = await privateFile(resolve(".runtime/product-local-live/diagnostic-tls-key.pem"));
  const cert = await privateFile(resolve(".runtime/product-local-live/diagnostic-tls-cert.pem"));
  const certificate = new X509Certificate(cert), hostname = status.Self.DNSName.replace(/\.$/, "");
  assert.equal(certificate.checkHost(hostname), hostname);
  assert.ok(Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now());
  const context = createSecureContext({ key, cert, minVersion: "TLSv1.2" });
  const whois = new TailscaleCliWhoIs(cli);
  const expectedPhoneAddress = tailnetAddress(process.env.SG_PRODUCT_TAILNET_SOURCE_IP ?? "100.118.89.89");
  assert.ok(expectedPhoneAddress && !status.TailscaleIPs.includes(expectedPhoneAddress));
  const expectedPhone = readTailnetNode(await whois.lookup(expectedPhoneAddress, AbortSignal.timeout(2000)), expectedPhoneAddress);
  assert.ok(expectedPhone);
  let active = 0, stopping = false, accepted = 0;
  let listener: PinnedServeListener;
  const http = createServer((req, res) => {
    active++;
    void (async () => {
      const transport = listener.transportFor(req.socket), peer = transport ? listener.peerOf(transport) : null;
      assert.ok(peer && active <= 4 && !stopping);
      // Re-read identity from LocalAPI; no claimed header or IP in body.
      const started = Date.now();
      const raw = await whois.lookup(peer, AbortSignal.timeout(2000));
      const observed = readTailnetNode(raw, peer);
      const sourceIdentityVerified = !!observed && Date.now() - started < 3000
        && listener.peerOf(transport!) === peer;
      const expectedPhoneSourceVerified = sourceIdentityVerified && peer === expectedPhoneAddress
        && observed!.nodeId === expectedPhone.nodeId && observed!.nodeKey === expectedPhone.nodeKey;
      const health = req.method === "GET" && req.url === "/health";
      const code = health ? "INDEPENDENT_VERIFIER_TRANSPORT_PREFLIGHT" : "NETWORK_REVISION_UNAVAILABLE";
      res.writeHead(health ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
      res.end(JSON.stringify({ code, trustedIncomingTransport: true, sourceIdentityVerified, expectedPhoneSourceVerified,
        restrictionVerified: false, networkRevisionAvailable: false, enrollmentApiReady: false,
        networkAdmissionGranted: false, actionPermissionGranted: false }));
      accepted++;
      console.log(JSON.stringify({ event: "verifier_preflight_request", accepted, sourceIdentityVerified, expectedPhoneSourceVerified, enrollmentApiReady: false }));
    })().catch(() => { res.writeHead(503, { "Content-Type": "application/json", Connection: "close" });
      res.end('{"code":"VERIFIER_SOURCE_UNAVAILABLE","networkAdmissionGranted":false,"actionPermissionGranted":false}');
    }).finally(() => { active--; });
  });
  http.requestTimeout = 5000; http.headersTimeout = 5000;
  stage = "pinned_listener";
  listener = await PinnedServeListener.create(4443, status.TailscaleIPs, context, socket => http.emit("connection", socket));
  await new Promise<void>((yes, no) => { listener.server.once("error", no); listener.server.listen(4443, "127.0.0.1", yes); });
  let child: ReturnType<typeof spawn> | null = null;
  const stop = () => { if (stopping) return; stopping = true; child?.kill("SIGINT"); listener.close(); http.closeAllConnections(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const timer = setTimeout(stop, minutes * 60_000);
  try {
    stage = "owned_foreground_serve";
    child = spawn(cli, ["serve", "--tcp=9443", "--proxy-protocol=1", "tcp://127.0.0.1:4443"], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout?.on("data", () => undefined); child.stderr?.on("data", () => undefined);
    const closed = new Promise<void>((yes, no) => { child!.once("error", no); child!.once("close", code => stopping || code === 0 ? yes() : no(new Error())); });
    const result = { startedAt: new Date().toISOString(), maxLifetimeMinutes: minutes, incomingPreferenceChanged: false,
      endpoint: `https://${hostname}:9443/health`, loopbackTargetPort: 4443, transport: "pinned_serve_proxy_v1_then_tls",
      certificateExpiresAt: new Date(certificate.validTo).toISOString(), tlsScope: "existing_debug_ca_not_production_tls",
      policyMutationPerformed: false, enrollmentApiReady: false, networkAdmissionGranted: false, actionPermissionGranted: false };
    await writeFile(resolve(output, "verifier-preflight-start.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ event: "independent_verifier_preflight_started", ...result }));
    await closed;
  } finally {
    clearTimeout(timer); stop();
    await writeFile(resolve(output, "verifier-preflight-stop.json"), JSON.stringify({ stoppedAt: new Date().toISOString(), accepted,
      noParticipationWithdrawal: true, policyMutationPerformed: false, networkAdmissionGranted: false, actionPermissionGranted: false }), { mode: 0o600 });
  }
}
await main().catch(() => { console.error(JSON.stringify({ event: "independent_verifier_preflight_unavailable", stage })); process.exitCode = 2; });
