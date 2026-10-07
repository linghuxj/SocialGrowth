import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1");
const projectName = process.env.SG_PRODUCT_CORE_PROJECT_NAME;
assert.ok(projectName, "Use the existing authorized test project");
const execute = process.env.SG_PRODUCT_CORE_EXECUTE === "1";
const queryUnknown = process.env.SG_PRODUCT_CORE_EXPECT_UNKNOWN === "1";
assert.ok(!(execute && queryUnknown), "Querying an unknown original must never start a new check");
const output = resolve(process.env.SG_PRODUCT_CORE_OUTPUT ?? "output/playwright/core-execution-20261006");
await mkdir(output, { recursive: true, mode: 0o700 });
const password = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")).operatorPassword;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
const checks: string[] = [];
let step = "login", starts = 0, attempts = 0, retries = 0;
page.on("request", request => {
  if (request.method() !== "POST") return;
  const path = new URL(request.url()).pathname;
  if (path.endsWith("/preflight")) starts++;
  if (path.endsWith("/attempts")) attempts++;
  if (path.endsWith("/retry-audit")) retries++;
});
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const project = page.locator(".project-workspace");
  async function openProjectTasks() {
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await project.getByRole("row").filter({ has: page.getByText(projectName!, { exact: true }) })
      .getByRole("button", { name: "打开项目", exact: true }).click();
    await project.getByRole("button", { name: "排期与任务", exact: true }).click();
  }
  await openProjectTasks();
  const readiness = page.getByRole("region", { name: "计划任务当前条件", exact: true });
  await readiness.getByText(/发布准备状态：/).waitFor();
  await readiness.getByText(/检查时间：/).waitFor();
  assert.ok((await readiness.innerText()).includes("最终发布前"));
  assert.ok(!(await project.innerText()).includes("手机任务派发：未接入"));
  checks.push("任务页说明准备核对会操作手机并停在最终发布前，任务编号收在详情");
  await readiness.screenshot({ path: resolve(output, "before-desktop.png") });
  if (process.env.SG_PRODUCT_CORE_ONLY !== "1") {
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
  }
  if (queryUnknown) {
    step = "query original failed audit and inspect operator feedback";
    const querying = readiness.getByRole("button", { name: "查询原核查状态", exact: true });
    await querying.click();
    await querying.waitFor({ state: "visible" });
    await readiness.getByText(/身份核验超时|原发布准备检查超时/).waitFor();
    assert.ok((await readiness.innerText()).includes("系统不会重复启动") || (await readiness.innerText()).includes("结果核清前不会重复启动"));
    assert.equal(await readiness.getByRole("button", { name: /创建原尝试并检查|检查 Page 与切片/ }).count(), 0);
    assert.equal(starts, 0); assert.equal(attempts, 0);
    await readiness.screenshot({ path: resolve(output, "original-timeout-desktop.png") });
    await page.reload();
    await openProjectTasks();
    await readiness.getByText(/身份核验超时|原发布准备检查超时/).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText("手机端为只读模式", { exact: true }).waitFor();
    await readiness.screenshot({ path: resolve(output, "original-timeout-390.png") });
    assert.equal(await readiness.getByRole("button", { name: "查询原核查状态", exact: true }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    checks.push("原核验超时原因和下一步可见，刷新后保留，桌面只查询、手机只读，零重复派发");
  }
  if (execute) {
    step = "real phone preflight with lost HTTP response";
    const start = readiness.getByRole("button", { name: /创建原尝试并检查发布准备|检查 Page 与切片发布准备/, exact: false });
    if (await start.count()) {
      await page.route("**/preflight", async route => {
        if (route.request().method() !== "POST") return route.continue();
        // The real backend processes the one request; only its browser response
        // is interrupted. Never invent a result or retry the device operation.
        const response = await route.fetch();
        await writeFile(resolve(output, "start-response.json"), JSON.stringify({ status: response.status(), body: await response.json() }, null, 2), { mode: 0o600 });
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
    await openProjectTasks();
    await prepared.waitFor();
    checks.push("原任务可信准备结果回写且刷新后保留，明确尚未发布");
  }
  if (process.env.SG_PRODUCT_CORE_RETRY_AUDIT === "1") {
    step = "Web resumes only the stopped identity audit";
    await page.setViewportSize({ width: 1465, height: 1074 });
    await readiness.getByRole("button", { name: "查询原核查状态", exact: true }).click();
    const retry = readiness.getByRole("button", { name: "重新核验 Page 并继续准备", exact: true });
    await retry.waitFor({ timeout: 60000 });
    const accepted = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/retry-audit"));
    await retry.click();
    const retryResponse = await accepted;
    assert.ok(retryResponse.ok(), `Retry admission HTTP ${retryResponse.status()}`);
    const resumed = await retryResponse.json();
    assert.equal(resumed.operationId, "0ef94113-c6de-4171-b873-fd0c2bf62b53", "Continue only the original authorized operation");
    console.log(JSON.stringify({ event: "original_audit_resumed", operationId: resumed.operationId }));
    const prepared = readiness.getByText("发布准备已核对，尚未发布", { exact: true }).first();
    const deadline = Date.now() + 31 * 60_000;
    while (!(await prepared.isVisible()) && Date.now() < deadline) {
      await page.waitForTimeout(10_000);
      const reading = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname.endsWith(`/tasks/${resumed.taskId}/preflight`));
      await readiness.getByRole("button", { name: "查询原核查状态", exact: true }).click();
      const read = await reading; assert.ok(read.ok());
      const workflow = await read.json();
      const task = workflow.tasks.find((t: { taskId: string }) => t.taskId === resumed.taskId);
      assert.ok(task); assert.equal(task.operation?.operationId, resumed.operationId);
      assert.ok(["running", "prepared"].includes(task.workflow.state), `Original operation stopped: ${task.workflow.state}; ${task.workflow.blockers.join(",")}`);
    }
    await prepared.waitFor();
    assert.equal(starts, 0); assert.equal(attempts, 0);
    assert.equal(retries, 1, "One stopped read-only audit resumption only");
    await readiness.screenshot({ path: resolve(output, "recovered-prepared.png") });
    await page.reload(); await openProjectTasks();
    await readiness.getByText("发布准备已核对，尚未发布", { exact: true }).first().waitFor();
    checks.push("Web核清原只读身份核验后继续同一操作，可信Page和切片准备结果回写并刷新保留，未发布");
  }
  if (process.env.SG_PRODUCT_CORE_REVALIDATE === "1") {
    step = "revalidate original clip and project feedback through Web";
    await page.setViewportSize({ width: 1465, height: 1074 });
    const { revalidateSliceAndFeedback } = await import("./verify-product-slice-feedback-steps.mts");
    await revalidateSliceAndFeedback(page, project, output);
    checks.push("通过真实Web重新提取原切片、核对项目账号占用和效果来源；未知数值不填零");
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "passed", checks, starts, attempts, retries, phonePreflight: execute, queriedOriginalUnknown: queryUnknown, publicPublication: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, checks: checks.length, starts, attempts, phonePreflight: execute }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failed.png"), fullPage: true });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "failed", step, checks, starts, attempts, error: error instanceof Error ? error.message : "unknown" }, null, 2), { mode: 0o600 });
  throw error;
} finally { await browser.close(); }
