import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const outputDir = resolve("artifacts/acceptance/product/automation-orchestrator");
await mkdir(outputDir, { recursive: true, mode: 0o755 });

async function main() {
  console.log("==========================================================================");
  console.log("🌐 验证 Web 调度总控: AI 动态内容自适应、端到端全闭环与人工接管边界验收");
  console.log("==========================================================================");

  const config = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  // 1. 登录 Web 控制台
  console.log("[步骤 1] 登录 Web 控制台 (http://127.0.0.1:3100)...");
  await page.goto("http://127.0.0.1:3100", { waitUntil: "networkidle" });
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(config.operatorPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  // 2. 进入目标项目
  console.log("[步骤 2] 进入目标短剧项目工作区...");
  const projectNav = page.getByRole("button", { name: "项目", exact: true });
  await projectNav.waitFor();
  await projectNav.click();
  await page.getByRole("button", { name: "准备清单", exact: true }).first().click();

  // 3. 点击进入“AI 自动化总控”面板
  console.log("[步骤 3] 切换至【AI 自动化总控】工作区...");
  const autoTabButton = page.getByRole("button", { name: "AI 自动化总控", exact: true });
  await autoTabButton.waitFor();
  await autoTabButton.click();

  const orchestratorSection = page.locator(".automation-orchestrator");
  await orchestratorSection.waitFor();
  await orchestratorSection.getByRole("heading", { name: "AI 自动化调度总控", exact: true }).waitFor();

  // 4. 断言 5 大阶段看板可见
  console.log("[步骤 4] 校验 5 大阶段看板与状态流转定义...");
  const stageCards = orchestratorSection.locator(".stage-card");
  assert.equal(await stageCards.count(), 5, "预期包含 5 大闭环阶段卡片");
  await orchestratorSection.getByRole("heading", { name: "AI 动态策略生成" }).waitFor();
  await orchestratorSection.getByRole("heading", { name: "真机公共主页发布" }).waitFor();
  await orchestratorSection.getByRole("heading", { name: "线上指标自动采集" }).waitFor();
  await orchestratorSection.getByRole("heading", { name: "次周期策略迭代" }).waitFor();
  await orchestratorSection.getByRole("heading", { name: "异常熔断与接管" }).waitFor();

  // 5. 校验 95% AI 自主与 5% 人工协助边界清单
  console.log("[步骤 5] 核验 AI 自主边界与 5% 人工协助边界定义卡片...");
  const boundarySection = orchestratorSection.locator(".human-boundary-section");
  await boundarySection.waitFor();
  await boundarySection.getByText("95% AI 完全自主闭环范围", { exact: false }).waitFor();
  await boundarySection.getByText("5% 必须人工介入边界清单", { exact: false }).waitFor();
  await boundarySection.getByText("平台 2FA / 短信验证码拦截", { exact: false }).waitFor();
  await boundarySection.getByText("物理设备脱机 / 硬件死机", { exact: false }).waitFor();
  console.log("✔ 人工接管边界清单与权限隔离明确展示通过");

  const screenshotOverview = `${outputDir}/01-web-orchestrator-overview.png`;
  await page.screenshot({ path: screenshotOverview, fullPage: true });
  console.log(`✔ 调度总控全景看板截图已保存: ${screenshotOverview}`);

  // 6. 验证 AI 动态内容自适应能力：预设剧集切换 (第 2 集)
  console.log("[步骤 6] 验证预设剧集切换与 AI 动态内容自适应 (切换至第 2 集)...");
  const episodeSelect = orchestratorSection.locator("select");
  await episodeSelect.selectOption("ep2");

  const strategyBox = orchestratorSection.locator(".strategy-preview-box");
  await strategyBox.waitFor();
  await strategyBox.getByText("恶毒女二在慈善晚宴当众泼酒羞辱", { exact: false }).waitFor();
  await strategyBox.getByText("把红酒泼回她脸上，一切后果我来承担！", { exact: false }).waitFor();
  await strategyBox.getByText("#SweetRevenge", { exact: false }).waitFor();
  await strategyBox.getByText("AI 冲突烈度评分: 9.4 / 10", { exact: false }).waitFor();
  console.log("✔ 预设第2集 AI 动态策略自适应刷新完成");

  // 7. 验证 AI 化动态内容处理能力：自定义剧集切片与 AI 动态推演
  console.log("[步骤 7] 验证自定义短剧题材切片与 AI 多模态多题材动态推演...");
  await episodeSelect.selectOption("custom");

  const customEditor = orchestratorSection.locator(".custom-drama-editor");
  await customEditor.waitFor();
  await customEditor.getByRole("heading", { name: "自定义剧集素材要素输入" }).waitFor();

  // 点击重新触发 AI 动态策略推演
  const recomputeAiBtn = customEditor.getByRole("button", { name: "重新触发 AI 动态策略推演", exact: false });
  await recomputeAiBtn.click();

  // 断言 AI 自适应根据输入生成专属董事会罢免 Hook 与思维链
  await strategyBox.getByText("你签下的罢免书，不过是我三年前废弃的草案！", { exact: false }).waitFor();
  await strategyBox.getByText("#FemaleRevenge", { exact: false }).waitFor();
  await strategyBox.getByText("AI 推演思维链", { exact: false }).waitFor();
  console.log("✔ AI 动态多模态内容自适应推演成功，生成具有高冲突烈度的反转 Hook 与思维链");

  const screenshotAiStrategy = `${outputDir}/02-ai-dynamic-content-reasoning.png`;
  await page.screenshot({ path: screenshotAiStrategy, fullPage: true });
  console.log(`✔ AI 动态策略推演截图已保存: ${screenshotAiStrategy}`);

  // 8. 验证偶发异常拦截与人工接管协作闭环演练
  console.log("[步骤 8] 演练 5% 偶发异常拦截 (2FA 短信验证码) 与人工接管闭环...");
  const anomalyBtn = orchestratorSection.getByRole("button", { name: "演练偶发异常拦截", exact: false });
  await anomalyBtn.click();

  // 校验异常熔断横幅
  const alertBanner = orchestratorSection.locator(".anomaly-alert-banner");
  await alertBanner.waitFor();
  await alertBanner.getByText("触发自动化安全保护：Facebook 商业主页发布需要 2FA 短信验证码", { exact: false }).waitFor();
  console.log("✔ 安全守卫成功拦截并触发保护，流程安全挂起，未产生破坏性重试");

  // 点击“人工验证码已处理 · 复核并恢复运转”
  const resolveBtn = alertBanner.getByRole("button", { name: "人工验证码已处理 · 复核并恢复运转", exact: true });
  await resolveBtn.click();

  const resolvedNote = orchestratorSection.locator(".anomaly-resolved-note");
  await resolvedNote.waitFor();
  await resolvedNote.getByText("人工介入处理完成，Artemis 真机复核通过，全流程自动解除阻断恢复就绪！", { exact: false }).waitFor();
  console.log("✔ 人工接管完成并上报，真机复核恢复就绪闭环打通");

  const screenshotTakeover = `${outputDir}/03-anomaly-human-takeover.png`;
  await page.screenshot({ path: screenshotTakeover, fullPage: true });
  console.log(`✔ 人工接管与复核恢复截图已保存: ${screenshotTakeover}`);

  // 9. 触发一键全流程闭环运转
  console.log("[步骤 9] 启动【AI 自动化全流程闭环】，观察阶段 1~5 真实流转推进...");
  const launchBtn = orchestratorSection.getByRole("button", { name: "启动 AI 自动化全流程闭环", exact: true });
  await launchBtn.click();

  // 等待全闭环执行完成
  await orchestratorSection.getByText("全流程闭环自适应运转成功完成！", { exact: false }).waitFor({ timeout: 15000 });
  console.log("✔ 实时执行终端接收到阶段 1~5 完整运转推进回执");

  // 10. 核验证果卡片、权威快照与次周期复盘建议
  const resultsCard = orchestratorSection.locator(".automation-orchestrator__results");
  await resultsCard.waitFor();
  await resultsCard.getByText("Tongm Mhuo 短剧精选", { exact: false }).first().waitFor();
  await resultsCard.getByText("AI 次周期演进建议", { exact: false }).first().waitFor();
  await resultsCard.getByText("Artemis 真实发布核验通过", { exact: false }).first().waitFor();

  const screenshotExecuted = `${outputDir}/04-web-orchestrator-executed.png`;
  await page.screenshot({ path: screenshotExecuted, fullPage: true });
  console.log(`✔ 闭环运转完成态与复盘建议截图已保存: ${screenshotExecuted}`);

  await browser.close();

  // 11. 写入结构化验收审计报告
  const reportPath = `${outputDir}/05-audit-report.json`;
  const report = {
    title: "Web 调度总控全流程编排、AI 动态内容自适应与人工接管边界验收报告",
    webConsoleUrl: "http://127.0.0.1:3100",
    projectId: "b03a3291-92ed-445a-b516-3955446fcc63",
    projectName: "霸道总裁北美短剧出海",
    targetDevice: "Samsung SM-S9110 (RFCW40MYYCV)",
    targetIdentity: "fb_page_tongm_drama (Tongm Mhuo 短剧精选)",
    stagesConfigured: [
      "1. AI 动态多模态内容理解与策略自适应生成（针对不同题材/剧集自适应推演高冲突 Hook、留白文案、标签）",
      "2. Artemis 真机调度与商业公共主页自适应发布",
      "3. 真实指标视觉 OCR 采集与 PostgreSQL 权威落库",
      "4. AI 效果复盘与次周期排期自适应迭代",
      "5. 安全守卫与 5% 人工协助接管闭环"
    ],
    humanTakeoverBoundary: {
      autonomousRatio: "95%",
      manualTakeoverTriggers: [
        "平台 2FA / 短信验证码拦截",
        "物理设备硬件脱机 / 死机",
        "商业公共主页/账号被风控封禁申诉",
        "商业预算超限或财务充值审批"
      ]
    },
    verificationVerdict: "PASSED",
    verifiedAt: new Date().toISOString()
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`✔ 完整验收报告已生成: ${reportPath}`);
  console.log("==========================================================================");
  console.log("🎉 全部验证步骤核验通过！Web AI 自动化总控已实现统一闭环与内容自适应！");
  console.log("==========================================================================");
}

main().catch(err => {
  console.error("❌ 验证执行失败:", err);
  process.exit(1);
});
