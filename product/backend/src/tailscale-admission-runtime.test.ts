import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Server, Socket } from "node:net";
import test from "node:test";
import { TailscaleAdmissionRuntime, type AdmissionRevisionPort } from "./tailscale-admission-runtime.js";
import { DirectTailnetConnections } from "./tailscale-source-verifier.js";
import { createAdmissionRecord, confirmRestriction } from "./network-admission-core.js";
import type { AuthenticatedAdmissionState } from "./network-admission-store.js";

// Synthetic ports only, supplement transaction/source checks; no live grants.
const peer = "100.118.89.89", local = "100.75.25.72", nodeKey = `nodekey:${"a".repeat(64)}`;
const node = () => ({ Node: { StableID: "n_testphone", Key: nodeKey, Online: true,
  KeyExpiry: "2099-01-01T00:00:00Z", Addresses: [`${peer}/32`] } });
function fixture() {
  const server = new Server(), socket = new Socket();
  Object.defineProperties(socket, { remoteAddress: { value: peer }, remotePort: { value: 12345 }, localAddress: { value: local }, localPort: { value: 9443 } });
  const transports = new DirectTailnetConnections(server, [local]); server.emit("connection", socket);
  const authority = { deviceId: randomUUID(), installationId: randomUUID(), installationGeneration: "1", enrollmentGeneration: "1", ownershipVersion: "1", eligible: true };
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const r = createAdmissionRecord(authority, key, new Date().toISOString());
  const record = confirmRestriction(r, 0, authority, { enrollmentId: r.enrollmentId, deviceId: authority.deviceId,
    installationId: authority.installationId, enrollmentGeneration: "1", evidenceId: randomUUID(), policyRevision: 1, networkRevision: 1,
    checkedAt: new Date().toISOString(), independentVerifierReachable: true, adbDenied: true, otherPhonesDenied: true,
    operatorServicesDenied: true, businessEgressDenied: true, additiveRulesChecked: true }, new Date().toISOString());
  const state: AuthenticatedAdmissionState = { scope: { deviceId: authority.deviceId, installationId: authority.installationId,
    installationGeneration: "1", ownershipVersion: "1" }, record };
  return { server, socket, transports, state, handle: transports.transportFor(socket)! };
}
const revision = (): AdmissionRevisionPort => ({ read: async () => ({ revision: 1, observedAt: new Date().toISOString() }) });
test("admission requires its own revision port, not a restriction's expected revision", async () => {
  const f = fixture(), runtime = new TailscaleAdmissionRuntime(f.transports, { lookup: async () => node() }, null, null);
  assert.equal(await runtime.observe(f.handle, f.state, AbortSignal.timeout(1000)), null);
  assert.equal(await runtime.canBegin(f.handle, f.state, AbortSignal.timeout(1000)), false);
});
test("only minted live sockets with online host identity and fresh scope revision produce observations", async () => {
  const f = fixture(), runtime = new TailscaleAdmissionRuntime(f.transports, { lookup: async () => node() }, revision(), { ready: async () => true });
  assert.equal(await runtime.observe({}, f.state, AbortSignal.timeout(1000)), null);
  const result = await runtime.observe(f.handle, f.state, AbortSignal.timeout(1000));
  assert.deepEqual(result?.node, { nodeId: "n_testphone", nodeKey, networkRevision: 1 });
  assert.equal(await runtime.canBegin(f.handle, f.state, AbortSignal.timeout(1000)), true);
  f.socket.destroy(); assert.equal(await runtime.observe(f.handle, f.state, AbortSignal.timeout(1000)), null);
});
test("revision mismatch, stale/future observations, absent enrollment and offline identity close", async () => {
  for (const value of [{ revision: 2, observedAt: new Date().toISOString() }, { revision: 1, observedAt: "invalid" },
    { revision: 1, observedAt: new Date(Date.now()-4000).toISOString() }, { revision: 1, observedAt: new Date(Date.now()+4000).toISOString() }]) {
    const f = fixture(), runtime = new TailscaleAdmissionRuntime(f.transports, { lookup: async () => node() }, { read: async () => value }, null);
    assert.equal(await runtime.observe(f.handle, f.state, AbortSignal.timeout(1000)), null);
  }
  const f = fixture(), raw = node(); raw.Node.Online = false;
  const runtime = new TailscaleAdmissionRuntime(f.transports, { lookup: async () => raw }, revision(), null);
  assert.equal(await runtime.observe(f.handle, f.state, AbortSignal.timeout(1000)), null);
  assert.equal(await runtime.observe(f.handle, { ...f.state, record: null }, AbortSignal.timeout(1000)), null);
});
test("hung ports and revoked transport cannot outlive abort or become admission evidence", async () => {
  const f = fixture(), runtime = new TailscaleAdmissionRuntime(f.transports, { lookup: () => new Promise(() => {}) }, revision(), null);
  const at = Date.now(); assert.equal(await runtime.observe(f.handle, f.state, AbortSignal.timeout(25)), null);
  assert.ok(Date.now()-at<500);
  const close = new TailscaleAdmissionRuntime(f.transports, { lookup: async () => node() }, { read: async () => { f.server.emit("close"); return { revision: 1, observedAt: new Date().toISOString() }; } }, null);
  assert.equal(await close.observe(f.handle, f.state, AbortSignal.timeout(1000)), null);
});
