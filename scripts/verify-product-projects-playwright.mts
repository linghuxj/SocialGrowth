import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100", loginName = required("SG_PRODUCT_TEST_LOGIN_NAME"), password = required("SG_PRODUCT_TEST_PASSWORD");
const secondLogin = required("SG_PRODUCT_TEST_SECOND_LOGIN_NAME"), secondPassword = required("SG_PRODUCT_TEST_SECOND_PASSWORD");
const output = required("SG_PRODUCT_PROJECT_SCREENSHOT_DIR"); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), errors: string[] = [];
async function signIn(page: Page, name: string, secret: string) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "networkidle" }); await page.getByLabel("登录名").fill(name); await page.getByLabel("密码").fill(secret);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
}
const panel = (page: Page) => page.locator(".project-workspace");
try {
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
  const a = await context.newPage(); await signIn(a, loginName, password);
  await a.getByRole("button", { name: "项目", exact: true }).click(); await panel(a).getByRole("heading", { name: "尚无项目" }).waitFor();
  await a.screenshot({ path: `${output}/empty.png` });
  await panel(a).getByRole("button", { name: "新建项目" }).click(); await panel(a).getByLabel("项目名称").fill("验收筹备项目A");
  // Forward this real UI mutation, then drop its response. Never fabricate a
  // business result: the retry must recover the actual committed project.
  const keys: string[] = [];
  await a.route("**/api/operator/projects", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    keys.push((route.request().postDataJSON() as { metadata: { idempotencyKey: string } }).metadata.idempotencyKey);
    const response = await route.fetch(); assert.ok(response.ok()); await route.abort("failed");
  });
  await panel(a).getByRole("button", { name: "创建筹备项目" }).click(); await panel(a).getByText("服务暂时不可用，输入已保留，请重试。", { exact: true }).waitFor();
  assert.equal(await panel(a).getByLabel("项目名称").inputValue(), "验收筹备项目A");
  assert.equal(await panel(a).getByLabel("项目名称").isDisabled(), true, "Unknown creation must not silently switch to a different request");
  await a.unroute("**/api/operator/projects");
  const retry = a.waitForRequest(r => r.method() === "POST" && new URL(r.url()).pathname === "/api/operator/projects");
  await panel(a).getByRole("button", { name: "创建筹备项目" }).click(); keys.push(((await retry).postDataJSON() as { metadata: { idempotencyKey: string } }).metadata.idempotencyKey);
  await panel(a).getByText(/基本信息已保存；仍在筹备/).waitFor(); assert.equal(keys[0], keys[1]);
  await panel(a).getByRole("heading", { name: "准备清单", exact: true }).waitFor();
  assert.equal(await panel(a).locator(".project-readiness tbody tr").count(), 6);
  assert.equal(await panel(a).getByRole("button", { name: "确认方向", exact: true }).count(), 0);
  await panel(a).getByLabel("项目名称").fill("保留的跨导航输入");
  await a.getByRole("button", { name: "账号与设备", exact: true }).click(); await a.getByRole("button", { name: "项目", exact: true }).click();
  assert.equal(await panel(a).getByLabel("项目名称").inputValue(), "保留的跨导航输入");
  await panel(a).getByRole("button", { name: "放弃本次输入" }).click(); assert.equal(await panel(a).getByLabel("项目名称").inputValue(), "验收筹备项目A");
  await a.getByRole("button", { name: "账号与设备", exact: true }).click(); await a.getByLabel("登录名").fill(secondLogin); await a.getByLabel("显示名").fill("验收代办运营"); await a.getByLabel("初始密码").fill(secondPassword);
  await a.getByRole("button", { name: "开通账号", exact: true }).click(); await a.getByText("运营账号已开通", { exact: true }).waitFor();
  await a.getByRole("button", { name: "项目", exact: true }).click();
  const second = await browser.newContext({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } }); const b = await second.newPage(); await signIn(b, secondLogin, secondPassword);
  await b.getByRole("button", { name: "项目", exact: true }).click();
  await panel(b).getByRole("row").filter({ hasText: "验收筹备项目A" }).waitFor();
  assert.equal(await panel(b).getByRole("row").filter({ hasText: "验收筹备项目A" }).count(), 1);
  await panel(b).getByRole("button", { name: "准备清单", exact: true }).click();
  await panel(a).getByLabel("项目名称").fill("运营A待保存版本");
  await panel(b).getByLabel("项目名称").fill("运营B已保存版本"); await panel(b).getByRole("button", { name: "保存基本信息" }).click(); await panel(b).getByText(/基本信息已保存；仍在筹备/).waitFor();
  await panel(a).getByRole("button", { name: "保存基本信息" }).click(); await panel(a).getByText(/项目已被其他运营更新/).waitFor(); assert.equal(await panel(a).getByLabel("项目名称").inputValue(), "运营A待保存版本");
  await a.getByRole("button", { name: "刷新", exact: true }).click(); await panel(a).getByRole("button", { name: "已核对，采用最新版本继续编辑" }).waitFor();
  await panel(a).getByText(/当前保存：运营B已保存版本/).waitFor(); await a.screenshot({ path: `${output}/conflict.png`, fullPage: true });
  await panel(a).getByRole("button", { name: "已核对，采用最新版本继续编辑" }).click(); await panel(a).getByRole("button", { name: "保存基本信息" }).click(); await panel(a).getByText(/基本信息已保存；仍在筹备/).waitFor();
  await panel(a).getByLabel("负责人").selectOption({ label: "验收代办运营" }); await panel(a).getByLabel("提醒邮箱").fill("qa-project@example.invalid");
  await panel(a).getByRole("button", { name: "保存基本信息" }).click(); await panel(a).getByText("提醒邮箱已保存；尚未发送", { exact: true }).waitFor();
  await a.reload({ waitUntil: "networkidle" }); await a.getByRole("button", { name: "项目", exact: true }).click(); await panel(a).getByRole("button", { name: "准备清单", exact: true }).click();
  assert.equal(await panel(a).getByLabel("项目名称").inputValue(), "运营A待保存版本"); assert.equal(await panel(a).getByLabel("提醒邮箱").inputValue(), "qa-project@example.invalid");
  await a.screenshot({ path: `${output}/readiness-desktop.png` });
  await a.screenshot({ path: `${output}/readiness-full.png`, fullPage: true });
  for (const width of [980, 700, 390]) {
    await a.setViewportSize({ width, height: 1000 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `overflow at ${width}`);
    if (width <= 700) { await a.getByText("手机端为只读模式", { exact: true }).waitFor(); assert.equal(await panel(a).getByRole("button", { name: "保存基本信息" }).count(), 0); }
    await a.screenshot({ path: `${output}/readiness-${width}.png`, fullPage: true });
  }
  await a.setViewportSize({ width: 1465, height: 1074 }); await panel(a).getByRole("button", { name: "返回项目列表" }).click();
  assert.equal(await panel(a).getByRole("row").filter({ hasText: "运营A待保存版本" }).count(), 1);
  await panel(a).getByRole("button", { name: "新建项目" }).click(); await panel(a).getByLabel("项目名称").fill("客户验收筹备项目"); await panel(a).getByLabel("项目类型").selectOption("client_managed");
  await panel(a).getByRole("button", { name: "创建筹备项目" }).click(); assert.equal(await panel(a).getByRole("heading", { name: "新建筹备项目" }).count(), 1);
  await panel(a).getByLabel("关联客户").fill("隔离验收客户"); await panel(a).getByRole("button", { name: "创建筹备项目" }).click(); await panel(a).getByText(/基本信息已保存；仍在筹备/).waitFor();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, scope: "real project metadata UI only", responseLossReplay: true, peerConflict: true, draftsPreserved: true, reloadPersistence: true, readOnlyWidths: [700,390], autoExecution: "not created or accepted", browserErrors: 0 }));
} finally { await browser.close(); }
