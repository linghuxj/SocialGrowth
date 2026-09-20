import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionRuntime } from "../services/execution-runtime/src/runtime.ts";
import { RuntimeStore } from "../services/execution-runtime/src/store.ts";
import { executeDeviceTask } from "../services/execution-runtime/src/device-executor.ts";
import type { Binding, PublishSettings } from "../services/execution-runtime/src/contracts.ts";

function createTestHarness(mediaBytes: Buffer = Buffer.from("test-video-asset-mp4")) {
  const dir = join(tmpdir(), `sg-acceptance-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "runtime.sqlite");
  const store = new RuntimeStore(dbPath);
  const mediaSha256 = createHash("sha256").update(mediaBytes).digest("hex");

  const runtime = new ExecutionRuntime(store, {
    mediaBaseUrl: "http://127.0.0.1:4318",
    signingKey: "test-signing-key-32-characters!!",
    now: () => "2026-09-20T03:00:00Z",
    hasAsset: (sha) => sha === mediaSha256,
    canExecuteAsset: (sha) => sha === mediaSha256,
  });

  const { state } = store.snapshot();
  state.clients.push({ id: "client-1", name: "测试客户", status: "active", createdAt: "2026-09-20T00:00:00Z" });
  state.projects.push({
    id: "proj-1",
    clientId: "client-1",
    name: "主推短剧项目",
    primaryGoal: "有效点击",
    audience: "北美受众",
    ownerId: "op-1",
    status: "active",
    createdAt: "2026-09-20T00:00:00Z",
  });
  state.accounts.push({
    id: "acc-fb-1",
    clientId: "client-1",
    platform: "facebook",
    displayName: "短剧官方Page",
    deviceRef: "phone-1",
    status: "active",
  });
  state.accountServiceRelations.push({
    id: "rel-1",
    projectId: "proj-1",
    accountId: "acc-fb-1",
    clientId: "client-1",
    ownerPartyId: "client-1",
    authorizerPartyId: "client-1",
    authorizationRef: "auth://fb-official-2026",
    allowedActions: ["publish"],
    allowedData: ["public_metrics"],
    validFrom: "2026-09-01T00:00:00Z",
    validUntil: "2026-10-01T00:00:00Z",
  });
  state.contentIdentities.push({
    id: "content-ep01",
    title: "霸道总裁第01集",
    sourceRef: "drama://ceo-ep01",
    storySummary: "核心剧情片段",
    allocationStatus: "assigned_locked",
    assignedAccountId: "acc-fb-1",
    lockVersion: 1,
  });
  state.sliceAssets.push({
    id: "slice-ep01-en",
    contentIdentityId: "content-ep01",
    language: "en-US",
    variant: "subtitle",
    fileRef: "runtime-asset:" + mediaSha256,
    sha256: mediaSha256,
    rightsRef: "rights://exclusive-drama-2026",
    destinationFit: "eligible",
    rightsValidUntil: "2026-10-01T00:00:00Z",
  });
  state.destinationVersions.push({
    id: "dest-v1",
    projectId: "proj-1",
    accountId: "acc-fb-1",
    scope: "content",
    scopeId: "content-ep01",
    url: "https://short.link/drama-ep01",
    maintenancePermissionRef: "perm://shortlink",
    sharedAttribution: false,
    isActive: true,
    health: "available",
  });
  state.executionApprovals.push({
    id: "appr-1",
    projectId: "proj-1",
    accountId: "acc-fb-1",
    strategyDraftId: "strat-1",
    contentIdentityId: "content-ep01",
    destinationVersionId: "dest-v1",
    status: "active",
    validFrom: "2026-09-20T00:00:00Z",
    validUntil: "2026-09-21T00:00:00Z",
    reviewNotes: "业务负责人审核通过",
  });
  state.publicationSchedules.push({
    id: "sched-1",
    approvalId: "appr-1",
    scheduledFor: "2026-09-20T03:00:00Z",
    expiresAt: "2026-09-20T05:00:00Z",
    businessTimezone: "America/Los_Angeles",
    status: "scheduled",
  });
  store.save(state);

  const binding: Binding = {
    id: "bind-fb-1",
    deviceId: "phone-1",
    platform: "facebook",
    accountId: "acc-fb-1",
    serial: "RFCW40MYYCV",
    platformIdentity: "https://www.facebook.com/drama.official.page",
    authorizationRef: "auth://fb-official-2026",
    automationScopeRef: "scope://publish-reels",
    verifiedAt: "2026-09-20T00:00:00Z",
    validUntil: "2026-09-21T00:00:00Z",
  };
  runtime.bind(binding, "tester");

  const settings: PublishSettings = {
    scheduleId: "sched-1",
    bindingId: "bind-fb-1",
    sliceId: "slice-ep01-en",
    mode: "publish",
    publishAuthorizationRef: "auth-exec-once-2026",
    captionText: "Check out Episode 1! #Drama #Reels",
    audience: "public",
    aiLabel: true,
    aiLabelReason: "ai-generated-avatar-and-voice",
    musicRightsRef: "rights://bgm-licensed-2026",
    rightsRef: "rights://exclusive-drama-2026",
    taskTimeoutMs: 60000,
  };

  const cleanup = () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { runtime, store, binding, settings, mediaBytes, mediaSha256, cleanup };
}

function prepareAndStart(runtime: ExecutionRuntime, deviceId = "phone-1") {
  const lease = runtime.pullPreparation(deviceId);
  assert.ok(lease, "必须成功拉取 preparation lease");
  runtime.reportPreparation(deviceId, lease.task.directive.taskId, lease.lease, {
    status: "ready",
    reason: "IDENTITY_VISIBLE",
    observedAt: runtime.now(),
    observationSha256: "a".repeat(64),
  });
  const runningTask = runtime.pull(deviceId, { taskId: lease.task.directive.taskId, lease: lease.lease });
  assert.ok(runningTask, "必须成功领取并转入 running 状态");
  return runningTask;
}

// -----------------------------------------------------------------------------
// 验收断言 1: 正常情况自动完成 (Happy Path Auto-Completion)
// -----------------------------------------------------------------------------
test("验收断言 1: 正常情况自动完成（双端素材核验 -> 只读身份通过 -> 发布执行 -> UI 树交叉核验 -> 闭环成功）", async () => {
  const h = createTestHarness();
  try {
    h.runtime.enqueue(h.settings, "tester");
    const task = prepareAndStart(h.runtime, h.binding.deviceId);
    assert.ok(task, "任务应成功入队并转为 running");

    // 预备模拟依赖
    let runTaskCallCount = 0;
    const publishedUrl = "https://www.facebook.com/reel/998877665544";
    const hierarchyWithUrl = `<hierarchy><node text="Reel Published"/><node text="${publishedUrl}"/></hierarchy>`;

    const outcome = await executeDeviceTask(task, {
      now: () => Date.parse("2026-09-20T03:00:00Z"),
      download: async () => h.mediaBytes,
      device: {
        prepare: async (serial, bytes, sha) => {
          assert.equal(serial, h.binding.serial);
          assert.equal(sha, h.mediaSha256);
          return `/sdcard/Movies/SocialGrowth/${sha}.mp4`;
        },
        screenshot: async () => Buffer.from("screenshot-png"),
      },
      archive: async (mime, bytes) => h.runtime.archiveEvidence(task.directive.taskId, h.binding.deviceId, mime, bytes),
      trace: () => {},
      artemis: {
        close: async () => {},
        call: async (name, args) => {
          if (name === "mobile_run_task") {
            runTaskCallCount++;
            return { trace_id: `trace-${runTaskCallCount}`, device_serial: h.binding.serial };
          }
          if (name === "mobile_manage_task") {
            if (runTaskCallCount === 1) {
              // 阶段 1：只读身份核查结果
              return {
                status: "completed",
                device_serial: h.binding.serial,
                result: {
                  observedIdentity: h.binding.platformIdentity,
                  identityKind: "facebook_page",
                  status: "verified",
                  mutationsPerformed: 0,
                },
              };
            }
            // 阶段 2：发布执行结果
            return {
              status: "completed",
              device_serial: h.binding.serial,
              result: {
                observedIdentity: h.binding.platformIdentity,
                finalSubmitClicked: true,
                publishStatus: "published",
                publishedUrl,
                publishedPostId: "post-998877665544",
                audience: "public",
                aiLabel: true,
              },
            };
          }
          if (name === "mobile_get_device_state") {
            // UI Hierarchy 交叉核验
            return hierarchyWithUrl;
          }
          throw new Error(`Unexpected tool call: ${name}`);
        },
      },
    });

    // 断言结果结构
    assert.equal(runTaskCallCount, 2, "正常情况必须执行两阶段（1次只读身份 + 1次受控发布）");
    assert.equal(outcome.executionStatus, "completed");
    assert.equal(outcome.publishStatus, "published");
    assert.equal(outcome.publishedUrl, publishedUrl);
    assert.equal(outcome.resourceStatus, "available");

    // 服务端接收回执并持久化
    const receiptResult = h.runtime.receive(outcome, h.binding.deviceId);
    assert.equal(receiptResult?.publishStatus, "published");

    // 校验状态机与发布尝试
    const snap = h.store.snapshot();
    assert.equal(snap.state.publicationAttempts[0].publishStatus, "published");
    assert.equal(h.store.db.prepare("SELECT * FROM pauses").all().length, 0, "成功完成后不应存在任何暂停锁");
  } finally {
    h.cleanup();
  }
});

// -----------------------------------------------------------------------------
// 验收断言 2: 登录异常处理后自动继续 (Login Exception -> Challenge -> Human Review -> Resume)
// -----------------------------------------------------------------------------
test("验收断言 2: 登录异常处理后自动继续（遇到 2FA/挑战 -> 阻断并级联暂停 -> 人工审查解暂停 -> 新排期自动复核并完成）", async () => {
  const h = createTestHarness();
  try {
    h.runtime.enqueue(h.settings, "tester");
    const task = prepareAndStart(h.runtime, h.binding.deviceId);

    // 模拟第 1 次执行：阶段 1 遭遇风控挑战 (ACCOUNT_CHALLENGE)
    let runTaskCallCount = 0;
    const challengeOutcome = await executeDeviceTask(task, {
      now: () => Date.parse("2026-09-20T03:00:00Z"),
      download: async () => h.mediaBytes,
      device: {
        prepare: async () => "/sdcard/media.mp4",
        screenshot: async () => Buffer.from("challenge-screen"),
      },
      archive: async (mime, bytes) => h.runtime.archiveEvidence(task.directive.taskId, h.binding.deviceId, mime, bytes),
      trace: () => {},
      artemis: {
        close: async () => {},
        call: async (name) => {
          if (name === "mobile_run_task") {
            runTaskCallCount++;
            return { trace_id: "trace-challenge", device_serial: h.binding.serial };
          }
          if (name === "mobile_manage_task") {
            return {
              status: "completed",
              device_serial: h.binding.serial,
              result: {
                observedIdentity: h.binding.platformIdentity,
                identityKind: "facebook_page",
                status: "challenge", // 遭遇验证挑战
                mutationsPerformed: 0,
              },
            };
          }
          throw new Error(`Unexpected call during challenge: ${name}`);
        },
      },
    });

    assert.equal(runTaskCallCount, 1, "遇到挑战必须在阶段 1 立即熔断，严禁进入阶段 2");
    assert.equal(challengeOutcome.executionStatus, "blocked");
    assert.equal(challengeOutcome.publishStatus, "not_submitted");
    assert.equal(challengeOutcome.failureCode, "IDENTITY_CHALLENGE");
    assert.equal(challengeOutcome.actionRequired?.kind, "account");
    assert.equal(challengeOutcome.actionRequired?.reason, "ACCOUNT_CHALLENGE");

    // 服务端入库阻断回执
    h.runtime.receive(challengeOutcome, h.binding.deviceId);

    // 断言级联暂停锁已生效 (device, account, project, content 四维锁定)
    const pauses = h.store.db.prepare("SELECT * FROM pauses").all();
    assert.equal(pauses.length, 4, "必须写入 4 维级联暂停锁");

    // 暂停生效期间，调度器直接阻断拉取
    assert.equal(h.runtime.pull(h.binding.deviceId), null, "存在暂停锁时严禁派发任务");

    // 模拟线下人工处理完成，运营在控制台录入审查结果 (POST /api/runtime/reviews)
    const reviewResult = h.runtime.review(
      {
        taskId: task.directive.taskId,
        publishStatus: "not_submitted",
        evidenceRefs: [challengeOutcome.evidenceRefs[0]],
        reason: "账号运营已在真机手动完成 2FA 验证，账号状态已就绪",
        relatedScopeReviewed: true,
        authorizationRechecked: true,
      },
      "operator-alice",
    );
    assert.ok(reviewResult);

    // 审查后：暂停锁全部解除
    const pausesAfterReview = h.store.db.prepare("SELECT * FROM pauses").all();
    assert.equal(pausesAfterReview.length, 0, "审查通过后必须清除全部暂停锁");

    // 旧排期与批准已按设计失效（不可复用旧尝试）
    assert.equal(h.store.snapshot().state.executionApprovals[0].status, "invalidated");

    // 重新发起合规排期与任务入队（旧排期作废，生成新排期 sched-2）
    const { state } = h.store.snapshot();
    state.executionApprovals[0].status = "active"; // 重新激活批准
    state.publicationSchedules.push({
      id: "sched-2",
      approvalId: "appr-1",
      scheduledFor: "2026-09-20T03:00:00Z",
      expiresAt: "2026-09-20T05:00:00Z",
      businessTimezone: "America/Los_Angeles",
      status: "scheduled",
    });
    h.store.save(state);

    const nextSettings: PublishSettings = {
      ...h.settings,
      scheduleId: "sched-2",
    };
    h.runtime.enqueue(nextSettings, "tester");
    const nextTask = prepareAndStart(h.runtime, h.binding.deviceId);
    assert.ok(nextTask);

    // 再次执行：登录已修复，阶段 1 与阶段 2 顺利自动走通
    let secondRunCallCount = 0;
    const resumedOutcome = await executeDeviceTask(nextTask, {
      now: () => Date.parse("2026-09-20T03:00:00Z"),
      download: async () => h.mediaBytes,
      device: {
        prepare: async () => "/sdcard/media.mp4",
        screenshot: async () => Buffer.from("screenshot"),
      },
      archive: async (mime, bytes) => h.runtime.archiveEvidence(nextTask.directive.taskId, h.binding.deviceId, mime, bytes),
      trace: () => {},
      artemis: {
        close: async () => {},
        call: async (name) => {
          if (name === "mobile_run_task") {
            secondRunCallCount++;
            return { trace_id: `trace-next-${secondRunCallCount}`, device_serial: h.binding.serial };
          }
          if (name === "mobile_manage_task") {
            if (secondRunCallCount === 1) {
              return {
                status: "completed",
                result: {
                  observedIdentity: h.binding.platformIdentity,
                  identityKind: "facebook_page",
                  status: "verified", // 恢复正常
                  mutationsPerformed: 0,
                },
              };
            }
            return {
              status: "completed",
              result: {
                observedIdentity: h.binding.platformIdentity,
                finalSubmitClicked: true,
                publishStatus: "published",
                publishedUrl: "https://www.facebook.com/reel/11223344",
                audience: "public",
                aiLabel: true,
              },
            };
          }
          if (name === "mobile_get_device_state") {
            return '<screen><node text="https://www.facebook.com/reel/11223344"/></screen>';
          }
          throw new Error(`Unexpected call: ${name}`);
        },
      },
    });

    assert.equal(secondRunCallCount, 2);
    assert.equal(resumedOutcome.publishStatus, "published", "登录处理完成后流程自动闭环成功");
  } finally {
    h.cleanup();
  }
});

// -----------------------------------------------------------------------------
// 验收断言 3: 账号变化不误发 (Account Identity Change / Type Mismatch Prevention)
// -----------------------------------------------------------------------------
test("验收断言 3: 账号变化不误发（检测到个人 Profile 或身份错配 -> 阶段 1 强行阻断 -> mutationsPerformed 为 0 -> 零误发）", async () => {
  const h = createTestHarness();
  try {
    const task = h.runtime.enqueue(h.settings, "tester");

    // 场景 3.1: 账号类型变化为个人主页 (facebook_profile)
    let callCountProfile = 0;
    const profileOutcome = await executeDeviceTask(task, {
      now: () => Date.parse("2026-09-20T03:00:00Z"),
      download: async () => h.mediaBytes,
      device: {
        prepare: async () => "/sdcard/media.mp4",
        screenshot: async () => Buffer.from("profile-screen"),
      },
      archive: async () => `evidence:${randomUUID()}`,
      trace: () => {},
      artemis: {
        close: async () => {},
        call: async (name) => {
          if (name === "mobile_run_task") {
            callCountProfile++;
            return { trace_id: "trace-profile" };
          }
          if (name === "mobile_manage_task") {
            return {
              status: "completed",
              result: {
                observedIdentity: h.binding.platformIdentity,
                identityKind: "facebook_profile", // 错误身份类型
                status: "verified",
                mutationsPerformed: 0,
              },
            };
          }
          throw new Error(`Unexpected tool: ${name}`);
        },
      },
    });

    assert.equal(callCountProfile, 1, "阶段 1 识别到 profile 必须立即停止");
    assert.equal(profileOutcome.executionStatus, "blocked");
    assert.equal(profileOutcome.publishStatus, "not_submitted");
    assert.equal(profileOutcome.actionRequired?.reason, "ACCOUNT_TYPE_MISMATCH");

    // 场景 3.2: 账号身份 ID 不匹配 (串号或切换到了非专属账号)
    let callCountMismatch = 0;
    const mismatchOutcome = await executeDeviceTask(task, {
      now: () => Date.parse("2026-09-20T03:00:00Z"),
      download: async () => h.mediaBytes,
      device: {
        prepare: async () => "/sdcard/media.mp4",
        screenshot: async () => Buffer.from("mismatch-screen"),
      },
      archive: async () => `evidence:${randomUUID()}`,
      trace: () => {},
      artemis: {
        close: async () => {},
        call: async (name) => {
          if (name === "mobile_run_task") {
            callCountMismatch++;
            return { trace_id: "trace-mismatch" };
          }
          if (name === "mobile_manage_task") {
            return {
              status: "completed",
              result: {
                observedIdentity: "https://www.facebook.com/wrong.competing.page", // 错误账号
                identityKind: "facebook_page",
                status: "verified",
                mutationsPerformed: 0,
              },
            };
          }
          throw new Error(`Unexpected tool: ${name}`);
        },
      },
    });

    assert.equal(callCountMismatch, 1);
    assert.equal(mismatchOutcome.executionStatus, "blocked");
    assert.equal(mismatchOutcome.publishStatus, "not_submitted");
    assert.equal(mismatchOutcome.actionRequired?.reason, "ACCOUNT_IDENTITY_MISMATCH");
    assert.equal(mismatchOutcome.actionRequired?.observedIdentity, "https://www.facebook.com/wrong.competing.page");
  } finally {
    h.cleanup();
  }
});

// -----------------------------------------------------------------------------
// 验收断言 4: 提交结果未知不重发 (Submission Unknown -> Monotonic Protection -> No Resubmission)
// -----------------------------------------------------------------------------
test("验收断言 4: 提交结果未知不重发（提交后异常 -> 强制记为 unknown -> 级联暂停锁住排期 -> 迟到 not_submitted 无法覆盖未知事实）", async () => {
  const h = createTestHarness();
  try {
    h.runtime.enqueue(h.settings, "tester");
    const task = prepareAndStart(h.runtime, h.binding.deviceId);

    // 模拟执行：阶段 1 成功，阶段 2 进入发布并点击了提交，但随后面临网络断连或 413 网关错误导致异常
    let stage2Started = false;
    let stopTaskCalled = false;

    const unknownOutcome = await executeDeviceTask(task, {
      now: () => Date.parse("2026-09-20T03:00:00Z"),
      download: async () => h.mediaBytes,
      device: {
        prepare: async () => "/sdcard/media.mp4",
        screenshot: async () => Buffer.from("final-screen-during-failure"),
      },
      archive: async (mime, bytes) => h.runtime.archiveEvidence(task.directive.taskId, h.binding.deviceId, mime, bytes),
      trace: () => {},
      artemis: {
        close: async () => {},
        call: async (name, args) => {
          if (name === "mobile_run_task") {
            if (!stage2Started) {
              return { trace_id: "trace-id-1" };
            }
            return { trace_id: "trace-publish-2" };
          }
          if (name === "mobile_manage_task") {
            if (args.action === "stop") {
              stopTaskCalled = true;
              return { status: "stopped" };
            }
            if (!stage2Started) {
              stage2Started = true;
              return {
                status: "completed",
                result: {
                  observedIdentity: h.binding.platformIdentity,
                  identityKind: "facebook_page",
                  status: "verified",
                  mutationsPerformed: 0,
                },
              };
            }
            // 阶段 2 轮询期间触发异常中断
            throw new Error("ARTEMIS_TASK_FAILED");
          }
          throw new Error(`Unexpected: ${name}`);
        },
      },
    });

    assert.ok(stopTaskCalled, "异常发生时必须主动调用 mobile_manage_task(stop) 停机");
    assert.equal(unknownOutcome.executionStatus, "failed");
    assert.equal(unknownOutcome.publishStatus, "unknown", "发布流程已开始后的异常必须保守记为 unknown");
    assert.equal(unknownOutcome.failureCode, "TECHNICAL_FAILURE");

    // 服务端录入该 unknown 回执
    h.runtime.receive(unknownOutcome, h.binding.deviceId);

    // 断言已写入级联暂停锁
    const pauses = h.store.db.prepare("SELECT * FROM pauses").all();
    assert.ok(pauses.some((p) => p.scope === `account:${h.binding.accountId}`));
    assert.ok(pauses.some((p) => p.scope === `content:content-ep01`));

    // 防重发断言 A：暂停锁阻断后续排期派发
    assert.equal(h.runtime.pull(h.binding.deviceId), null, "任务处于 unknown 状态时严禁拉取或重发");

    // 防重发断言 B：单调性保护——如果 Agent 迟到上报了 not_submitted，绝不能将 unknown 降级清空
    const lateConflictingReceipt = {
      ...unknownOutcome,
      eventId: randomUUID(),
      publishStatus: "not_submitted" as const,
    };
    h.runtime.receive(lateConflictingReceipt, h.binding.deviceId);

    // 查看最终持久化结果：依然保持 unknown，且记录 RECEIPT_CONFLICT
    const storedTask = h.runtime.tasks().find((t) => t.taskId === task.directive.taskId);
    assert.equal(storedTask?.status, "unknown", "单调性保护生效：not_submitted 绝不能覆盖已有 unknown 事实");
    assert.equal(storedTask?.receipt?.publishStatus, "unknown");
    assert.equal(storedTask?.receipt?.failureCode, "RECEIPT_CONFLICT");
  } finally {
    h.cleanup();
  }
});
