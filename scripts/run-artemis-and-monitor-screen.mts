import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 Artemis 真机执行与 Web 监控大屏端到端实时联动验收");
  console.log("==========================================================================");

  const outDir = resolve("artifacts/acceptance/artemis-live-monitoring");
  await mkdir(outDir, { recursive: true });

  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  console.log(`[Chrome] 物理浏览器路径: ${executablePath}`);

  // 1. 启动真实 Google Chrome 浏览器
  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  // 监听浏览器网络请求，捕捉 screenshot 与 step 相关的加载
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/api/runtime/screenshots/")) {
      console.log(`[Web Console Network] 收到真机截屏图像响应: ${res.status()} ${url}`);
    }
  });

  const baseUrl = "http://127.0.0.1:3000";

  // 检查设备人工接管状态并在 Web 页面上解除 Hold
  console.log("\n--- 前置步骤: 检查设备接管状态并交还自动复查 ---");
  await page.goto(`${baseUrl}/#/device-farm`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1000);

  const releaseRes = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/runtime/device-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'RFCW40MYYCV', held: false }),
      });
      return await res.json();
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log("✔ 调用 Web 运营端接口解除人工接管结果:", JSON.stringify(releaseRes));
  await page.waitForTimeout(1000);

  // 步骤 1: 访问真机监控大屏
  console.log(`\n--- 步骤 1: 访问真机监控大屏 (#/device-farm) ---`);
  await page.goto(`${baseUrl}/#/device-farm`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(2000);

  const initialShot = join(outDir, "01-device-farm-initial.png");
  await page.screenshot({ path: initialShot });
  console.log(`✔ 初始真机大屏已就绪，已保存截图: ${initialShot}`);

  // 验证大屏上是否存在 Galaxy S23 / RFCW40MYYCV 卡片
  const phoneCard = page.locator("div:has-text('RFCW40MYYCV')").first();
  const cardVisible = await phoneCard.isVisible();
  console.log(`✔ 真机 RFCW40MYYCV 卡片可见性: ${cardVisible}`);

  // 步骤 2: 启动 Artemis 设备任务执行 (pnpm runtime:agent)
  console.log(`\n--- 步骤 2: 启动 Artemis 任务执行 (pnpm runtime:agent) ---`);
  
  const agentProcess = spawn("pnpm", ["runtime:agent"], {
    cwd: resolve("."),
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let agentOutput = "";
  agentProcess.stdout?.on("data", (data) => {
    const text = data.toString();
    agentOutput += text;
    process.stdout.write(`[Artemis Agent stdout] ${text}`);
  });

  agentProcess.stderr?.on("data", (data) => {
    const text = data.toString();
    agentOutput += text;
    process.stderr.write(`[Artemis Agent stderr] ${text}`);
  });

  let agentFinished = false;
  let agentExitCode: number | null = null;
  agentProcess.on("exit", (code) => {
    agentFinished = true;
    agentExitCode = code;
    console.log(`\n[Artemis Agent] 进程退出，退出码: ${code}`);
  });

  // 步骤 3: 监控大屏：轮询与变化捕捉
  console.log(`\n--- 步骤 3: 实时监控真机大屏内容与截屏渲染 ---`);
  
  let lastImageSrc = "";
  let lastStepText = "";
  let lastActionDesc = "";
  let captureCount = 1;
  const startTime = Date.now();
  const maxTimeoutMs = 300000; // 最长监控 5 分钟

  while (Date.now() - startTime < maxTimeoutMs) {
    // 检查页面上当前显示的内容
    const screenImg = page.locator("img[alt='物理真机屏幕画面']").first();
    const currentSrc = (await screenImg.getAttribute("src").catch(() => null)) || "";
    
    // 检查步骤数与动作描述
    const stepLocator = page.locator("text=/Step \\d+/").first();
    const currentStep = (await stepLocator.textContent().catch(() => null)) || "";

    // 检查动作描述
    const actionDescLocator = page.locator("div.bg-slate-950\\/80 p").first();
    const currentDesc = (await actionDescLocator.textContent().catch(() => null)) || "";

    const hasChanged = 
      (currentSrc && currentSrc !== lastImageSrc) ||
      (currentStep && currentStep !== lastStepText) ||
      (currentDesc && currentDesc !== lastActionDesc);

    if (hasChanged) {
      captureCount++;
      const snapName = `${String(captureCount).padStart(2, "0")}-artemis-progress.png`;
      const snapPath = join(outDir, snapName);
      await page.screenshot({ path: snapPath });
      
      console.log(`\n[大屏状态更新 Frame ${captureCount}]`);
      if (currentSrc !== lastImageSrc) {
        console.log(`  📸 截屏 URL 变化: ${currentSrc}`);
        lastImageSrc = currentSrc;
      }
      if (currentStep !== lastStepText) {
        console.log(`  🔢 步骤变化: ${currentStep}`);
        lastStepText = currentStep;
      }
      if (currentDesc !== lastActionDesc) {
        console.log(`  📝 动作描述: ${currentDesc.trim()}`);
        lastActionDesc = currentDesc;
      }
      console.log(`  💾 已保存监控大屏画面: ${snapPath}`);
    }

    if (agentFinished) {
      console.log("\n✔ 检测到 Artemis Agent 任务已结束执行，进行最终大屏状态确认...");
      await page.waitForTimeout(3000);
      break;
    }

    await page.waitForTimeout(1000);
  }

  // 最终大屏截图
  const finalShot = join(outDir, "final-device-farm-completed.png");
  await page.screenshot({ path: finalShot });
  console.log(`✔ 最终真机监控大屏画面已保存: ${finalShot}`);

  console.log("\n==========================================================================");
  console.log("🏁 Artemis 执行与真机监控大屏联动测试执行完毕");
  console.log(`- Agent 退出码: ${agentExitCode}`);
  console.log(`- 捕获状态更新帧数: ${captureCount}`);
  console.log(`- 监控产物目录: ${outDir}`);
  console.log("==========================================================================");

  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((err) => {
  console.error("执行发生异常:", err);
  process.exit(1);
});
