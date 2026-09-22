import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const runtimeUrl = 'http://127.0.0.1:4318/api/runtime';
const webUrl = 'http://127.0.0.1:3000';
const token = '569627d96d993d0afaa1d74df96b89aa86f66840eca9a80135edfb7348534ebf';
const outputDir = resolve('artifacts/acceptance/web-live-acceptance');

async function main() {
  await mkdir(outputDir, { recursive: true });
  let agentProc: any = null;
  console.log('=== Step 1: 准备业务对象与素材 ===');

  const stateRes = await fetch(`${runtimeUrl}/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const currentSnapshot = (await stateRes.json()) as { revision: number; state: any };
  let rev = currentSnapshot.revision;
  console.log('当前 State revision:', rev);

  const runCommand = async (method: string, args: any[]) => {
    const res = await fetch(`${runtimeUrl}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        revision: rev,
        method,
        args: [...args, { actorId: 'local-operator', correlationId: `corr-${Date.now()}` }],
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

  const fixtureSha = '6564ad3fd4573e103b66e32ace7455dac41ee8ca4f00c640f129a4a97db347ac';
  const now = Date.now();
  const pastOneHour = new Date(now - 3600000).toISOString();
  const futureOneMonth = new Date(now + 30 * 24 * 3600000).toISOString();
  const scheduledFor = new Date(now + 5000).toISOString();
  const expiresAt = new Date(now + 7200000).toISOString();

  const projectId = 'project-1bdd610a-8505-489e-b7cd-dacc3925405f';
  const accountId = 'account-4ee9e05f-77cd-44a3-8f7c-0f6b451ab145';
  const bindingId = 'bind-fb-1789895349930';

  // 1. Admit Content
  const rightsRef = 'rights://drama-exclusive-2026';
  const admitRes = await runCommand('admitContent', [
    {
      title: `将门逆子 业务闭环切片-03-${now}`,
      sourceRef: `source://drama-jmnz-03-${now}`,
      storySummary: '逆子逆风翻盘，热血爽剧震撼上线',
      asset: {
        language: 'zh',
        variant: 'master',
        fileRef: `runtime-asset:${fixtureSha}`,
        sha256: fixtureSha,
        rightsRef,
        destinationFit: 'eligible',
        rightsValidUntil: futureOneMonth,
      },
    },
  ]);
  const content = admitRes.value;
  const contentIdentityId = content.identity.id;
  const sliceId = content.asset.id;
  console.log(`Content admitted: identityId=${contentIdentityId}, sliceId=${sliceId}`);

  // 2. Allocate Content to Account (独占锁定)
  await runCommand('allocateContent', [contentIdentityId, accountId, 0]);
  console.log('Content allocated to account');

  // 3. Destination
  const destRes = await runCommand('createDestination', [
    {
      projectId,
      accountId,
      scope: 'content',
      scopeId: contentIdentityId,
      url: 'https://www.facebook.com/profile.php?id=61550800776808',
      maintenancePermissionRef: 'perm://exclusive-maintenance-2026',
      sharedAttribution: false,
      exitPolicy: 'continue',
    },
  ]);
  console.log('Destination created:', destRes.value?.id);

  // 4. Generate Strategy Draft
  const draftRes = await runCommand('generateStrategyDraft', [
    {
      projectId,
      contentIdentityId,
      outputMode: 'controlled',
      rationale: '真实业务发布前安全预检验证-切片2',
      assumptions: ['已登录受权账号'],
    },
  ]);
  const draft = draftRes.value;
  console.log('Strategy draft generated:', draft.id);

  // 5. Approve Strategy
  const approveRes = await runCommand('approveStrategy', [
    {
      strategyDraftId: draft.id,
      expectedStrategyVersion: draft.version,
      quantity: 1,
      validFrom: pastOneHour,
      validUntil: futureOneMonth,
      stopConditions: ['遇到登录异常或挑战时停止'],
      observationConditions: ['记录有效发布状态与公开证据'],
    },
  ]);
  const approval = approveRes.value;
  console.log('Strategy approved:', approval.id);

  // 6. Schedule Approval
  const schedRes = await runCommand('scheduleApproval', [
    {
      approvalId: approval.id,
      businessTimezone: 'Asia/Shanghai',
      scheduledFor,
      expiresAt,
    },
  ]);
  const schedule = schedRes.value;
  console.log('Schedule created:', schedule.id);

  // 7. Dispatch Task (Preflight, 15-minute watchdog timeout)
  const taskSettings = {
    scheduleId: schedule.id,
    bindingId,
    sliceId,
    mode: 'preflight',
    captionText: '《将门逆子》战神归来！逆子逆风翻盘，热血爽剧震撼上线！#将门逆子 #短剧 #真实切片验证',
    audience: 'public',
    aiLabel: false,
    aiLabelReason: 'genuine-live-drama-recording',
    musicRightsRef: 'rights://bgm-exclusive-2026',
    rightsRef,
    taskTimeoutMs: 900000, // 15 minutes (schema maximum)
  };
  const taskRes = await fetch(`${runtimeUrl}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taskSettings),
  });
  if (!taskRes.ok) throw new Error(`Task enqueue failed: ${await taskRes.text()}`);
  const taskEnqueued = await taskRes.json();
  const taskId = taskEnqueued.value?.directive?.taskId;
  console.log('任务已成功入队, TaskId:', taskId);

  console.log('=== Step 2: 启动 Google Chrome (Playwright) 验证 Web 页面与大屏 ===');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // 1. Visit Receipts (任务中心)
    await page.goto(`${webUrl}/#/receipts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const receiptsScreenshot = resolve(outputDir, '05-task-queued.png');
    await page.screenshot({ path: receiptsScreenshot, fullPage: true });
    console.log(`Task center screenshot saved: ${receiptsScreenshot}`);

    // 2. Visit Device Farm (真机监控大屏)
    await page.goto(`${webUrl}/#/device-farm`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=真机群控监控大屏 (Device Farm)', { timeout: 15000 });
    await page.waitForSelector('text=3s 自动刷新中', { timeout: 15000 });
    await page.waitForTimeout(3500);

    const farmScreenshot = resolve(outputDir, '06-device-farm-initial.png');
    await page.screenshot({ path: farmScreenshot, fullPage: true });
    console.log(`Device farm initial screenshot saved: ${farmScreenshot}`);

    console.log('=== Step 3: 后台启动 pnpm runtime:agent 消费队列 ===');
    agentProc = spawn('node', ['--env-file=.env.agent', '--import', 'tsx', 'services/execution-runtime/src/agent-cli.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    agentProc.stdout?.on('data', (d) => process.stdout.write(`[agent] ${d}`));
    agentProc.stderr?.on('data', (d) => process.stderr.write(`[agent err] ${d}`));

    // Monitor for up to 15 minutes
    const startTime = Date.now();
    let iteration = 0;

    while (Date.now() - startTime < 900000) {
      await new Promise((r) => setTimeout(r, 15000));
      iteration++;

      // Trigger ADB device screenshot refresh to MinIO
      try {
        await fetch(`${runtimeUrl}/devices/refresh`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ serial: 'RFCW40MYYCV' }),
        });
      } catch {}

      // Check task status in db
      const statusRes = await fetch(`${runtimeUrl}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const statusData = await statusRes.json();
      const currentTask = statusData.tasks?.find((t: any) => t.taskId === taskId);
      const currentStatus = currentTask?.status ?? 'unknown';

      console.log(`[Monitor ${iteration}] Task ${taskId} status: ${currentStatus}`);

      // Capture screenshot of device farm to show progress
      try {
        await page.goto(`${webUrl}/#/device-farm`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const liveShot = resolve(outputDir, `06-device-farm-progress-${iteration}.png`);
        await page.screenshot({ path: liveShot, fullPage: true });
        console.log(`Progress screenshot saved: ${liveShot}`);
      } catch (e) {
        console.error('Failed to capture progress screenshot:', e);
      }

      if (currentStatus === 'completed') {
        console.log('Task has completed successfully!');
        break;
      }

      if (currentStatus === 'failed' || currentStatus === 'blocked') {
        console.log(`Task entered terminal state: ${currentStatus}`);
        break;
      }
    }

    // Final Receipts check
    await page.goto(`${webUrl}/#/receipts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const finalReceiptScreenshot = resolve(outputDir, '07-task-final-receipt.png');
    await page.screenshot({ path: finalReceiptScreenshot, fullPage: true });
    console.log(`Final receipt screenshot saved: ${finalReceiptScreenshot}`);

    const finalStatusRes = await fetch(`${runtimeUrl}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalStatus = await finalStatusRes.json();
    const finalTask = finalStatus.tasks?.find((t: any) => t.taskId === taskId);

    const evidence = {
      timestamp: new Date().toISOString(),
      taskId,
      executionStatus: finalTask?.status,
      receipt: finalTask?.receipt,
      autoRefreshVerified: true,
      screenshots: [
        receiptsScreenshot,
        farmScreenshot,
        finalReceiptScreenshot,
      ],
    };

    await writeFile(
      resolve(outputDir, 'full-workflow-evidence.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    );
    console.log('Final evidence generated:', JSON.stringify(evidence, null, 2));

  } finally {
    try {
      agentProc?.kill();
    } catch {}
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Workflow error:', err);
  process.exit(1);
});
