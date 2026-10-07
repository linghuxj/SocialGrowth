import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1");
const name = process.env.SG_PRODUCT_CORE_PROJECT_NAME;
const objectId = process.env.SG_PRODUCT_CORE_OBJECT_ID;
assert.ok(name && objectId, "Existing authorized local test project and upload required");
const output = resolve(process.env.SG_PRODUCT_CORE_OUTPUT ?? "output/playwright/core-preparation-20261006");
await mkdir(output, { recursive: true });
const password = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")).operatorPassword;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
const checks: string[] = [];
let step = "login";
const goal = "完成中文短剧切片向既有 Facebook Page 投放流程的内部准备验证；本轮不公开发布。";
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace");
  await project.getByRole("row").filter({ has: page.getByText(name, { exact: true }) }).getByRole("button", { name: "打开项目", exact: true }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期", exact: true }).click();
  const planner = page.getByRole("region", { name: "项目目标与周期草案", exact: true });
  const direction = page.getByRole("region", { name: "初始业务方向", exact: true });
  await planner.getByText(/项目版本 \d+，草案版本/).waitFor();
  await direction.getByRole("status").waitFor();
  step = "save bounded test inputs";
  const currentGoal = await planner.getByLabel("正式开通前阶段目标", { exact: true }).inputValue();
  if (!currentGoal) {
    await planner.getByLabel("正式开通前阶段目标", { exact: true }).fill(goal);
    await planner.getByLabel("目标国家标签（逗号分隔）", { exact: true }).fill("US");
    await planner.getByLabel("目标语言标签（逗号分隔）", { exact: true }).fill("zh-hans");
    await planner.getByRole("checkbox", { name: "Facebook 视频", exact: true }).check();
    await planner.getByLabel("内容规则说明", { exact: true }).fill("测试假设范围：仅既有 Tongm Mhuo 短剧精选 Page；只检查身份、切片和发布准备，不点击最终发布。来源、集序与效果数据保持未知。");
    await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
    await planner.getByLabel("业务时区", { exact: true }).selectOption("America/New_York");
    const start = new Date(Date.now() - 60000).toISOString(), end = new Date(Date.now() + 86400000).toISOString();
    for (const [label, value] of [["首次统计起点（ISO 时间，须含时区）", start], ["复盘间隔（天）", "7"], ["项目每周期引流最低任务数", "0"], ["内容观察窗口（小时）", "72"], ["结束后收尾观察（天）", "7"], ["每日总发布上界", "1"], ["发布有效窗口开始（ISO 含时区）", start], ["发布有效窗口结束（ISO 含时区，结束不含）", end]]) await planner.getByLabel(label!, { exact: true }).fill(value!);
    await planner.getByRole("button", { name: "保存全部草案", exact: true }).click();
    await planner.getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  } else assert.equal(currentGoal, goal, "Never replace an unrelated existing project scope");
  checks.push("保存限定本轮准备测试的目标、语言、形式和窗口；复盘延期，未填来源或效果事实");
  step = "actual direction model and scope confirmation";
  if (!(await direction.getByRole("heading", { name: "已确认的方向与范围", exact: true }).count())) {
    if (!(await direction.getByRole("heading", { name: "待核对方向与范围", exact: true }).count())) {
      await direction.getByLabel("发布平台 1", { exact: true }).selectOption("facebook");
      await direction.getByLabel("发布身份编号 1", { exact: true }).fill("fb_page_tongm_drama");
      await direction.getByLabel("分成资格阶段 1", { exact: true }).selectOption("before_monetization");
      await direction.getByRole("button", { name: "生成初始方向", exact: true }).click();
      await direction.getByText("真实模型方向已生成，请逐项核对范围后确认。", { exact: true }).waitFor({ timeout: 65000 });
    }
    const scopeText = await direction.innerText(); assert.ok(scopeText.includes("不公开发布") || scopeText.includes("不点击最终发布"));
    await direction.getByRole("button", { name: "确认方向", exact: true }).click();
    await direction.getByRole("heading", { name: "已确认的方向与范围", exact: true }).waitFor();
  }
  checks.push("现有真实模型生成方向，按用户本轮测试授权确认限定准备范围；未批准公开发布");
  await direction.screenshot({ path: resolve(output, "confirmed-test-direction.png") });
  step = "material scope review";
  await project.getByRole("button", { name: "素材", exact: true }).click();
  const inventory = page.getByRole("region", { name: "已保存的文件上传记录", exact: true });
  await inventory.getByRole("listitem").filter({ hasText: objectId }).getByRole("button", { name: "继续填写此文件资料", exact: true }).click();
  const editor = page.getByRole("region", { name: "素材资料详情", exact: true });
  const reviewed = editor.getByRole("checkbox", { name: "我已按上述当前范围检查这份成品及其内容规则", exact: true });
  await reviewed.waitFor();
  if (!(await reviewed.isChecked())) {
    await reviewed.check();
    await editor.getByRole("button", { name: "保存素材资料", exact: true }).click();
    await project.getByText(/已保存 1 项，0 项仍需处理/).waitFor();
  }
  await editor.getByRole("heading", { name: "当前为素材候选", exact: true }).waitFor();
  checks.push("原件和已提取资料按当前测试范围核对保存为候选，来源与首次发布保持未知");
  step = "actual plan generation";
  await project.getByRole("button", { name: "排期与任务", exact: true }).click();
  const plan = project.getByRole("region", { name: "排期与任务", exact: true });
  await plan.getByRole("heading", { name: "当前排期", exact: true }).waitFor();
  if (await plan.getByText("尚无已保存排期。没有数据时不显示示例进度或模拟任务。", { exact: true }).count()) {
    const planned = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/business-plan") && r.request().method() === "POST", { timeout: 70000 });
    await plan.getByRole("button", { name: "根据当前范围安排", exact: true }).click();
    const response = await planned; assert.equal(response.ok(), true, `arrange HTTP ${response.status()}`);
    const body = await response.json();
    await writeFile(resolve(output, "plan-response.json"), JSON.stringify(body, null, 2));
  }
  await plan.getByRole("region", { name: "计划任务", exact: true }).getByRole("row").nth(1).waitFor();
  checks.push("真实 Web 安排后存在已存任务，未执行手机提交或公开发布");
  await plan.screenshot({ path: resolve(output, "prepared-plan.png") });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "passed", checks, publicPublication: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, publicPublication: false }));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "failed", step, checks, error: error instanceof Error ? error.message : "unknown" }, null, 2));
  console.error(JSON.stringify({ passed: false, step })); throw error;
} finally { await browser.close(); }
