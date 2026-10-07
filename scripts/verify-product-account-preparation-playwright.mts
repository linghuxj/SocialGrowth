import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
// Actual Web persistence/recovery in an owned DB; synthetic declarations never
// establish platform ownership, real creation or physical execution permission.
const required = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} required`); return v; };
const output = required("SG_PRODUCT_PREPARATION_SCREENSHOT_DIR"), login = required("SG_PRODUCT_TEST_LOGIN_NAME"), password = required("SG_PRODUCT_TEST_PASSWORD");
const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
if (new URL(base).hostname !== "127.0.0.1" || process.env.SG_PRODUCT_PREPARATION_OWNED_ENV !== "1") throw new Error("Owned isolated loopback product Web required");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1464, height: 1074 } });
const results: string[] = [], errors: string[] = []; let taskIds: string[] = [], checkVersion = 0, reviewId: string | null = null;
page.on("pageerror", () => errors.push("pageerror"));
try {
  await page.goto(base); await page.getByLabel("登录名", { exact: true }).fill(login); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click(); const project = page.locator(".project-workspace"), projectName = `初始化检查合成验收-${Date.now()}`;
  await project.getByRole("button", { name: "新建项目" }).click(); await project.getByLabel("项目名称").fill(projectName); await project.getByRole("button", { name: "创建筹备项目" }).click();
  await project.getByText(/基本信息已保存；仍在筹备/).waitFor(); await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  const panel = page.getByRole("region", { name: "发布身份初始化" }); await panel.getByText("尚无初始化检查记录。", { exact: true }).waitFor();
  assert.equal(await panel.getByLabel("初始化范围", { exact: true }).inputValue(), "check_only"); assert.equal(await panel.getByRole("checkbox").count(), 0);
  await panel.getByRole("button", { name: "发起初始化检查", exact: true }).click();
  assert.equal(await panel.getByLabel("父登录账号记录标识", { exact: true }).evaluate((el: HTMLInputElement) => el.validity.valueMissing), true);
  results.push("默认仅检查；必要输入缺少时真实表单阻止提交");
  await panel.getByLabel("父登录账号记录标识", { exact: true }).fill("synthetic_parent_facebook");
  await panel.getByLabel("Page／频道准确名称", { exact: true }).fill("合成验证 Page 不实际创建");
  await panel.getByLabel("操作范围依据记录", { exact: true }).fill("synthetic_component_scope");
  const firstResponse = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/account-preparation/request") && r.request().method() === "POST");
  await panel.getByRole("button", { name: "发起初始化检查", exact: true }).click(); const first = await (await firstResponse).json();
  taskIds = first.tasks.map((t: { taskId: string }) => t.taskId); assert.equal(taskIds.length, 1);
  assert.equal(first.tasks[0].actionPermissionGranted, false); assert.equal(first.tasks[0].state, "waiting_resources");
  await panel.getByText("检查请求已记录，当前阻断已保存；尚未操作手机或创建 Page／频道。", { exact: true }).waitFor();
  await panel.getByText("等待项目账号与手机分配", { exact: true }).waitFor(); results.push("实际提交保存原任务，页面展示资源阻断，无虚构就绪");
  let reviewAckDropped = false;
  await page.route("**/account-preparation/execution-review", async route => {
    if (reviewAckDropped) { await route.continue(); return; } reviewAckDropped = true;
    const actual = await route.fetch(); assert.equal(actual.status(), 201); const saved = await actual.json();
    reviewId = saved.executionReviews[0].reviewId;
    assert.equal(saved.executionReviews[0].dispatchCreated, false); assert.equal(saved.executionReviews[0].actionPermissionGranted, false);
    assert.equal(saved.tasks[0].taskVersion, 0); assert.deepEqual(saved.originalOperations, []);
    await route.abort("failed"); // Actual committed review; lose only the transport ACK.
  });
  await panel.getByRole("button", { name: "核验执行条件", exact: true }).click(); await panel.getByText(/本次请求结果尚未确认/).waitFor();
  assert.equal(await panel.getByLabel("父登录账号记录标识", { exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: "读取初始化记录", exact: true }).click();
  await panel.getByText("执行条件核验记录 · v0", { exact: true }).click();
  await panel.getByText("等待手机本机当前参与确认", { exact: true }).waitFor();
  await panel.getByText("本次核验未派发手机动作。", { exact: true }).waitFor();
  await panel.getByText("尚无原手机操作记录；没有派发手机动作。", { exact: true }).waitFor();
  results.push("执行条件从真实服务保存并读取，缺失许可阻断，不虚构派发或回执");
  const reviewRecovered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/account-preparation/execution-review") && r.status() === 201);
  await panel.getByRole("button", { name: "接续原初始化请求", exact: true }).click(); const reviewed = await (await reviewRecovered).json();
  assert.equal(reviewed.executionReviews.length, 1); assert.equal(reviewed.executionReviews[0].reviewId, reviewId); assert.equal(reviewed.tasks[0].taskVersion, 0);
  await panel.getByText("执行条件核验已记录；条件未满足，本次未派发手机动作。", { exact: true }).waitFor();
  await page.unroute("**/account-preparation/execution-review"); results.push("执行核验丢响应后接续原键，保留同一核验记录与任务版本");
  const rechecked = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/account-preparation/recheck"));
  await panel.getByRole("button", { name: "重新检查原任务", exact: true }).click(); const next = await (await rechecked).json();
  assert.equal(next.tasks[0].taskId, taskIds[0]); checkVersion = next.tasks[0].taskVersion; assert.equal(checkVersion, 1);
  assert.equal(next.executionReviews[0].reviewId, reviewId); assert.equal(next.executionReviews[0].taskVersion, 0);
  await panel.getByText(/· v1/).waitFor(); await panel.getByText("该记录对应较早事实，请重新核验当前条件。", { exact: true }).waitFor();
  results.push("重新检查同一任务，原身份和历史保留，检查版本递增，旧核验不会被伪装为当前许可");
  await panel.getByLabel("平台", { exact: true }).selectOption("youtube"); await panel.getByLabel("父登录账号记录标识", { exact: true }).fill("synthetic_parent_youtube");
  await panel.getByLabel("Page／频道准确名称", { exact: true }).fill("合成验证频道不实际创建");
  await panel.getByLabel("初始化范围", { exact: true }).selectOption("prepare_if_missing"); await panel.getByRole("checkbox", { name: "允许确认缺少时创建一个 Page／频道" }).check();
  await panel.getByLabel("频道标识名", { exact: true }).fill("@synthetic-not-created");
  let dropped = false;
  await page.route("**/account-preparation/request", async route => {
    if (dropped) { await route.continue(); return; } dropped = true;
    const actual = await route.fetch(); assert.equal(actual.status(), 201); await route.abort("failed"); // Lose ACK after actual server commit.
  });
  await panel.getByRole("button", { name: "发起初始化检查", exact: true }).click(); await panel.getByText(/本次请求结果尚未确认/).waitFor();
  assert.equal(await panel.getByLabel("父登录账号记录标识", { exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: "读取初始化记录", exact: true }).click(); await panel.getByRole("row").filter({ hasText: "合成验证频道不实际创建" }).waitFor();
  const recovered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/account-preparation/request") && r.status() === 201);
  await panel.getByRole("button", { name: "接续原初始化请求", exact: true }).click(); const current = await (await recovered).json();
  assert.equal(current.tasks.length, 2); taskIds = current.tasks.map((t: { taskId: string }) => t.taskId);
  assert.equal(current.tasks.every((t: { actionPermissionGranted: boolean; publicationAllowed: boolean }) => !t.actionPermissionGranted && !t.publicationAllowed), true);
  await panel.getByText("检查请求已记录，当前阻断已保存；尚未操作手机或创建 Page／频道。", { exact: true }).waitFor();
  await page.unroute("**/account-preparation/request"); results.push("实际保存后丢响应：锁输入、读记录、原键接续，无重复任务");
  await panel.screenshot({ path: `${output}/preparation-desktop.png` });
  await page.reload(); await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor(); await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: projectName }).getByRole("button", { name: "打开项目" }).click(); await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await panel.getByRole("row").filter({ hasText: "合成验证频道不实际创建" }).waitFor(); assert.equal(await panel.getByRole("button", { name: "重新检查原任务" }).count(), 2);
  await panel.getByText("执行条件核验记录 · v0", { exact: true }).waitFor();
  results.push("重载保留两平台任务与原检查状态");
  await page.setViewportSize({ width: 390, height: 844 }); await panel.getByText("转电脑处理", { exact: true }).first().waitFor();
  assert.equal(await panel.getByRole("button", { name: "发起初始化检查" }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "核验执行条件" }).count(), 0);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(width.content <= width.viewport + 1);
  await panel.screenshot({ path: `${output}/preparation-mobile.png` }); results.push("390px 可读、写操作关闭，无横向溢出"); assert.deepEqual(errors, []);
} catch (e) {
  errors.push(e instanceof Error ? e.message : "UNKNOWN"); process.exitCode = 1;
  const panel = page.getByRole("region", { name: "发布身份初始化" });
  if (await panel.isVisible()) { await panel.screenshot({ path: `${output}/failure-panel.png` }); console.log(JSON.stringify({ panelLabels: await panel.locator("label").allTextContents() })); }
}
finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ results, errors, taskIds, checkVersion, reviewId, phoneOperations: 0, createdPlatformAssets: 0, publications: 0, platformReadinessVerified: false }, null, 2));
  console.log(JSON.stringify({ results, errors, taskCount: taskIds.length })); await browser.close();
}
