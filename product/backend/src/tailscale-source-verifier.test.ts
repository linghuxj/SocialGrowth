import assert from "node:assert/strict";
import { Server, Socket } from "node:net";
import test from "node:test";
import { tailnetAddress, DirectTailnetConnections, readTailnetNode, readTailnetNodeIdentity, TailscaleCliWhoIs,
  TailscaleEndpointSourceVerifier, type TailnetRevisionPort } from "./tailscale-source-verifier.js";

// Synthetic source ports/listener events only: no enrollment/real network success.
const peer = "100.118.89.89", local = "100.75.25.72";
const nodeKey = `nodekey:${"a".repeat(64)}`;
const node = () => ({ Node: { StableID: "n_testphone", Key: nodeKey, Online: true,
  KeyExpiry: "2099-01-01T00:00:00Z", Addresses: [`${peer}/32`] } });
const expected = { enrollmentId: "00000000-0000-4000-8000-000000000001", deviceId: "00000000-0000-4000-8000-000000000002",
  installationId: "00000000-0000-4000-8000-000000000003", installationGeneration: "1", enrollmentGeneration: "1", ownershipVersion: "1",
  node: { nodeId: "n_testphone", nodeKey, networkRevision: 1 } };
const revision = (): TailnetRevisionPort => ({ read: async () => ({ revision: 1, observedAt: new Date().toISOString() }) });
function fixture(source = peer, target = local) {
  const server = new Server(), socket = new Socket();
  let remoteAddress = source;
  Object.defineProperties(socket, { remoteAddress: { get: () => remoteAddress }, remotePort: { value: 12345 },
    localAddress: { value: target }, localPort: { value: 8443 } });
  const transports = new DirectTailnetConnections(server, [local]);
  server.emit("connection", socket);
  return { transports, server, socket, handle: transports.transportFor(socket), move: (value: string) => { remoteAddress = value; } };
}

