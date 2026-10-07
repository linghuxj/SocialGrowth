import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const checkKind = process.env.SG_NETWORK_CHECK_KIND ?? "network-coexistence";
assert.ok(["network-coexistence", "pilot-device-connectivity", "pilot-coexistence-guide"].includes(checkKind));
const remoteSerial = process.env.SG_PHONE_NETWORK_REMOTE_SDK;
assert.ok(remoteSerial && /^127\.0\.0\.1:\d+$/.test(remoteSerial), "Verified remote bridge required");
const cfg = JSON.parse(await readFile(".runtime/web-verification.json", "utf8"));
assert.equal(cfg.serial, remoteSerial, "Web must use the verified remote transport, without USB fallback");
const liveIdentity = await promisify(execFile)("adb", ["-s", remoteSerial, "shell", "getprop", "ro.serialno"], { timeout: 10_000 });
assert.equal(liveIdentity.stdout.trim(), "RFCW40MYYCV", "Read the current hardware identity through the remote alias before submitting");
const output = resolve(process.env.SG_NETWORK_COEXISTENCE_OUTPUT ?? "output/playwright/network-coexistence-20261006");
await mkdir(output, { recursive: true, mode: 0o700 });
let password = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")).operatorPassword;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1465, height: 1074 }, locale: "zh-CN" });
const errors: string[] = [];
page.on("pageerror", e => errors.push(e.name));
let jobId: string | undefined;
let originalActor: string | undefined;
let passed = false;
let stage = "login";
async function refresh() {
  const response = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/operator/executor/status");
  await page.getByRole("button", { name: "查询原任务", exact: true }).click();
  const r = await response; assert.equal(r.status(), 200); return r.json();
}
try {
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(password); password = undefined;
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "运营工作台", exact: true }).waitFor();
  stage = "open_console";
  await page.getByRole("button", { name: "执行与人工协助", exact: true }).click();
  await page.getByRole("heading", { name: "执行与人工协助", level: 1 }).waitFor();
  stage = "initial_refresh";
  const before = await refresh(); assert.equal(before.available, true);
  originalActor = before.holds.find((h: any) => h.device === cfg.deviceId)?.actor;
  assert.ok(originalActor, "Preserve existing hold; do not claim or release it");
  assert.equal(before.jobs.filter((j: any) => j.status === "running").length, 0);
  const existingJob = process.env.SG_NETWORK_EXISTING_JOB;
  let facts = before;
  let job: any;
  if (existingJob) {
    assert.match(existingJob, /^[0-9a-f-]{36}$/);
    job = facts.jobs.find((j: any) => j.id === existingJob);
    assert.ok(job, "Reconcile the original Web task instead of resubmitting");
    jobId = job.id;
  } else {
  stage = "fill_form";
  const name = `${checkKind === "network-coexistence" ? "网络共存验证" : "新节点本机连接验证"}-${Date.now()}`;
  await page.getByLabel("检查平台").selectOption("socialgrowth");
  await page.getByLabel("检查模式").selectOption("connectivity_test");
  await page.getByLabel("预期身份名称", { exact: true }).fill(name);
  await page.getByLabel("预期身份编号", { exact: true }).fill("com.socialgrowth.product");
  await page.getByLabel("任务目标（禁止凭证）", { exact: true }).fill(checkKind === "network-coexistence" ? "VERIFY_PHONE_NETWORK_COEXISTENCE" : checkKind === "pilot-coexistence-guide" ? "VERIFY_CONNECTED_GUIDE_ONLY CHECK_NETWORK_PREPARATION_GUIDE" : "VERIFY_CONNECTED_GUIDE_ONLY");
  await page.getByLabel("检查说明", { exact: true }).fill(checkKind === "network-coexistence" ? "验证 Tailscale 远程 Artemis 与手机订阅同时可用。只读取 FB 并播放公开 YT 视频。禁止登录、发布和网络改动。" : "通过现有远程连接读取已关联本机的最新平台连接状态。禁止登录、重新关联、参与变更、配对、发布和网络改动。");
  await page.getByLabel("确认目标与范围，禁止最终发布", { exact: true }).check();
  stage = "submit";
  const submitted = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/operator/executor/verifications");
  await page.getByRole("button", { name: "启动受控检查", exact: true }).click();
  const submission = await submitted; assert.ok([200, 201].includes(submission.status()));
  await page.getByText("检查任务已受理。受理不代表执行成功。", { exact: true }).waitFor();
  facts = await refresh(); job = facts.jobs.find((j: any) => j.expectedName === name); assert.ok(job); jobId = job.id;
  console.log(JSON.stringify({ event: "web_network_task_started", jobId, remoteSerial, usbFallback: false }));
  }
  stage = "await_terminal";
  const deadline = Date.now() + 880_000;
  while (job.status === "running" && Date.now() < deadline) {
    await page.waitForTimeout(10_000); facts = await refresh(); job = facts.jobs.find((j: any) => j.id === jobId); assert.ok(job);
  }
  assert.equal(job.status, "finished"); assert.equal(job.resultCode, "CONNECTIVITY_SETUP_COMPLETED");
  // The operator API intentionally selects public job fields. Read-only counts
  // supplement the actual Web receipt; they never create or alter a task/result.
  const diagnosticsStore = new DatabaseSync(resolve(".runtime/runtime.sqlite"), { readOnly: true });
  let stored: any;
  try {
    const row = diagnosticsStore.prepare("SELECT body FROM web_verifications WHERE id=?").get(jobId) as { body: string } | undefined;
    assert.ok(row); stored = JSON.parse(row.body);
  } finally { diagnosticsStore.close(); }
  assert.equal(stored.id, jobId); assert.equal(stored.resultCode, job.resultCode);
  assert.equal(stored.goal, checkKind === "network-coexistence" ? "VERIFY_PHONE_NETWORK_COEXISTENCE" : checkKind === "pilot-coexistence-guide" ? "VERIFY_CONNECTED_GUIDE_ONLY CHECK_NETWORK_PREPARATION_GUIDE" : "VERIFY_CONNECTED_GUIDE_ONLY");
  const checks = stored.diagnostics;
  assert.equal(checks?.taskStatus, "completed");
  assert.equal(checks?.failed, 0); assert.equal(checks?.inconclusive, 0);
  assert.ok(checks?.passed >= (checkKind === "network-coexistence" ? 4 : checkKind === "pilot-coexistence-guide" ? 3 : 1));
  assert.equal(facts.holds.find((h: any) => h.device === cfg.deviceId)?.actor, originalActor);
  const article = page.locator(`[data-executor-job="${jobId}"]`);
  await article.getByText(/CONNECTIVITY_SETUP_COMPLETED/).waitFor();
  await article.screenshot({ path: resolve(output, "web-network-receipt.png") });
  assert.deepEqual(errors, []); passed = true;
  await writeFile(resolve(output, "web-result.json"), JSON.stringify({ checkedAt: new Date().toISOString(), passed, jobId, checkKind, independentChecks: checks,
    originalJobReconciled: !!existingJob, countsSource: "read_only_runtime_record",
    remoteSerial, usbFallback: false, webInitiated: true, finalReceiptVisible: true, originalHoldRetained: true,
    publication: false, businessAcceptance: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed, jobId, scope: checkKind }));
} catch (e) {
  await page.locator("section").filter({ has: page.locator("#executor-check-title") }).screenshot({ path: resolve(output, "web-failure.png"), mask: [page.locator("input, textarea")] }).catch(() => {});
  await writeFile(resolve(output, "web-failure.json"), JSON.stringify({ checkedAt: new Date().toISOString(), passed: false,
    stage, jobId, category: e instanceof Error ? e.name : "Unknown", errors }, null, 2), { mode: 0o600 });
  console.error(JSON.stringify({ passed: false, stage, jobId, category: e instanceof Error ? e.name : "Unknown" })); process.exitCode = 1;
} finally {
  if (!passed && jobId) {
    const article = page.locator(`[data-executor-job="${jobId}"]`);
    const stop = article.getByRole("button", { name: "请求停止", exact: true });
    if (await stop.count()) { await stop.click(); await refresh(); }
  }
  await page.close(); await browser.close();
}
