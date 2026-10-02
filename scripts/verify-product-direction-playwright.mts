import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
// Actual Web operations and configured model. No business API writes, DB seeds
// or synthetic model output. UI data is deliberately synthetic and unready.
const required = (key: string) => { const v = process.env[key]; if (!v) throw new Error(`${key} required`); return v; };
const output = required("SG_PRODUCT_DIRECTION_SCREENSHOT_DIR"); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1464, height: 1074 }, locale: "zh-CN" });
const page = await context.newPage(), second = await browser.newPage({ viewport: { width: 1464, height: 1074 }, locale: "zh-CN" }), name = `真实模型合成方向验收-${Date.now()}`;
const project = (p: Page) => p.locator(".project-workspace"), planner = (p: Page) => p.getByRole("region", { name: "项目目标与周期草案" }), direction = (p: Page) => p.getByRole("region", { name: "初始业务方向" });
const errors: string[] = []; for (const p of [page, second]) p.on("pageerror", () => errors.push("pageerror"));
const modelAttempts: { outcome: "proposed" | "unavailable"; elapsedMs: number }[] = [];
async function open(p: Page, initial = false) {
  await p.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  if (initial) { await p.getByLabel("登录名", { exact: true }).fill(required("SG_PRODUCT_TEST_LOGIN_NAME")); await p.getByLabel("密码", { exact: true }).fill(required("SG_PRODUCT_TEST_PASSWORD")); await p.getByRole("button", { name: "登录", exact: true }).click(); }
  await p.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor(); await p.getByRole("button", { name: "项目", exact: true }).click();
  if (!initial || p === second) { await project(p).getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click(); await project(p).getByRole("button", { name: "设置 · 目标与周期" }).click(); await planner(p).getByText(/项目版本 \d+，草案版本/).waitFor(); }
}
async function generate() {
  // Exercise actual operator recovery through the UI, not a hidden provider
  // retry or an ignored failed test. Only a known unavailable result permits
  // one explicit new command; unknown results must retain the original key.
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now(); await direction(page).getByRole("button", { name: "生成初始方向", exact: true }).click();
    const feedback = direction(page).getByText(/^(真实模型方向已生成，请逐项核对范围后确认。|配置模型未返回可用方向；未采用模板，请读取结果后重试。)$/);
    await feedback.waitFor({ timeout: 55_000 });
    const proposed = (await feedback.innerText()).startsWith("真实模型");
    modelAttempts.push({ outcome: proposed ? "proposed" : "unavailable", elapsedMs: Date.now() - started });
    await writeFile(`${output}/model-attempts.json`, JSON.stringify(modelAttempts, null, 2));
    if (proposed) { await direction(page).getByRole("heading", { name: "待核对方向与范围" }).waitFor(); return; }
    assert.equal(await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).count(), 0);
    await direction(page).getByRole("button", { name: "读取方向结果", exact: true }).click();
  }
  throw new Error("Configured model unavailable after one explicit UI recovery; business acceptance blocked");
}
try {
  await open(page, true); await project(page).getByRole("button", { name: "新建项目" }).click(); await project(page).getByLabel("项目名称").fill(name); await project(page).getByRole("button", { name: "创建筹备项目" }).click();
  await project(page).getByText(/基本信息已保存；仍在筹备/).waitFor(); await project(page).getByRole("button", { name: "设置 · 目标与周期" }).click(); await planner(page).getByText(/草案版本 0/).waitFor();
  await direction(page).getByText("尚无已确认方向", { exact: true }).waitFor();
  await planner(page).getByLabel("正式开通前阶段目标", { exact: true }).fill("合成验收：完善明确范围；无真实发布授权");
  await planner(page).getByLabel("正式开通后阶段目标", { exact: true }).fill("合成验收：观察内容，禁止推定真实收益");
  await planner(page).getByLabel("正式开通后优先级", { exact: true }).selectOption("balanced");
  await planner(page).getByLabel("目标国家标签（逗号分隔）").fill("CN"); await planner(page).getByLabel("目标语言标签（逗号分隔）").fill("zh");
  await planner(page).getByRole("checkbox", { name: "Facebook 图文", exact: true }).check(); await planner(page).getByLabel("内容规则说明", { exact: true }).fill("仅合成验收素材；来源未验证；不得公开发布");
  await planner(page).getByRole("button", { name: "周期与观察", exact: true }).click();
  await planner(page).getByLabel("业务时区", { exact: true }).selectOption("Asia/Shanghai");
  const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 8 * 86400000).toISOString();
  await planner(page).getByLabel("首次统计起点（ISO 时间，须含时区）").fill(start);
  for (const [label, value] of [["复盘间隔（天）", "7"], ["项目每周期引流最低任务数", "0"], ["内容观察窗口（小时）", "24"], ["结束后收尾观察（天）", "0"], ["每日总发布上界", "1"]]) await planner(page).getByLabel(label!, { exact: true }).fill(value!);
  await planner(page).getByLabel("发布有效窗口开始（ISO 含时区）").fill(start); await planner(page).getByLabel("发布有效窗口结束（ISO 含时区，结束不含）").fill(end);
  await planner(page).getByRole("button", { name: "保存全部草案", exact: true }).click(); await planner(page).getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  await direction(page).getByLabel("发布身份范围", { exact: true }).fill("facebook/UI_SYNTHETIC_UNREGISTERED/开通前"); await generate();
  assert.ok((await direction(page).locator(".direction-copy").first().innerText()).length > 0);
  // A real second browser page edits the stored planning draft through the UI.
  await open(second, true); await planner(second).getByLabel("正式开通前阶段目标", { exact: true }).fill("合成验收：第二窗口修改目标，旧方向不可确认");
  await planner(second).getByRole("button", { name: "保存全部草案", exact: true }).click(); await planner(second).getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  await direction(page).getByRole("button", { name: "确认方向", exact: true }).click(); await direction(page).getByText(/输入或版本不满足要求/).waitFor();
  assert.equal(await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).count(), 0);
  await direction(page).getByRole("button", { name: "读取方向结果", exact: true }).click(); await generate();
  assert.ok((await direction(page).innerText()).includes("第二窗口修改目标"));
  // Drop only the transport response AFTER the real confirmation has committed.
  // No business result is replaced, and recovery must use the original command.
  let lost = false;
  await page.route("**/direction/confirm", async route => { if (lost) { await route.continue(); return; } await route.fetch(); lost = true; await route.abort("failed"); });
  await direction(page).getByRole("button", { name: "确认方向", exact: true }).click(); await direction(page).getByText(/提交结果尚未确认/).waitFor();
  await direction(page).getByRole("button", { name: "读取方向结果", exact: true }).click(); await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).waitFor();
  await direction(page).getByRole("button", { name: "接续原方向请求", exact: true }).click(); await direction(page).getByText("方向已确认并留存批准范围；执行条件尚未就绪。", { exact: true }).waitFor();
  assert.equal(lost, true); await page.unroute("**/direction/confirm");
  assert.equal(await direction(page).getByRole("button", { name: "生成初始方向", exact: true }).count(), 0);
  await direction(page).getByText("当前未派发手机任务，未开启公开发布。", { exact: true }).waitFor();
  await direction(page).screenshot({ path: `${output}/direction-approved-desktop.png` });
  await page.reload(); await open(page); await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).waitFor();
  assert.ok((await direction(page).innerText()).includes("第二窗口修改目标"));
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await direction(page).getByRole("button", { name: "确认方向", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await direction(page).screenshot({ path: `${output}/direction-approved-mobile.png` }); assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, actualModel: true, scope: "synthetic UI inputs with configured real model; stale direction rejection, immutable confirmation, lost response original replay, reload, mobile readonly", execution: "blocked", publication: "not performed" }, null, 2));
  console.log(JSON.stringify({ passed: true, actualModel: true, actualPhone: false, actualPublication: false }));
} catch (error) {
  if (await direction(page).count()) { await writeFile(`${output}/failure-direction.txt`, await direction(page).innerText()); await direction(page).screenshot({ path: `${output}/failure-direction.png` }); }
  throw error;
} finally { await browser.close(); }
