import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import type { OperatorAuthService } from "./operator-auth-service.js";
import { ProductTransactionError } from "./product-transaction-error.js";
import { ExecutorConsoleService } from "./executor-console-service.js";

const auth = { authenticateSession: async (token: string, csrf?: string) => {
  if (token !== "valid-session" || (csrf !== undefined && csrf !== "valid-csrf")) throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Rejected");
  return {} as Awaited<ReturnType<OperatorAuthService["authenticateSession"]>>;
} };
test("executor bridge rejects unauthenticated reads and missing/wrong CSRF before contacting execution", async () => {
  const service = new ExecutorConsoleService(auth, { url: "http://127.0.0.1:1", token: "never-sent" });
  await assert.rejects(service.read("invalid"), /Rejected/);
  await assert.rejects(service.mutate("valid-session", "", "verifications", {}), /操作凭据/);
  await assert.rejects(service.mutate("valid-session", "wrong-csrf", "verifications", {}), /Rejected/);
});
test("unconfigured execution is explicit and does not fabricate tasks", async () => {
  const service = new ExecutorConsoleService(auth, null);
  assert.deepEqual(await service.read("valid-session"), { automaticPhoneInitialization: false, configured: false, available: false, bootstrapDevices: [], tasks: [], holds: [], jobs: [], requests: [], challenges: [] });
});
test("authenticated projection preserves unknown task/hold facts and strips internal capabilities", async () => {
  // Synthetic HTTP fixture, supplementary projection test; no phone or acceptance claim.
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    assert.equal(req.url, "/api/runtime/status"); assert.equal(req.headers.authorization, "Bearer private-runtime-key");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ tasks: [{ taskId: "original-task", status: "unknown", task: { token: "must-not-leak" } }],
      deviceHolds: [{ device: "fixed-device", actor: "original-operation", since: "2026-10-06T00:00:00Z" }],
      verificationOptions: { available: false }, verifications: [{ id: "old-job", requestId: "11111111-1111-4111-8111-111111111111",
        deviceId: "fixed-device", status: "interrupted", expectedName: "historical fixture", expectedProfileId: "12345", startedAt: "2026-09-20T00:00:00Z" }],
      assistance: [], supervision: { requests: [] }, token: "must-not-leak" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const service = new ExecutorConsoleService(auth, { url: `http://127.0.0.1:${address.port}`, token: "private-runtime-key" });
    const projection = await service.read("valid-session");
    assert.deepEqual(projection.tasks, [{ id: "original-task", status: "unknown" }]);
    assert.equal(projection.holds[0]?.actor, "original-operation"); assert.equal(requests, 1);
    assert.equal(projection.jobs[0]?.mode, "unknown", "Old missing mode remains unknown, not a fabricated current mode");
    assert.doesNotMatch(JSON.stringify(projection), /private-runtime-key|must-not-leak/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("automatic connection dispatch retains request identity through unknown responses and only hands off a verified completed setup", async () => {
  const deviceId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
  const bodies: Record<string, unknown>[] = [];
  let handoffs = 0, connected = true;
  const server = createServer(async (req, res) => {
    let data = ""; for await (const chunk of req) data += chunk;
    bodies.push(JSON.parse(data));
    assert.equal(req.url, "/api/runtime/phone-initializations");
    assert.equal(req.headers.authorization, "Bearer private-runtime-key");
    res.setHeader("content-type", "application/json");
    if (bodies.length === 1) { res.statusCode = 503; res.end('{"ok":false}'); return; }
    res.end(JSON.stringify({ ok: true, value: { deviceId, status: "finished", resultCode: bodies.length === 2 ? "UNCONFIRMED" : "CONNECTIVITY_SETUP_COMPLETED",
      managementAddress: "100.95.1.2", stability: { observedSeconds: 300, transport: "tailnet_and_bootstrap" } } }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const addr = server.address(); assert.ok(addr && typeof addr === "object");
  let epoch = "33333333-3333-4333-8333-333333333333";
  const target = () => ({ deviceId, requestId, sessionId: epoch, serial: "127.0.0.1:23456", hardwareSerial: "TEST_PHONE", wirelessPort: 37111 });
  const connections = { bootstrapDevices: async () => [{ deviceId, connected, mode: "bootstrap" as const }],
    preparationTarget: async () => target(), initializationTarget: async () => target(),
    handoffBootstrap: async (id: string, ip: string) => { assert.equal(id, deviceId); assert.equal(ip, "100.95.1.2"); handoffs++; } };
  try {
    const config = { url: `http://127.0.0.1:${addr.port}`, token: "private-runtime-key" };
    await new ExecutorConsoleService(auth, config, connections).initializeConnectedPhones(); assert.equal(bodies.length, 0);
    const service = new ExecutorConsoleService(auth, config, connections, true);
    await service.initializeConnectedPhones(); assert.equal(handoffs, 0);
    epoch = "44444444-4444-4444-8444-444444444444";
    await service.initializeConnectedPhones(); assert.equal(handoffs, 0);
    await service.initializeConnectedPhones(); assert.equal(handoffs, 1);
    assert.equal(new Set(bodies.map(b => b.requestId)).size, 1, "Uncertain or reconnecting transport never creates a new task identity");
    connected = false; await service.initializeConnectedPhones(); assert.equal(bodies.length, 3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
