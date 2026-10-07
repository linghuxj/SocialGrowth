import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const output = resolve(process.env.SG_PRODUCT_EXECUTOR_CONSOLE_OUTPUT ?? "artifacts/acceptance/executor-console-migration-20261006");
let password = process.env.SG_PRODUCT_TEST_PASSWORD;
const loginName = process.env.SG_PRODUCT_TEST_LOGIN_NAME ?? "device-live-local";
if (!password && process.env.SG_PRODUCT_LOCAL_LIVE_TEST === "1") {
  const config = JSON.parse(await readFile(resolve(".runtime/product-local-live/config.json"), "utf8")) as { operatorPassword?: string };
  password = config.operatorPassword;
}
assert.ok(password, "Explicit test credentials or owned local-live test environment required");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1465, height: 1074 }, locale: "zh-CN" });
const page = await context.newPage();
const requests: { method: string; path: string }[] = [];
const errors: string[] = [];
page.on("request", request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/")) requests.push({ method: request.method(), path: url.pathname });
});
page.on("pageerror", error => errors.push(error.name));
const checks: string[] = [];
try {
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await page.getByLabel("登录名", { exact: true }).fill(loginName);
  await page.getByLabel("密码", { exact: true }).fill(password);
  password = undefined;
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "运营工作台", exact: true }).waitFor();
  checks.push("Actual formal Web login passed");
  const response = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/operator/executor/status");
  await page.getByRole("button", { name: "执行与人工协助", exact: true }).click();
  await page.getByRole("heading", { name: "执行与人工协助", level: 1 }).waitFor();
  const factsResponse = await response; assert.equal(factsResponse.status(), 200);
  const facts = await factsResponse.json() as { configured: boolean; available: boolean; jobs: { id: string }[]; tasks: { id: string; status: string }[]; bootstrapDevices: { deviceId: string; connected: boolean }[] };
  await page.getByRole("heading", { name: "安全登录协助", exact: true }).waitFor();
  await page.getByRole("heading", { name: "人工协助与复查", exact: true }).waitFor();
  await page.getByRole("heading", { name: "受控执行检查", exact: true }).waitFor();
  assert.equal(await page.locator("[data-executor-job]").count(), facts.jobs.length);
  for (const task of facts.tasks) await page.getByRole("row").filter({ hasText: task.id }).getByRole("cell", { name: task.status, exact: true }).waitFor();
  await page.getByRole("heading", { name: "手机接入与准备", exact: true }).waitFor();
  if (facts.bootstrapDevices.length === 0) {
    await page.getByText("尚无可准备的手机。", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "开始手机准备（不执行业务）", exact: true }).count(), 0);
    checks.push("No live bootstrap target cannot expose a preparation launch button");
  }
  checks.push("Visible original tasks, receipt list and migrated human-assistance sections match authenticated read");
  if (facts.available) {
    await page.getByLabel("预期身份名称", { exact: true }).fill("迁移入口校验，不执行手机任务");
    await page.getByLabel("预期身份编号", { exact: true }).fill("invalid-profile");
    await page.getByLabel("检查说明", { exact: true }).fill("仅验证表单拒绝，不提交业务检查");
    await page.getByRole("button", { name: "启动受控检查", exact: true }).click();
    assert.equal(await page.getByLabel("预期身份编号", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.patternMismatch), true);
    checks.push("Real form rejects invalid identity before task submission");
  } else checks.push("Unconfigured diagnostic form remains disabled");
  const refreshed = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/operator/executor/status");
  await page.getByRole("button", { name: "查询原任务", exact: true }).click();
  assert.equal((await refreshed).status(), 200);
  checks.push("Original request refresh uses formal authenticated Web route");
  assert.ok(requests.every(request => !request.path.startsWith("/api/runtime")));
  assert.equal(requests.filter(request => request.path.startsWith("/api/operator/executor/") && request.method !== "GET").length, 0);
  await page.screenshot({ path: resolve(output, "formal-execution-console.png"), fullPage: true, mask: [page.locator("input, textarea")] });
  await page.getByRole("button", { name: "退出登录", exact: true }).first().click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  checks.push("Actual formal logout removes authenticated console");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, checks, requests,
    jobCount: facts.jobs.length, taskCount: facts.tasks.length, diagnosticConfigured: facts.available,
    phoneActions: "not-run", realHumanResponseAndCredentialDelivery: "not-run", publication: "not-run" }, null, 2));
  console.log(JSON.stringify({ passed: true, assertions: checks.length, tasks: facts.tasks.length, jobs: facts.jobs.length, phoneActions: false }));
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ checkedAt: new Date().toISOString(), passed: false, checks, requests, category: error instanceof Error ? error.name : "UnknownFailure" }, null, 2));
  // Error call logs can contain input. Keep only a bounded category in output.
  console.error(JSON.stringify({ passed: false, category: error instanceof Error ? error.name : "UnknownFailure" }));
  process.exitCode = 1;
} finally { await context.close(); await browser.close(); }
