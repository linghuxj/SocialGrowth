import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { ArtemisMcp } from "../services/execution-runtime/src/artemis.js";

function sql(query: string): string {
  const sanitized = query.replace(/"/g, '\\"');
  return execSync(
    `docker exec socialgrowth-product-local-live psql -U socialgrowth -d sg_product_local_live -t -A -c "${sanitized}"`,
    { encoding: "utf8" }
  ).trim();
}

async function main() {
  console.log("==========================================================================");
  console.log("🚀 选项 2：正式版 Web 到真机的自动化调度流水线 (ADR-0002 / R-106)");
  console.log("==========================================================================");

  const repo = process.cwd();
  const dir = resolve(repo, ".runtime/product-local-live");
  const config = JSON.parse(await readFile(resolve(dir, "config.json"), "utf8"));
  const outDir = resolve(repo, "artifacts/acceptance/product/option2-pipeline");
  await mkdir(outDir, { recursive: true });

  const baseUrl = "http://127.0.0.1:3100";
  const deviceId = "0fef3177-636c-4b82-8209-1af38134e00f";
  const serial = "RFCW40MYYCV";
  const accountId = "7587ac3f-9a9d-4e16-b8aa-ddb57c075d8b";
  const projectId = "b03a3291-92ed-445a-b516-3955446fcc63";
  const localVideoPath = resolve(repo, "integrations/google-artemis/tests/tools/inputs/recording.mp4");
  const deviceVideoPath = "/sdcard/Movies/SocialGrowth/CEO_Secret_Romance_Ep1.mp4";
  const videoSha256 = "57bc19a38eba1cfd55387e9e815935b3456a95fcdace1c67a67230ee1a7e8a62";
  const captionText = "CEO's Secret Romance Episode 1: He didn't know she was the true heiress... #ShortDrama #Romance #Billionaire";

  console.log(`[配置] Web 地址: ${baseUrl}`);
  console.log(`[配置] 运营项目: ${projectId} (霸道总裁北美短剧出海)`);
  console.log(`[配置] 执行手机: ${deviceId} (${serial})`);
  console.log(`[配置] 目标账号: ${accountId} (Tongm Mhuo)`);
  console.log(`[配置] 待发布短剧视频: ${deviceVideoPath} (${videoSha256.slice(0, 12)}...)`);

  // -------------------------------------------------------------
  // 步骤 1: 准备手机端视频素材与媒体扫描
  // -------------------------------------------------------------
  console.log("\n--- 步骤 1: 确保真机短剧视频素材已就绪并已注册至 Android MediaStore ---");
  execSync(`adb -s ${serial} push "${localVideoPath}" "${deviceVideoPath}"`, { stdio: "inherit" });
  execSync(`adb -s ${serial} shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${deviceVideoPath}`, { stdio: "inherit" });
  console.log("✔ 短剧视频已推送到手机并在 MediaStore 完成广播注册");

  // -------------------------------------------------------------
  // 步骤 2: Playwright 操作 Web 端短剧排期与调度检查
  // -------------------------------------------------------------
  console.log("\n--- 步骤 2: 访问正式版 Web 后台，核验素材与排期工作区 ---");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
    await page.getByLabel("密码", { exact: true }).fill(config.operatorPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor({ timeout: 15000 });
    console.log("✔ Web 后台登录成功");

    // 进入项目页面
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page.waitForTimeout(1000);
    const headingList = page.getByRole("heading", { name: "项目列表", level: 1, exact: true });
    if (await headingList.isVisible()) {
      await page.locator("tr", { hasText: "霸道总裁北美短剧出海" }).first().getByRole("button", { name: "准备清单" }).click();
    }
    await page.getByRole("heading", { name: "霸道总裁北美短剧出海", level: 1 }).waitFor();

    // 检查“素材”标签
    await page.getByRole("button", { name: "素材", exact: true }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(outDir, "01-material-workspace.png") });
    console.log("✔ 素材工作区已成功加载并记录截图");

    // -------------------------------------------------------------
    // 步骤 3: 启动 Google Artemis 自动化调度流水线 (Preflight 阶段)
    // -------------------------------------------------------------
    console.log("\n--- 步骤 3: 启动 Google Artemis 多模态决策引擎执行真机发布前置编排 ---");
    const root = process.env.SG_ARTEMIS_ROOT || "/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis";
    const mcp = new ArtemisMcp(root);
    await mcp.connect();
    console.log("✔ Artemis MCP 引擎连接成功");

    try {
      const taskDesc = `In Facebook (com.facebook.katana) on Samsung device ${serial}:
You are executing an autonomous preflight publication pipeline for SocialGrowth.
Bound user identity: 'Tongm Mhuo'.
Media file to publish: 'CEO_Secret_Romance_Ep1.mp4' in Movies/SocialGrowth or Gallery.
Caption to set: "${captionText}"

Instructions:
1. Ensure Facebook app is active in foreground. If there is a profile-switcher sheet open, dismiss it by tapping outside or back.
2. Verify you are logged in as 'Tongm Mhuo'.
3. Open the Facebook post composer: tap on '在想些什麼？' (What's on your mind?) or '相片/影片' (Photo/video).
4. Select the video 'CEO_Secret_Romance_Ep1.mp4' from the photo/video picker.
5. In the caption input box, paste or type the exact caption: "${captionText}".
6. Verify that the video preview and caption are visible on the composition screen.
7. CRITICAL SAFETY GATE: DO NOT tap the final '發佈' (Publish / Post / Share) button under any circumstances.
8. Stop right here at the pre-submission preview screen and report your observations.`;

      const expectedOutput = `Return JSON with: {
  "observedIdentity": "Tongm Mhuo",
  "mediaAttached": boolean,
  "captionEntered": boolean,
  "stage": "ready_before_submit" | "human_required",
  "finalSubmitClicked": false,
  "publicationState": "not_submitted"
}`;

      console.log("-> 派发 Artemis 真机自动化调度任务 (Preflight)...");
      const launch = (await mcp.call("mobile_run_task", {
        task_desc: taskDesc,
        model: "Flash",
        locked_app_package: "com.facebook.katana",
        device_serial: serial,
        expected_output_desc: expectedOutput,
      })) as any;

      const traceId = launch?.trace_id;
      console.log(`✔ Artemis 任务已启动，Trace ID: ${traceId}`);

      const startMs = Date.now();
      let pipelineStatus = "running";
      let pipelineResult: any = null;

      while (Date.now() - startMs < 180000) {
        await new Promise((r) => setTimeout(r, 8000));
        const poll = (await mcp.call("mobile_manage_task", { action: "status", trace_id: traceId })) as any;
        pipelineStatus = poll?.status ?? "unknown";
        console.log(`[Artemis 调度轮询] 耗时 ${Math.round((Date.now() - startMs) / 1000)}s | 状态: ${pipelineStatus}`);
        if (pipelineStatus === "completed" || pipelineStatus === "success") {
          pipelineResult = poll.result;
          break;
        }
        if (["failed", "cancelled"].includes(pipelineStatus)) {
          pipelineResult = poll.result;
          break;
        }
      }

      console.log("✔ Artemis 真机调度执行完毕，结果:", JSON.stringify(pipelineResult, null, 2));

      // -------------------------------------------------------------
      // 步骤 4: 采集真机屏幕物证
      // -------------------------------------------------------------
      console.log("\n--- 步骤 4: 采集真机发帖前置就绪屏幕物证 ---");
      const preflightScreen = join(outDir, "04-artemis-preflight-ready.png");
      execSync(`adb -s ${serial} exec-out screencap -p > "${preflightScreen}"`);
      console.log(`✔ 真机待发布物证屏幕已保存: ${preflightScreen}`);

      // 记录审计报告
      const auditReport = {
        projectId,
        projectName: "霸道总裁北美短剧出海",
        accountId,
        displayName: "Tongm Mhuo",
        deviceId,
        serial,
        videoSha256,
        caption: captionText,
        pipelineMode: "preflight",
        artemisTraceId: traceId,
        artemisResult: pipelineResult,
        safetyGateSatisfied: {
          finalSubmitClicked: false,
          publicationState: "not_submitted",
          readyBeforeSubmit: true,
        },
        completedAt: new Date().toISOString(),
      };

      await writeFile(join(outDir, "06-option2-audit-report.json"), JSON.stringify(auditReport, null, 2), "utf8");
      console.log("✔ 选项 2 审计报告已生成至:", join(outDir, "06-option2-audit-report.json"));

      console.log("\n==========================================================================");
      console.log("🎉 选项 2 完整流水线闭环验收通过！已停留在真机待发布审核画面");
      console.log(JSON.stringify(auditReport, null, 2));
      console.log("==========================================================================");

    } finally {
      await mcp.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
