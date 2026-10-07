import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
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
  console.log("📄 调度 Google Artemis 视觉自主决策引擎创建 Facebook 商业 Page（公共主页）");
  console.log("==========================================================================");

  const serial = "RFCW40MYYCV";
  const repo = process.cwd();
  const outDir = resolve(repo, "artifacts/acceptance/product/page-preparation");
  await mkdir(outDir, { recursive: true });

  const root = process.env.SG_ARTEMIS_ROOT || "/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis";
  const mcp = new ArtemisMcp(root);
  await mcp.connect();
  console.log("✔ Artemis MCP 引擎连接成功");

  let createResult: any = null;
  let traceId = "";
  const pageName = "Tongm Mhuo 短剧精选";

  try {
    const taskDesc = `In Facebook (com.facebook.katana) on Samsung device ${serial}:
You are on the "粉絲專頁" (Pages) screen in Facebook.
The operator authorizes creating a new commercial Page for short drama distribution.
Target Page name: "${pageName}"

Instructions:
1. Tap "建立" (Create) at the top left.
2. Tap "開始使用" (Get Started).
3. Type the Page Name: "${pageName}". Then tap "下一步" (Next).
4. In the category search, search for "影片" or "娛樂" and select a category like "影片創作者" (Video Creator) or "娛樂" (Entertainment). Tap "建立" (Create) or "下一步" (Next).
5. If prompt asks for Bio / Contact / Website / Address, skip or tap "下一步" (Next).
6. If prompt asks to add profile/cover photo, tap "下一步" (Next).
7. If prompt asks to invite friends or connect WhatsApp, tap "下一步" (Next) or "略過" (Skip).
8. Tap "完成" (Done) to finish Page creation.
9. Facebook will switch to the new Page. Verify that the Page "${pageName}" is active.
10. Return a JSON report with:
    - status: "page_created"
    - isCreated: true
    - pageName: "${pageName}"
    - activeIdentity: the currently active identity name`;

    const expectedOutput = `Return JSON with: {
  "status": "page_created",
  "isCreated": boolean,
  "pageName": string,
  "activeIdentity": string
}`;

    console.log(`-> 派发 Artemis 创建 Page 任务: ${pageName}...`);
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
      console.log(`[Artemis 创建 Page 轮询] 耗时 ${Math.round((Date.now() - startMs) / 1000)}s | 状态: ${taskStatus}`);
      if (taskStatus === "completed" || taskStatus === "success") {
        createResult = poll.result;
        break;
      }
      if (["failed", "cancelled"].includes(taskStatus)) {
        createResult = poll.result;
        break;
      }
    }

    console.log("✔ Artemis Page 创建任务执行完毕，结果:", JSON.stringify(createResult, null, 2));

    const finalScreen = join(outDir, "03-artemis-page-created.png");
    execSync(`adb -s ${serial} exec-out screencap -p > "${finalScreen}"`);
    console.log(`✔ 创建后真机屏幕截图已保存: ${finalScreen}`);

    // 写回数据库 publishing_identities
    const accountId = "7587ac3f-9a9d-4e16-b8aa-ddb57c075d8b";
    const projectId = "b03a3291-92ed-445a-b516-3955446fcc63";
    const identityRef = "fb_page_tongm_drama";

    sql(`INSERT INTO socialgrowth_product.publishing_identities(identity_id, account_id, platform, canonical_identity_ref)
VALUES(gen_random_uuid(), '${accountId}', 'facebook', '${identityRef}')
ON CONFLICT (platform, canonical_identity_ref) DO UPDATE SET account_id=EXCLUDED.account_id;`);

    const identityId = sql(`SELECT identity_id FROM socialgrowth_product.publishing_identities WHERE platform='facebook' AND canonical_identity_ref='${identityRef}';`);

    sql(`INSERT INTO socialgrowth_product.project_identity_reservations(project_id, identity_id, account_id, platform, device_id)
VALUES('${projectId}', '${identityId}', '${accountId}', 'facebook', '0fef3177-636c-4b82-8209-1af38134e00f')
ON CONFLICT DO NOTHING;`);

    console.log(`✔ 数据库已注册公共主页发布身份: ${identityRef} (${identityId})`);

    const reportPath = join(outDir, "04-page-creation-report.json");
    await writeFile(reportPath, JSON.stringify({
      serial,
      artemisTraceId: traceId,
      pageName,
      canonicalIdentityRef: identityRef,
      identityId,
      artemisResult: createResult,
      screenshot: finalScreen,
      timestamp: new Date().toISOString()
    }, null, 2), "utf8");
    console.log(`✔ 闭环报告已保存: ${reportPath}`);

  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
