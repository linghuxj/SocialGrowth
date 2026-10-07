import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { ArtemisMcp } from "../product/executor/src/runtime/artemis.js";

function sql(query: string): string {
  const sanitized = query.replace(/"/g, '\\"');
  return execSync(
    `docker exec socialgrowth-product-local-live psql -U socialgrowth -d sg_product_local_live -t -A -c "${sanitized}"`,
    { encoding: "utf8" }
  ).trim();
}

async function main() {
  console.log("==========================================================================");
  console.log("🎬 调度 Google Artemis 视觉自主决策引擎在 Facebook Page 上发布真实短剧切片");
  console.log("==========================================================================");

  const serial = "RFCW40MYYCV";
  const repo = process.cwd();
  const outDir = resolve(repo, "artifacts/acceptance/product/ai-strategy");
  await mkdir(outDir, { recursive: true });

  // 1. 读取大模型动态生成的短剧宣发文案
  const strategyPath = resolve(outDir, "01-ai-generated-strategy.json");
  const strategyData = JSON.parse(await readFile(strategyPath, "utf8"));
  const aiStrategy = strategyData.ai_strategy;
  const postCaption = `${aiStrategy.post_title}\n\n${aiStrategy.creative_hook}\n\n${aiStrategy.caption.slice(0, 300)}...\n\n${aiStrategy.cta_text}\n\n${aiStrategy.hashtags.join(" ")}`;

  console.log("✔ 已加载业务 AI 动态生成短剧策略:");
  console.log("--------------------------------------------------");
  console.log("标题/Hook:", aiStrategy.post_title);
  console.log("标签:", aiStrategy.hashtags.join(" "));
  console.log("--------------------------------------------------");

  // 2. 检查手机锁屏
  console.log("-> 检查真机状态...");
  const isLocked = execSync(`adb -s ${serial} shell "dumpsys window | grep isKeyguardShowing"`, { encoding: "utf8" }).includes("isKeyguardShowing=true");
  if (isLocked) {
    console.log("⚠️ 手机当前处于锁屏状态，请在手机上滑动并输入指纹/密码解锁！");
  }

  // 3. 启动 Artemis 视觉执行引擎
  const root = process.env.SG_ARTEMIS_ROOT || "/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis";
  const mcp = new ArtemisMcp(root);
  await mcp.connect();
  console.log("✔ Artemis MCP 引擎连接成功");

  let publishResult: any = null;
  let traceId = "";

  try {
    const taskDesc = `In Facebook (com.facebook.katana) on Samsung device ${serial}:
The operator wants to publish a real vertical short drama episode to the commercial Page "Tongm Mhuo 短剧精选".

Target post caption to fill:
"${postCaption}"

Instructions:
1. Ensure Facebook is open and active on the commercial Page "Tongm Mhuo 短剧精选" (switch to it if not already).
2. Tap "在想些什麼？" (What's on your mind? / Create post) on the Page.
3. Tap "相片／影片" (Photo/video).
4. Select the vertical short drama video from the album (the video around 2 minutes in duration).
5. In the post text/caption area, type or paste the exact post caption:
"${postCaption}"
6. Tap "下一步" (Next) at the top right.
7. In the sharing/publishing options, tap "發佈" (Publish / Post / Share).
8. Wait 15-20 seconds for Facebook to upload and publish the video to the Page feed.
9. Refresh the Page timeline and locate the newly published post with caption "${aiStrategy.post_title}".
10. Return a JSON report with:
    - status: "published_to_page"
    - isPublished: true
    - pageName: "Tongm Mhuo 短剧精选"
    - postTitleMatched: true
    - observedTime: current time string`;

    const expectedOutput = `Return JSON with: {
  "status": "published_to_page",
  "isPublished": boolean,
  "pageName": string,
  "postTitleMatched": boolean,
  "observedTime": string
}`;

    console.log("-> 派发 Artemis 真机商业 Page 短剧发布任务...");
    const launch = (await mcp.call("mobile_run_task", {
      task_desc: taskDesc,
      model: "Flash",
      locked_app_package: "com.facebook.katana",
      device_serial: serial,
      expected_output_desc: expectedOutput,
    })) as any;

    traceId = launch?.trace_id;
    console.log(`✔ Artemis 任务已启动，Trace ID: ${traceId}`);

    const startMs = Date.now();
    let taskStatus = "running";

    while (Date.now() - startMs < 240000) {
      await new Promise((r) => setTimeout(r, 8000));
      const poll = (await mcp.call("mobile_manage_task", { action: "status", trace_id: traceId })) as any;
      taskStatus = poll?.status ?? "unknown";
      console.log(`[Artemis Page 发布轮询] 耗时 ${Math.round((Date.now() - startMs) / 1000)}s | 状态: ${taskStatus}`);
      if (taskStatus === "completed" || taskStatus === "success") {
        publishResult = poll.result;
        break;
      }
      if (["failed", "cancelled"].includes(taskStatus)) {
        publishResult = poll.result;
        break;
      }
    }

    console.log("✔ Artemis 真机 Page 发布任务执行完毕，结果:", JSON.stringify(publishResult, null, 2));

    const finalScreen = join(outDir, "02-artemis-page-published.png");
    execSync(`adb -s ${serial} exec-out screencap -p > "${finalScreen}"`);
    console.log(`✔ 发布后真机屏幕截图已保存: ${finalScreen}`);

    const auditReport = {
      action: "publish_drama_to_commercial_page",
      platform: "facebook",
      pageName: "Tongm Mhuo 短剧精选",
      canonicalIdentityRef: "fb_page_tongm_drama",
      artemisTraceId: traceId,
      artemisResult: publishResult,
      screenshot: finalScreen,
      completedAt: new Date().toISOString()
    };
    const reportPath = join(outDir, "03-page-publish-report.json");
    await writeFile(reportPath, JSON.stringify(auditReport, null, 2), "utf8");
    console.log(`✔ 审计报告已写入: ${reportPath}`);

  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
