import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { BusinessPlanWorkflowScope } from "@socialgrowth/product-contracts";
import { BusinessPlanExecutionRuntime } from "./business-plan-execution-runtime.js";

// Isolated adapter checks with synthetic status responses, not phone or Web
// acceptance. No device operation, persistence or publication is performed.
function fixture() {
  const config = { url: "http://127.0.0.1:4318", token: "component-test-only", bindingId: randomUUID(),
    deviceId: "runtime-device", serial: "100.64.0.1:44444", productDeviceId: randomUUID(),
    productIdentityId: randomUUID(), canonicalIdentityRef: "123456789", accountId: randomUUID() };
  const scope: BusinessPlanWorkflowScope = {
    projectId: randomUUID(), taskId: randomUUID(), taskRevision: 1, planId: randomUUID(), planRevision: 1,
    projectVersion: 1, approvalId: randomUUID(), contentUnitId: randomUUID(), variantId: randomUUID(), materialRevision: 1,
    expectedFiles: [{ objectId: randomUUID(), sha256: "a".repeat(64), bytes: 128, contentType: "video/mp4" }],
    taskAttemptId: randomUUID(), identityId: config.productIdentityId, reservedDeviceId: config.productDeviceId,
    platform: "facebook", form: "facebook_video", scheduledAt: "2090-01-01T00:00:00.000Z",
  };
  let permits = 0;
  const runtime = new BusinessPlanExecutionRuntime(config,
    async () => ({ canonicalIdentityRef: config.canonicalIdentityRef, accountId: config.accountId, pageName: "Component Page", captionText: "Component caption" }),
    async () => ({ adapterState: "connected", businessState: "ready", scopeFingerprint: "b".repeat(64), blockers: [] }),
    async () => { permits++; return { permitId: randomUUID(), scopeFingerprint: "b".repeat(64), expiresAt: new Date(Date.now() + 5000).toISOString() }; },
    async () => { throw new Error("Asset reads must not occur in readiness checks"); });
  const status = {
    bindings: [{ id: config.bindingId, deviceId: config.deviceId, serial: config.serial, platform: "facebook", validUntil: new Date(Date.now() + 60000).toISOString() }],
    tasks: [] as Array<{ status: string; task: { binding: { deviceId: string; serial?: string } } }>,
    deviceHolds: [] as Array<{ device: string; actor: string }>,
    supervision: { controls: [] as Array<{ deviceId: string; taskId: string; state: string }>, requests: [] as Array<{ deviceId: string; taskId: string; status: string }> },
    pauses: [] as Array<{ scope: string; reason: string }>,
  };
  return { config, scope, status, ports: runtime.ports(), permits: () => permits };
}

test("all unresolved task states block readiness and action permission through every target identifier", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async (input: URL) => new Response(JSON.stringify(input.pathname.endsWith("/devices/states")
    ? { devices: [{ serial: f.config.serial, adbStatus: "device", status: "online" }] } : f.status)));
  for (const state of ["queued", "running", "unknown", "blocked"]) {
    for (const id of [f.config.deviceId, f.config.serial, f.config.productDeviceId]) {
      f.status.tasks = [{ status: state, task: { binding: { deviceId: id } } }];
      const result = await f.ports.readiness!.assess(f.scope);
      assert.equal(result.businessState, "blocked"); assert.ok(result.blockers.includes("runtime_device_task_active"));
      const operationId = randomUUID();
      f.status.deviceHolds = [{ device: f.config.deviceId, actor: operationId }];
      assert.equal(await f.ports.actionGate!.authorizeAction({ scope: f.scope, operationId, stepId: "read:identity", scopeFingerprint: "b".repeat(64) }), null);
      f.status.deviceHolds = [];
    }
  }
  f.status.tasks = [{ status: "unknown", task: { binding: { deviceId: "legacy-alias", serial: f.config.serial } } }];
  assert.equal((await f.ports.readiness!.assess(f.scope)).businessState, "blocked"); assert.equal(f.permits(), 0);
});

test("resolved history and unrelated device work do not block the reserved target", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async (input: URL) => new Response(JSON.stringify(input.pathname.endsWith("/devices/states")
    ? { devices: [{ serial: f.config.serial, adbStatus: "device", status: "online" }] } : f.status)));
  for (const state of ["completed", "failed", "cancelled"]) {
    f.status.tasks = [{ status: state, task: { binding: { deviceId: f.config.deviceId } } },
      { status: "unknown", task: { binding: { deviceId: "another-phone" } } }];
    assert.equal((await f.ports.readiness!.assess(f.scope)).businessState, "ready");
  }
});

test("central phone holds, pauses and responded assistance block the same physical target", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async (input: URL) => new Response(JSON.stringify(input.pathname.endsWith("/devices/states")
    ? { devices: [{ serial: f.config.serial, adbStatus: "device", status: "online" }] } : f.status)));
  f.status.deviceHolds = [{ device: f.config.productDeviceId, actor: "phone-initialization" }];
  assert.ok((await f.ports.readiness!.assess(f.scope)).blockers.includes("runtime_device_held"));
  f.status.deviceHolds = []; f.status.pauses = [{ scope: `device:${f.config.productDeviceId}`, reason: "original pause" }];
  assert.ok((await f.ports.readiness!.assess(f.scope)).blockers.includes("runtime_device_paused"));
  f.status.pauses = []; f.status.supervision.requests = [{ deviceId: f.config.productDeviceId, taskId: randomUUID(), status: "responded" }];
  assert.ok((await f.ports.readiness!.assess(f.scope)).blockers.includes("runtime_assistance_request_active"));
});

test("another reserved device or identity is rejected before runtime calls and asset reads", async t => {
  const f = fixture(); let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Must not call runtime for another target"); });
  for (const scope of [{ ...f.scope, reservedDeviceId: randomUUID() }, { ...f.scope, identityId: randomUUID() }]) {
    assert.ok((await f.ports.readiness!.assess(scope)).blockers.includes("runtime_target_scope_mismatch"));
  }
  await assert.rejects(f.ports.executor!.execute({ scope: { ...f.scope, reservedDeviceId: randomUUID() },
    operationId: randomUUID(), claimId: randomUUID(), authorizeAction: async () => null }), /EXECUTION_DEVICE_CONFIGURATION_MISMATCH/);
  await assert.rejects(f.ports.executor!.execute({ scope: { ...f.scope, identityId: randomUUID() },
    operationId: randomUUID(), claimId: randomUUID(), authorizeAction: async () => null }), /EXECUTION_IDENTITY_CONFIGURATION_MISMATCH/);
  assert.equal(requests, 0);
});

test("incomplete runtime status never establishes readiness", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async (input: URL) => new Response(JSON.stringify(input.pathname.endsWith("/devices/states")
    ? { devices: [{ serial: f.config.serial, adbStatus: "device", status: "online" }] } : { bindings: f.status.bindings })));
  const result = await f.ports.readiness!.assess(f.scope);
  assert.equal(result.businessState, "unknown"); assert.equal(result.adapterState, "unconnected");
  assert.ok(result.blockers.includes("runtime_device_inspector_unavailable"));
});
