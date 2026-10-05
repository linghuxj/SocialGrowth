import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1");
const projectName = process.env.SG_PRODUCT_CORE_PROJECT_NAME;
assert.ok(projectName, "Use the existing authorized test project");
const execute = process.env.SG_PRODUCT_CORE_EXECUTE === "1";
const output = resolve(process.env.SG_PRODUCT_CORE_OUTPUT ?? "output/playwright/core-execution-20261006");
await mkdir(output, { recursive: true });
const password = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")).operatorPassword;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
const checks: string[] = [];
let step = "login", starts = 0, attempts = 0;
page.on("request", request => {
  if (request.method() !== "POST") return;
  const path = new URL(request.url()).pathname;
  if (path.endsWith("/preflight")) starts++;
  if (path.endsWith("/attempts")) attempts++;
});
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace");
  await project.getByRole("row").filter({ has: page.getByText(projectName, { exact: true }) })
    .getByRole("button", { name: "打开项目", exact: true }).click();
  await project.getByRole("button", { name: "排期与任务", exact: true }).click();
  const readiness = page.getByRole("region", { name: "计划任务当前条件", exact: true });
  await readiness.getByText(/发布准备状态：/).waitFor();
  await readiness.getByText(/检查时间：/).waitFor();
  assert.ok((await readiness.innerText()).includes("最终发布前"));
  assert.ok(!(await project.innerText()).includes("手机任务派发：未接入"));
  checks.push("任务页说明准备核对会操作手机并停在最终发布前，任务编号收在详情");
  await readiness.screenshot({ path: resolve(output, "before-desktop.png") });
  step = "narrow read-only interaction";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await readiness.getByRole("button", { name: /创建原尝试并检查|检查 Page 与切片/ }).count(), 0);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(width.scroll <= width.viewport + 1);
  await readiness.screenshot({ path: resolve(output, "readiness-390.png") });
  checks.push("390px 保持只读、隐藏启动动作且无整页横向溢出");
  await page.setViewportSize({ width: 1465, height: 1074 });
  await page.getByText("手机端为只读模式", { exact: true }).waitFor({ state: "hidden" });
  if (execute) {
    step = "real phone preflight with lost HTTP response";
    const start = readiness.getByRole("button", { name: /创建原尝试并检查发布准备|检查 Page 与切片发布准备/, exact: false });
    if (await start.count()) {
      await page.route("**/preflight", async route => {
        if (route.request().method() !== "POST") return route.continue();
        // The real backend processes the one request; only its browser response
        // is interrupted. Never invent a result or retry the device operation.
        const response = await route.fetch();
        await writeFile(resolve(output, "start-response.json"), JSON.stringify({ status: response.status(), body: await response.json() }, null, 2));
        await route.abort("connectionreset");
      });
      await start.click();
      await readiness.getByText(/请求响应中断，原核查状态未知/).waitFor({ timeout: 60000 });
      await page.unroute("**/preflight");
      const beforeQueries = starts;
      await readiness.getByRole("button", { name: "查询原核查状态", exact: true }).click();
      assert.equal(starts, beforeQueries, "Query must never start another phone operation");
      checks.push("真实启动响应中断后页面显示未知，查询原操作未再次 POST");
    }
    step = "trusted result writeback";
    const prepared = readiness.getByText("发布准备已核对，尚未发布", { exact: true }).first();
    await prepared.waitFor({ timeout: 16 * 60_000 });
    assert.ok(starts <= 1 && attempts <= 1, "One original attempt and one start at most");
    await readiness.screenshot({ path: resolve(output, "prepared.png") });
    await page.reload();
    await project.getByRole("button", { name: "排期与任务", exact: true }).click();
    await prepared.waitFor();
    checks.push("原任务可信准备结果回写且刷新后保留，明确尚未发布");
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "passed", checks, starts, attempts, phonePreflight: execute, publicPublication: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, starts, attempts, phonePreflight: execute }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failed.png"), fullPage: true });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "failed", step, checks, starts, attempts, error: error instanceof Error ? error.message : "unknown" }, null, 2));
  throw error;
} finally { await browser.close(); }
