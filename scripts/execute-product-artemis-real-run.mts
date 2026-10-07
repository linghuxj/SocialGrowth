import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { ArtemisMcp } from "../product/executor/src/runtime/artemis.js";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 正式版物理真机 Artemis 视觉智能体真实切片发布链路执行");
  console.log("==========================================================================");

  const outDir = resolve("artifacts/acceptance/product/real-publication");
  await mkdir(outDir, { recursive: true });

  const root = process.env.SG_ARTEMIS_ROOT || "/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis";
  const serial = "RFCW40MYYCV";
  const appPackage = "com.facebook.katana";

  console.log(`[配置] Artemis Root: ${root}`);
  console.log(`[配置] 目标物理真机: ${serial}`);
  console.log(`[配置] 目标应用包名: ${appPackage}`);

  // 1. 保存前置状态截屏
  const initialScreen = join(outDir, "01-phone-initial.png");
  execSync(`adb -s ${serial} exec-out screencap -p > "${initialScreen}"`);
  console.log(`✔ 前置屏幕状态已采集: ${initialScreen}`);

  // 2. 连接 Artemis MCP
  console.log("\n-> 正在连接 Google Artemis 执行引擎 MCP 服务...");
  const mcp = new ArtemisMcp(root);
  await mcp.connect();
  console.log("✔ Artemis MCP 服务连接成功");

  try {
    // 3. 检查当前 UI 元素层次结构
    console.log("\n-> 探测真机前台当前 UI 元素...");
    const stateRes = (await mcp.call("mobile_get_device_state", {
      view_type: "hierarchy",
      device_serial: serial,
    })) as any;
    const hierarchyText = typeof stateRes === "string" ? stateRes : JSON.stringify(stateRes, null, 2);
    await writeFile(join(outDir, "02-initial-hierarchy.txt"), hierarchyText, "utf8");
    console.log("✔ 前台 UI 结构已探测并记录");

    // 4. 下发 Artemis 视觉决策发布任务
    console.log("\n-> 正在向 Artemis 提交自主 UI 发布任务 (mobile_run_task)...");
    const taskDesc = `In Facebook (${appPackage}) on Samsung device ${serial}:
You are an autonomous mobile UI agent. Your goal is to create a post with the prepared drama clip.
Current account is already logged in as 'Tongm Mhuo'.
Step 1: Look at the Facebook home screen. Find and tap '建立' or '+' or '在想些什麼？' (What's on your mind? / Create post).
Step 2: Select '相片/影片' (Photo/video) to open the media picker.
Step 3: In the photo/video gallery, choose the video 'jiangmen_nizi_real_slice' or the short drama clip around 16-17MB (first video in Recent/Camera).
Step 4: Once the video is added, find the text entry area '在想些什麼？' or '關於這部影片...' and enter this verbatim caption:
《将门逆子》战神归来！逆子逆风翻盘，热血爽剧震撼上线！#将门逆子 #短剧 #真实切片验证
Step 5: Verify audience setting is Public / 所有人.
Step 6: Stop at the final preview / post ready screen right before tapping '發佈' / 'Post'. Do not tap final Publish/Post without confirmation.
Step 7: Conclude and report the final screen elements and verified parameters in JSON.`;

    const expectedOutput = `Return JSON with fields: { observedAccount: string, selectedMedia: string, captionEntered: string, audience: string, finalScreenReady: boolean, status: string }`;

    const launchRes = (await mcp.call("mobile_run_task", {
      task_desc: taskDesc,
      model: "Flash",
      locked_app_package: appPackage,
      device_serial: serial,
      expected_output_desc: expectedOutput,
    })) as any;

    console.log("✔ Artemis 任务已成功派发至设备:", JSON.stringify(launchRes, null, 2));
    const traceId = launchRes?.trace_id;
    if (!traceId) {
      throw new Error(`未获取到 trace_id: ${JSON.stringify(launchRes)}`);
    }

    await writeFile(join(outDir, "03-artemis-launch.json"), JSON.stringify(launchRes, null, 2), "utf8");

    // 5. 轮询监控 Artemis 智能体执行
    console.log(`\n-> 启动状态轮询监控 (Trace ID: ${traceId})...`);
    const startTime = Date.now();
    let pollCount = 0;
    let finalStatus = "unknown";
    let finalResult: any = null;

    while (Date.now() - startTime < 300000) { // 最多等待 5 分钟
      await new Promise((r) => setTimeout(r, 10000));
      pollCount++;

      // 采集当前真机屏幕
      const loopScreen = join(outDir, `04-progress-poll-${pollCount}.png`);
      try {
        execSync(`adb -s ${serial} exec-out screencap -p > "${loopScreen}"`);
      } catch {}

      try {
        const poll = (await mcp.call("mobile_manage_task", {
          action: "status",
          trace_id: traceId,
        })) as any;

        finalStatus = poll?.status ?? "unknown";
        console.log(`[Artemis 轮询 ${pollCount}] 耗时 ${Math.round((Date.now() - startTime) / 1000)}s | 状态: ${finalStatus}`);

        if (poll?.result) {
          finalResult = poll.result;
          console.log(`[Artemis 阶段结果]:`, JSON.stringify(poll.result).slice(0, 200));
        }

        if (finalStatus === "completed" || finalStatus === "success") {
          console.log("\n🎉 Artemis 任务执行完成！");
          finalResult = poll.result;
          break;
        }

        if (["failed", "cancelled"].includes(finalStatus)) {
          console.log(`\n❌ Artemis 任务终态: ${finalStatus}`);
          finalResult = poll.result;
          break;
        }
      } catch (err: any) {
        console.log(`[Artemis 轮询 ${pollCount} 告警]`, err.message);
      }
    }

    // 6. 归档最终物证
    const finalScreen = join(outDir, "05-phone-final-screen.png");
    execSync(`adb -s ${serial} exec-out screencap -p > "${finalScreen}"`);
    console.log(`✔ 最终真机屏幕物证已保存: ${finalScreen}`);

    const receipt = {
      traceId,
      serial,
      appPackage,
      account: "Tongm Mhuo (mhtongm@gmail.com)",
      sliceHash: "2b426251ca5b1547612fd80309bcd3f449bdd17aa0319004b54020ef4eaf2168",
      caption: "《将门逆子》战神归来！逆子逆风翻盘，热血爽剧震撼上线！#将门逆子 #短剧 #真实切片验证",
      status: finalStatus,
      result: finalResult,
      completedAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - startTime) / 1000),
    };

    await writeFile(join(outDir, "06-execution-receipt.json"), JSON.stringify(receipt, null, 2), "utf8");
    console.log("✔ 执行回执已归档至:", join(outDir, "06-execution-receipt.json"));
    console.log("\n==========================================================================");
    console.log("📋 最终结果概要:");
    console.log(JSON.stringify(receipt, null, 2));
    console.log("==========================================================================");

  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error("执行异常:", err);
  process.exit(1);
});
