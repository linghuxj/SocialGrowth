import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

async function main() {
  console.log("=== 步骤 1: 检查运行环境与配置 ===");
  const envRuntime = readFileSync(".env.runtime", "utf8");
  const token = envRuntime.match(/SG_RUNTIME_TOKEN=([a-f0-9]+)/)?.[1];
  if (!token) throw new Error("Missing SG_RUNTIME_TOKEN in .env.runtime");
  const baseUrl = "http://127.0.0.1:4318/api/runtime";

  const fixturePath = resolve("artifacts/reports/2026-09-20-operations-refactor/acceptance-fixture.mp4");
  if (!existsSync(fixturePath)) throw new Error("acceptance-fixture.mp4 not found");
  const fixtureBytes = readFileSync(fixturePath);

  const fixtureSha = createHash("sha256").update(fixtureBytes).digest("hex");
  console.log(`=== 步骤 2: 上传真实切片素材 (${fixtureBytes.length} bytes, SHA: ${fixtureSha}) ===`);
  const assetRes = await fetch(`${baseUrl}/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "video/mp4",
      "x-content-sha256": fixtureSha,
    },
    body: fixtureBytes,
  });
  if (!assetRes.ok) throw new Error(`Asset upload failed: ${await assetRes.text()}`);
  const assetInfo = (await assetRes.json()) as { sha256: string; fileRef: string };
  console.log("素材上传成功，SHA-256:", assetInfo.sha256);

  console.log("=== 步骤 3: 读取当前状态与 Revision ===");
  const stateRes = await fetch(`${baseUrl}/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const currentSnapshot = (await stateRes.json()) as { revision: number; state: any };
  let rev = currentSnapshot.revision;
  console.log("当前 State revision:", rev);

  const runCommand = async (method: string, args: any[]) => {
    const res = await fetch(`${baseUrl}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        revision: rev,
        method,
        args: [...args, { actorId: "local-operator", correlationId: `corr-${Date.now()}` }],
      }),
    });
    if (!res.ok) throw new Error(`Command ${method} failed: ${await res.text()}`);
    const data = (await res.json()) as { revision: number; result: any };
    if (!data.result?.ok) {
      throw new Error(`Command ${method} business rejected: ${JSON.stringify(data.result?.error)}`);
    }
    rev = data.revision;
    return data.result;
  };

  console.log("=== 步骤 4: 注册业务对象 (Client, Project, Account, Rights, Slice, Schedule) ===");
  // 1. Client
  const clientRes = await runCommand("registerClient", ["北美短剧业务客户"]);
  const client = clientRes.value;
  console.log("Client registered:", client.id);

  // 2. Account (绑定 RFCW40MYYCV 对应真机的 Facebook 账号)
  const accountRes = await runCommand("registerAccount", [{
    name: "Zan Wang (CEO Drama)",
    platform: "facebook",
    owner: "operator-admin",
    positioning: "北美短剧",
    deviceRef: "RFCW40MYYCV",
  }]);
  const account = accountRes.value;
  console.log("Account registered:", account.id);

  // 3. Project
  const projRes = await runCommand("saveProjectDraft", [{
    name: "霸道总裁北美短剧出海",
    clientId: client.id,
    primaryGoal: "views",
    audience: "北美25-45女性受众",
    ownerId: "operator-admin",
  }]);
  const project = projRes.value;
  console.log("Project draft saved:", project.id);

  await runCommand("activateProject", [project.id]);
  console.log("Project activated:", project.id);

  // 4. Relation
  const now = new Date();
  const pastOneHour = new Date(now.getTime() - 3600000).toISOString();
  const futureOneMonth = new Date(now.getTime() + 30 * 86400000).toISOString();

  await runCommand("grantAccountServiceRelation", [{
    accountId: account.id,
    projectId: project.id,
    clientId: client.id,
    ownerPartyId: client.id,
    authorizerPartyId: client.id,
    authorizationRef: "auth://exclusive-fb-official-2026",
    allowedActions: ["publish"],
    allowedData: ["public_metrics"],
    validFrom: pastOneHour,
    validUntil: futureOneMonth,
  }]);
  console.log("AccountServiceRelation granted");

  // 5. Admit Content
  const rightsRef = "rights://drama-exclusive-2026";
  const admitRes = await runCommand("admitContent", [{
    title: "总裁的替嫁新娘 第01集",
    sourceRef: "source://drama-ceo-01",
    storySummary: "豪门替嫁，反转不断",
    asset: {
      language: "en",
      variant: "master",
      fileRef: `runtime-asset:${fixtureSha}`,
      sha256: fixtureSha,
      rightsRef,
      destinationFit: "eligible",
      rightsValidUntil: futureOneMonth,
    },
  }]);
  const content = admitRes.value;
  const contentIdentityId = content.identity.id;
  const sliceId = content.asset.id;
  console.log(`Content admitted: identityId=${contentIdentityId}, sliceId=${sliceId}`);

  // 6. Allocate Content to Account (独占锁定)
  await runCommand("allocateContent", [contentIdentityId, account.id, 0]);
  console.log("Content allocated to account");

  // 7. Destination
  const destRes = await runCommand("createDestination", [{
    projectId: project.id,
    accountId: account.id,
    scope: "content",
    scopeId: contentIdentityId,
    url: "https://www.facebook.com/profile.php?id=61550800776808",
    maintenancePermissionRef: "perm://exclusive-maintenance-2026",
    sharedAttribution: false,
    exitPolicy: "continue",
  }]);
  console.log("Destination created:", destRes.value?.id);

  // 8. Strategy Rule & Draft
  await runCommand("addStrategyRule", [{
    projectId: project.id,
    category: "internal_rule",
    statement: "严格采用纯真机 Facebook 原生 App 预检并记录证据",
    sourceRef: "policy://strict-real-device",
  }]);
  console.log("Strategy rule added");

  const draftRes = await runCommand("generateStrategyDraft", [{
    projectId: project.id,
    outputMode: "controlled",
    rationale: "真实首单发布前安全预检验证",
    assumptions: ["已登录受权账号"],
  }]);
  const draft = draftRes.value;
  console.log("Strategy draft generated:", draft.id, "version:", draft.version);

  // 9. Approve Strategy
  const approveRes = await runCommand("approveStrategy", [{
    strategyDraftId: draft.id,
    expectedStrategyVersion: draft.version,
    quantity: 1,
    validFrom: pastOneHour,
    validUntil: futureOneMonth,
    stopConditions: ["遇到登录异常或挑战时停止"],
    observationConditions: ["记录有效发布状态与公开证据"],
  }]);
  const approval = approveRes.value;
  console.log("Strategy approved:", approval.id);

  // 10. Schedule Approval
  const scheduledFor = new Date(Date.now() + 5000).toISOString();
  const expiresAt = new Date(Date.now() + 7200000).toISOString();
  const schedRes = await runCommand("scheduleApproval", [{
    approvalId: approval.id,
    businessTimezone: "Asia/Shanghai",
    scheduledFor,
    expiresAt,
  }]);
  const schedule = schedRes.value;
  console.log("Schedule created:", schedule.id);

  console.log("=== 步骤 5: 登记真机设备绑定 (RFCW40MYYCV) ===");
  const bindingId = `bind-fb-${Date.now()}`;
  const bindingPayload = {
    id: bindingId,
    deviceId: "RFCW40MYYCV",
    serial: "RFCW40MYYCV",
    platform: "facebook",
    accountId: account.id,
    platformIdentity: "https://www.facebook.com/profile.php?id=61550800776808",
    authorizationRef: "auth://exclusive-fb-official-2026",
    automationScopeRef: "scope://reels-publish-exclusive",
    verifiedAt: pastOneHour,
    validUntil: futureOneMonth,
  };
  const bindRes = await fetch(`${baseUrl}/bindings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bindingPayload),
  });
  if (!bindRes.ok) throw new Error(`Binding failed: ${await bindRes.text()}`);
  console.log("设备账号绑定成功:", bindingId);

  console.log("=== 步骤 6: 提交 preflight 预检任务入队 ===");
  const taskSettings = {
    scheduleId: schedule.id,
    bindingId,
    sliceId,
    mode: "preflight",
    captionText: "Exclusive Premiere: The Substitute Bride Ep.1! Watch now. #Drama #Reels",
    audience: "public",
    aiLabel: true,
    aiLabelReason: "ai-generated-avatar-and-voice",
    musicRightsRef: "rights://bgm-exclusive-2026",
    rightsRef,
    taskTimeoutMs: 180000,
  };
  const taskRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskSettings),
  });
  if (!taskRes.ok) throw new Error(`Task enqueue failed: ${await taskRes.text()}`);
  const taskEnqueued = await taskRes.json();
  const taskId = taskEnqueued.value?.directive?.taskId;
  console.log("任务已成功入队:", taskId);

  console.log("=== 步骤 7: 检查 /api/runtime/status ===");
  const statusRes = await fetch(`${baseUrl}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const status = await statusRes.json();
  console.log(`当前队列任务数: ${status.tasks.length}, 绑定数: ${status.bindings.length}`);
  console.log("任务准备就绪！TaskId:", taskId);
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
