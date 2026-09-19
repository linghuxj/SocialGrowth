import assert from "node:assert/strict";
import test from "node:test";
import { DevicePool } from "./device-pool.js";
import { InMemoryReceiptStore } from "./receipt-store.js";
import { TaskScheduler } from "./scheduler.js";
import type {
  DeviceInfo,
  ExecutionAdapter,
  ExecutionReceipt,
  PublishTaskDirective,
} from "./types.js";

function directive(overrides: Partial<PublishTaskDirective> = {}): PublishTaskDirective {
  return {
    schemaVersion: "design-v1",
    taskId: "task-1",
    attemptId: "attempt-1",
    projectId: "project-1",
    strategyVersionId: "strategy-v1",
    approvalId: "approval-1",
    bindingId: "binding-1",
    deviceId: "device-a",
    accountId: "account-a",
    platform: "facebook",
    targetAppPackage: "com.facebook.katana",
    contentIdentityId: "content-1",
    sliceId: "slice-1",
    media: {
      url: "https://assets.test/file",
      sha256: "a".repeat(64),
      expiresAt: "2026-09-21T00:00:00Z",
    },
    captionText: "受控测试",
    destinationVersionId: "destination-v1",
    scheduledAt: "2026-09-19T00:00:00Z",
    expiresAt: "2026-09-20T00:00:00Z",
    timeZone: "Asia/Shanghai",
    steps: [],
    taskTimeoutMs: 120000,
    ...overrides,
  };
}

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    deviceId: "device-a",
    deviceType: "physical",
    model: "Samsung Galaxy S23",
    platformBound: ["facebook"],
    boundAccounts: ["account-a"],
    status: "idle",
    lastHeartbeat: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

function receipt(
  task: PublishTaskDirective,
  overrides: Partial<ExecutionReceipt> = {},
): ExecutionReceipt {
  return {
    schemaVersion: "design-v1",
    eventId: "event-1",
    taskId: task.taskId,
    attemptId: task.attemptId,
    deviceId: task.deviceId,
    accountId: task.accountId,
    occurredAt: "2026-09-19T01:00:00Z",
    executionStatus: "completed",
    publishStatus: "published",
    evidenceRefs: ["evidence://post/1"],
    publishedPostId: "post-1",
    resourceStatus: "available",
    ...overrides,
  };
}

class FakeAdapter implements ExecutionAdapter {
  calls = 0;
  constructor(
    private readonly handler: (
      task: PublishTaskDirective,
    ) => ExecutionReceipt | Promise<ExecutionReceipt>,
  ) {}
  async execute(task: PublishTaskDirective): Promise<ExecutionReceipt> {
    this.calls += 1;
    return this.handler(task);
  }
}

function scheduler(adapter: ExecutionAdapter, devices: DeviceInfo[] = [device()]) {
  const pool = new DevicePool();
  for (const item of devices) pool.registerDevice(item);
  return new TaskScheduler(pool, adapter, new InMemoryReceiptStore(), {
    now: () => "2026-09-19T01:00:00Z",
    nextId: () => "generated-event",
  });
}

void test("T-01/C-05: task waits for its exact physical account-bound device and never borrows another", async () => {
  const task = directive();
  const adapter = new FakeAdapter((value) => receipt(value));
  const controller = scheduler(adapter, [
    device({ deviceId: "device-a", status: "busy" }),
    device({ deviceId: "device-b", boundAccounts: ["account-a"] }),
  ]);
  assert.equal(controller.enqueueTask(task), true);
  assert.equal(await controller.dispatchNext(), null);
  assert.equal(controller.getPendingCount(), 1);
  assert.equal(adapter.calls, 0);
  assert.equal(controller.listAuditEntries().at(-1)?.reasonCode, "EXACT_BOUND_DEVICE_UNAVAILABLE");
});

void test("T-06/T-08: duplicate delivery submits once and published fact survives later failure", async () => {
  const task = directive();
  const adapter = new FakeAdapter((value) => receipt(value));
  const controller = scheduler(adapter);
  assert.equal(controller.enqueueTask(task), true);
  assert.equal(controller.enqueueTask(task), false);
  const first = await controller.dispatchNext();
  assert.equal(first?.publishStatus, "published");
  assert.equal(adapter.calls, 1);
  assert.equal(controller.enqueueTask(task), false);
  const lateFailure = receipt(task, {
    eventId: "late-failure",
    executionStatus: "failed",
    publishStatus: "confirmed_not_published",
    evidenceRefs: ["evidence://failure"],
  });
  assert.equal(controller.recordLateReceipt(task, lateFailure).publishStatus, "published");
});

void test("T-05/T-07: technical exception becomes unknown and late public evidence updates history without resubmission", async () => {
  const task = directive();
  const adapter = new FakeAdapter(() => {
    throw new Error("connection lost after tap");
  });
  const controller = scheduler(adapter);
  controller.enqueueTask(task);
  const unknown = await controller.dispatchNext();
  assert.equal(unknown?.publishStatus, "unknown");
  assert.equal(unknown?.failureCode, "TECHNICAL_FAILURE");
  const published = controller.recordLateReceipt(task, receipt(task, { eventId: "late-public" }));
  assert.equal(published.publishStatus, "published");
  assert.equal(adapter.calls, 1);
});

void test("C-09/T-09: challenge pauses the binding and resume requires all business checks", async () => {
  const task = directive();
  const adapter = new FakeAdapter((value) =>
    receipt(value, {
      executionStatus: "blocked",
      publishStatus: "not_submitted",
      failureCode: "IDENTITY_CHALLENGE",
      challengeType: "2fa",
      evidenceRefs: [],
    }),
  );
  const controller = scheduler(adapter);
  controller.enqueueTask(task);
  await controller.dispatchNext();
  assert.equal(
    controller.enqueueTask(directive({ taskId: "task-2", attemptId: "attempt-2" })),
    false,
  );
  assert.equal(
    controller.resumeBinding("binding-1", {
      challengeResolved: true,
      authorizationValid: true,
      scheduleStillValid: false,
    }),
    false,
  );
  assert.equal(
    controller.resumeBinding("binding-1", {
      challengeResolved: true,
      authorizationValid: true,
      scheduleStillValid: true,
    }),
    true,
  );
  assert.equal(
    controller.enqueueTask(directive({ taskId: "task-2", attemptId: "attempt-2" })),
    true,
  );
});
