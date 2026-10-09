import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { executorConsoleSchema, type ExecutorConsole } from "../product/contracts/src/executor-console.js";

// Actual Web only. GET response observations supplement visible receipts;
// this script never writes through APIs, SQLite, ADB or a simulated executor.
const url = process.env.SG_PRODUCT_WEB_URL;
const loginFile = process.env.SG_PRODUCT_DEPLOYMENT_LOGIN_FILE;
assert.ok(url && loginFile, "Web URL and protected login file required");
const login = JSON.parse(await readFile(loginFile, "utf8")) as { loginName: string; password: string };
assert.ok(typeof login.loginName === "string" && typeof login.password === "string");
const output = resolve(process.env.SG_PHONE_INITIALIZATION_OUTPUT ?? "output/playwright/phone-initialization");
const waitMs = Number(process.env.SG_PHONE_INITIALIZATION_WAIT_MS ?? "30000");
assert.ok(Number.isSafeInteger(waitMs) && waitMs >= 1000 && waitMs <= 7_200_000, "A bounded observation window is required");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true, ...(process.env.SG_PRODUCT_BROWSER_PROXY ? { proxy: { server: process.env.SG_PRODUCT_BROWSER_PROXY } } : {}) });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
let step = "login", jobId: string | undefined;
let outcome = "unconfirmed";
let lastFacts: ExecutorConsole | undefined;
async function refresh(): Promise<ExecutorConsole> {
  const response = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/operator/executor/status");
  await page.getByRole("button", { name: "查询原任务", exact: true }).click();
  const result = await response; assert.equal(result.status(), 200);
  lastFacts = executorConsoleSchema.parse(await result.json());
  return lastFacts;
}
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByLabel("登录名", { exact: true }).fill(login.loginName);
  await page.getByLabel("密码", { exact: true }).fill(login.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  login.password = "";
  await page.getByRole("heading", { name: "运营工作台", exact: true }).waitFor();
  step = "console";
  await page.getByRole("button", { name: "执行与人工协助", exact: true }).click();
  await page.getByRole("heading", { name: "手机接入与准备", exact: true }).waitFor();
  let facts = await refresh();
  assert.equal(facts.automaticPhoneInitialization, true, "Production initialization must be explicitly enabled");
  await page.getByText("手机连接核验后自动准备环境。需要机主操作时会显示提示；准备结果见下方回执。", { exact: true }).waitFor();
  const specified = process.env.SG_PHONE_INITIALIZATION_DEVICE;
  step = "connection";
  const connectionDeadline = Date.now() + 60000;
  while (!facts.bootstrapDevices.some(d => (!specified || d.deviceId === specified) && d.connected) && Date.now() < connectionDeadline) {
    await page.waitForTimeout(5000); facts = await refresh();
  }
  const candidates = facts.bootstrapDevices.filter(d => !specified || d.deviceId === specified);
  assert.equal(candidates.length, 1, "Choose exactly one verified target");
  const deviceId = candidates[0].deviceId;
  assert.equal(candidates[0].connected, true);
  if (process.env.SG_PHONE_INITIALIZATION_RETURN_CONTROL === "true") {
    const hold = facts.holds.find(h => h.device === deviceId);
    if (hold) {
      assert.equal(hold.actor, "local-operator", "Do not release initialization or unresolved-task holds");
      assert.equal(facts.tasks.some(t => ["queued", "running", "unknown", "blocked"].includes(t.status)), false);
      assert.equal(facts.jobs.some(j => j.deviceId === deviceId && j.status === "running"), false);
      step = "return_control";
      await writeFile(resolve(output, "web-control-intent.json"), JSON.stringify({ at: new Date().toISOString(), deviceId, action: "return_existing_operator_hold" }), { mode: 0o600 });
      await page.locator(`[data-bootstrap-device="${deviceId}"]`).getByRole("button", { name: "交还自动准备", exact: true }).click();
      facts = await refresh();
      assert.equal(facts.holds.some(h => h.device === deviceId && h.actor === "local-operator"), false);
    }
  }
  if (process.env.SG_PHONE_INITIALIZATION_RESUME === "true") {
    const original = facts.jobs.find(j => j.deviceId === deviceId && j.expectedName === "手机环境初始化");
    assert.ok(original && original.status === "finished" && original.resultCode === "UNCONFIRMED" && !original.initializationRecovery);
    assert.ok((original.initializationStartupRecoveryCount ?? 0) < 2 || original.initializationPrepared && (original.initializationConfigurationRecoveryCount ?? (original.initializationPreparationRequestId ? 1 : 0)) < 2 || original.errorCode === "ASSISTANCE_EXPIRY_INVALID");
    step = "resume_original";
    await writeFile(resolve(output, "resume-intent.json"), JSON.stringify({ at: new Date().toISOString(), deviceId, originalId: original.id }), { mode: 0o600 });
    const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/operator/executor/bootstrap-initialization-resume");
    await page.locator(`[data-bootstrap-device="${deviceId}"]`).getByRole("button", { name: "核对原停止证据并继续初始化", exact: true }).click();
    const received = await response;
    await writeFile(resolve(output, "resume-response.json"), JSON.stringify({ status: received.status(), at: new Date().toISOString() }), { mode: 0o600 });
    assert.ok(received.status() === 201 || received.status() === 200, "Reconcile a rejected continuation; never retry blindly");
    facts = await refresh();
    const next = facts.jobs.find(j => j.deviceId === deviceId && j.expectedName === "手机环境初始化");
    assert.ok(next && next.id !== original.id && next.previousInitializationId === original.id);
    jobId = next.id;
    await page.locator(`[data-bootstrap-device="${deviceId}"]`).getByText(`衔接原失败任务：${original.id}。原回执保留。`, { exact: true }).waitFor();
  }
  step = "original_job";
  const deadline = Date.now() + waitMs;
  while (true) {
    const job = facts.jobs.find(j => j.deviceId === deviceId && j.expectedName === "手机环境初始化");
    if (job) jobId = job.id;
    if (job && job.status !== "running") {
      if (job.status !== "finished" || job.resultCode !== "CONNECTIVITY_SETUP_COMPLETED") { outcome = "failed_initialization"; break; }
      assert.ok(job.stability && job.stability.observedSeconds >= 300 && job.stability.samples >= 2);
      const receipt = page.locator(`[data-executor-job="${job.id}"]`);
      await receipt.getByText(/CONNECTIVITY_SETUP_COMPLETED/).waitFor();
      await receipt.screenshot({ path: resolve(output, "receipt.png") });
      // Handoff may happen on the next scan; observe the actual Web status.
      if (facts.bootstrapDevices.find(d => d.deviceId === deviceId)?.mode === "managed_verified") {
        outcome = "passed"; break;
      }
    }
    if (facts.requests.some(r => r.taskId === jobId && r.status === "waiting" && Date.parse(r.expiresAt) > Date.now())) {
      outcome = "owner_action_required"; break;
    }
    if (Date.now() >= deadline) { outcome = "pending_original_job"; break; }
    await writeFile(resolve(output, "progress.json"), JSON.stringify({ at: new Date().toISOString(), jobId: job?.id, status: job?.status, phase: job?.initializationProgress?.phase }, null, 2), { mode: 0o600 });
    await page.waitForTimeout(15000); facts = await refresh();
  }
  const job = facts.jobs.find(j => j.id === jobId);
  await page.locator("section[aria-labelledby='bootstrap-title']").screenshot({ path: resolve(output, "connection.png") });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ outcome, jobId, deviceId, job, at: new Date().toISOString(), webObserved: true,
    requests: facts.requests.filter(r => r.taskId === jobId), newPhoneFirstEnrollmentAccepted: false, longTermStabilityAccepted: false, businessAccepted: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ outcome, jobId, step, newPhoneFirstEnrollmentAccepted: false, longTermStabilityAccepted: false }));
  if (outcome !== "passed") process.exitCode = outcome === "failed_initialization" ? 1 : 2;
  await page.getByRole("button", { name: "退出登录", exact: true }).first().click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ outcome: "failed", step, jobId, category: error instanceof Error ? error.name : "Unknown",
    bootstrapDevices: lastFacts?.bootstrapDevices, automaticPhoneInitialization: lastFacts?.automaticPhoneInitialization,
    originalJobs: lastFacts?.jobs.filter(j => j.deviceId === process.env.SG_PHONE_INITIALIZATION_DEVICE).map(j => ({ id: j.id, status: j.status, resultCode: j.resultCode, errorCode: j.errorCode, initializationPrepared: j.initializationPrepared })) }), { mode: 0o600 });
  console.error(JSON.stringify({ outcome: "failed", step, jobId })); process.exitCode = 1;
} finally {
  // A browser timeout never cancels or recreates a phone task. Reconcile its ID.
  await browser.close();
}
