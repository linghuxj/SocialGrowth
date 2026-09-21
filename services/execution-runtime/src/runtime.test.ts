import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { DatabaseSync } from "node:sqlite";
import { runAgentOnce } from "./agent-cli.ts";
import { RuntimeStore } from "./store.ts";
import { ExecutionRuntime } from "./runtime.ts";
import { createRuntimeServer } from "./server.ts";
import {
  FirstLoopEngine,
  createEmptyFirstLoopState,
} from "../../../apps/web-console/lib/first-loop/engine.ts";
import type { ExecutionReceipt } from "../../../apps/artemis-controller/src/types.ts";
import { executeDeviceTask } from "./device-executor.ts";
import { inspectPreparation } from "./preparation.ts";
import { runWorker } from "./worker-cli.ts";

test("daily strategy without traffic destination can enter the runtime queue", () => {
  const f = setup();
  try {
    const { state } = f.store.snapshot();
    for (const draft of state.strategyDrafts) {
      draft.templateId = "daily_clip";
      delete draft.destinationVersionId;
    }
    for (const approval of state.executionApprovals) delete approval.destinationVersionId;
    state.destinationVersions = [];
    f.store.save(state);
    const task = f.runtime.enqueue(f.settings, "tester");
    assert.equal(task.directive.destinationVersionId, undefined);
  } finally {
    f.store.close();
  }
});

test("preparation waits preserve approval; same-scope human repair resumes exactly once", () => {
  const f = setup();
  try {
    const task = f.runtime.enqueue(f.settings, "tester");
    f.advance("2026-09-20T02:00:00.000Z");
    assert.equal(f.runtime.pull("phone"), null);
    const lease = f.runtime.pullPreparation("phone")!;
    assert.ok(lease);
    assert.equal(f.runtime.pullPreparation("phone"), null);
    assert.throws(() => f.runtime.holdDevice("phone", true, "tester"), /DEVICE_PREPARATION_ACTIVE/);
    f.runtime.reportPreparation("phone", task.directive.taskId, lease.lease, {
      status: "waiting",
      reason: "LOGIN_REQUIRED",
      observedAt: f.runtime.now(),
    });
    assert.equal(f.store.snapshot().state.publicationAttempts.length, 0);
    assert.equal(f.store.snapshot().state.executionApprovals[0].status, "active");
    assert.equal(f.runtime.pullPreparation("phone"), null);
    f.runtime.holdDevice("phone", true, "tester");
    f.advance("2026-09-20T02:01:00.000Z");
    assert.equal(f.runtime.pullPreparation("phone"), null);
    f.runtime.holdDevice("phone", false, "tester");
    assert.ok(prepareAndStart(f.runtime));
    assert.equal(f.store.snapshot().state.publicationAttempts.length, 1);
    assert.equal(f.runtime.pullPreparation("phone"), null);
    assert.throws(() => f.runtime.holdDevice("phone", true, "tester"), /DEVICE_EXECUTION_ACTIVE/);
  } finally {
    f.store.close();
  }
});

test("expired preparation lease is repeatable; late report and stale ready proof cannot launch", () => {
  const f = setup();
  try {
    f.runtime.enqueue(f.settings, "tester");
    f.advance("2026-09-20T02:00:00.000Z");
    const first = f.runtime.pullPreparation("phone")!;
    f.advance("2026-09-20T02:11:00.000Z");
    const second = f.runtime.pullPreparation("phone")!;
    assert.notEqual(first.lease, second.lease);
    const report = {
      status: "ready",
      reason: "IDENTITY_VISIBLE",
      observedAt: f.runtime.now(),
      observationSha256: "a".repeat(64),
    };
    assert.throws(
      () => f.runtime.reportPreparation("phone", first.task.directive.taskId, first.lease, report),
      /PREPARATION_LEASE_INVALID/,
    );
    f.runtime.reportPreparation("phone", second.task.directive.taskId, second.lease, report);
    f.advance("2026-09-20T02:12:00.000Z");
    assert.throws(
      () => f.runtime.pull("phone", { taskId: second.task.directive.taskId, lease: second.lease }),
      /PREPARATION_REQUIRED/,
    );
    assert.equal(f.store.snapshot().state.publicationAttempts.length, 0);
  } finally {
    f.store.close();
  }
});

