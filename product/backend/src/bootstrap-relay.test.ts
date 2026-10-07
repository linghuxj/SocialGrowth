import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { BootstrapRelay, type BootstrapScope } from "./bootstrap-relay.js";

// Real local TCP/WebSocket protocol tests with isolated authentication.
// They do not claim Android, production authentication or first-pair acceptance.
async function fixture(t: { after(fn: () => void): void }) {
  const server = createServer(), relay = new BootstrapRelay(true);
  const scope: BootstrapScope = { deviceId: randomUUID(), providerId: randomUUID(), installationId: randomUUID(),
    installationGeneration: "1", ownershipVersion: "1", factVersion: "1", associationId: randomUUID() };
  let valid = true;
  relay.attach(server, async token => { if (token !== "test-installation-token" || !valid) throw new Error("DENIED"); return scope; });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address(); assert.ok(bound && typeof bound !== "string");
  const url = `ws://127.0.0.1:${bound.port}/api/installation/bootstrap`;
  t.after(() => { relay.onModuleDestroy(); server.close(); });
  const open = async () => {
    const ws = new WebSocket(url, { headers: { authorization: "Installation test-installation-token" } });
    const [raw] = await once(ws, "message");
    assert.equal(JSON.parse(String(raw)).type, "ready");
    t.after(() => ws.terminate()); return ws;
  };
  return { relay, scope, url, open, revoke() { valid = false; } };
}

test("rejects unauthenticated upgrade and query-string credentials", async t => {
  const f = await fixture(t);
  for (const url of [f.url, f.url + "?token=test-installation-token"]) {
    const ws = new WebSocket(url); const closed = new Promise<void>(resolve => ws.once("close", () => resolve())); ws.on("error", () => {}); await closed;
    assert.equal(f.relay.current(f.scope), null);
  }
});

test("relay is loopback-only, preserves bytes with ACK flow control, isolates scope and withdraws ports", async t => {
  const f = await fixture(t), ws = await f.open();
  const network = f.relay.current(f.scope); assert.ok(network);
  assert.equal(f.relay.current({ ...f.scope, installationId: randomUUID() }), null);
  assert.throws(() => f.relay.target(network, "connect", 41000));
  f.relay.report(network, 42000, 41000);
  const target = f.relay.target(network, "connect", 41000);
  assert.equal(target.address, "127.0.0.1"); assert.notEqual(target.port, 41000);
  const chunks: Buffer[] = [];
  ws.on("message", raw => {
    const msg = JSON.parse(String(raw));
    if (msg.type === "open") { assert.equal(msg.purpose, "connect"); assert.equal(msg.port, 41000); }
    if (msg.type === "data") {
      chunks.push(Buffer.from(msg.data, "base64"));
      ws.send(JSON.stringify({ type: "ack", id: msg.id }));
      ws.send(JSON.stringify({ type: "data", id: msg.id, data: msg.data }));
    }
  });
  const tcp = connect(target.port, target.address); t.after(() => tcp.destroy()); await once(tcp, "connect");
  const received: Buffer[] = [];
  const payload = Buffer.alloc(100_000, 0x7a);
  const echoed = new Promise<void>(resolve => tcp.on("data", bytes => { received.push(bytes); if (Buffer.concat(received).length === payload.length) resolve(); }));
  tcp.write(payload); await echoed;
  assert.deepEqual(Buffer.concat(chunks), payload); assert.deepEqual(Buffer.concat(received), payload);
  const closed = once(tcp, "close"); f.relay.report(network, null, null); await closed;
  assert.throws(() => f.relay.target(network, "connect", 41000));
});

test("new session invalidates old mappings; revocation closes active session", async t => {
  const f = await fixture(t), first = await f.open(), old = f.relay.current(f.scope); assert.ok(old);
  const closed = once(first, "close"); const second = await f.open(); await closed;
  assert.throws(() => f.relay.report(old, null, 41000));
  const revoked = once(second, "close"); f.revoke(); await revoked;
  assert.equal(f.relay.current(f.scope), null);
});

test("handoff is delivered before closure and no bootstrap mapping survives", async t => {
  const f = await fixture(t), ws = await f.open(), current = f.relay.current(f.scope); assert.ok(current);
  const message = once(ws, "message"), closed = once(ws, "close");
  f.relay.handoff(current);
  const [raw] = await message; assert.equal(JSON.parse(String(raw)).type, "managed");
  await closed; assert.equal(f.relay.current(f.scope), null);
});
