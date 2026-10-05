import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { ArtemisMcp } from "../services/execution-runtime/src/artemis.js";

async function main() {
  console.log("==========================================================================");
  console.log("🔍 调度 Google Artemis 视觉自主决策引擎核验 Facebook 商业 Page（公共主页）");
  console.log("==========================================================================");

  const serial = "RFCW40MYYCV";
  const repo = process.cwd();
  const outDir = resolve(repo, "artifacts/acceptance/product/page-preparation");
  await mkdir(outDir, { recursive: true });

  const root = process.env.SG_ARTEMIS_ROOT || "/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis";
  const mcp = new ArtemisMcp(root);
  await mcp.connect();
  console.log("✔ Artemis MCP 引擎连接成功");

  let checkResult: any = null;
  let traceId = "";

  try {
    const taskDesc = `In Facebook (com.facebook.katana) on Samsung device ${serial}:
The operator wants to inspect all Facebook Pages (粉絲專頁 / Pages) belonging to or managed by Tongm Mhuo.

Instructions:
1. Open Facebook if not already in foreground.
2. Navigate to the Menu tab (bottom-right avatar icon or top-right menu) or tap the dropdown next to the profile name.
3. Find and tap "粉絲專頁" (Pages) or look at the Pages list.
4. Observe all Pages listed on screen.
5. Record all Page names and whether any Page exists (e.g. "Tongm Mhuo 短剧精选" or any other Page).
6. Return a JSON report with:
   - status: "success"
   - existingPages: array of string (names of pages found)
   - hasDramaPage: boolean (whether any drama page exists)
   - activeProfileOrPage: string (currently active profile or page name)`;

    const expectedOutput = `Return JSON with: {
  "status": "success",
  "existingPages": string[],
  "hasDramaPage": boolean,
  "activeProfileOrPage": string
}`;

    console.log("-> 派发 Artemis Page 核验任务...");
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

    while (Date.now() - startMs < 120000) {
      await new Promise((r) => setTimeout(r, 6000));
      const poll = (await mcp.call("mobile_manage_task", { action: "status", trace_id: traceId })) as any;
      taskStatus = poll?.status ?? "unknown";
      console.log(`[Artemis 轮询] 耗时 ${Math.round((Date.now() - startMs) / 1000)}s | 状态: ${taskStatus}`);
      if (taskStatus === "completed" || taskStatus === "success") {
        checkResult = poll.result;
        break;
      }
      if (["failed", "cancelled"].includes(taskStatus)) {
        checkResult = poll.result;
        break;
      }
    }

    console.log("✔ Artemis Page 核验完成，结果:", JSON.stringify(checkResult, null, 2));

    const pageScreen = join(outDir, "01-artemis-pages-screen.png");
    execSync(`adb -s ${serial} exec-out screencap -p > "${pageScreen}"`);
    console.log(`✔ 真机 Page 屏幕已保存: ${pageScreen}`);

    const reportPath = join(outDir, "02-page-check-report.json");
    await writeFile(reportPath, JSON.stringify({
      serial,
      artemisTraceId: traceId,
      result: checkResult,
      screenshot: pageScreen,
      timestamp: new Date().toISOString()
    }, null, 2), "utf8");
    console.log(`✔ 报告已保存: ${reportPath}`);

  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error("核验失败:", err);
  process.exit(1);
});
