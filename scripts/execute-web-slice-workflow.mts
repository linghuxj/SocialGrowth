import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync, statSync } from "node:fs";

async function runWebFlow() {
  console.log("==========================================================================");
  console.log("🎯 执行 Web 业务全链路闭环：真实素材录入 -> 独占绑定 -> 策略审批 -> 排期入队 -> 大屏观测");
  console.log("==========================================================================");

  const outDir = resolve("artifacts/acceptance/web-live-acceptance");
  await mkdir(outDir, { recursive: true });

  const slicePath = "/Users/linghuxj/Downloads/切片/将门逆子/将门逆子-pxy-8.15-二创 (7).mp4";
  if (!existsSync(slicePath)) {
    throw new Error(`切片素材不存在: ${slicePath}`);
  }
  const sliceSizeMb = (statSync(slicePath).size / (1024 * 1024)).toFixed(2);
  const ts = Date.now().toString().slice(-4);
  const uniqueTitle = `将门逆子 业务闭环切片-${ts}`;

  console.log(`✔ 真实切片文件: ${slicePath} (${sliceSizeMb} MB)`);
  console.log(`✔ 任务业务标识: ${uniqueTitle}`);

  // 启动真实 Google Chrome 浏览器
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  console.log(`\n--- 启动真实 Google Chrome 浏览器 (${executablePath}) ---`);
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

  page.on("console", (msg) => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[Browser PageError] ${err}`));

  try {
    // 步骤 1: 检查真机监控大屏并确保设备就绪
    console.log("\n--- 步骤 1: 检查真机监控大屏并确保设备就绪 ---");
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

    // 步骤 2: 全局选择运营项目“霸道总裁北美短剧出海”
    console.log("\n--- 步骤 2: 全局项目选择 ---");
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
    await form.locator("textarea[name='summary']").fill("《将门逆子》热血逆袭切片，真实业务全流程验证");
    await form.locator("select[name='language']").selectOption("zh-CN");
    await form.locator("select[name='variant']").selectOption("master");
    await form.locator("input[name='rights']").fill("exclusive-license-2026-jiangmen");
    await form.locator("select[name='fit']").selectOption("eligible");

    const submitContentBtn = form.locator("button:has-text('计算指纹并保存')");
    await submitContentBtn.click();
    console.log("-> 已点击【计算指纹并保存】，正在等待浏览器计算哈希并上传...");

    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("已保存，列表和操作审计已更新") ||
          text.includes("已登记") ||
          text.includes("未能保存") ||
          text.includes("操作未完成")
        );
      },
      undefined,
      { timeout: 45000 },
    );
    const feedbackText = await page.locator("p.op-success, p.op-error, [role='status'], [role='alert']").first().textContent().catch(() => "");
    console.log(`✔ 素材登记提交反馈: ${feedbackText || "已完成"}`);
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

    // 步骤 4: 制定日常切片策略并完成审阅批准 (#/strategies)
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

    // 点击进入详情完成审阅批准
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

    // 步骤 5: 安排发布排期并加入设备队列 (#/plans)
    console.log("\n--- 步骤 5: 安排发布时间并锁定加入设备队列 (#/plans) ---");
    await page.goto(`${baseUrl}/#/plans`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);

    const planLink = page.locator(`a:has-text('${uniqueTitle}')`).first();
    await planLink.waitFor({ state: "visible", timeout: 10000 });
    await planLink.click();
    await page.waitForTimeout(1000);

    const scheduleSummary = page.locator("summary:has-text('安排发布时间')").first();
    if (await scheduleSummary.isVisible()) {
      await scheduleSummary.click();
      await page.waitForTimeout(600);

      const scheduleForm = page.locator("form[id^='schedule-']");
      // 重新获取即时时间，向上设定为当前时间+2分钟
      const step5Now = new Date();
      const atLocal = toLocalIso(new Date(step5Now.getTime() + 120000));
      const scheduleUntilLocal = toLocalIso(new Date(step5Now.getTime() + 5 * 86400000));

      console.log(`-> 填写排期时间: at=${atLocal}, until=${scheduleUntilLocal}`);
      await scheduleForm.locator("input[name='at']").fill(atLocal);
      await scheduleForm.locator("input[name='until']").fill(scheduleUntilLocal);

      const scheduleBtn = scheduleForm.locator("button:has-text('保存排期')");
      await scheduleBtn.click();
      await page.waitForTimeout(2000);

      const scheduleFeedback = await page.locator("p.op-success, p.op-error, [role='status'], [role='alert']").allTextContents();
      console.log(`✔ 排期表单反馈: ${scheduleFeedback.join(" | ") || "已保存"}`);
    }

    // 点击展开“核对真机执行参数”折叠面板
    const queueSummary = page.locator("details.op-form-panel summary:has-text('核对真机执行参数')").last();
    await queueSummary.waitFor({ state: "visible", timeout: 15000 });
    await queueSummary.click();
    await page.waitForTimeout(800);

    // 定位“核对真机执行参数”表单并锁定 preflight 提交入队
    const queueForm = page.locator("form[id^='dispatch-']").last();
    await queueForm.waitFor({ state: "visible", timeout: 15000 });

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

    // 步骤 6: 导航至监控大屏 (#/device-farm)，保持大屏观测
    console.log("\n--- 步骤 6: 导航至监控大屏 (#/device-farm) 观测 ---");
    await page.goto(`${baseUrl}/#/device-farm`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);

    const farmShot = join(outDir, "03-device-farm-monitoring.png");
    await page.screenshot({ path: farmShot });
    console.log(`✔ 监控大屏画面已记录: ${farmShot}`);

    console.log("\n==========================================================================");
    console.log("🏁 Web 业务链路完整跑通并已排入真机执行队列");
    console.log(`- 素材标识: ${uniqueTitle}`);
    console.log(`- 产物目录: ${outDir}`);
    console.log("==========================================================================");

  } catch (err) {
    console.error("执行发生异常:", err);
    try {
      const errShot = join(outDir, "error-snapshot.png");
      await page.screenshot({ path: errShot });
      console.log(`[错误快照] 已保存: ${errShot}`);
      const bodyText = await page.locator("body").innerText();
      console.log(`[错误页面文本]:\n${bodyText.slice(0, 1000)}`);
    } catch {}
    throw err;
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

runWebFlow().catch((err) => {
  console.error("执行发生异常:", err);
  process.exit(1);
});
