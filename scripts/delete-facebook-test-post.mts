import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { ArtemisMcp } from "../product/executor/src/runtime/artemis.js";

async function main() {
  console.log("==========================================================================");
  console.log("🗑️  使用 Google Artemis 视觉自主决策引擎删除 Facebook 测试短剧帖子");
  console.log("==========================================================================");

  const serial = "RFCW40MYYCV";
  const repo = process.cwd();
  const outDir = resolve(repo, "artifacts/acceptance/product/deletion");
  await mkdir(outDir, { recursive: true });

  const root = process.env.SG_ARTEMIS_ROOT || "/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis";
  const mcp = new ArtemisMcp(root);
  await mcp.connect();
  console.log("✔ Artemis MCP 引擎连接成功");

  let deleteResult: any = null;
  let traceId = "";

  try {
    const taskDesc = `In Facebook (com.facebook.katana) on Samsung device ${serial}:
The operator wants to delete the test post that was just published.
Target post to delete:
Post contains the caption starting with: "CEO's Secret Romance Episode 1"

Instructions:
1. Go to Tongm Mhuo's profile page (e.g. tap profile avatar on top-left or tap menu/profile).
2. Scroll down on the profile timeline to find the post with video and caption "CEO's Secret Romance Episode 1: He didn't know she was the true heiress...".
3. Tap the three dots (...) button at the top-right of that specific post card.
4. From the bottom sheet / popup options menu, tap "移至垃圾桶" (Move to trash) or "刪除貼文" (Delete post).
5. If a confirmation dialog appears asking to confirm ("移至垃圾桶？" / "Move to trash?" / "刪除" / "確定"), tap "移至垃圾桶" or "刪除" / "Move" to confirm deletion.
6. Wait 3 seconds, pull to refresh or observe the timeline to confirm the post is gone.
7. Return a JSON report with:
   - status: "deleted"
   - isDeleted: true
   - confirmedGone: true`;

    const expectedOutput = `Return JSON with: {
  "status": "deleted",
  "isDeleted": boolean,
  "confirmedGone": boolean
}`;

    console.log("-> 派发 Artemis 真机删除任务...");
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

    while (Date.now() - startMs < 180000) {
      await new Promise((r) => setTimeout(r, 6000));
      const poll = (await mcp.call("mobile_manage_task", { action: "status", trace_id: traceId })) as any;
      taskStatus = poll?.status ?? "unknown";
      console.log(`[Artemis 删除轮询] 耗时 ${Math.round((Date.now() - startMs) / 1000)}s | 状态: ${taskStatus}`);
      if (taskStatus === "completed" || taskStatus === "success") {
        deleteResult = poll.result;
        break;
      }
      if (["failed", "cancelled"].includes(taskStatus)) {
        deleteResult = poll.result;
        break;
      }
    }

    console.log("✔ Artemis 真机删除任务执行完毕，结果:", JSON.stringify(deleteResult, null, 2));

    const finalScreen = join(outDir, "01-facebook-post-deleted.png");
    execSync(`adb -s ${serial} exec-out screencap -p > "${finalScreen}"`);
    console.log(`✔ 删除后真机屏幕截图已保存至: ${finalScreen}`);

    const auditReport = {
      action: "delete_published_test_post",
      platform: "facebook",
      serial,
      postTarget: "CEO's Secret Romance Episode 1",
      artemisTraceId: traceId,
      artemisResult: deleteResult,
      screenshot: finalScreen,
      completedAt: new Date().toISOString()
    };
    const reportPath = join(outDir, "02-delete-audit-report.json");
    await writeFile(reportPath, JSON.stringify(auditReport, null, 2), "utf8");
    console.log(`✔ 审计报告已写入: ${reportPath}`);

  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error("执行删除失败:", err);
  process.exit(1);
});