for (const change of ["caption", "binding", "approval", "expired"] as const)
  test(`preparation never resumes after ${change} changes`, () => {
    const f = setup();
    try {
      const task = f.runtime.enqueue(f.settings, "tester");
      f.advance("2026-09-20T02:00:00.000Z");
      const lease = f.runtime.pullPreparation("phone")!;
      f.runtime.reportPreparation("phone", task.directive.taskId, lease.lease, {
        status: "waiting",
        reason: "LOGIN_REQUIRED",
        observedAt: f.runtime.now(),
      });
      if (change === "caption") {
        task.settings.captionText = "changed";
        f.store.db
          .prepare("UPDATE tasks SET body=? WHERE id=?")
          .run(JSON.stringify(task), task.directive.taskId);
      } else if (change === "binding") {
        f.store.db
          .prepare("UPDATE bindings SET body=? WHERE id=?")
          .run(
            JSON.stringify({ ...task.binding, platformIdentity: "https://www.facebook.com/other" }),
            task.binding.id,
          );
      } else if (change === "approval") {
        const { state } = f.store.snapshot();
        state.executionApprovals[0].status = "invalidated";
        f.store.save(state);
      }
      f.advance(change === "expired" ? "2026-09-20T03:01:00.000Z" : "2026-09-20T02:01:00.000Z");
      assert.equal(f.runtime.pullPreparation("phone"), null);
      assert.equal(f.runtime.tasks()[0].status, "blocked");
      assert.equal(f.store.snapshot().state.publicationAttempts.length, 0);
    } finally {
      f.store.close();
    }
  });

test("passive preparation requires target foreground and exact identity; error beats matching URL", async () => {
  const f = setup();
  try {
    const task = f.runtime.enqueue(f.settings, "tester");
    let observed = task.binding.platformIdentity;
    let foreground = task.directive.targetAppPackage;
    const ports = {
      ensureApp: async () => {},
      foreground: async () => foreground,
      observe: async () => observed,
    };
    assert.equal((await inspectPreparation(task, ports)).status, "ready");
    observed += "-wrong";
    assert.equal((await inspectPreparation(task, ports)).reason, "IDENTITY_NOT_VISIBLE");
    observed = `登入您的帳戶時發生問題 ${task.binding.platformIdentity}`;
    assert.equal((await inspectPreparation(task, ports)).reason, "LOGIN_REQUIRED");
    observed = "Error: device unavailable";
    assert.equal((await inspectPreparation(task, ports)).reason, "OBSERVER_UNAVAILABLE");
    foreground = "com.android.settings";
    assert.equal((await inspectPreparation(task, ports)).reason, "TARGET_APP_NOT_VISIBLE");
  } finally {
    f.store.close();
  }
});

test("bounded worker retries checks sequentially and exits normally", async () => {
  let calls = 0;
  await runWorker({
    signal: new AbortController().signal,
    intervalMs: 1,
    cycles: 3,
    once: async () => {
      calls++;
    },
  });
  assert.equal(calls, 3);
});

