import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DeviceConnectionApi } from "./device-connection-api.js";

// Exercise real API ordering with isolated I/O ports. These checks do not
// provide a phone, authenticated Tailnet, or first-pair acceptance result.
function setup() {
  const scope = { deviceId: "00000000-0000-4000-8000-000000000001", providerId: "provider", installationId: "install",
    installationGeneration: "1", ownershipVersion: "2", factVersion: "2", associationId: "assoc", deviceState: "access_ready" };
  const network = { ...scope, mode: "pilot_verified", tailnetNodeId: "node", tailnetNodeKey: `nodekey:${"a".repeat(64)}`,
    tailnetAddress: "100.64.0.1", enrollmentId: null, enrollmentGeneration: null, enrollmentVersion: null, networkRevision: null,
    observedAt: new Date().toISOString() };
  const binding = createHash("sha256").update(JSON.stringify({ deviceId: scope.deviceId, providerId: scope.providerId,
    installationId: scope.installationId, installationGeneration: scope.installationGeneration, ownershipVersion: scope.ownershipVersion,
    factVersion: scope.factVersion, mode: network.mode, tailnetNodeId: network.tailnetNodeId, tailnetNodeKey: network.tailnetNodeKey,
    tailnetAddress: network.tailnetAddress, enrollmentId: null, enrollmentGeneration: null, enrollmentVersion: null, networkRevision: null })).digest();
  const row: Record<string, any> = { device_id: scope.deviceId, installation_id: scope.installationId, provider_id: scope.providerId,
    association_id: scope.associationId, authority_mode: network.mode, network_binding_digest: binding, source_generation: "1",
    source_epoch: "00000000-0000-4000-8000-000000000002", endpoint_revision: "1", source_sequence: "0",
    pairing_state: "unknown", pairing_attempt_id: "original", connect_status: "candidate", connect_port: 40000,
    pairing_status: "candidate", pairing_port: 40001, pairing_expires_at: new Date(Date.now()+60000), endpoint_observed_at: new Date() };
  let pairCalls = 0;
  const client = { release() {}, async query(sql: string, p: any[] = []): Promise<{ rows: any[] }> {
    if (sql.includes("SELECT clock_timestamp()")) return { rows: [{ now: new Date(Date.now()+1200) }] };
    if (sql.includes("SET provider_id=$2")) Object.assign(row, { source_epoch: p[6], source_generation: p[7], endpoint_revision: String(p[9]),
      source_sequence: "0", pairing_state: p[10], pairing_attempt_id: p[11], connect_status: "unknown", connect_port: null });
    if (sql.includes("SET source_sequence=$2")) Object.assign(row, { source_sequence: p[1], connect_status: p[4], connect_port: p[5],
      pairing_status: p[6], pairing_port: p[7], endpoint_observed_at: p[8], endpoint_revision: String(p[10]), pairing_state: p[11], pairing_expires_at: p[12] });
    return { rows: [] };
  } };
  const pool = { connect: async () => client, query: client.query };
  const api = new DeviceConnectionApi(pool as any, {} as any, {} as any, {} as any, { pair: async () => { pairCalls++; return "unknown"; } } as any);
  const internal = api as any;
  internal.installationScope = internal.installationScopeInTransaction = internal.providerScope = internal.providerScopeInTransaction = async () => scope;
  internal.readNetwork = async () => network;
  internal.connectionRow = internal.currentConnectionState = async () => row;
  internal.reconnectCurrent = async () => {};
  internal.lockDevice = async () => async () => {};
  internal.pairAttempt = async () => null;
  const pair = () => api.pair("unused", { protocolVersion: "device-connection-v1", requestId: "request-pair", idempotencyKey: "new-request-key-123",
    deviceId: scope.deviceId, expectedFactVersion: 2, pairingCode: "123456" });
  return { api, internal, row, scope, binding, pool, pair, pairCalls: () => pairCalls };
}

test("initialization identity survives relay epochs but changes with enrollment; a concurrent ownership change is rejected", async () => {
  const f = setup();
  f.internal.providerScopeByIdentity = async () => structuredClone(f.scope);
  f.api.preparationTarget = async deviceId => ({ deviceId, serial: "127.0.0.1:41234", hardwareSerial: "TEST_PHONE", sessionId: String(f.row.source_epoch) });
  const first = await f.api.initializationTarget(f.scope.deviceId);
  assert.equal(first.wirelessPort, 40000);
  assert.match(first.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  f.row.source_epoch = "00000000-0000-4000-8000-000000000003";
  assert.equal((await f.api.initializationTarget(f.scope.deviceId)).requestId, first.requestId);
  f.scope.installationGeneration = "2";
  assert.notEqual((await f.api.initializationTarget(f.scope.deviceId)).requestId, first.requestId);
  f.api.preparationTarget = async deviceId => {
    f.scope.ownershipVersion = "3";
    return { deviceId, serial: "127.0.0.1:41234", hardwareSerial: "TEST_PHONE", sessionId: String(f.row.source_epoch) };
  };
  await assert.rejects(f.api.initializationTarget(f.scope.deviceId));
});

test("an unresolved pairing survives reporter restart and replacement pairing port", async () => {
  const f = setup();
  const epoch = await f.api.beginEpoch("unused", { protocolVersion: "device-connection-v1", requestId: "new-epoch" });
  await f.api.report("unused", { protocolVersion: "device-connection-v1", requestId: "new-report", sourceEpoch: epoch.sourceEpoch,
    sequence: "1", observedAt: new Date().toISOString(), connect: { status: "candidate", port: 40002 }, pairing: { status: "candidate", port: 40003 } });
  assert.equal(f.row.pairing_state, "unknown"); assert.equal(f.row.pairing_attempt_id, "original");
  await assert.rejects(f.pair()); assert.equal(f.pairCalls(), 0);
  // A DB/container clock ahead of the API host must not invalidate an otherwise
  // fresh report immediately or extend the endpoint's observation lifetime.
  assert.ok(f.row.endpoint_observed_at.getTime() <= Date.now());
});

test("a durable unresolved attempt blocks a new key even when the current row has been replaced", async () => {
  const f = setup(); f.row.pairing_state = "awaiting_code";
  f.pool.query = async () => ({ rows: [{ attempt_id: "unresolved-original" }] });
  await assert.rejects(f.pair()); assert.equal(f.pairCalls(), 0);
});

test("the original successful pairing result can be retrieved after its popup disappears", async () => {
  const f = setup(); f.row.pairing_expires_at = null; f.row.pairing_port = null; f.row.connect_port = null;
  f.internal.pairAttempt = async () => ({ device_id: f.scope.deviceId, installation_id: f.scope.installationId,
    expected_fact_version: "2", network_binding_digest: f.binding, status: "connected", blocker_code: null });
  const result = await f.pair(); assert.equal(result.pairingState, "paired"); assert.equal(result.connectionState, "connected");
  assert.equal(f.pairCalls(), 0);
});

test("a busy device lock releases its pool client without waiting behind the owner", async () => {
  let released = 0;
  const api = new DeviceConnectionApi({ connect: async () => ({ release: () => released++, query: async (sql: string) => {
    assert.ok(sql.includes("pg_try_advisory_lock")); return { rows: [{ locked: false }] };
  } }) } as any, {} as any, {} as any, null, null);
  await assert.rejects((api as any).lockDevice("busy-device")); assert.equal(released, 1);
});
