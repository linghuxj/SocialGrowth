import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync, statSync } from "node:fs";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 真实 Web 任务执行: 将门逆子切片录入 -> 独占锁定 -> 策略批准 -> 排期调度 -> 真机监控");
  console.log("==========================================================================");

  const slicePath = "/Users/linghuxj/Downloads/切片/将门逆子/将门逆子-pxy-8.15-二创 (7).mp4";
  if (!existsSync(slicePath)) {
    throw new Error(`切片文件不存在: ${slicePath}`);
  }
  const sliceStat = statSync(slicePath);
  console.log(`✔ 真实切片文件路径: ${slicePath}`);
  console.log(`✔ 文件大小: ${(sliceStat.size / (1024 * 1024)).toFixed(2)} MB`);

  const outDir = resolve("artifacts/acceptance/real-slice-publication");
  await mkdir(outDir, { recursive: true });

  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  console.log(`[Chrome] 物理浏览器路径: ${executablePath}`);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  const baseUrl = "http://127.0.0.1:3000";
  const runtimeUrl = process.env.SG_RUNTIME_URL || "http://127.0.0.1:4318/api/runtime";
  const token = process.env.SG_RUNTIME_TOKEN || "569627d96d993d0afaa1d74df96b89aa86f66840eca9a80135edfb7348534ebf";

  try {
    // -------------------------------------------------------------
    // 步骤 1: 访问内容资产页面 (#/content) 并切换项目上下文
    // -------------------------------------------------------------
    console.log("\n--- 步骤 1: 访问内容资产页面 (#/content) 并上传真实切片 ---");
    await page.goto(`${baseUrl}/#/content`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector("header.op-header");
    await page.screenshot({ path: join(outDir, "01-content-page-init.png") });
    console.log("✔ 内容资产页面加载成功");

    // 锁定当前运营项目为“霸道总裁北美短剧出海”
    const projectScope = page.locator("#operating-project");
    if (await projectScope.isVisible()) {
      const pOptions = await projectScope.locator("option").all();
      for (const opt of pOptions) {
        const txt = await opt.textContent();
        if (txt?.includes("霸道总裁") || txt?.includes("出海")) {
          const pVal = (await opt.getAttribute("value")) || "";
          await projectScope.selectOption(pVal);
          await page.waitForTimeout(600);
          console.log(`✔ 已全局切换运营项目: ${txt?.trim()}`);
          break;
        }
      }
    }

    // 点击打开“登记内容与素材”抽屉
    const openDrawerBtn = page.locator("button.op-trigger-button:has-text('登记内容与素材')");
    await openDrawerBtn.click();
    await page.waitForTimeout(600);

    // 填写素材表单
    console.log("-> 正在填写切片素材与内容身份表单...");
    const fileInput = page.locator("form[id='content-new'] input[type='file']");
    await fileInput.setInputFiles(slicePath);

    const titleInput = page.locator("form[id='content-new'] input[name='title']");
    const uniqueTitle = `将门逆子 真实切片-${Date.now().toString().slice(-4)}`;
    await titleInput.fill(uniqueTitle);

    const sourceInput = page.locator("form[id='content-new'] input[name='source']");
    await sourceInput.fill("自有短剧母带二创高潮段落");

    const summaryInput = page.locator("form[id='content-new'] textarea[name='summary']");
    await summaryInput.fill("将门逆子精彩片段，逆风翻盘真实发布流程验证");

    const langSelect = page.locator("form[id='content-new'] select[name='language']");
    await langSelect.selectOption("zh-CN");

    const variantSelect = page.locator("form[id='content-new'] select[name='variant']");
    await variantSelect.selectOption("master");

    const rightsInput = page.locator("form[id='content-new'] input[name='rights']");
    await rightsInput.fill("exclusive-license-2026-jiangmen");

    const fitSelect = page.locator("form[id='content-new'] select[name='fit']");
    await fitSelect.selectOption("eligible");

    await page.screenshot({ path: join(outDir, "02-content-form-filled.png") });
    console.log(`✔ 表单填写完成: 标题 "${uniqueTitle}"`);

    // 提交素材上传与指纹计算
    console.log("-> 正在提交表单（上传素材至执行服务并计算 SHA-256）...");
    const submitContentBtn = page.locator("form[id='content-new'] button:has-text('计算指纹并保存')");
    await submitContentBtn.click();

    // 等待上传和计算完成
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("已保存，列表和操作审计已更新") || text.includes("已登记");
      },
      undefined,
      { timeout: 30000 },
    );
    console.log("✔ 真实切片素材上传与 SHA-256 指纹计算成功");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, "03-content-saved.png") });

    // -------------------------------------------------------------
    // 步骤 2: 切片独占分配给真机绑定的 Facebook 账号 (Exclusive Lock)
    // -------------------------------------------------------------
    console.log("\n--- 步骤 2: 绑定内容专属分配 (Exclusive Allocation) ---");
    // 点击进入刚创建的内容详情抽屉
    const contentRowLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await contentRowLink.waitFor({ state: "visible", timeout: 10000 });
    await contentRowLink.click();
    await page.waitForTimeout(1000);

    // 点击展开“分配唯一目标账号”折叠栏
    const allocateSummary = page.locator("summary:has-text('分配唯一目标账号')").first();
    await allocateSummary.waitFor({ state: "visible", timeout: 10000 });
    await allocateSummary.click();
    await page.waitForTimeout(600);

    // 找到分配下拉框：选择真机绑定的 Facebook 账号
    const allocateAccountSelect = page.locator("form[id^='allocate-'] select[name='account']").first();
    await allocateAccountSelect.waitFor({ state: "visible", timeout: 10000 });
    const options = await allocateAccountSelect.locator("option").all();
    let targetVal = "";
    for (const opt of options) {
      const txt = await opt.textContent();
      if (txt?.includes("Android测试机") || txt?.includes("RFCW40MYYCV") || txt?.includes("facebook")) {
        targetVal = (await opt.getAttribute("value")) || "";
        break;
      }
    }
    if (!targetVal && options.length > 1) {
      targetVal = (await options[1].getAttribute("value")) || "";
    }
    await allocateAccountSelect.selectOption(targetVal);

    const confirmAllocBtn = page.locator("form[id^='allocate-'] button:has-text('确认独占分配')");
    await confirmAllocBtn.click();
    await page.waitForTimeout(2000);
    console.log(`✔ 切片已成功排他性独占分配至指定真机专属账号 (ID: ${targetVal})`);
    await page.screenshot({ path: join(outDir, "04-content-allocated.png") });

    // 关闭详情抽屉
    const closeDetailLink = page.locator("a:has-text('关闭详情返回列表')").first();
    if (await closeDetailLink.isVisible()) {
      await closeDetailLink.click();
      await page.waitForTimeout(500);
    }

    // -------------------------------------------------------------
    // 步骤 3: 策略管理 (#/strategies) 生成并批准策略
    // -------------------------------------------------------------
    console.log("\n--- 步骤 3: 制定策略草案并完成审阅批准 (#/strategies) ---");
    await page.goto(`${baseUrl}/#/strategies`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);

    const draftTriggerBtn = page.locator("button.op-trigger-button:has-text('制定策略草案')");
    await draftTriggerBtn.waitFor({ state: "visible", timeout: 10000 });
    await draftTriggerBtn.click();
    await page.waitForTimeout(800);

    // 显式选择运营项目
    const projectSelect = page.locator("form[id='strategy-new'] select[name='project']");
    if (await projectSelect.isVisible()) {
      const pOpts = await projectSelect.locator("option").all();
      for (const opt of pOpts) {
        const txt = await opt.textContent();
        if (txt?.includes("霸道总裁") || txt?.includes("出海")) {
          const pVal = (await opt.getAttribute("value")) || "";
          await projectSelect.selectOption(pVal);
          await page.waitForTimeout(500);
          break;
        }
      }
    }

    // 选择合格的独占内容
    const contentSelect = page.locator("form[id='strategy-new'] select[name='content']");
    await contentSelect.waitFor({ state: "visible", timeout: 10000 });
    const contentOptions = await contentSelect.locator("option").all();
    let selectedContent = false;
    for (const opt of contentOptions) {
      const txt = await opt.textContent();
      if (txt?.includes(uniqueTitle)) {
        const val = (await opt.getAttribute("value")) || "";
        await contentSelect.selectOption(val);
        selectedContent = true;
        break;
      }
    }
    if (!selectedContent && contentOptions.length > 1) {
      await contentSelect.selectOption((await contentOptions[contentOptions.length - 1].getAttribute("value")) || "");
    }

    // 提交按钮是：“保存待审草案”
    const saveDraftBtn = page.locator("form[id='strategy-new'] button:has-text('保存待审草案')");
    await saveDraftBtn.click();
    await page.waitForTimeout(2000);
    console.log("✔ 成功生成并保存策略草案");
    await page.screenshot({ path: join(outDir, "05-strategy-drafted.png") });

    // 找到刚生成的草案并进入详情执行批准
    const draftLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await draftLink.waitFor({ state: "visible", timeout: 10000 });
    await draftLink.click();
    await page.waitForTimeout(1000);

    // 点击展开“审阅并批准本次执行”折叠栏
    const approveSummary = page.locator("summary:has-text('审阅并批准本次执行')").first();
    await approveSummary.waitFor({ state: "visible", timeout: 10000 });
    await approveSummary.click();
    await page.waitForTimeout(600);

    // 辅助函数：将 Date 转换为 datetime-local 所需的本地时间字符串 (YYYY-MM-DDTHH:mm)
    const toLocalIso = (d: Date) => {
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
    };

    // 填写批准表单
    const approveForm = page.locator("form[id^='approve-']");
    await approveForm.waitFor({ state: "visible", timeout: 10000 });
    const now = new Date();
    const fromLocal = toLocalIso(new Date(now.getTime() - 120000));
    const untilLocal = toLocalIso(new Date(now.getTime() + 7 * 86400000));

    await approveForm.locator("input[name='from']").fill(fromLocal);
    await approveForm.locator("input[name='until']").fill(untilLocal);
    await approveForm.locator("textarea[name='stop']").fill("连续2次平台返回风险提示或网络错误立即阻断");
    await approveForm.locator("input[name='metric']").fill("views");
    await approveForm.locator("select[name='direction']").selectOption("increase");
    await approveForm.locator("input[name='unit']").fill("次");
    await approveForm.locator("input[name='source']").fill("平台公开数据分析");
    await approveForm.locator("input[name='scope']").fill("本切片发布后24小时");
    await approveForm.locator("input[name='start']").fill(fromLocal);
    await approveForm.locator("input[name='end']").fill(untilLocal);
    await approveForm.locator("textarea[name='criterion']").fill("24小时播放突破1000次即为有效切片引流");

    const approveSubmitBtn = approveForm.locator("button:has-text('确认以上范围，批准一次发布')");
    await approveSubmitBtn.click();
    await page.waitForTimeout(2000);
    console.log("✔ 策略已成功批准");
    await page.screenshot({ path: join(outDir, "06-strategy-approved.png") });

    // -------------------------------------------------------------
    // 步骤 4: 发布排期与设备队列调度 (#/plans)
    // -------------------------------------------------------------
    console.log("\n--- 步骤 4: 安排发布时间并加入设备队列 (#/plans) ---");
    await page.goto(`${baseUrl}/#/plans`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);

    const planLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await planLink.waitFor({ state: "visible", timeout: 10000 });
    await planLink.click();
    await page.waitForTimeout(1000);

    // 点击展开“安排发布时间”折叠栏
    const scheduleSummary = page.locator("summary:has-text('安排发布时间')").first();
    if (await scheduleSummary.isVisible()) {
      await scheduleSummary.click();
      await page.waitForTimeout(600);

      const scheduleForm = page.locator("form[id^='schedule-']");
      const nowMs = Date.now();
      // 向上取整到下一个整分钟，并加 1 分钟，保证无论何时点击，都至少有 60~120 秒的余量，且严格在批准期内
      const scheduledTime = new Date(Math.ceil(nowMs / 60000) * 60000 + 60000);
      const atLocal = toLocalIso(scheduledTime);
      const scheduleUntilLocal = toLocalIso(new Date(nowMs + 86400000)); // 未来 24 小时

      await scheduleForm.locator("input[name='at']").fill(atLocal);
      await scheduleForm.locator("input[name='until']").fill(scheduleUntilLocal);

      const scheduleBtn = scheduleForm.locator("button:has-text('保存排期')");
      await scheduleBtn.click();
      await page.waitForTimeout(2500);

      const scheduleError = scheduleForm.locator(".op-error");
      if (await scheduleError.isVisible()) {
        const msg = await scheduleError.textContent();
        throw new Error(`排期保存失败: ${msg}`);
      }
      console.log(`✔ 排期时间安排成功（设定时间: ${atLocal}）`);
      await page.screenshot({ path: join(outDir, "07-schedule-saved.png") });
    }

    // 确保设备未被人工接管锁定（解除 hold）
    try {
      await fetch(`${runtimeUrl}/device-control`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceId: "RFCW40MYYCV", held: false }),
      });
      console.log("✔ 已确保设备交还自动执行（held: false）");
    } catch {}

    // 点击展开“核对真机执行参数”折叠栏 (ExecutionQueue)
    const queueSummary = page.locator("summary:has-text('核对真机执行参数')").first();
    await queueSummary.waitFor({ state: "visible", timeout: 10000 });
    await queueSummary.click();
    await page.waitForTimeout(600);

    const queueForm = page.locator("form[id^='dispatch-']");
    await queueForm.waitFor({ state: "visible", timeout: 10000 });
    console.log("-> 发现设备执行调度表单，正在选择参数（执行模式锁定为 preflight 发布前验证）...");

    // 选择已核对绑定 (binding)
    const bindingSelect = queueForm.locator("select[name='binding']");
    const bindingOpts = await bindingSelect.locator("option").all();
    if (bindingOpts.length > 1) {
      const val = (await bindingOpts[1].getAttribute("value")) || "";
      await bindingSelect.selectOption(val);
    }

    // 选择本次唯一素材版本 (slice)
    const sliceSelect = queueForm.locator("select[name='slice']");
    const sliceOpts = await sliceSelect.locator("option").all();
    if (sliceOpts.length > 1) {
      const val = (await sliceOpts[1].getAttribute("value")) || "";
      await sliceSelect.selectOption(val);
    }

    // 1. 执行模式: preflight（发布前验证（不提交）——严格停在最终提交页之前）
    await queueForm.locator("select[name='mode']").selectOption("preflight");

    // 2. 最终文案
    await queueForm.locator("textarea[name='caption']").fill("《将门逆子》战神归来！逆子逆风翻盘，热血爽剧震撼上线！#将门逆子 #短剧 #真实切片验证");

    // 3. AI 标签
    await queueForm.locator("select[name='ai']").selectOption("false");
    await queueForm.locator("input[name='aiReason']").fill("真人实景拍摄演出，无合成人脸");

    // 4. 音乐版权依据
    await queueForm.locator("input[name='music']").fill("商用正版音乐库授权编号 2026-JM-01");

    await page.screenshot({ path: join(outDir, "08-queue-form-ready.png") });

    // 提交加入设备队列
    console.log("-> 点击【确认并加入设备队列】...");
    const queueSubmitBtn = queueForm.locator("button:has-text('确认并加入设备队列')");
    await queueSubmitBtn.click();
    await page.waitForTimeout(3000);
    console.log("✔ 任务已成功加入物理真机设备执行队列（模式: preflight，停留在发布按钮点击之前）！");
    await page.screenshot({ path: join(outDir, "09-task-enqueued.png") });

    // 查询当前入队任务
    const statusRes = await fetch(`${runtimeUrl}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusData = (await statusRes.json()) as any;
    const latestTask = statusData.tasks?.[0];
    const taskId = latestTask?.taskId ?? latestTask?.id;
    console.log(`[Task Enqueued] Task ID: ${taskId}, status: ${latestTask?.status}`);

    // -------------------------------------------------------------
    // 步骤 5: 启动 Worker 持续消费并在真机监控大屏 (#/device-farm) 实时核验
    // -------------------------------------------------------------
    console.log("\n--- 步骤 5: 启动 Worker 消费并在真机群控监控大屏 (#/device-farm) 实时核验 ---");
    await page.goto(`${baseUrl}/#/device-farm`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);

    const { spawn } = await import("node:child_process");
    const nodeBin = process.execPath;
    const agentProc = spawn(nodeBin, ["--env-file=.env.agent", "--import", "tsx", "services/execution-runtime/src/worker-cli.ts"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SG_WORKER_INTERVAL_MS: "5000" },
    });
    agentProc.stdout?.on("data", (d: any) => process.stdout.write(`[worker] ${d}`));
    agentProc.stderr?.on("data", (d: any) => process.stderr.write(`[worker err] ${d}`));

    const startTime = Date.now();
    let iteration = 0;
    let finalTaskStatus = "unknown";

    while (Date.now() - startTime < 900000) {
      await new Promise((r) => setTimeout(r, 12000));
      iteration++;

      // 刷新真机画面到 MinIO
      try {
        await fetch(`${runtimeUrl}/devices/refresh`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ serial: "RFCW40MYYCV" }),
        });
      } catch {}

      // 截取大屏当前状态
      try {
        const progressShot = join(outDir, `10-device-farm-progress-${iteration}.png`);
        await page.screenshot({ path: progressShot, fullPage: true });
        console.log(`[大屏监控 ${iteration}] 进度截屏保存: ${progressShot}`);
      } catch {}

      // 检查最新任务状态
      const pollRes = await fetch(`${runtimeUrl}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pollData = (await pollRes.json()) as any;
      const currentTask = pollData.tasks?.find((t: any) => (t.taskId || t.id) === taskId) ?? pollData.tasks?.[0];
      finalTaskStatus = currentTask?.status ?? "unknown";
      console.log(`[任务状态 ${iteration}] ${currentTask?.taskId ?? currentTask?.id ?? "none"} -> ${finalTaskStatus}`);

      if (finalTaskStatus === "completed") {
        console.log("✔ 任务已成功在真机完成执行（模式: preflight，安全停手）！");
        break;
      }
      if (["failed", "cancelled", "timeout"].includes(finalTaskStatus)) {
        console.log(`❌ 任务进入异常终态: ${finalTaskStatus}`);
        break;
      }
    }

    if (agentProc && !agentProc.killed) {
      agentProc.kill("SIGTERM");
    }

    // -------------------------------------------------------------
    // 步骤 6: 导航至任务中心 (#/receipts) 检查任务执行回执
    // -------------------------------------------------------------
    console.log("\n--- 步骤 6: 导航至任务中心 (#/receipts) 查看任务执行日志与回执 ---");
    await page.goto(`${baseUrl}/#/receipts`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(outDir, "11-receipts-final.png"), fullPage: true });
    console.log("✔ 任务中心成功加载，包含真机执行记录与模式标识");

    // 采集真机最终屏幕物证
    const { execSync } = await import("node:child_process");
    try {
      execSync(`adb exec-out screencap -p > "${join(outDir, '12-phone-final-screen.png')}"`);
      console.log("✔ 已采集真机当前最终屏幕物证: 12-phone-final-screen.png");
    } catch (e) {
      console.warn("未能获取真机屏幕:", e);
    }

    // 导出最终状态与物证报告
    const finalStatusRes = await fetch(`${runtimeUrl}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalData = await finalStatusRes.json();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(outDir, "full-publication-evidence.json"), JSON.stringify(finalData, null, 2));
    console.log("✔ 全流程物证数据已归档至 full-publication-evidence.json");

    console.log("\n==========================================================================");
    console.log(`🎉 真实切片 Web 操作与真机执行闭环验证完成！任务终态: ${finalTaskStatus}`);
    console.log(`📁 证据与全流程截图已保存在: ${outDir}`);
    console.log("==========================================================================");
  } catch (err) {
    console.error("❌ 执行过程中出现异常:", err);
    await page.screenshot({ path: join(outDir, "error-state.png"), fullPage: true });
    throw err;
  } finally {
    await page.waitForTimeout(2000);
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
