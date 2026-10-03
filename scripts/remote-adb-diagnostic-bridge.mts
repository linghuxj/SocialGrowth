import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, isIP, type Socket } from "node:net";
import { diagnosticConnectPort } from "./remote-adb-report-source.mts";

async function main(): Promise<void> {
  // Temporary diagnostic transport for a Mac with no OS Tailnet route. Uses the
  // actual authenticated Tailscale daemon; never LAN/USB fallback or adb tcpip.
  // This does not register network admission, grant control or confirm stop.
  const cli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const run = promisify(execFile);
  const target = process.env.SG_DIAGNOSTIC_TAILNET_IP;
  const port = Number(process.env.SG_DIAGNOSTIC_ADB_PORT);
  const reported = process.env.SG_DIAGNOSTIC_AUTOMATIC_ENDPOINT === "authorized";
  const productDevice = process.env.SG_DIAGNOSTIC_PRODUCT_DEVICE_ID;
  const localPort = Number(process.env.SG_DIAGNOSTIC_BRIDGE_PORT);
  const maximumMinutes = Number(process.env.SG_DIAGNOSTIC_BRIDGE_MINUTES ?? "30");
  assert.ok(Number.isInteger(maximumMinutes) && maximumMinutes >= 5 && maximumMinutes <= 60);
  assert.equal(process.env.SG_DIAGNOSTIC_REMOTE_ADB, "authorized");
  assert.ok(target && isIP(target) === 4 && /^100\.(?:[6-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(target));
  assert.ok(reported ? !!productDevice && /^[a-f0-9-]{36}$/.test(productDevice) : Number.isInteger(port) && port >= 1024 && port <= 65535);
  assert.ok(Number.isInteger(localPort) && localPort >= 1024 && localPort <= 65535);
  interface Peer { ID: string | number; Key: string; Addresses: string[]; Online?: boolean }
  async function peer(): Promise<Peer> {
    const { stdout } = await run(cli, ["debug", "netmap"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    const map = JSON.parse(stdout) as { Peers: Peer[] };
    const peers = map.Peers.filter(p => p.Addresses?.some(a => a.split("/")[0] === target));
    assert.equal(peers.length, 1);
    assert.ok(peers[0]!.Key && peers[0]!.Online === true);
    return peers[0]!;
  }
  const original = await peer();
  const selectedPort = () => reported ? diagnosticConnectPort({ tailnetIp: target!, nodeId: String(original.ID), deviceId: productDevice! }) : Promise.resolve(port);
  const sockets = new Set<Socket>(), children = new Set<ReturnType<typeof spawn>>();
  const streamPorts = new Map<Socket, number>();
  let accepted = 0, stopping = false;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => { sockets.delete(socket); streamPorts.delete(socket); });
    void (async () => {
      assert.ok(!stopping && socket.remoteAddress === "127.0.0.1" && sockets.size <= 2 && accepted < 10);
      const current = await peer();
      assert.equal(current.ID, original.ID); assert.equal(current.Key, original.Key);
      const remotePort = await selectedPort(); assert.ok(remotePort !== null);
      if (socket.destroyed || stopping) return;
      accepted++;
      streamPorts.set(socket, remotePort);
      const child = spawn(cli, ["nc", target!, String(remotePort)], { stdio: ["pipe", "pipe", "pipe"], shell: false });
      children.add(child);
      socket.pipe(child.stdin); child.stdout.pipe(socket);
      // Pairing codes/ADB wire bytes and daemon detail are never logged.
      child.stderr.on("data", () => undefined);
      child.stdin.on("error", () => socket.destroy());
      child.stdout.on("error", () => socket.destroy());
      child.once("error", () => socket.destroy());
      child.once("close", () => { children.delete(child); socket.destroy(); });
      socket.once("close", () => { child.kill("SIGTERM"); });
      socket.once("error", () => child.kill("SIGTERM"));
      console.log(JSON.stringify({ event: "diagnostic_remote_stream_opened", accepted,
        source: "Tailscale daemon", fallback: false }));
    })().catch(() => { socket.destroy(); console.error('{"event":"diagnostic_stream_rejected"}'); });
  });
  const stop = () => {
    if (stopping) return; stopping = true;
    for (const socket of sockets) socket.destroy();
    for (const child of children) child.kill("SIGTERM");
    server.close();
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const timer = setTimeout(stop, maximumMinutes * 60_000);
  let observing = false;
  const endpointTimer = reported ? setInterval(() => {
    if (observing || stopping) return; observing = true;
    void selectedPort().then(selected => {
      for (const [socket, streamPort] of streamPorts) if (selected !== streamPort) socket.destroy();
    }).finally(() => { observing = false; });
  }, 1000) : null;
  try {
    await new Promise<void>((yes, no) => { server.once("error", no); server.listen(localPort, "127.0.0.1", yes); });
    console.log(JSON.stringify({ event: "diagnostic_bridge_ready", localPort, targetPort: reported ? null : port, automaticEndpoint: reported,
      maxLifetimeMinutes: maximumMinutes, newPairing: false, formalAdmission: false }));
    await new Promise<void>(yes => server.once("close", yes));
  } finally { clearTimeout(timer); if (endpointTimer) clearInterval(endpointTimer); stop(); }

}
await main().catch(() => {
  console.error('{"event":"diagnostic_bridge_unavailable","automaticFallback":false}');
  process.exitCode = 1;
});
