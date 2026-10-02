import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Explicit, bounded real Web -> Artemis observation -> operator feedback -> receipt.
// No business API writes, publication, login, identity creation, worker or queue consumption.
assert.equal(process.env.SG_DEMO_REAL_OBSERVATION, "authorized", "Explicit real-device scope required");
const expectedName = process.env.SG_DEMO_IDENTITY_NAME;
const expectedId = process.env.SG_DEMO_IDENTITY_ID;
assert.ok(expectedName && expectedId && /^\d{5,30}$/.test(expectedId));
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/demo-observation");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30_000);
let taskId = "", requestId = "", traceId = "", acquiredHold = false, responded = false;
let ownedHoldReleased = false, cleanupConfirmed = true;
let result = "not_started";
let step = "entry";
const save = (name: string, data: unknown) => writeFile(resolve(output, name), JSON.stringify(data, null, 2), { mode: 0o600 });
try {
  await page.goto(`${process.env.SOCIALGROWTH_WEB_URL ?? "http://127.0.0.1:3000"}/#/receipts`);
  await page.getByRole("heading", { name: "任务中心", exact: true, level: 1 }).waitFor();
  step = "device_hold";
  await page.getByRole("button", { name: /^RFCW40MYYCV：(?:申请人工接管|交还自动复查)$/ }).waitFor();
  const hold = page.getByRole("button", { name: "RFCW40MYYCV：申请人工接管", exact: true });
  if (await hold.count()) {
    await hold.click();
    await page.getByRole("button", { name: "RFCW40MYYCV：交还自动复查", exact: true }).waitFor();
    acquiredHold = true;
  } else {
    await page.getByRole("button", { name: "RFCW40MYYCV：交还自动复查", exact: true }).waitFor();
  }
  await page.goto(`${process.env.SOCIALGROWTH_WEB_URL ?? "http://127.0.0.1:3000"}/#/connections`);
  step = "verification_form";
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "真机发布前验收", exact: true }) });
  await panel.getByRole("button", { name: "从 Web 启动完整验收", exact: true }).waitFor();
  await panel.getByLabel("平台", { exact: true }).selectOption("facebook");
  await panel.getByLabel("执行模式", { exact: true }).selectOption("observe");
  await panel.getByLabel("预期账号显示名", { exact: true }).fill(expectedName);
  await panel.getByLabel("预期平台身份 ID", { exact: true }).fill(expectedId);
  await panel.getByLabel("任务目标（禁止凭证）", { exact: true }).fill("只读观察当前手机状态并说明是否可核验已登记 Facebook 身份。通过本任务请求一次人工澄清，收到回复后重新观察并保存真实结果。历史任务结果未知仍保留；不登录、不操作手机、不发布、不声明旧任务已完成。");
  await panel.getByLabel("验收文案", { exact: true }).fill("SG TAKEOVER OBSERVATION - DO NOT PUBLISH");
  await panel.getByRole("checkbox").check();
  step = "launch";
  const launched = page.waitForResponse(r => new URL(r.url()).pathname === "/api/runtime/verifications" && r.request().method() === "POST");
  await panel.getByRole("button", { name: "从 Web 启动完整验收", exact: true }).click();
  const response = await launched;
  assert.equal(response.status(), 200, "Actual Web task launch must be acknowledged");
  const envelope = await response.json() as { id: string; deviceId: string; status: string };
  assert.equal(envelope.deviceId, "RFCW40MYYCV");
  assert.equal(envelope.status, "running");
  assert.match(envelope.id, /^[a-f0-9-]{36}$/);
  taskId = envelope.id;
  step = "observation_and_feedback";
  console.log(JSON.stringify({ event: "web_launched", taskId }));
  const card = panel.locator(`[data-verification-id="${taskId}"]`);
  await card.waitFor();
  const receiptPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await receiptPage.goto(`${process.env.SOCIALGROWTH_WEB_URL ?? "http://127.0.0.1:3000"}/#/receipts`);
  const expires = Date.now() + 480_000;
  while (Date.now() < expires) {
    const content = await card.innerText();
    if (!content.includes("running ·")) { result = content; break; }
    const pending = receiptPage.locator("[data-agent-request-id]").filter({ hasText: taskId }).filter({ has: receiptPage.getByRole("button", { name: "提交回复并等待 Agent 核验", exact: true }) });
    if (!responded && await pending.count()) {
      assert.equal(await pending.count(), 1, "One task-bound clarification only");
      requestId = await pending.getAttribute("data-agent-request-id") ?? "";
      const requestText = await pending.innerText();
      assert.match(requestText, /clarification/);
      traceId = requestText.match(/Artemis：([a-f0-9-]{36})/)?.[1] ?? "";
      assert.ok(traceId, "Clarification must bind the original Artemis trace");
      const link = pending.getByRole("link", { name: "查看协助截图", exact: true });
      const href = await link.getAttribute("href");
      assert.ok(typeof href === "string" && href.startsWith("/api/runtime/supervision/screenshot?id="));
      // Read only: save the exact screenshot already linked by the task UI.
      const screenshot = await receiptPage.request.get(new URL(href, receiptPage.url()).href);
      assert.ok(screenshot.ok());
      await writeFile(resolve(output, "phone-observation-private.png"), await screenshot.body(), { mode: 0o600 });
      await save("waiting.json", { taskId, requestId, traceId, requestText });
      console.log(JSON.stringify({ event: "operator_review_required", taskId, requestId, traceId }));
      let feedback: { taskId: string; requestId: string; text: string } | undefined;
      while (Date.now() < expires && !feedback) {
        try { feedback = JSON.parse(await readFile(resolve(output, "operator-feedback.json"), "utf8")) as typeof feedback; }
        catch { await page.waitForTimeout(1000); }
      }
      assert.equal(feedback?.taskId, taskId); assert.equal(feedback?.requestId, requestId);
      assert.ok(feedback?.text && feedback.text.length <= 4000);
      await pending.getByLabel("处理说明／资料（禁止凭证）", { exact: true }).fill(feedback.text);
      await pending.getByRole("checkbox").check();
      const acknowledgement = receiptPage.waitForResponse(r => new URL(r.url()).pathname === "/api/runtime/supervision/respond" && r.request().method() === "POST");
      await pending.getByRole("button", { name: "提交回复并等待 Agent 核验", exact: true }).click();
      assert.equal((await acknowledgement).status(), 200);
      responded = true;
      console.log(JSON.stringify({ event: "web_feedback_submitted", taskId, requestId, traceId }));
    }
    await page.waitForTimeout(2000);
  }
  assert.ok(responded, "A genuine Artemis clarification and actual Web response are required");
  assert.match(result, /finished · OBSERVATION_COMPLETED/);
  assert.match(result, /登录提交：0/);
  assert.match(result, /内容提交：未点击/);
  const requestCard = receiptPage.locator(`[data-agent-request-id="${requestId}"]`);
  await requestCard.waitFor();
  assert.match(await requestCard.innerText(), /verified/);
  await receiptPage.close();
  await card.screenshot({ path: resolve(output, "web-observation-receipt.png") });
  result = "observation_and_web_feedback_confirmed";
} catch (error) {
  result = `${step}: ${error instanceof Error ? error.message.split("\n")[0] : "UNKNOWN_ERROR"}`;
  process.exitCode = 2;
} finally {
  try {
    if (taskId) {
      const stop = page.locator(`[data-verification-id="${taskId}"]`).getByRole("button", { name: "停止该验收任务", exact: true });
      if (await stop.count()) { await stop.click(); await stop.waitFor({ state: "detached", timeout: 60_000 }); }
    }
    if (acquiredHold) {
      await page.goto(`${process.env.SOCIALGROWTH_WEB_URL ?? "http://127.0.0.1:3000"}/#/receipts`);
      const release = page.getByRole("button", { name: "RFCW40MYYCV：交还自动复查", exact: true });
      await release.click();
      await page.getByRole("button", { name: "RFCW40MYYCV：申请人工接管", exact: true }).waitFor();
      ownedHoldReleased = true;
    }
  } catch { cleanupConfirmed = false; process.exitCode = 2; }
  try {
    await save("result.json", { checkedAt: new Date().toISOString(), taskId, requestId, traceId, result, responded,
      initiatedThrough: "pnpm test:playwright / real Demo Web", publicationAttempted: false,
      businessQueueConsumed: false, oldUnknownTaskResolved: false, ownedHoldReleased, cleanupConfirmed });
    console.log(JSON.stringify({ taskId, result, responded, cleanupConfirmed }));
  } finally { await browser.close(); }
}
