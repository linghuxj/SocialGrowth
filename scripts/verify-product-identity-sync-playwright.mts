import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { accountPreparationWorkspaceSchema, productErrorResponseSchema } from "../product/contracts/src/index.js";

// Tests the real blocked writeback path against the original task. No API/DB
// writes outside Web, fabricated receipt, new task, or device retry.
const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1", "Candidate Web only");
const projectId = process.env.SG_PRODUCT_CORE_PROJECT_ID, projectName = process.env.SG_PRODUCT_CORE_PROJECT_NAME;
const loginFile = process.env.SG_PRODUCT_DEPLOYMENT_LOGIN_FILE;
assert.ok(projectId && projectName && loginFile, "Existing project and protected operator login required");
const login = JSON.parse(await readFile(loginFile, "utf8"));
const output = resolve(process.env.SG_PRODUCT_IDENTITY_SYNC_OUTPUT ?? "output/playwright/identity-sync");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
let step = "login";
const errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(error.name));
const path = `/api/operator/projects/${projectId}/account-preparation`;
async function openProject() {
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const workspace = page.locator(".project-workspace");
  await workspace.getByRole("row").filter({ has: page.getByText(projectName!, { exact: true }) })
    .getByRole("button", { name: "打开项目", exact: true }).click();
  const read = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === path);
  await workspace.getByRole("button", { name: "设置 · 目标与周期", exact: true }).click();
  const response = await read; assert.equal(response.status(), 200);
  return accountPreparationWorkspaceSchema.parse(await response.json());
}
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill(login.loginName);
  await page.getByLabel("密码", { exact: true }).fill(login.password); login.password = "";
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "运营工作台", exact: true }).waitFor();
  step = "original-task";
  const before = await openProject();
  assert.equal(before.tasks.length, 1, "Use the original bounded preparation task");
  assert.deepEqual(before.identityVerifications, []);
  const panel = page.getByRole("region", { name: "发布身份初始化", exact: true });
  const button = panel.getByRole("button", { name: "同步原身份核验", exact: true });
  await button.waitFor();
  assert.equal(await button.isEnabled(), true);
  step = "real-blocked-sync";
  const received = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === `${path}/identity-sync`);
  await button.click(); const response = await received;
  assert.equal(response.status(), 409);
  assert.equal(productErrorResponseSchema.parse(await response.json()).error.code, "FACT_VERSION_STALE");
  await panel.getByText("当前条件或原核验回执尚不完整，请读取原记录核对；本次没有派发手机动作或替换身份。", { exact: true }).waitFor();
  checks.push("实际 Web 同步缺少可信回执时明确阻断，不伪造已绑定身份");
  const read = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === path);
  await panel.getByRole("button", { name: "读取初始化记录", exact: true }).click();
  const after = accountPreparationWorkspaceSchema.parse(await (await read).json());
  assert.deepEqual(after, before);
  checks.push("重新读取保留原任务、版本、身份、原操作和资源版本");
  await panel.screenshot({ path: resolve(output, "blocked-original-task.png") });
  await page.reload();
  const reloaded = await openProject(); assert.deepEqual(reloaded, before);
  checks.push("浏览器重载保留原记录，未重复派发或升级权限");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks,
    businessAcceptance: "blocked", blockers: ["trusted_original_identity_receipt_required"],
    originalTaskId: before.tasks[0]!.taskId, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, checks: checks.length, businessAcceptance: "blocked" }));
} catch {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, step, businessAcceptance: "not_completed" }), { mode: 0o600 });
  console.error(JSON.stringify({ passed: false, step })); process.exitCode = 1;
} finally { login.password = ""; await browser.close(); }