test("direct source accepts only individual Tailnet IPv4/IPv6, normalizes mapped IP", () => {
  assert.equal(tailnetAddress("::ffff:100.118.89.89"), peer);
  assert.equal(tailnetAddress("FD7A:115C:A1E0:0:0:0:0:1"), "fd7a:115c:a1e0::1");
  for (const ip of ["127.0.0.1", "172.20.10.7", "100.63.255.255", "100.128.0.1", "100.118.089.89", "fd7b::1", "fd7a:115c:a1e0::1%en0", `${peer}:8443`, "localhost"]) assert.equal(tailnetAddress(ip), null);
});
test("unregistered body/header/socket claims never reach WhoIs", async () => {
  const f = fixture(); let calls = 0;
  const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => { calls++; return node(); } }, revision());
  for (const object of [{ remoteAddress: peer }, { headers: { "x-forwarded-for": peer } }, {}, f.socket]) {
    assert.equal(await verifier.observe(object, expected, new AbortController().signal), null);
  }
  assert.equal(calls, 0);
});
test("loopback Serve and LAN sockets do not acquire direct-source handles", () => {
  assert.equal(fixture("127.0.0.1").handle, null);
  assert.equal(fixture("172.20.10.7").handle, null);
  assert.equal(fixture(peer, "127.0.0.1").handle, null);
  assert.throws(() => new DirectTailnetConnections(new Server(), ["127.0.0.1"]));
});
test("closed listener, closed socket and changed peer invalidate handles", () => {
  const a = fixture(); assert.equal(a.transports.peerOf(a.handle!), peer);
  a.server.emit("close"); assert.equal(a.transports.peerOf(a.handle!), null);
  const b = fixture(); b.socket.destroy(); assert.equal(b.transports.peerOf(b.handle!), null);
  const c = fixture(); c.move("100.118.89.90"); assert.equal(c.transports.peerOf(c.handle!), null);
});
test("fixture identity and independent revision are checked before binding returned scope", async () => {
  const f = fixture(); const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => node() }, revision());
  const result = await verifier.observe(f.handle!, expected, new AbortController().signal);
  assert.ok(result); assert.deepEqual(result.scope, expected);
  assert.notEqual(result.scope, expected); assert.notEqual(result.scope.node, expected.node);
  assert.ok(Date.parse(result.observedAt) <= Date.now());
});
test("absent policy revision never borrows revision from expected enrollment", async () => {
  const f = fixture(); let calls = 0;
  const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => { calls++; return node(); } });
  assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
  assert.equal(calls, 0);
});
test("wrong node, rotated key and current policy revision all fail closed", async () => {
  for (const mutate of [(v: ReturnType<typeof node>) => { v.Node.StableID = "other_node"; },
    (v: ReturnType<typeof node>) => { v.Node.Key = `nodekey:${"b".repeat(64)}`; }]) {
    const f = fixture(), raw = node(); mutate(raw);
    const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => raw }, revision());
    assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
  }
  const f = fixture(); const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => node() },
    { read: async () => ({ revision: 2, observedAt: new Date().toISOString() }) });
  assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
});
test("offline, expired, unknown identity, route-only address and invalid JSON are rejected", () => {
  for (const bad of [null, {}, { Node: {} }, { Node: { ...node().Node, Online: false } },
    { Node: { ...node().Node, Expired: true } }, { Node: { ...node().Node, KeyExpiry: "2020-01-01T00:00:00Z" } },
    { Node: { ...node().Node, KeyExpiry: undefined } }, { Node: { ...node().Node, StableID: undefined, ID: 1234 } },
    { Node: { ...node().Node, Addresses: ["100.118.89.0/24"] } }, { Node: { ...node().Node, Addresses: ["100.118.89.90/32"] } },
    { Node: { ...node().Node, Key: "unexpected-secret-material" } }]) assert.equal(readTailnetNode(bad, peer), null);
});
test("canonical IPv6 host address and zero non-expiring key time are explicit", () => {
  assert.deepEqual(readTailnetNode({ Node: { ...node().Node, KeyExpiry: "0001-01-01T00:00:00Z", Addresses: ["FD7A:115C:A1E0:0:0:0:0:1/128"] } }, "fd7a:115c:a1e0::1"), { nodeId: "n_testphone", nodeKey });
});
test("Self inventory without Online can match identity but never become live source evidence", () => {
  const { Online: _online, ...self } = node().Node;
  assert.deepEqual(readTailnetNodeIdentity({ Node: self }, peer), { nodeId: "n_testphone", nodeKey });
  assert.equal(readTailnetNode({ Node: self }, peer), null);
});
test("stale, future, missing and malformed revision observations are rejected", async () => {
  for (const value of [null, { revision: 1, observedAt: new Date(Date.now() - 4000).toISOString() },
    { revision: 1, observedAt: new Date(Date.now() + 5000).toISOString() }, { revision: 0, observedAt: new Date().toISOString() },
    { revision: 1, observedAt: "not-a-time" }]) {
    const f = fixture(); const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => node() }, { read: async () => value });
    assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
  }
});
test("source rechecked after LocalAPI I/O; close during lookup cannot attest", async () => {
  const f = fixture(); const verifier = new TailscaleEndpointSourceVerifier(f.transports,
    { lookup: async () => { f.socket.destroy(); return node(); } }, revision());
  assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
});
test("aborted request never starts lookups and platform errors never surface secrets", async () => {
  const f = fixture(); let calls = 0; const controller = new AbortController(); controller.abort();
  const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => { calls++; throw new Error("private-tailnet-detail"); } }, revision());
  assert.equal(await verifier.observe(f.handle!, expected, controller.signal), null); assert.equal(calls, 0);
  assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
});
test("non-cooperative source port has a bounded deadline without success", async () => {
  const f = fixture(); const start = Date.now();
  const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => new Promise<never>(() => undefined) }, revision());
  assert.equal(await verifier.observe(f.handle!, expected, new AbortController().signal), null);
  assert.ok(Date.now() - start >= 1900 && Date.now() - start < 4000);
});
test("cancellation during non-cooperative I/O ends observation promptly", async () => {
  const f = fixture(), controller = new AbortController();
  const verifier = new TailscaleEndpointSourceVerifier(f.transports, { lookup: async () => new Promise<never>(() => undefined) }, revision());
  const start = Date.now(), pending = verifier.observe(f.handle!, expected, controller.signal);
  controller.abort(); assert.equal(await pending, null); assert.ok(Date.now() - start < 500);
});
test("CLI requires explicit trusted executable and does not expose platform messages", async () => {
  assert.throws(() => new TailscaleCliWhoIs("tailscale"));
  await assert.rejects(new TailscaleCliWhoIs("/no/such/trusted/tailscale").lookup(peer, new AbortController().signal), { message: "TAILNET_LOCAL_API_UNAVAILABLE" });
});
