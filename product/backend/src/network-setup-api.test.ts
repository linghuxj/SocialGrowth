import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NetworkSetupApi, networkSetupContractVersion } from "./network-setup-api.js";
import type { NetworkAdmissionStore } from "./network-admission-store.js";
import type { InstallationAuthService } from "./installation-auth-service.js";
import type { PilotWhoIsPort } from "./network-access-authority.js";

const deviceId = "10000000-0000-4000-8000-000000000001";
const providerId = "20000000-0000-4000-8000-000000000002";
const installationId = "30000000-0000-4000-8000-000000000003";
const nodeId = "n_pilot_android";
const address = "100.100.10.20";
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const fakeKey = "tskey-auth-0123456789abcdefghijklmnopqrstuv";
const body = { contractVersion: networkSetupContractVersion };
const authorization = `Bearer ${"a".repeat(43)}`;

async function fixture(options: { allowlisted?: boolean; online?: boolean; keyFile?: boolean; observedNodeId?: string; pinned?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "socialgrowth-network-setup-"));
  await chmod(dir, 0o700);
  const configPath = join(dir, "pilot.json"), keyPath = join(dir, "pilot-auth-key.txt");
  const binding = { deviceId, providerId, installationId, installationGeneration: "1",
    nodeId: options.pinned === false ? null : nodeId, tailnetAddress: options.pinned === false ? null : address };
  await writeFile(configPath, JSON.stringify({ authKeyExpiresAt: expiresAt, devices: options.allowlisted === false ? [] : [binding] }), { mode: 0o600 });
  if (options.keyFile !== false) await writeFile(keyPath, `${fakeKey}\n`, { mode: 0o600 });
  const store = { authenticatedState: async () => ({ scope: { deviceId, providerId, installationId,
    installationGeneration: "1", ownershipVersion: "7" }, record: null }) } as unknown as NetworkAdmissionStore;
  const auth = {} as InstallationAuthService;
  const whois: PilotWhoIsPort = { lookup: async () => options.online === false ? {} : ({ Node: {
    Online: true, StableID: options.observedNodeId ?? nodeId, Key: `nodekey:${"b".repeat(64)}`, Addresses: [`${address}/32`],
    KeyExpiry: "0001-01-01T00:00:00Z",
  } }) };
  const api = new NetworkSetupApi(store, auth, configPath, whois, options.keyFile === false ? join(dir, "missing.txt") : keyPath);
  return { api, dir };
}

test("pilot setup state verifies the allowlisted online node without a key file", async () => {
  const f = await fixture({ keyFile: false });
  try {
    const state = await f.api.handle("state", body, authorization);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { contractVersion: networkSetupContractVersion, state: "connected",
      blockerCode: null, mode: "pilot_verified", formalNetworkAdmission: false, node: { nodeId, tailnetAddress: address } });
    const key = await f.api.handle("key", body, authorization);
    assert.equal(key.status, 503);
    assert.deepEqual(key.body, { contractVersion: networkSetupContractVersion, error: { code: "PILOT_AUTH_KEY_UNAVAILABLE" } });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("pilot key is returned only by the explicit authenticated key route and no node is inferred while offline", async () => {
  const f = await fixture({ online: false });
  try {
    const state = await f.api.handle("state", body, authorization);
    assert.deepEqual(state.body, { contractVersion: networkSetupContractVersion, state: "waiting_for_network",
      blockerCode: "TAILNET_NODE_NOT_OBSERVED", node: null });
    const key = await f.api.handle("key", body, authorization);
    assert.equal(key.status, 200);
    assert.deepEqual(key.body, { contractVersion: networkSetupContractVersion, key: fakeKey, expiresAt, usage: "pilot_shared" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("pre-allowlisted device can obtain the pilot key before its operator pins a Tailnet node", async () => {
  const f = await fixture({ pinned: false });
  try {
    const state = await f.api.handle("state", body, authorization);
    assert.deepEqual(state.body, { contractVersion: networkSetupContractVersion, state: "waiting_for_network",
      blockerCode: "PILOT_NODE_PIN_REQUIRED", node: null });
    const key = await f.api.handle("key", body, authorization);
    assert.equal(key.status, 200);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("pilot status and key fail closed for devices outside the pinned allowlist", async () => {
  const f = await fixture({ allowlisted: false });
  try {
    assert.deepEqual((await f.api.handle("state", body, authorization)).body, { contractVersion: networkSetupContractVersion,
      state: "blocked", blockerCode: "DEVICE_NOT_IN_PILOT_ALLOWLIST", node: null });
    assert.equal((await f.api.handle("key", body, authorization)).status, 403);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("pilot status stays waiting when a live address resolves to a different node than the pin", async () => {
  const f = await fixture({ observedNodeId: "n_different_node" });
  try {
    assert.deepEqual((await f.api.handle("state", body, authorization)).body, { contractVersion: networkSetupContractVersion,
      state: "waiting_for_network", blockerCode: "TAILNET_NODE_NOT_OBSERVED", node: null });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("pilot API rejects client-supplied device identity and malformed authorization", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.api.handle("key", { ...body, deviceId }, authorization)).status, 400);
    assert.equal((await f.api.handle("key", body, "Bearer invalid")).status, 401);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("unknown expiry is deferred to Tailscale; a known expired key is withheld", async () => {
  const { readPilotAuthKeyFile } = await import("./network-setup-config.js");
  const dir = await mkdtemp(join(tmpdir(), "sg-pilot-expiry-"));
  try {
    const path = join(dir, "key.txt");
    await writeFile(path, fakeKey, { mode: 0o600 });
    assert.deepEqual(await readPilotAuthKeyFile(path, null), { key: fakeKey, expiresAt: null });
    await assert.rejects(readPilotAuthKeyFile(path, new Date(Date.now() - 1000).toISOString()));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
