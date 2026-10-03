import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { resolve } from "node:path";

/** User-authorized, time-limited incoming diagnostic session; restores shields.
 * No login, ACL/Funnel/exit-node change, daemon or persistent Serve config.
 */
const cli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale", run = promisify(execFile);
async function prefs() { return JSON.parse((await run(cli, ["debug", "prefs"], { timeout: 5000 })).stdout) as Record<string, unknown>; }
async function main() {
  assert.equal(process.env.SG_DIAGNOSTIC_REMOTE_ADB, "authorized");
  assert.equal(process.env.SG_DIAGNOSTIC_TEMPORARY_INCOMING, "authorized");
  const original = await prefs(); assert.equal(original.WantRunning, true);
  const config = JSON.parse((await run(cli, ["serve", "status", "--json"], { timeout: 5000 })).stdout) as object;
  assert.deepEqual(config, {}, "Preserve other Serve owners");
  const sameScope = (current: Record<string, unknown>) => ["ControlURL", "WantRunning", "CorpDNS", "RouteAll", "ExitNodeID", "AdvertiseRoutes", "RunSSH", "Persist"]
    .every(key => JSON.stringify(current[key]) === JSON.stringify(original[key]));
  let child: ReturnType<typeof spawn> | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;
  const proxyTls = process.env.SG_DIAGNOSTIC_PROXY_TLS === "authorized";
  const stop = () => { stopping = true; child?.kill("SIGINT"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    if (original.ShieldsUp === true) await run(cli, ["set", "--shields-up=false"], { timeout: 5000 });
    const ready = await prefs(); assert.equal(ready.ShieldsUp, false); assert.ok(sameScope(ready));
    assert.ok(!stopping);
    child = spawn(cli, ["serve", ...(proxyTls ? ["--tcp=8443", "--proxy-protocol=1", "tcp://127.0.0.1:4343"] : ["--https=8443", `unix:${resolve(".runtime/product-local-live/ep.sock")}`])], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    // Suppress CLI output and arbitrary platform errors; config can be inspected read-only.
    child.stdout?.on("data", () => undefined); child.stderr?.on("data", () => undefined);
    timer = setTimeout(stop, 60 * 60_000);
    console.log(JSON.stringify({ event: "owned_tailnet_incoming_diagnostic_started", maxLifetimeMinutes: 60, originalShieldsUp: original.ShieldsUp, restoreRequired: original.ShieldsUp === true }));
    const [exitCode] = await once(child, "close");
    assert.ok(stopping || exitCode === 0);
  } finally {
    if (timer) clearTimeout(timer); stop();
    const current = await prefs(); assert.ok(sameScope(current), "Network scope changed; do not overwrite another owner");
    if (original.ShieldsUp === true && current.ShieldsUp === false) await run(cli, ["set", "--shields-up=true"], { timeout: 5000 });
    assert.equal((await prefs()).ShieldsUp, original.ShieldsUp);
    console.log('{"event":"original_incoming_preference_restored"}');
  }
}
await main().catch(() => { console.error('{"event":"owned_incoming_session_requires_inspection"}'); process.exitCode = 1; });
