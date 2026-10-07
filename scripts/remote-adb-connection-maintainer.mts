import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diagnosticConnectPort } from "./remote-adb-report-source.mts";

/** Foreground diagnostic reconnection only. Host authorization is reused;
 * unauthorized/failed auth requires controlled first pairing, never AI codes.
 */
async function main() {
  assert.equal(process.env.SG_DIAGNOSTIC_REMOTE_ADB, "authorized");
  assert.equal(process.env.SG_DIAGNOSTIC_AUTOMATIC_ENDPOINT, "authorized");
  const localPort = Number(process.env.SG_DIAGNOSTIC_BRIDGE_PORT);
  assert.ok(Number.isInteger(localPort) && localPort >= 1024 && localPort <= 65535);
  const serial = `127.0.0.1:${localPort}`, hardware = process.env.SG_DIAGNOSTIC_HARDWARE_SERIAL;
  assert.ok(hardware && /^[A-Za-z0-9]{8,30}$/.test(hardware));
  const expected = { tailnetIp: process.env.SG_DIAGNOSTIC_TAILNET_IP ?? "", deviceId: process.env.SG_DIAGNOSTIC_PRODUCT_DEVICE_ID ?? "" };
  assert.match(expected.tailnetIp, /^100\./); assert.match(expected.deviceId, /^[a-f0-9-]{36}$/);
  const adb = "/Users/linghuxj/Library/Android/sdk/platform-tools/adb", run = promisify(execFile);
  const file = resolve(".runtime/product-local-live/remote-adb-connection.json");
  let stopping = false, attempts = 0, targetPort: number | null = null, verified = false;
  let block: string | null = null, nextAttempt = 0, attemptWindowStart = 0;
  let identityReadFailures = 0;
  process.once("SIGINT", () => { stopping = true; }); process.once("SIGTERM", () => { stopping = true; });
  const deadline = Date.now() + 60 * 60_000;
  async function disconnect() {
    await run(adb, ["disconnect", serial], { timeout: 5000 }).catch(() => undefined);
    verified = false;
  }
  async function save(state: string) {
    const temp = file + ".tmp";
    await writeFile(temp, JSON.stringify({ at: new Date().toISOString(), serial, targetPort, state, attempts,
      targetIdentityVerified: verified, reusedHostAuthorization: true, newPairingAttempted: false,
      formalAdmission: false, actionPermissionGranted: false }, null, 2), { mode: 0o600 });
    await chmod(temp, 0o600); await rename(temp, file);
  }
  try {
    await disconnect(); // Clear only this owned transport once at session start.
    while (!stopping && Date.now() < deadline) {
      const candidate = await diagnosticConnectPort(expected);
      if (candidate !== targetPort) {
        if (targetPort !== null) await disconnect();
        targetPort = candidate; verified = false;
        // A new port reuses host keys; it never constitutes fresh pairing.
        // Preserve the three-attempt window across changes and report epochs.
        nextAttempt = Date.now();
      }
      if (targetPort === null) { await save("waiting_for_fresh_connect_report"); }
      else if (block) await save(block);
      else {
        const { stdout } = await run(adb, ["devices"], { timeout: 5000 });
        const row = stdout.split("\n").find(line => line.startsWith(serial + "\t"));
        const state = row?.split(/\s+/)[1];
        if (state !== "device") verified = false;
        if (state === "unauthorized") { block = "first_pairing_or_host_authorization_required"; await disconnect(); }
        else if (state === "device") {
          const result = await run(adb, ["-s", serial, "shell", "getprop", "ro.serialno"], { timeout: 6000 }).catch(() => null);
          if (!result) {
            verified = false;
            identityReadFailures++;
            console.error(JSON.stringify({ event: "remote_adb_identity_read_unavailable", consecutiveFailures: identityReadFailures }));
            if (identityReadFailures >= 3) { block = "target_identity_read_budget_exhausted"; await disconnect(); }
          } else if (result.stdout.trim() !== hardware) { block = "target_identity_mismatch"; await disconnect(); }
          else {
            verified = true;
            identityReadFailures = 0;
            // Successful hardware verification ends this failure window. The
            // total three-attempt budget remains unchanged across later ports.
            attemptWindowStart = 0;
          }
        } else if (Date.now() >= nextAttempt) {
          verified = false;
          if (attempts >= 3 || attemptWindowStart && Date.now() - attemptWindowStart >= 120_000) block = "connection_budget_exhausted";
          else {
            if (!attemptWindowStart) attemptWindowStart = Date.now();
            attempts++; nextAttempt = Date.now() + 4000 * attempts;
            const result = await run(adb, ["connect", serial], { timeout: 15000 }).catch(() => null);
            if (result && /unauthorized|failed to authenticate/i.test(result.stdout)) block = "first_pairing_or_host_authorization_required";
          }
        }
        await save(block ?? (verified ? "connected_target_verified" : "connecting_with_existing_host_authorization"));
      }
      await new Promise(yes => setTimeout(yes, 1500));
    }
  } finally { await disconnect(); await save("diagnostic_maintenance_stopped"); }
}
await main().catch(() => { console.error('{"event":"remote_adb_maintenance_failed_closed"}'); process.exitCode = 1; });