test("waiting preparation and manual hold survive database restart without creating attempts", () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-preparation-restart-"));
  const path = join(dir, "runtime.sqlite");
  const f = setup(new RuntimeStore(path));
  try {
    f.runtime.enqueue(f.settings, "tester");
    f.advance("2026-09-20T02:00:00.000Z");
    const lease = f.runtime.pullPreparation("phone")!;
    f.runtime.reportPreparation("phone", lease.task.directive.taskId, lease.lease, {
      status: "waiting",
      reason: "LOGIN_REQUIRED",
      observedAt: f.runtime.now(),
    });
    f.runtime.holdDevice("phone", true, "tester");
    f.store.close();
    const store = new RuntimeStore(path);
    try {
      const runtime = new ExecutionRuntime(store, {
        mediaBaseUrl: "http://127.0.0.1",
        signingKey: "k".repeat(32),
        hasAsset: () => true,
        now: () => "2026-09-20T02:01:00.000Z",
      });
      assert.equal(runtime.pullPreparation("phone"), null);
      assert.equal(runtime.preparations()[0].report.reason, "LOGIN_REQUIRED");
      assert.equal(store.snapshot().state.publicationAttempts.length, 0);
      runtime.holdDevice("phone", false, "tester");
      assert.ok(prepareAndStart(runtime));
      assert.equal(store.snapshot().state.publicationAttempts.length, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live ledger owner prevents a second process from replaying its in-flight outbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-agent-owner-"));
  const path = join(dir, "agent.sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE agent_owner (id INTEGER PRIMARY KEY, pid INTEGER, token TEXT)");
  db.prepare("INSERT INTO agent_owner VALUES (1,?,?)").run(process.pid, "other-owner");
  db.close();
  try {
    await assert.rejects(
      runAgentOnce({
        runtimeUrl: "http://127.0.0.1:1",
        token: "unused",
        deviceId: "phone",
        artemisRoot: "/missing",
        ledgerPath: path,
      }),
      /AGENT_ALREADY_RUNNING/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setup(store = new RuntimeStore(":memory:"), digest = "a".repeat(64)) {
  let clock = "2026-09-20T01:00:00.000Z";
  let seq = 0;
  const engine = new FirstLoopEngine(createEmptyFirstLoopState(), {
    now: () => clock,
    nextId: (p) => `${p}-${++seq}`,
  });
  const context = { actorId: "tester", correlationId: "test" };
  const client = engine.registerClient("Test client", context).value!;
  const account = engine.registerAccount(
    {
      name: "Test page",
      platform: "facebook",
      owner: "owner",
      positioning: "test",
      deviceRef: "phone",
    },
    context,
  ).value!;
  const project = engine.saveProjectDraft(
    { name: "test", clientId: client.id, primaryGoal: "views", audience: "test", ownerId: "owner" },
    context,
  ).value!;
  engine.activateProject(project.id, context);
  engine.grantAccountServiceRelation(
    {
      accountId: account.id,
      projectId: project.id,
      clientId: client.id,
      ownerPartyId: "owner",
      authorizerPartyId: "owner",
      authorizationRef: "auth",
      allowedActions: ["publish"],
      allowedData: ["public_metrics"],
      validFrom: "2026-09-01T00:00:00Z",
    },
    context,
  );
  const admitted = engine.admitContent(
    {
      title: "test",
      sourceRef: "source",
      storySummary: "story",
      asset: {
        language: "en",
        variant: "master",
        fileRef: `runtime-asset:${digest}`,
        sha256: digest,
        rightsRef: "rights",
        destinationFit: "eligible",
      },
    },
    context,
  ).value!;
  engine.allocateContent(admitted.identity.id, account.id, 0, context);
  engine.createDestination(
    {
      projectId: project.id,
      accountId: account.id,
      scope: "content",
      scopeId: admitted.identity.id,
      url: "https://example.com",
      maintenancePermissionRef: "permission",
      sharedAttribution: false,
      exitPolicy: "continue",
    },
    context,
  );
  engine.addStrategyRule(
    { projectId: project.id, category: "internal_rule", statement: "test", sourceRef: "policy" },
    context,
  );
  const draft = engine.generateStrategyDraft(
    { projectId: project.id, outputMode: "controlled", rationale: "test", assumptions: [] },
    context,
  ).value!;
  assert.ok(draft);
  const approval = engine.approveStrategy(
    {
      strategyDraftId: draft.id,
      expectedStrategyVersion: draft.version,
      quantity: 1,
      validFrom: clock,
      validUntil: "2026-09-21T00:00:00Z",
      stopConditions: ["unknown"],
      observationConditions: ["views"],
    },
    context,
  ).value!;
  const schedule = engine.scheduleApproval(
    {
      approvalId: approval.id,
      businessTimezone: "Asia/Shanghai",
      scheduledFor: "2026-09-20T02:00:00Z",
      expiresAt: "2026-09-20T03:00:00Z",
    },
    context,
  ).value!;
  assert.ok(schedule);
  store.save(engine.snapshot());
  const runtime = new ExecutionRuntime(store, {
    mediaBaseUrl: "http://127.0.0.1:4318",
    signingKey: "k".repeat(32),
    now: () => clock,
    hasAsset: () => true,
  });
  runtime.bind(
    {
      id: "binding",
      deviceId: "phone",
      serial: "RFC_TEST",
      platform: "facebook",
      accountId: account.id,
      platformIdentity: "https://www.facebook.com/test-page",
      authorizationRef: "auth",
      automationScopeRef: "scope",
      verifiedAt: clock,
      validUntil: "2026-09-21T00:00:00Z",
    },
    "tester",
  );
  const settings = {
    scheduleId: schedule.id,
    sliceId: admitted.asset.id,
    bindingId: "binding",
    mode: "preflight" as const,
    captionText: "test",
    audience: "public" as const,
    aiLabel: true,
    aiLabelReason: "test",
    rightsRef: "rights",
    musicRightsRef: "music",
    taskTimeoutMs: 1000,
  };
  return {
    runtime,
    store,
    settings,
    advance: (value: string) => {
      clock = value;
    },
    account,
    approval,
    schedule,
  };
}
function receipt(
  f: ReturnType<typeof setup>,
  changes: Partial<ExecutionReceipt> = {},
): ExecutionReceipt {
  const task = f.runtime.tasks()[0].task;
  return {
    schemaVersion: "design-v1",
    eventId: randomUUID(),
    taskId: task.directive.taskId,
    attemptId: task.directive.attemptId,
    deviceId: "phone",
    accountId: f.account.id,
    occurredAt: "2026-09-20T02:00:00Z",
    executionStatus: "failed",
    publishStatus: "unknown",
    evidenceRefs: [],
    failureCode: "TECHNICAL_FAILURE",
    resourceStatus: "error",
    ...changes,
  };
}
function claim(f: ReturnType<typeof setup>) {
  const task = f.runtime.enqueue(f.settings, "tester");
  f.advance("2026-09-20T02:00:00Z");
  assert.ok(prepareAndStart(f.runtime));
  return task;
}
function prepareAndStart(runtime: ExecutionRuntime) {
  const lease = runtime.pullPreparation("phone");
  assert.ok(lease);
  runtime.reportPreparation("phone", lease.task.directive.taskId, lease.lease, {
    status: "ready",
    reason: "IDENTITY_VISIBLE",
    observedAt: runtime.now(),
    observationSha256: "a".repeat(64),
  });
  return runtime.pull("phone", { taskId: lease.task.directive.taskId, lease: lease.lease });
}

test("durable queue: future schedule, exact device, duplicate enqueue, claim once and restart recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-runtime-test-"));
  const path = join(dir, "db.sqlite");
  const f = setup(new RuntimeStore(path));
  try {
    const task = f.runtime.enqueue(f.settings, "tester");
    assert.equal(
      f.runtime.enqueue(f.settings, "tester").directive.attemptId,
      task.directive.attemptId,
    );
    assert.throws(
      () => f.runtime.enqueue({ ...f.settings, captionText: "changed" }, "tester"),
      /ID_CONFLICT/,
    );
    assert.equal(f.runtime.pull("phone"), null);
    f.advance("2026-09-20T02:00:00Z");
    assert.equal(f.runtime.pull("other"), null);
    assert.ok(prepareAndStart(f.runtime));
    assert.equal(f.runtime.pull("phone"), null);
    f.store.close();
    const reopened = new RuntimeStore(path);
    const runtime = new ExecutionRuntime(reopened, {
      mediaBaseUrl: "http://127.0.0.1",
      signingKey: "k".repeat(32),
      now: () => "2026-09-20T02:01:00Z",
      hasAsset: () => true,
    });
    assert.equal(runtime.pull("phone"), null);
    assert.equal(runtime.tasks()[0].receipt?.publishStatus, "unknown");
    assert.ok(reopened.db.prepare("SELECT * FROM pauses").all().length);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("server authority rechecks authorization at dispatch and refuses missing publish approval", () => {
  const f = setup();
  try {
    assert.throws(
      () => f.runtime.enqueue({ ...f.settings, mode: "publish" }, "tester"),
      /PUBLISH_AUTHORIZATION_REQUIRED/,
    );
    f.runtime.enqueue(f.settings, "tester");
    const { state } = f.store.snapshot();
    state.accountServiceRelations[0].revokedAt = "2026-09-20T01:30:00Z";
    f.store.save(state);
    f.advance("2026-09-20T02:00:00Z");
    assert.equal(f.runtime.pull("phone"), null);
    assert.equal(f.runtime.tasks()[0].status, "blocked");
  } finally {
    f.store.close();
  }
});
test("receipt scope, archived evidence, event conflict and monotonic public fact", () => {
  const f = setup();
  try {
    claim(f);
    assert.throws(
      () => f.runtime.receive(receipt(f, { accountId: "wrong" }), "phone"),
      /RECEIPT_SCOPE_INVALID/,
    );
    assert.throws(
      () =>
        f.runtime.receive(
          receipt(f, {
            publishStatus: "published",
            evidenceRefs: ["fake"],
            publishedPostId: "post",
          }),
          "phone",
        ),
      /EVIDENCE_NOT_ARCHIVED/,
    );
    assert.throws(() =>
      f.runtime.receive(receipt(f, { publishStatus: "published", evidenceRefs: [] }), "phone"),
    );
    const evidence = f.runtime.archiveEvidence(
      f.runtime.tasks()[0].taskId,
      "phone",
      "application/json",
      Buffer.from('{"public":"post-1"}'),
    );
    const publicReceipt = receipt(f, {
      executionStatus: "completed",
      publishStatus: "published",
      evidenceRefs: [evidence],
      publishedPostId: "post-1",
      failureCode: undefined,
      resourceStatus: "available",
    });
    f.runtime.receive(publicReceipt, "phone");
    assert.equal(f.runtime.receive(publicReceipt, "phone")?.publishStatus, "published");
    assert.throws(
      () => f.runtime.receive({ ...publicReceipt, publishedPostId: "other" }, "phone"),
      /ID_CONFLICT/,
    );
    f.runtime.receive(receipt(f), "phone");
    assert.equal(f.runtime.tasks()[0].receipt?.publishStatus, "published");
  } finally {
    f.store.close();
  }
});
test("unknown cannot be cleared by not_submitted; manual review requires evidence and invalidates old authority", () => {
  const f = setup();
  try {
    claim(f);
    f.runtime.receive(receipt(f), "phone");
    const task = f.runtime.tasks()[0];
    const evidence = f.runtime.archiveEvidence(
      task.taskId,
      "phone",
      "text/plain",
      Buffer.from("verified explicit rejection"),
    );
    f.runtime.receive(
      receipt(f, { publishStatus: "not_submitted", evidenceRefs: [evidence] }),
      "phone",
    );
    assert.equal(f.runtime.tasks()[0].receipt?.publishStatus, "unknown");
    assert.throws(
      () =>
        f.runtime.review(
          {
            taskId: task.taskId,
            publishStatus: "not_submitted",
            evidenceRefs: [evidence],
            reason: "cannot erase uncertainty",
            relatedScopeReviewed: true,
            authorizationRechecked: true,
          },
          "reviewer",
        ),
      /NON_SUBMISSION_NOT_ESTABLISHED/,
    );
    f.runtime.review(
      {
        taskId: task.taskId,
        publishStatus: "confirmed_not_published",
        evidenceRefs: [evidence],
        reason: "verified",
        relatedScopeReviewed: true,
        authorizationRechecked: true,
      },
      "reviewer",
    );
    assert.equal(f.store.db.prepare("SELECT * FROM pauses").all().length, 0);
    assert.equal(f.store.snapshot().state.executionApprovals[0].status, "invalidated");
    assert.equal(f.runtime.pull("phone"), null);
  } finally {
    f.store.close();
  }
});
test("command idempotency, optimistic revision, whitelist and server-owned actor", () => {
  const store = new RuntimeStore(":memory:");
  const runtime = new ExecutionRuntime(store, {
    mediaBaseUrl: "http://localhost",
    signingKey: "k".repeat(32),
    hasAsset: () => false,
  });
  try {
    const input = {
      requestId: "request-1",
      revision: 0,
      method: "registerClient",
      args: ["client", { actorId: "spoof", correlationId: "spoof" }],
    };
    runtime.command(input, "operator");
    runtime.command(input, "operator");
    assert.equal(store.snapshot().state.clients.length, 1);
    assert.equal(store.snapshot().state.auditLogs[0].actorId, "operator");
    assert.throws(
      () => runtime.command({ ...input, requestId: "request-2" }, "operator"),
      /REVISION_CONFLICT/,
    );
    assert.throws(() => runtime.command({ ...input, method: "replaceState" }, "operator"));
    assert.throws(
      () => runtime.command({ ...input, args: ["other", {}] }, "operator"),
      /ID_CONFLICT/,
    );
  } finally {
    store.close();
  }
});
test("signed media URL rejects expiration and tampering without new attempts", () => {
  const f = setup();
  try {
    const task = f.runtime.enqueue(f.settings, "tester");
    const url = new URL(task.directive.media.url);
    f.runtime.verifyMedia(task.directive.media.sha256, url.searchParams);
    url.searchParams.set("signature", "0".repeat(64));
    assert.throws(
      () => f.runtime.verifyMedia(task.directive.media.sha256, url.searchParams),
      /SIGNATURE/,
    );
    f.advance("2026-09-20T04:00:00Z");
    assert.throws(
      () =>
        f.runtime.verifyMedia(
          task.directive.media.sha256,
          new URL(task.directive.media.url).searchParams,
        ),
      /EXPIRED/,
    );
    assert.equal(f.runtime.tasks().length, 1);
  } finally {
    f.store.close();
  }
});
test("HTTP and authenticated WebSocket exercise real transport, evidence upload and receipt roundtrip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-http-test-"));
  const token = "o".repeat(32),
    agent = "a".repeat(32);
  const server = createRuntimeServer({
    dataDir: dir,
    token,
    signingKey: "k".repeat(32),
    deviceTokens: { phone: agent },
    port: 0,
  });
  let socket: WebSocket | undefined;
  try {
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const port = (server.http.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const missing = await fetch(`${base}/api/runtime/state`);
    assert.equal(missing.status, 409);
    const response = await fetch(`${base}/api/runtime/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "one",
        revision: 0,
        method: "registerClient",
        args: ["transport test", {}],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { state: { clients: unknown[] } }).state.clients.length,
      1,
    );
    const bytes = Buffer.from("\0\0\0\x18ftypisomtest");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const upload = await fetch(`${base}/api/runtime/assets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-Content-Sha256": digest },
      body: bytes,
    });
    assert.equal(upload.status, 200);
    const f = setup(server.store, digest);
    const task = f.runtime.enqueue(f.settings, "tester");
    // Use a currently due approved window in this transport fixture.
    const { state } = server.store.snapshot();
    const now = Date.now();
    state.executionApprovals[0].validFrom = new Date(now - 60000).toISOString();
    state.executionApprovals[0].validUntil = new Date(now + 3600000).toISOString();
    state.publicationSchedules[0].scheduledFor = new Date(now - 1000).toISOString();
    state.publicationSchedules[0].expiresAt = new Date(now + 600000).toISOString();
    server.store.save(state);
    task.directive.scheduledAt = state.publicationSchedules[0].scheduledFor;
    task.directive.expiresAt = state.publicationSchedules[0].expiresAt;
    task.binding.validUntil = new Date(now + 3600000).toISOString();
    server.store.db.prepare("UPDATE bindings SET body=?").run(JSON.stringify(task.binding));
    server.store.db.prepare("UPDATE tasks SET body=?").run(JSON.stringify(task));
    socket = new WebSocket(`ws://127.0.0.1:${port}/agent`, {
      headers: { Authorization: `Bearer ${agent}` },
    });
    await once(socket, "open");
    const rpc = async (type: string, payload: unknown) => {
      const next = once(socket!, "message");
      socket!.send(
        JSON.stringify({
          messageId: randomUUID(),
          contractVersion: "design-v1",
          sentAt: new Date().toISOString(),
          type,
          payload,
        }),
      );
      return JSON.parse((await next)[0].toString());
    };
    assert.equal(
      (await rpc("PullTask", { deviceId: "wrong", resourceStatus: "idle" })).type,
      "Rejected",
    );
    assert.equal(
      (await rpc("PullTask", { deviceId: "phone", resourceStatus: "idle" })).type,
      "Rejected",
    );
    const prep = await rpc("PullPreparation", { deviceId: "phone", resourceStatus: "idle" });
    assert.equal(prep.type, "PreparationLease");
    const lease = { taskId: task.directive.taskId, lease: prep.payload.lease };
    assert.equal(
      (
        await rpc("PreparationReport", {
          ...lease,
          report: {
            status: "ready",
            reason: "IDENTITY_VISIBLE",
            observedAt: new Date().toISOString(),
            observationSha256: "a".repeat(64),
          },
        })
      ).type,
      "Accepted",
    );
    assert.equal((await rpc("BeginExecution", lease)).type, "PublishTaskDirective");
    assert.equal(
      (await rpc("PullPreparation", { deviceId: "phone", resourceStatus: "idle" })).type,
      "NoTask",
    );
    const ev = await fetch(`${base}/api/runtime/evidence`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${agent}`,
        "X-Task-Id": task.directive.taskId,
        "Content-Type": "text/plain",
      },
      body: "preflight final screen, no submission",
    });
    const ref = ((await ev.json()) as { id: string }).id;
    assert.ok(ref);
    const completedReceipt = receipt(f, {
      executionStatus: "completed",
      publishStatus: "not_submitted",
      evidenceRefs: [ref],
      failureCode: undefined,
      resourceStatus: "available",
    });
    const result = await rpc("ExecutionReceipt", completedReceipt);
    assert.equal(result.type, "Accepted");
    assert.equal(
      server.store.snapshot().state.publicationAttempts[0].publishStatus,
      "not_submitted",
    );
    const ledgerPath = join(dir, "agent.sqlite");
    const ledger = new DatabaseSync(ledgerPath);
    ledger.exec(
      "CREATE TABLE attempts (id TEXT PRIMARY KEY, trace TEXT, receipt TEXT, task TEXT, acknowledged INTEGER NOT NULL DEFAULT 0)",
    );
    ledger
      .prepare("INSERT INTO attempts(id,receipt,task) VALUES (?,?,?)")
      .run(task.directive.attemptId, JSON.stringify(completedReceipt), JSON.stringify(task));
    ledger.close();
    const replayed = await runAgentOnce({
      runtimeUrl: base,
      token: agent,
      deviceId: "phone",
      artemisRoot: "/not-used-for-replay",
      ledgerPath,
    });
    assert.equal(replayed.status, "no_task");
    const checked = new DatabaseSync(ledgerPath);
    assert.equal(checked.prepare("SELECT acknowledged FROM attempts").get()!.acknowledged, 1);
    checked.close();
    assert.equal(server.store.db.prepare("SELECT * FROM events").all().length, 1);
  } finally {
    socket?.terminate();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("device workflow checks hashes and identity before publishing; no model completion is fabricated as public evidence", async () => {
  const bytes = Buffer.from("test-media");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const f = setup(undefined, digest);
  try {
    const task = f.runtime.enqueue(f.settings, "tester");
    let calls = 0;
    const dependencies = {
      device: {
        prepare: async () => "/sdcard/file.mp4",
        screenshot: async () => Buffer.from("screenshot"),
      },
      download: async () => Buffer.from("corrupt"),
      archive: async () => `evidence:${++calls}`,
      trace: () => {},
      now: () => Date.parse("2026-09-20T02:00:00Z"),
      artemis: {
        call: async () => {
          throw new Error("must not be called");
        },
        close: async () => {},
      },
    };
    const bad = await executeDeviceTask(task, dependencies);
    assert.equal(bad.publishStatus, "not_submitted");
    let starts = 0;
    const wrong = await executeDeviceTask(task, {
      ...dependencies,
      download: async () => bytes,
      artemis: {
        close: async () => {},
        call: async (name) => {
          if (name === "mobile_run_task") {
            starts++;
            return { trace_id: "trace", device_serial: "RFC_TEST" };
          }
          return {
            status: "completed",
            device_serial: "RFC_TEST",
            result: {
              observedIdentity: "wrong-account",
              identityKind: "facebook_page",
              status: "verified",
              mutationsPerformed: 0,
              finalSubmitClicked: false,
            },
          };
        },
      },
    });
    assert.equal(starts, 1);
    assert.equal(wrong.publishStatus, "not_submitted");
    assert.equal(wrong.executionStatus, "blocked");
    assert.equal(wrong.failureCode, "IDENTITY_CHALLENGE");
    assert.equal(wrong.actionRequired?.observedIdentity, "wrong-account");
    assert.equal(wrong.actionRequired?.expectedIdentity, task.binding.platformIdentity);
  } finally {
    f.store.close();
  }
});

test("account readiness blocks persist clear work instructions and require fresh approval after configuration review", () => {
  const f = setup();
  try {
    claim(f);
    const taskId = f.runtime.tasks()[0].taskId;
    const evidence = f.runtime.archiveEvidence(
      taskId,
      "phone",
      "text/plain",
      Buffer.from("read-only identity mismatch"),
    );
    f.runtime.receive(
      receipt(f, {
        executionStatus: "blocked",
        publishStatus: "not_submitted",
        failureCode: "IDENTITY_CHALLENGE",
        evidenceRefs: [evidence],
        actionRequired: {
          kind: "account",
          reason: "ACCOUNT_IDENTITY_MISMATCH",
          expectedIdentity: "page-a",
          observedIdentity: "page-b",
          nextAction: "Assign the expected page without automatic account switching.",
        },
      }),
      "phone",
    );
    assert.equal(f.runtime.tasks()[0].status, "blocked");
    assert.equal(f.store.db.prepare("SELECT * FROM pauses").all().length, 4);
    f.runtime.review(
      {
        taskId,
        publishStatus: "not_submitted",
        evidenceRefs: [evidence],
        reason: "operator configured expected page; next attempt rechecks",
        relatedScopeReviewed: true,
        authorizationRechecked: true,
      },
      "operator",
    );
    assert.equal(f.store.db.prepare("SELECT * FROM pauses").all().length, 0);
    assert.equal(f.store.snapshot().state.executionApprovals[0].status, "invalidated");
    assert.equal(f.runtime.pull("phone"), null);
  } finally {
    f.store.close();
  }
});

for (const [status, identityKind, expectedReason] of [
  ["verified", "facebook_profile", "ACCOUNT_TYPE_MISMATCH"],
  ["login_required", "unknown", "ACCOUNT_LOGIN_REQUIRED"],
  ["login_rejected", "unknown", "ACCOUNT_LOGIN_REJECTED"],
  ["challenge", "unknown", "ACCOUNT_CHALLENGE"],
  ["unverifiable", "unknown", "ACCOUNT_UNVERIFIABLE"],
] as const)
  test(`${expectedReason} never starts publishing workflow`, async () => {
    const bytes = Buffer.from("test-media");
    const f = setup(undefined, createHash("sha256").update(bytes).digest("hex"));
    try {
      const task = f.runtime.enqueue(f.settings, "tester");
      let starts = 0;
      const result = await executeDeviceTask(task, {
        device: {
          prepare: async () => "/sdcard/test.mp4",
          screenshot: async () => Buffer.from("png"),
        },
        download: async () => bytes,
        archive: async () => `evidence:${randomUUID()}`,
        trace: () => {},
        now: () => Date.parse("2026-09-20T02:00:00Z"),
        artemis: {
          close: async () => {},
          call: async (name) => {
            if (name === "mobile_run_task") {
              starts++;
              return { trace_id: "identity" };
            }
            return {
              status: "completed",
              result: {
                observedIdentity: task.binding.platformIdentity,
                identityKind,
                status,
                mutationsPerformed: 0,
                finalSubmitClicked: false,
              },
            };
          },
        },
      });
      assert.equal(starts, 1);
      assert.equal(result.executionStatus, "blocked");
      assert.equal(result.publishStatus, "not_submitted");
      assert.equal(result.actionRequired?.reason, expectedReason);
    } finally {
      f.store.close();
    }
  });

test("legacy import preserves history but cannot activate old approvals or overwrite a workspace", () => {
  const source = setup();
  const target = new RuntimeStore(":memory:");
  const runtime = new ExecutionRuntime(target, {
    mediaBaseUrl: "http://localhost",
    signingKey: "x".repeat(32),
    hasAsset: () => true,
  });
  try {
    const original = source.store.snapshot().state;
    const imported = runtime.importLegacy(original, "operator");
    assert.equal(imported.state.clients[0].id, original.clients[0].id);
    assert.equal(imported.state.executionApprovals[0].status, "invalidated");
    assert.equal(imported.state.publicationSchedules[0].status, "cancelled");
    assert.equal(original.executionApprovals[0].status, "active");
    assert.throws(
      () => runtime.importLegacy(original, "operator"),
      /IMPORT_REQUIRES_EMPTY_RUNTIME/,
    );
  } finally {
    source.store.close();
    target.close();
  }
});

test("public visibility observations require archived evidence and never manufacture a published receipt", () => {
  const f = setup();
  try {
    claim(f);
    const task = f.runtime.tasks()[0];
    const evidence = f.runtime.archiveEvidence(
      task.taskId,
      "phone",
      "text/plain",
      Buffer.from("processing screen"),
    );
    const input = {
      taskId: task.taskId,
      source: "manual platform inspection",
      capturedAt: "2026-09-20T02:00:00Z",
      publiclyVisible: false,
      processing: "processing",
      restrictionNotices: [],
      evidenceRefs: [evidence],
    };
    f.runtime.observe(input, "operator");
    assert.equal(f.store.db.prepare("SELECT * FROM observations").all().length, 1);
    assert.equal(f.store.snapshot().state.publicationAttempts[0].publishStatus, "in_progress");
    assert.throws(
      () => f.runtime.observe({ ...input, evidenceRefs: ["not-archived"] }, "operator"),
      /EVIDENCE_NOT_ARCHIVED/,
    );
  } finally {
    f.store.close();
  }
});

test("Artemis preflight returns non-submission; claimed public success without UI corroboration remains unknown", async () => {
  const media = Buffer.from("media");
  const f = setup(undefined, createHash("sha256").update(media).digest("hex"));
  try {
    const task = f.runtime.enqueue(f.settings, "tester");
    const run = async (publish: boolean) => {
      let starts = 0;
      const result = await executeDeviceTask(
        {
          ...task,
          settings: {
            ...task.settings,
            mode: publish ? "publish" : "preflight",
            publishAuthorizationRef: publish ? "approved-once" : undefined,
          },
        },
        {
          download: async () => media,
          device: {
            prepare: async () => "/sdcard/test.mp4",
            screenshot: async () => Buffer.from("png"),
          },
          archive: async () => `evidence:${randomUUID()}`,
          trace: () => {},
          now: () => Date.parse("2026-09-20T02:00:00Z"),
          artemis: {
            close: async () => {},
            call: async (name) => {
              if (name === "mobile_run_task") {
                starts++;
                // Artemis daemon-scheduled launches omit device_serial. The
                // subsequent status response carries the authoritative binding.
                return { trace_id: `trace-${starts}`, status: "running" };
              }
              if (name === "mobile_get_device_state")
                return "<screen>no public URL observed</screen>";
              return {
                status: "completed",
                device_serial: "RFC_TEST",
                result: {
                  result: {
                    observedIdentity: task.binding.platformIdentity,
                    identityKind: "facebook_page",
                    status: "verified",
                    mutationsPerformed: 1,
                    finalSubmitClicked: publish,
                    publishStatus: publish ? "published" : "not_submitted",
                    publishedUrl: publish ? "https://www.facebook.com/reel/123456" : undefined,
                    audience: "public",
                    aiLabel: true,
                  },
                },
              };
            },
          },
        },
      );
      return { result, starts };
    };
    assert.equal((await run(false)).result.publishStatus, "not_submitted");
    const unproven = await run(true);
    assert.equal(unproven.result.publishStatus, "unknown");
    assert.equal(unproven.starts, 1);
  } finally {
    f.store.close();
  }
});
