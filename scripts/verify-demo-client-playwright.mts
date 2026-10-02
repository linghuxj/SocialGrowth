import assert from "node:assert/strict";
import { mkdir, writeFile, lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.SG_DEMO_REAL_CLIENT_TEST, "authorized");
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/blocker-resolution-live-20261002/client-artemis");
await mkdir(output, { recursive: true, mode: 0o700 });
const intent = resolve(output, "launch-intent.json");
const phase = process.env.SG_DEMO_CLIENT_PHASE ?? "launch";
assert.ok(["launch", "reconcile"].includes(phase));
if (phase === "launch") {
  try { await lstat(intent); throw new Error("Original native test exists; reconcile before launching another"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
}
const save = (name: string, data: unknown) => writeFile(resolve(output, name), JSON.stringify(data, null, 2), { mode: 0o600 });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(30_000);
const web = process.env.SOCIALGROWTH_WEB_URL ?? "http://127.0.0.1:3000";
if (phase === "reconcile") {
  try {
    const ack = JSON.parse(await readFile(resolve(output, "launch-ack.json"), "utf8")) as { taskId: string };
    assert.match(ack.taskId, /^[a-f0-9-]{36}$/);
    await page.goto(`${web}/#/connections`);
    const card = page.locator(`[data-verification-id="${ack.taskId}"]`);
    await card.waitFor();
    const text = await card.innerText();
    assert.ok(!text.includes("running ·"), "Reconcile original terminal task only");
    const checks = text.match(/Artemis 检查：([^；]+)；通过 (\d+)，失败 (\d+)，待确认 (\d+)/);
    assert.ok(checks, "Original checker diagnostics must be visible");
    const accepted = text.includes("finished · CLIENT_TEST_COMPLETED") &&
      checks[1] === "completed" && Number(checks[2]) > 0 && Number(checks[3]) === 0 && Number(checks[4]) === 0;
    if (!accepted && text.includes("CLIENT_TEST_COMPLETED")) {
      await card.locator('[data-client-acceptance="failed"]').waitFor();
      assert.match(await card.innerText(), /客户端验收未通过/);
    }
    await card.screenshot({ path: resolve(output, "original-web-reconciliation.png") });
    await save("original-web-reconciliation.json", { checkedAt: new Date().toISOString(), taskId: ack.taskId,
      originalWebText: text, acceptance: accepted ? "passed" : "failed", taskRelaunched: false,
      backendStateWritten: false, historicalResultRewritten: false });
    console.log(JSON.stringify({ event: "original_client_test_reconciled", taskId: ack.taskId,
      acceptance: accepted ? "passed" : "failed", taskRelaunched: false }));
  } finally { await browser.close(); }
  process.exit(0);
}
let acquiredHold = false, taskId = "", traceId = "", result = "not_started", cleanupConfirmed = false;
try {
  await page.goto(`${web}/#/receipts`);
  await page.getByRole("heading", { name: "任务中心", level: 1, exact: true }).waitFor();
  await page.getByRole("button", { name: /^RFCW40MYYCV：(?:申请人工接管|交还自动复查)$/ }).waitFor();
  const hold = page.getByRole("button", { name: "RFCW40MYYCV：申请人工接管", exact: true });
  if (await hold.count()) { await hold.click(); acquiredHold = true; }
  await page.getByRole("button", { name: "RFCW40MYYCV：交还自动复查", exact: true }).waitFor();
  await page.goto(`${web}/#/connections`);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "真机发布前验收", exact: true }) });
  await panel.getByRole("button", { name: "从 Web 启动完整验收", exact: true }).waitFor();
  await panel.getByLabel("平台", { exact: true }).selectOption("socialgrowth");
  await panel.getByLabel("执行模式", { exact: true }).selectOption("client_test");
  await panel.getByLabel("预期账号显示名", { exact: true }).fill("SocialGrowth 自有客户端");
  await panel.getByLabel("预期平台身份 ID", { exact: true }).fill("com.socialgrowth.product");
  await panel.getByLabel("任务目标（禁止凭证）", { exact: true }).fill("用户已授权 Artemis 直接操作已关联的 Samsung 自有客户端，测试现有参与在后台持续以及撤回。禁止注册、登录、恢复参与、设置修改、其他 App、内容发布；保留历史 unknown。");
  await panel.getByLabel("验收文案", { exact: true }).fill("NATIVE PARTICIPATION TEST - NO PUBLICATION");
  await panel.getByRole("checkbox").check();
  await save("launch-intent.json", { at: new Date().toISOString(), scope: "native_background_and_withdraw", noPublication: true });
  const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/api/runtime/verifications" && r.request().method() === "POST");
  await panel.getByRole("button", { name: "从 Web 启动完整验收", exact: true }).click();
  const response = await responsePromise; assert.equal(response.status(), 200);
  const launched = await response.json() as { id: string; deviceId: string; status: string };
  assert.equal(launched.deviceId, "RFCW40MYYCV"); assert.equal(launched.status, "running");
  taskId = launched.id; assert.match(taskId, /^[a-f0-9-]{36}$/);
  await save("launch-ack.json", { taskId, deviceId: launched.deviceId });
  console.log(JSON.stringify({ event: "native_web_task_launched", taskId }));
  const card = panel.locator(`[data-verification-id="${taskId}"]`); await card.waitFor();
  const deadline = Date.now() + 720000;
  while (Date.now() < deadline) {
    const text = await card.innerText();
    traceId = text.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/g)?.find(id => id !== taskId) ?? traceId;
    await save("progress.json", { taskId, traceId, at: new Date().toISOString(), text });
    if (!text.includes("running ·")) { result = text; break; }
    await page.waitForTimeout(2000);
  }
  assert.match(result, /finished · CLIENT_TEST_COMPLETED/);
  assert.match(result, /Artemis 检查：completed；通过 [1-9]\d*，失败 0，待确认 0/);
  assert.match(result, /登录提交：0/); assert.match(result, /内容提交：未点击/);
  await card.screenshot({ path: resolve(output, "native-web-receipt.png") });
} catch (error) {
  result = error instanceof Error ? error.message.split("\n")[0] : "UNCONFIRMED";
  process.exitCode = 2;
} finally {
  try {
    if (taskId) {
      const stop = page.locator(`[data-verification-id="${taskId}"]`).getByRole("button", { name: "停止该验收任务", exact: true });
      if (await stop.count()) { await stop.click(); await stop.waitFor({ state: "detached", timeout: 60000 }); }
    }
    if (acquiredHold) {
      await page.goto(`${web}/#/receipts`);
      await page.getByRole("button", { name: "RFCW40MYYCV：交还自动复查", exact: true }).click();
      await page.getByRole("button", { name: "RFCW40MYYCV：申请人工接管", exact: true }).waitFor();
    }
    cleanupConfirmed = true;
  } catch { process.exitCode = 2; }
  await save("result.json", { checkedAt: new Date().toISOString(), taskId, traceId, result, cleanupConfirmed,
    initiatedThrough: "pnpm test:playwright / actual Demo Web", backendWithdrawalIndependentlyRequired: true,
    businessQueueConsumed: false, oldUnknownResolved: false, physicalStopConfirmed: false, publicationAttempted: false });
  console.log(JSON.stringify({ event: "native_web_test_result", taskId, result, cleanupConfirmed }));
  await browser.close();
}
