import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { BootstrapManagement } from "./bootstrap-management.js";

const scope = { deviceId: "device", providerId: "provider", installationId: "installation", installationGeneration: "1", ownershipVersion: "2", factVersion: "2" };
function fixture() {
  const node = { StableID: "bound-node", Key: `nodekey:${"a".repeat(64)}`, Online: true, KeyExpiry: "0001-01-01T00:00:00Z", Addresses: ["100.64.0.7/32"] };
  const pool = { query: async (_sql: string, args: string[]) => ({ rows: args[1] === scope.installationId && args[2] === "1" && args[3] === "2"
    ? [{ node_id: "bound-node", node_key: `nodekey:${"a".repeat(64)}`, address: "100.64.0.7" }] : [] }) } as unknown as Pool;
  let calls = 0;
  const authority = new BootstrapManagement(pool, { lookup: async () => { calls++; return { Node: node }; } });
  return { authority, node, calls: () => calls };
}
test("managed binding requires the current installation, live pinned node and key; grants no formal admission", async () => {
  const f = fixture();
  const current = await f.authority.readCurrent(scope);
  assert.equal(current?.mode, "managed_verified"); assert.equal(current?.enrollmentId, null); assert.equal(current?.networkRevision, null);
  assert.equal(await f.authority.readCurrent({ ...scope, installationGeneration: "2" }), null);
  assert.equal(await f.authority.readCurrent({ ...scope, ownershipVersion: "3" }), null);
  f.node.Online = false; assert.equal(await f.authority.readCurrent(scope), null);
  f.node.Online = true; f.node.Key = `nodekey:${"b".repeat(64)}`; assert.equal(await f.authority.readCurrent(scope), null);
});
test("management address validation prevents LAN, public and hostname probes", async () => {
  const f = fixture();
  for (const address of ["127.0.0.1", "10.0.0.1", "8.8.8.8", "phone.example", "100.128.0.1", "fd7a:115c:a1e0::1"])
    await assert.rejects(f.authority.observe(address));
  assert.equal(f.calls(), 0);
});
