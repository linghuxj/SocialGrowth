import assert from "node:assert/strict";
import test from "node:test";
import { DevicePool } from "../apps/artemis-controller/src/device-pool.ts";
import { InMemoryReceiptStore } from "../apps/artemis-controller/src/receipt-store.ts";
import { TaskScheduler } from "../apps/artemis-controller/src/scheduler.ts";
import type {
  ExecutionAdapter,
  ExecutionReceipt,
  PublishTaskDirective,
} from "../apps/artemis-controller/src/types.ts";
import {
  FirstLoopEngine,
  createEmptyFirstLoopState,
} from "../apps/web-console/lib/first-loop/engine.ts";
import { buildPublishTaskDirective } from "../apps/web-console/lib/first-loop/integration.ts";
import type { CommandContext } from "../apps/web-console/lib/first-loop/types.ts";

class FailingAfterSubmitAdapter implements ExecutionAdapter {
  calls = 0;
  async execute(): Promise<ExecutionReceipt> {
    this.calls += 1;
    throw new Error("controlled receipt loss after submit boundary");
  }
}

function setupBusinessFlow() {
  let id = 0;
  const engine = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => "2026-09-20T02:00:00Z",
    nextId: (prefix) => `${prefix}-${++id}`,
  });
  const context: CommandContext = { actorId: "integration-tester", correlationId: "corr-fl06" };
  const project = engine.saveProjectDraft(
    {
      name: "完整受控闭环",
      clientId: "client-a",
      primaryGoal: "有效点击",
      audience: "英语受众",
      ownerId: "owner-a",
    },
    context,
  ).value!;
  engine.activateProject(project.id, context);
  engine.grantAccountServiceRelation(
    {
      accountId: "fb-a",
      projectId: project.id,
      clientId: "client-a",
      ownerPartyId: "company",
      authorizerPartyId: "client-a",
      authorizationRef: "auth://integration",
      allowedActions: ["publish"],
      allowedData: ["public_metrics"],
      validFrom: "2026-09-01T00:00:00Z",
    },
    context,
  );
  const admitted = engine.admitContent(
    {
      title: "集成内容",
      sourceRef: "source://integration",
      storySummary: "共同主剧情",
      asset: {
        language: "en-US",
        variant: "subtitle",
        fileRef: "asset://integration",
        sha256: "f".repeat(64),
        rightsRef: "rights://integration",
        destinationFit: "eligible",
      },
    },
    context,
  ).value!;
  engine.allocateContent(admitted.identity.id, "fb-a", 0, context);
  const destination = engine.createDestination(
    {
      projectId: project.id,
      accountId: "fb-a",
      scope: "content",
      scopeId: admitted.identity.id,
      url: "https://example.com/client-a",
      maintenancePermissionRef: "permission://integration",
      sharedAttribution: false,
      exitPolicy: "continue",
    },
    context,
  ).value!;
  engine.addStrategyRule(
    {
      projectId: project.id,
      category: "external_constraint",
      statement: "只执行批准的一条内容",
      sourceRef: "policy://integration",
    },
    context,
  );
  const draft = engine.generateStrategyDraft(
    { projectId: project.id, outputMode: "controlled", rationale: "完整受控流程", assumptions: [] },
    context,
  ).value!;
  const approval = engine.approveStrategy(
    {
      strategyDraftId: draft.id,
      expectedStrategyVersion: draft.version,
      quantity: 1,
      validFrom: "2026-09-20T01:00:00Z",
      validUntil: "2026-09-21T04:00:00Z",
      stopConditions: ["unknown 时停止"],
      observationConditions: ["记录有效点击"],
    },
    context,
  ).value!;
  const schedule = engine.scheduleApproval(
    {
      approvalId: approval.id,
      businessTimezone: "Asia/Shanghai",
      scheduledFor: "2026-09-20T03:00:00Z",
      expiresAt: "2026-09-20T04:00:00Z",
    },
    context,
  ).value!;
  return { engine, context, project, admitted, destination, approval, schedule };
}

