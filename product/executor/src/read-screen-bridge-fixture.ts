// Synthetic component-only executable/authority; never called from main.
import { mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlProtocolVersion } from "@socialgrowth/product-contracts";
import { PhoneActionFence, type PhoneFenceAuthority } from "./phone-action-fence.js";
import { AdbReadScreenTransport } from "./adb-read-screen-transport.js";
import { ArtemisReadScreenBridge, type ReadScreenBridgeScope } from "./artemis-read-screen-bridge.js";

export async function bridgeFixture(body?: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "sg-bridge8-"))), binary = join(dir, "synthetic-adb"), calls = join(dir, "calls");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=", "base64");
  const script = `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(${JSON.stringify(calls)},'called\\n');${body ?? `process.stdout.write(Buffer.from('${png.toString("base64")}','base64'));`}\n`;
  await writeFile(binary, script, { mode: 0o700 });
  const scope: ReadScreenBridgeScope = { protocolVersion: controlProtocolVersion, deviceId: randomUUID(), holderId: randomUUID(), authorizationId: randomUUID(), taskAttemptId: randomUUID(), controlGeneration: "1", purpose: "business", serial: "SYNTHETIC_NOT_A_DEVICE" };
  const { serial, ...identity } = scope;
  const grant = { ...identity, serial, leaseUntil: new Date(Date.now() + 30_000).toISOString(), allowedKinds: ["read_screen" as const] };
  const outcomes: string[] = [];
  const authority: PhoneFenceAuthority = {
    async verifyHolder() {}, async beginAction(r) { const now = Date.now(); return { ...r, serial, checkedAt: new Date(now).toISOString(), validUntil: new Date(Math.min(now + 2000, Date.parse(grant.leaseUntil))).toISOString(), replayed: false }; },
    async recordActionOutcome(_r, status) { outcomes.push(status); }, async inspectOriginalAction() { throw Error("No real stop evidence in component fixture"); },
    async inspectStopped(s) { return { deviceId: s.deviceId, serial: s.serial, controlGeneration: s.controlGeneration, stopRequestId: s.stopRequestId, evidenceId: randomUUID(), checkedAt: new Date().toISOString(), allPathsFenced: true, controllerReleased: true, targetQuiescent: true }; },
  };
  const transport = new AdbReadScreenTransport({ ...scope, host: "127.0.0.1", port: 49199, binaryPath: binary, binarySha256: createHash("sha256").update(script).digest("hex") });
  const fence = new PhoneActionFence(join(dir, "fence.sqlite"), scope.deviceId, serial, authority, transport);
  const bridge = new ArtemisReadScreenBridge(join(dir, "r.sock"), scope, fence);
  try {
    await fence.confirmStopped(); await fence.installHolder(grant);
    const access = await bridge.listen();
    return { dir, png, scope, grant, fence, bridge, access, outcomes, async count() { try { return (await readFile(calls, "utf8")).trim().split("\n").length; } catch { return 0; } },
      async cleanup() { await bridge.close(); fence.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (e) { await bridge.close(); fence.close(); await rm(dir, { recursive: true, force: true }); throw e; }
}
