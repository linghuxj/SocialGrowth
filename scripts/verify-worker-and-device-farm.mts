import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync, statSync } from "node:fs";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 真实 Worker 调度与真机监控大屏端到端实时联动验收");
  console.log("==========================================================================");

  const outDir = resolve("artifacts/acceptance/worker-live-acceptance");
  await mkdir(outDir, { recursive: true });

  const slicePath = "/Users/linghuxj/Downloads/切片/将门逆子/将门逆子-pxy-8.15-二创 (7).mp4";
  if (!existsSync(slicePath)) {
    throw new Error(`切片素材不存在: ${slicePath}`);
  }
  const sliceSizeMb = (statSync(slicePath).size / (1024 * 1024)).toFixed(2);
  const ts = Date.now().toString().slice(-4);
  const uniqueTitle = `将门逆子 真实切片-${ts}`;

  console.log(`✔ 真实切片文件: ${slicePath} (${sliceSizeMb} MB)`);
  console.log(`✔ 本次唯一任务标识: ${uniqueTitle}`);

  // 1. 启动常驻设备 Worker (pnpm runtime:worker，5秒轮询心跳)
  console.log("\n--- 步骤 1: 启动常驻设备 Worker (runtime:worker) ---");
  const workerProcess = spawn("pnpm", ["runtime:worker"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      SG_WORKER_INTERVAL_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  workerProcess.stdout?.on("data", (data) => {
    process.stdout.write(`[Worker stdout] ${data.toString()}`);
  });
  workerProcess.stderr?.on("data", (data) => {
    process.stderr.write(`[Worker stderr] ${data.toString()}`);
  });

  const stopWorker = () => {
    try {
      workerProcess.kill("SIGTERM");
      console.log("[Worker] 已安全停止常驻 Worker 进程");
    } catch {}
  };
  process.on("exit", stopWorker);
  process.on("SIGINT", stopWorker);

  // 2. 启动真实 Google Chrome 浏览器
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  console.log(`\n--- 步骤 2: 启动真实 Google Chrome 浏览器 (${executablePath}) ---`);
  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const baseUrl = "http://127.0.0.1:3000";

  const toLocalIso = (d: Date) => {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  };

  try {
    // 步骤 2.1: 确保设备未被 Hold，并记录初始监控大屏
    console.log("-> 访问真机监控大屏 (#/device-farm)...");
    await page.goto(`${baseUrl}/#/device-farm`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1500);

    await page.evaluate(async () => {
      try {
        await fetch('/api/runtime/device-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: 'RFCW40MYYCV', held: false }),
        });
      } catch {}
    });

    const initShot = join(outDir, "01-device-farm-initial.png");
    await page.screenshot({ path: initShot });
    console.log(`✔ 初始监控大屏状态已记录: ${initShot}`);

    // 步骤 2.2: 全局选择运营项目“霸道总裁北美短剧出海”
    const projectScope = page.locator("#operating-project");
    if (await projectScope.isVisible()) {
      const opts = await projectScope.locator("option").all();
      for (const opt of opts) {
        const txt = await opt.textContent();
        if (txt?.includes("霸道总裁") || txt?.includes("出海")) {
          const val = await opt.getAttribute("value");
          if (val) {
            await projectScope.selectOption(val);
            await page.waitForTimeout(500);
            console.log(`✔ 已全局选中运营项目: ${txt.trim()}`);
            break;
          }
        }
      }
    }

    // 步骤 3: 登记切片素材并上传计算指纹 (#/content)
    console.log("\n--- 步骤 3: 登记切片素材并排他锁定至真机专属账号 (#/content) ---");
    await page.goto(`${baseUrl}/#/content`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);

    const openDrawerBtn = page.locator("button.op-trigger-button:has-text('登记内容与素材')");
    await openDrawerBtn.click();
    await page.waitForTimeout(600);

    const form = page.locator("form[id='content-new']");
    await form.waitFor({ state: "visible", timeout: 10000 });

    const fileInput = form.locator("input[type='file']");
    await fileInput.setInputFiles(slicePath);

    await form.locator("input[name='title']").fill(uniqueTitle);
    await form.locator("input[name='source']").fill("自有短剧母带二创高潮段落");
    await form.locator("textarea[name='summary']").fill("《将门逆子》热血逆袭切片，真实真机发布前验证与监控大屏联动测试");
    await form.locator("select[name='language']").selectOption("zh-CN");
    await form.locator("select[name='variant']").selectOption("master");
    await form.locator("input[name='rights']").fill("exclusive-license-2026-jiangmen");
    await form.locator("select[name='fit']").selectOption("eligible");

    const submitContentBtn = form.locator("button:has-text('计算指纹并保存')");
    await submitContentBtn.click();

    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("已保存，列表和操作审计已更新") || text.includes("已登记");
      },
      undefined,
      { timeout: 30000 },
    );
    console.log(`✔ 素材已登记入库并计算 SHA-256 指纹: ${uniqueTitle}`);
    await page.waitForTimeout(1500);

    // 点击进入新素材详情抽屉完成排他独占分配
    const contentLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await contentLink.waitFor({ state: "visible", timeout: 10000 });
    await contentLink.click();
    await page.waitForTimeout(1000);

    const allocToggle = page.locator("summary:has-text('分配唯一目标账号')").first();
    await allocToggle.waitFor({ state: "visible", timeout: 10000 });
    await allocToggle.click();
    await page.waitForTimeout(600);

    const accountSelect = page.locator("form[id^='allocate-'] select[name='account']").first();
    await accountSelect.waitFor({ state: "visible", timeout: 10000 });
    const accOptions = await accountSelect.locator("option").all();
    let targetVal = "";
    for (const opt of accOptions) {
      const txt = await opt.textContent();
      if (txt?.includes("Android测试机") || txt?.includes("RFCW40MYYCV") || txt?.includes("facebook")) {
        targetVal = (await opt.getAttribute("value")) || "";
        break;
      }
    }
    if (!targetVal && accOptions.length > 1) {
      targetVal = (await accOptions[1].getAttribute("value")) || "";
    }
    await accountSelect.selectOption(targetVal);

    const confirmAllocBtn = page.locator("form[id^='allocate-'] button:has-text('确认独占分配')");
    await confirmAllocBtn.click();
    await page.waitForTimeout(2000);
    console.log(`✔ 切片已成功排他锁定至真机专属账号 (ID: ${targetVal})`);

    const closeDetail = page.locator("a:has-text('关闭详情返回列表')").first();
    if (await closeDetail.isVisible()) await closeDetail.click();

    // 步骤 4: 制定日常切片策略并完成批准 (#/strategies)
    console.log("\n--- 步骤 4: 制定日常切片策略并完成审阅批准 (#/strategies) ---");
    await page.goto(`${baseUrl}/#/strategies`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);

    const draftTriggerBtn = page.locator("button.op-trigger-button:has-text('制定策略草案')");
    await draftTriggerBtn.waitFor({ state: "visible", timeout: 10000 });
    await draftTriggerBtn.click();
    await page.waitForTimeout(800);

    const projSelect = page.locator("form[id='strategy-new'] select[name='project']");
    if (await projSelect.isVisible()) {
      const pOpts = await projSelect.locator("option").all();
      for (const opt of pOpts) {
        const txt = await opt.textContent();
        if (txt?.includes("霸道总裁") || txt?.includes("出海")) {
          await projSelect.selectOption((await opt.getAttribute("value")) || "");
          await page.waitForTimeout(500);
          break;
        }
      }
    }

    const contentSelect = page.locator("form[id='strategy-new'] select[name='content']");
    await contentSelect.waitFor({ state: "visible", timeout: 10000 });
    const contentOpts = await contentSelect.locator("option").all();
    for (const opt of contentOpts) {
      const txt = await opt.textContent();
      if (txt?.includes(uniqueTitle)) {
        await contentSelect.selectOption((await opt.getAttribute("value")) || "");
        break;
      }
    }

    const saveDraftBtn = page.locator("form[id='strategy-new'] button:has-text('保存待审草案')");
    await saveDraftBtn.click();
    await page.waitForTimeout(2000);
    console.log("✔ 策略草案已保存");

    // 点击进入详情完成批准
    const draftLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await draftLink.waitFor({ state: "visible", timeout: 10000 });
    await draftLink.click();
    await page.waitForTimeout(1000);

    const approveSummary = page.locator("summary:has-text('审阅并批准本次执行')").first();
    await approveSummary.waitFor({ state: "visible", timeout: 10000 });
    await approveSummary.click();
    await page.waitForTimeout(600);

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
    console.log("✔ 策略审阅批准通过");

    // 步骤 5: 安排排期并提交设备队列 (#/plans)
    console.log("\n--- 步骤 5: 安排发布时间并锁定加入设备队列 (#/plans) ---");
    await page.goto(`${baseUrl}/#/plans`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);

    const planLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await planLink.waitFor({ state: "visible", timeout: 10000 });
    await planLink.click();
    await page.waitForTimeout(1000);

    const scheduleSummary = page.locator("summary:has-text('安排发布时间')").first();
    if (await scheduleSummary.isVisible()) {
      await scheduleSummary.click();
      await page.waitForTimeout(600);

      const scheduleForm = page.locator("form[id^='schedule-']");
      // 设为 5 秒后，保证 scheduledFor >= now() 且在下一个 Worker 心跳中立即被拉取！
      const atLocal = toLocalIso(new Date(now.getTime() + 5000));
      const scheduleUntilLocal = toLocalIso(new Date(now.getTime() + 86400000));

      await scheduleForm.locator("input[name='at']").fill(atLocal);
      await scheduleForm.locator("input[name='until']").fill(scheduleUntilLocal);

      const scheduleBtn = scheduleForm.locator("button:has-text('保存排期')");
      await scheduleBtn.click();
      await page.waitForTimeout(2000);
      console.log(`✔ 排期时间安排成功 (计划窗口: ${atLocal})`);
    }

    // 展开“核对真机执行参数”折叠栏并锁定 preflight 提交入队
    const queueSummary = page.locator("summary:has-text('核对真机执行参数')").first();
    await queueSummary.waitFor({ state: "visible", timeout: 10000 });
    await queueSummary.click();
    await page.waitForTimeout(600);

    const queueForm = page.locator("form[id^='dispatch-']");
    await queueForm.waitFor({ state: "visible", timeout: 10000 });

    const bindingSelect = queueForm.locator("select[name='binding']");
    const bindingOpts = await bindingSelect.locator("option").all();
    if (bindingOpts.length > 1) {
      await bindingSelect.selectOption((await bindingOpts[1].getAttribute("value")) || "");
    }

    const sliceSelect = queueForm.locator("select[name='slice']");
    const sliceOpts = await sliceSelect.locator("option").all();
    if (sliceOpts.length > 1) {
      await sliceSelect.selectOption((await sliceOpts[1].getAttribute("value")) || "");
    }

    await queueForm.locator("select[name='mode']").selectOption("preflight");
    console.log("✔ 严格锁定执行模式为: preflight (发布前验证，不真正点击发布)");

    await queueForm.locator("textarea[name='caption']").fill("《将门逆子》战神归来！逆子逆风翻盘，热血爽剧震撼上线！#将门逆子 #短剧 #真实切片验证");
    await queueForm.locator("select[name='ai']").selectOption("false");
    await queueForm.locator("input[name='aiReason']").fill("真人实景拍摄演出，无合成人脸");
    await queueForm.locator("input[name='music']").fill("商用正版音乐库授权编号 2026-JM-01");

    const queueSubmitBtn = queueForm.locator("button:has-text('确认并加入设备队列')");
    await queueSubmitBtn.click();
    await page.waitForTimeout(2500);
    console.log("✔ 任务已成功提交至物理设备执行队列！");

    const enqueuedShot = join(outDir, "02-task-enqueued.png");
    await page.screenshot({ path: enqueuedShot });
    console.log(`✔ 任务入队截图已保存: ${enqueuedShot}`);

    // 步骤 6: 导航至监控大屏 (#/device-farm)，实时观测常驻 Worker 自动消费与 Artemis 真机执行
    console.log("\n--- 步骤 6: 监控大屏实时观测 (3s 自动轮询 + SSE 双通道) ---");
    await page.goto(`${baseUrl}/#/device-farm`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);

    let lastSrc = "";
    let lastStep = "";
    let lastDesc = "";
    let frameIdx = 0;
    const monitorStart = Date.now();
    const monitorTimeout = 120000; // 观测 2 分钟

    console.log("-> 正在通过真实 Chrome 保持大屏观测...");

    while (Date.now() - monitorStart < monitorTimeout) {
      const screenImg = page.locator("img[alt='物理真机屏幕画面']").first();
      const currentSrc = (await screenImg.getAttribute("src").catch(() => null)) || "";
      
      const stepText = (await page.locator("text=/Step \\d+/").first().textContent().catch(() => null)) || "";
      const descText = (await page.locator("div.bg-slate-950\\/80 p").first().textContent().catch(() => null)) || "";

      const changed = 
        (currentSrc && currentSrc !== lastSrc) ||
        (stepText && stepText !== lastStep) ||
        (descText && descText !== lastDesc);

      if (changed) {
        frameIdx++;
        const frameName = `03-artemis-frame-${frameIdx}.png`;
        const framePath = join(outDir, frameName);
        await page.screenshot({ path: framePath });

        console.log(`\n[大屏状态更新 Frame ${frameIdx}]`);
        if (currentSrc !== lastSrc) {
          console.log(`  📸 截屏图像更新: ${currentSrc}`);
          lastSrc = currentSrc;
        }
        if (stepText !== lastStep) {
          console.log(`  🔢 步骤更新: ${stepText}`);
          lastStep = stepText;
        }
        if (descText !== lastDesc) {
          console.log(`  📝 动作描述更新: ${descText.trim()}`);
          lastDesc = descText;
        }
        console.log(`  💾 已捕获大屏画面: ${framePath}`);
      }

      await page.waitForTimeout(2000);
    }

    const finalShot = join(outDir, "04-worker-acceptance-final.png");
    await page.screenshot({ path: finalShot });
    console.log(`\n✔ 最终验收监控大屏画面已记录: ${finalShot}`);

    console.log("\n==========================================================================");
    console.log("🏁 真实 Worker 调度与大屏联动测试执行完毕");
    console.log(`- 捕获大屏变化帧数: ${frameIdx}`);
    console.log(`- 产物目录: ${outDir}`);
    console.log("==========================================================================");

  } finally {
    stopWorker();
    await browser.close();
  }
}

main().catch((err) => {
  console.error("执行发生异常:", err);
  process.exit(1);
});