void test("FL-06: controlled end-to-end flow preserves unknown, late evidence, observation, review and exit facts", async () => {
  const flow = setupBusinessFlow();
  const built = buildPublishTaskDirective(flow.engine.snapshot(), {
    approvalId: flow.approval.id,
    scheduleId: flow.schedule.id,
    taskId: "task-integration",
    attemptId: "attempt-integration",
    bindingId: "binding-integration",
    deviceId: "device-a",
    platform: "facebook",
    captionText: "受控测试",
    mediaUrl: "https://assets.example.com/integration",
    mediaExpiresAt: "2026-09-20T05:00:00Z",
    taskTimeoutMs: 120000,
  });
  assert.equal(built.ok, true);
  const task = built.value!;
  const pool = new DevicePool();
  pool.registerDevice({
    deviceId: "device-a",
    deviceType: "physical",
    model: "Samsung Galaxy S23",
    platformBound: ["facebook"],
    boundAccounts: ["fb-a"],
    status: "idle",
    lastHeartbeat: "2026-09-20T01:00:00Z",
  });
  const adapter = new FailingAfterSubmitAdapter();
  const scheduler = new TaskScheduler(pool, adapter, new InMemoryReceiptStore(), {
    now: () => "2026-09-20T03:00:00Z",
    nextId: () => "event-unknown",
    validateTask: (candidate) => ({ ok: candidate.approvalId === flow.approval.id }),
  });
  scheduler.enqueueTask(task);
  const unknown = await scheduler.dispatchNext();
  assert.equal(unknown?.publishStatus, "unknown");
  flow.engine.recordExecutionReceipt(
    {
      attemptId: task.attemptId,
      contentIdentityId: task.contentIdentityId,
      sliceId: task.sliceId,
      accountId: task.accountId,
      publishStatus: "unknown",
      evidenceRefs: [],
    },
    flow.context,
  );
  assert.equal(
    flow.engine.releaseContent(
      task.contentIdentityId,
      { approvalsInvalidated: true, schedulesInvalidated: true },
      flow.context,
    ).error?.code,
    "CONTENT_RESULT_UNRESOLVED",
  );

  const latePublished: ExecutionReceipt = {
    ...unknown!,
    eventId: "event-late",
    executionStatus: "completed",
    publishStatus: "published",
    evidenceRefs: ["evidence://public/post-1"],
    publishedPostId: "post-1",
    failureCode: undefined,
    resourceStatus: "available",
  };
  scheduler.recordLateReceipt(task, latePublished);
  flow.engine.recordExecutionReceipt(
    {
      attemptId: task.attemptId,
      contentIdentityId: task.contentIdentityId,
      sliceId: task.sliceId,
      accountId: task.accountId,
      publishStatus: "published",
      evidenceRefs: latePublished.evidenceRefs,
    },
    flow.context,
  );
  assert.ok(flow.engine.snapshot().contentIdentities[0]?.firstPublishedAt);
  assert.equal(adapter.calls, 1);

  flow.engine.recordDestinationEvent(
    {
      destinationEntryId: flow.destination.entry.id,
      destinationVersionId: flow.destination.version.id,
      eventType: "raw_visit",
      reasonCode: "REQUEST_RECEIVED",
    },
    flow.context,
  );
  flow.engine.recordMetricObservation(
    {
      projectId: flow.project.id,
      strategyVersion: flow.approval.strategyVersion,
      approvalId: flow.approval.id,
      metricKey: "valid_clicks",
      availability: "missing",
      source: "shortlink-v1",
      unit: "click",
      scope: "approved-content",
      windowStart: "2026-09-20T03:00:00Z",
      windowEnd: "2026-09-20T04:00:00Z",
      comparisonRole: "current",
      controlledData: true,
    },
    flow.context,
  );
  const review = flow.engine.createBasicReview(
    {
      projectId: flow.project.id,
      approvalId: flow.approval.id,
      primaryMetricKey: "valid_clicks",
      requiredWorkComplete: true,
      sourceComparisonAccepted: false,
    },
    flow.context,
  );
  assert.equal(review.value?.outcome, "evidence_insufficient");
  flow.engine.exitProject(flow.project.id, flow.context);
  const exited = flow.engine.snapshot();
  assert.equal(exited.projects[0]?.status, "exited");
  assert.ok(exited.accountServiceRelations[0]?.revokedAt);
  assert.equal(
    exited.destinationVersions.find((item) => item.id === flow.destination.version.id)?.isActive,
    true,
  );
  assert.equal(exited.auditLogs.at(-1)?.action, "project.exited");
});

void test("FL-06: content or destination changes invalidate old approval and scheduled execution", () => {
  const contentChange = setupBusinessFlow();
  contentChange.engine.admitContent(
    {
      identity: { id: contentChange.admitted.identity.id },
      title: "集成内容",
      sourceRef: "source://integration",
      storySummary: "共同主剧情",
      asset: {
        language: "es-ES",
        variant: "subtitle",
        fileRef: "asset://integration-es",
        sha256: "a".repeat(64),
        rightsRef: "rights://integration",
        destinationFit: "eligible",
      },
    },
    contentChange.context,
  );
  assert.equal(
    contentChange.engine.snapshot().executionApprovals[0]?.invalidationReason,
    "CONTENT_VERSION_CHANGED",
  );
  assert.equal(contentChange.engine.snapshot().publicationSchedules[0]?.status, "cancelled");

  const destinationChange = setupBusinessFlow();
  destinationChange.engine.updateDestination(
    destinationChange.destination.entry.id,
    {
      url: "https://example.com/client-a-v2",
      health: "available",
      changeReason: "客户目的地更新",
      permissionRef: "permission://integration",
    },
    destinationChange.context,
  );
  assert.equal(
    destinationChange.engine.snapshot().executionApprovals[0]?.invalidationReason,
    "DESTINATION_VERSION_CHANGED",
  );
});

void test("C-13/T-07: confirmed non-publication recovery stays on the approved account and references the prior attempt", () => {
  const flow = setupBusinessFlow();
  flow.engine.recordExecutionReceipt(
    {
      attemptId: "attempt-old",
      contentIdentityId: flow.admitted.identity.id,
      sliceId: flow.admitted.asset.id,
      accountId: "fb-a",
      publishStatus: "confirmed_not_published",
      evidenceRefs: ["evidence://explicit-rejection"],
    },
    flow.context,
  );
  const recovered = buildPublishTaskDirective(flow.engine.snapshot(), {
    approvalId: flow.approval.id,
    scheduleId: flow.schedule.id,
    taskId: "task-recovery",
    attemptId: "attempt-new",
    previousAttemptId: "attempt-old",
    bindingId: "binding-integration",
    deviceId: "device-a",
    platform: "facebook",
    captionText: "经人工确认后的原账号新尝试",
    mediaUrl: "https://assets.example.com/integration",
    mediaExpiresAt: "2026-09-20T05:00:00Z",
    taskTimeoutMs: 120000,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.value?.previousAttemptId, "attempt-old");
  assert.equal(recovered.value?.accountId, "fb-a");
  assert.equal(
    flow.engine.snapshot().publicationAttempts[0]?.publishStatus,
    "confirmed_not_published",
  );
});
