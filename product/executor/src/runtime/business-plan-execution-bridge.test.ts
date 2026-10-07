import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RuntimeStore } from "./store.js";
import { HumanAssistance } from "./human-assistance.js";
import { BusinessPlanExecutionBridge, type BusinessPlanExecutionBridgeConfig } from "./business-plan-execution-bridge.js";

test("a resumed audit and content phase retain the latest trace when a stale launch snapshot finishes", () => {
  const store = new RuntimeStore(":memory:"), assistance = new HumanAssistance(store);
  const config: BusinessPlanExecutionBridgeConfig = {
    dataDir: "/unused", artemisRoot: "/unused", runtimeUrl: "http://127.0.0.1:1", token: "test-only",
    deviceId: "phone", serial: "phone", bindingId: "binding", productDeviceId: randomUUID(),
    productIdentityId: randomUUID(), canonicalIdentityRef: "test", accountId: randomUUID(), runtimeAccountId: "test",
    pageName: "Test Page", callbackUrl: "http://127.0.0.1:1",
  };
  const bridge = new BusinessPlanExecutionBridge(store, assistance, config);
  // Exercise the store write used by real callbacks and terminal receipts.
  // No device, network, simulated publication or successful business state.
  const writer = bridge as unknown as { update(record: Record<string, unknown>, newTrace?: boolean): unknown };
  const stale = { operationId: randomUUID(), state: "unknown", traceId: randomUUID(), receipt: null,
    diagnostic: { phase: "identity_audit", reason: "EXECUTION_TIMEOUT" } };
  store.db.prepare("INSERT INTO business_plan_executions VALUES(?,?,?)").run(stale.operationId, JSON.stringify(stale), "test");
  try {
    const auditTrace = randomUUID(), contentTrace = randomUUID();
    writer.update({ ...stale, traceId: auditTrace }, true);
    writer.update(stale);
    assert.equal(bridge.read(stale.operationId)?.traceId, auditTrace);
    writer.update({ ...stale, traceId: contentTrace }, true);
    writer.update({ ...stale, traceId: null });
    assert.equal(bridge.read(stale.operationId)?.traceId, contentTrace);
    writer.update(stale);
    assert.equal(bridge.read(stale.operationId)?.traceId, contentTrace);
  } finally { assistance.close(); store.close(); }
});
