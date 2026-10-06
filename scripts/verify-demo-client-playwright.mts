import assert from "node:assert/strict";
import { mkdir, writeFile, lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { diagnosticConnectPort } from "./remote-adb-report-source.mts";

assert.equal(process.env.SG_DEMO_REAL_CLIENT_TEST, "authorized");
const mode = process.env.SG_DEMO_CLIENT_MODE ?? "client_test";
assert.ok(["client_test", "connectivity_test"].includes(mode));
if (mode === "connectivity_test") assert.equal(process.env.SG_DEMO_REAL_CONNECTIVITY_TEST, "authorized");
const expectedResult = mode === "client_test" ? "CLIENT_TEST_COMPLETED" : "CONNECTIVITY_SETUP_COMPLETED";
const allowInitialStart = process.env.SG_DEMO_CLIENT_INITIAL_CONFIRM === "authorized";
const allowEndpointStart = process.env.SG_DEMO_ENDPOINT_REPORTER_START === "authorized";
const allowWithdrawal = process.env.SG_DEMO_CLIENT_WITHDRAWAL_TEST === "authorized";
const offlineGuideOnly = process.env.SG_DEMO_VERIFY_OFFLINE_GUIDE_ONLY === "authorized";
const authKeyGuideOnly = process.env.SG_DEMO_VERIFY_AUTHKEY_GUIDE_ONLY === "authorized";
const singlePhoneGuide = process.env.SG_DEMO_VERIFY_SINGLE_PHONE_GUIDE === "authorized";
const singlePhoneRemote = process.env.SG_DEMO_VERIFY_SINGLE_PHONE_REMOTE === "authorized";
const androidConnectionUi = process.env.SG_DEMO_VERIFY_ANDROID_CONNECTION_UI === "authorized";
const automaticConnection = process.env.SG_DEMO_VERIFY_AUTOMATIC_CONNECTION === "authorized";
if (automaticConnection) {
  assert.equal(mode, "connectivity_test");
  assert.ok(allowEndpointStart && !androidConnectionUi && !singlePhoneRemote && !singlePhoneGuide && !offlineGuideOnly && !authKeyGuideOnly && !allowInitialStart && !allowWithdrawal);
}
if (androidConnectionUi) {
  assert.equal(mode, "connectivity_test");
  assert.ok(!singlePhoneRemote && !singlePhoneGuide && !offlineGuideOnly && !authKeyGuideOnly && !allowInitialStart && !allowEndpointStart && !allowWithdrawal);
}
if (singlePhoneRemote) {
  assert.equal(mode, "connectivity_test");
  assert.ok(!singlePhoneGuide && !offlineGuideOnly && !authKeyGuideOnly && !allowInitialStart && !allowEndpointStart && !allowWithdrawal);
  const proofPath = resolve(".runtime/new-phone-20261006/remote-transport.private.json");
  const stat = await lstat(proofPath); assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  assert.equal(proof.hardwareSerial, "RFCW40MYYCV"); assert.equal(proof.transport, "tailscale nc");
  assert.equal(proof.usbFallback, false); assert.equal(proof.lanFallback, false);
  assert.match(proof.serial, /^127\.0\.0\.1:\d+$/);
  const cfg = JSON.parse(await readFile(resolve(".runtime/web-verification.json"), "utf8"));
  assert.equal(cfg.serial, proof.serial); assert.equal(cfg.deviceId, proof.hardwareSerial);
  const age = Date.now() - Date.parse(proof.checkedAt); assert.ok(age >= 0 && age < 60_000);
  const run = promisify(execFile);
  const current = await run("/Users/linghuxj/Library/Android/sdk/platform-tools/adb", ["-s", proof.serial, "shell", "getprop", "ro.serialno"], { timeout: 6000 });
  assert.equal(current.stdout.trim(), proof.hardwareSerial);
}
if (singlePhoneGuide) {
  assert.equal(mode, "connectivity_test");
  assert.ok(!offlineGuideOnly && !authKeyGuideOnly && !allowInitialStart && !allowEndpointStart && !allowWithdrawal);
}
if (authKeyGuideOnly) {
  assert.equal(mode, "connectivity_test");
  assert.ok(!offlineGuideOnly && !allowInitialStart && !allowEndpointStart && !allowWithdrawal,
    "Auth Key guide check only verifies the existing association and network setup");
}
if (offlineGuideOnly) {
  assert.equal(mode, "connectivity_test");
  assert.ok(!allowInitialStart && !allowEndpointStart && !allowWithdrawal, "Offline guide check cannot authorize device state changes");
}
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/blocker-resolution-live-20261002/client-artemis");
await mkdir(output, { recursive: true, mode: 0o700 });
const intent = resolve(output, "launch-intent.json");
const phase = process.env.SG_DEMO_CLIENT_PHASE ?? "launch";
assert.ok(["launch", "reconcile", "cancel"].includes(phase));
if (phase === "launch") {
  try { await lstat(intent); throw new Error("Original native test exists; reconcile before launching another"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
}
const save = (name: string, data: unknown) => writeFile(resolve(output, name), JSON.stringify(data, null, 2), { mode: 0o600 });
async function requireAutomaticRemote() {
  if (process.env.SG_DEMO_REQUIRE_AUTOMATIC_REMOTE !== "authorized") return;
  try {
    const expected = { tailnetIp: process.env.SG_DIAGNOSTIC_TAILNET_IP ?? "", deviceId: process.env.SG_DIAGNOSTIC_PRODUCT_DEVICE_ID ?? "", nodeId: process.env.SG_DIAGNOSTIC_SOURCE_NODE_ID ?? "" };
    assert.match(expected.nodeId, /^\d+$/);
    const port = await diagnosticConnectPort(expected); assert.ok(port !== null);
    const path = resolve(".runtime/product-local-live/remote-adb-connection.json"), stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
    const connection = JSON.parse(await readFile(path, "utf8")) as { at: string; serial: string; state: string; targetPort: number; targetIdentityVerified: boolean; formalAdmission: boolean; actionPermissionGranted: boolean };
    assert.equal(connection.serial, "127.0.0.1:34323"); assert.equal(connection.targetPort, port);
    assert.equal(connection.state, "connected_target_verified"); assert.equal(connection.targetIdentityVerified, true);
    assert.equal(connection.formalAdmission, false); assert.equal(connection.actionPermissionGranted, false);
    assert.ok(Date.parse(connection.at) <= Date.now() && Date.now() - Date.parse(connection.at) < 8000);
    const run = promisify(execFile), adb = "/Users/linghuxj/Library/Android/sdk/platform-tools/adb";
    const hardware = await run(adb, ["-s", connection.serial, "shell", "getprop", "ro.serialno"], { timeout: 6000 });
    assert.equal(hardware.stdout.trim(), "RFCW40MYYCV");
    const devices = await run(adb, ["devices"], { timeout: 5000 }); assert.ok(!devices.stdout.includes("RFCW40MYYCV\t"));
    assert.equal(await diagnosticConnectPort(expected), port);
    await save("automatic-remote-precondition.json", { at: new Date().toISOString(), targetHardwareVerified: true, freshAutomaticEndpoint: true, usbAbsent: true, formalAdmission: false, actionPermissionGranted: false });
  } catch {
    await save("automatic-remote-precondition-blocked.json", { at: new Date().toISOString(), code: "FRESH_VERIFIED_REMOTE_REQUIRED", businessTaskDispatched: false });
    throw new Error("FRESH_VERIFIED_REMOTE_REQUIRED");
  }
}
if (phase === "launch") await requireAutomaticRemote();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(30_000);
const web = process.env.SOCIALGROWTH_WEB_URL ?? "http://127.0.0.1:3000";
if (phase === "reconcile" || phase === "cancel") {
  try {
    const ack = JSON.parse(await readFile(resolve(output, "launch-ack.json"), "utf8")) as { taskId: string };
    assert.match(ack.taskId, /^[a-f0-9-]{36}$/);
    await page.goto(`${web}/#/connections`);
    const card = page.locator(`[data-verification-id="${ack.taskId}"]`);
    await card.waitFor();
    if (phase === "cancel") {
      const stop = card.getByRole("button", { name: "停止该验收任务", exact: true });
      if (await stop.count()) { await stop.click(); await stop.waitFor({ state: "detached", timeout: 60000 }); }
      await save("operator-stop.json", { at: new Date().toISOString(), taskId: ack.taskId, initiatedThrough: "actual Demo Web", stoppedText: await card.innerText(), taskRelaunched: false });
      console.log(JSON.stringify({ event: "original_native_task_stopped_through_web", taskId: ack.taskId }));
      process.exitCode = 0;
    } else {
    const text = await card.innerText();
    assert.ok(!text.includes("running ·"), "Reconcile original terminal task only");
    const checks = text.match(/Artemis 检查：([^；]+)；通过 (\d+)，失败 (\d+)，待确认 (\d+)/);
    assert.ok(checks, "Original checker diagnostics must be visible");
    const accepted = text.includes(`finished · ${expectedResult}`) &&
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
    }
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
  await panel.getByLabel("执行模式", { exact: true }).selectOption(mode);
  await panel.getByLabel("预期账号显示名", { exact: true }).fill("SocialGrowth 自有客户端");
  await panel.getByLabel("预期平台身份 ID", { exact: true }).fill("com.socialgrowth.product");
  await panel.getByLabel("任务目标（禁止凭证）", { exact: true }).fill(allowWithdrawal ? "本轮明确授权后台参与与一次撤回测试；禁止其他授权、自动恢复或发布。" : "用户要求保留当前连接与参与，暂不测试撤回。测试后台参与持续后保持参与；首次确认按本次单独勾选授权执行；禁止撤回、注册、登录、自动恢复参与、设置修改、其他 App、内容发布；保留历史 unknown。");
  if (mode === "connectivity_test") await panel.getByLabel("任务目标（禁止凭证）", { exact: true }).fill(
    process.env.SG_DEMO_REQUIRE_CENTER_CONNECTION === "authorized" ? "REQUIRE_CENTER_CONNECTION: 恢复已有授权，检查本机准备并启动连接检查，必须看到平台已连接到这台手机；不读取密钥、不重新配对、不发布。" : process.env.SG_DEMO_ROTATE_WIRELESS_PORT === "authorized" ? "ROTATE_WIRELESS_PORT_ONCE: 恢复现有 Tailscale，切换无线调试一次并回到已关联 App；不配对、不发布。" : "恢复现有授权 Tailscale 和无线调试，返回自有 App 检查本机准备三步引导；连接检查按勾选授权执行；不读取密钥或配对码、不配对、不发布。");
  if (mode === "connectivity_test") {
    const goal = panel.getByLabel("任务目标（禁止凭证）", { exact: true });
    if (process.env.SG_DEMO_VERIFY_CONNECTED_GUIDE_ONLY === "authorized") await goal.fill("VERIFY_CONNECTED_GUIDE_ONLY REQUIRE_CENTER_CONNECTION: 仅在已关联的自有客户端核验本机准备与真实平台连接；不打开其他设置、不取密钥、不配对、不发布。");
    if (process.env.SG_DEMO_ROTATE_WIRELESS_PORT === "authorized") await goal.fill(`ROTATE_WIRELESS_PORT_ONCE: ${await goal.inputValue()}`);
    if (process.env.SG_DEMO_CHECK_PILOT_KEY_COPY === "authorized") await goal.fill(`CHECK_PILOT_KEY_COPY: 仅通过App按钮取用并复制密钥，检查成功提示；禁止读取、输出、粘贴密钥。 ${await goal.inputValue()}`);
    if (offlineGuideOnly) await goal.fill("VERIFY_OFFLINE_GUIDE_ONLY: 验证平台不可达时可进入本机准备；未确认关联与网络时，密钥获取和连接检查均不可用。只检查现有App，不登录、不关联、不修改系统或网络设置、不发布。");
    if (authKeyGuideOnly) await goal.fill("VERIFY_AUTHKEY_GUIDE_ONLY: 已通过USB单独完成当前手机Auth Key登录；仅验证自有App的实际本机网络确认、当前版本菜单说明和密钥复制反馈。禁止再次登录、读取或粘贴密钥、修改系统设置、启动连接检查或参与、配对和发布。");
    if (singlePhoneGuide) await goal.fill("VERIFY_SINGLE_PHONE_GUIDE: 用户已授权同一台手机管理与执行；本机已登录本人管理账号。仅通过本机卡片核对并明确确认关联SM-S9110，检查关联回执与管理、本机准备页面往返；禁止扫码关联其他手机、重新登录、读取密钥或验证码、改系统设置、启动连接检查、开始参与或发布。");
    if (singlePhoneRemote) await goal.fill("VERIFY_SINGLE_PHONE_REMOTE REQUIRE_CENTER_CONNECTION: 本轮实际执行配置限定为已核对硬件序列号的Tailscale远程ADB通道。检查本机管理、准备往返、通知内配对说明与当前平台已连接反馈；保持现有连接检查，不读取配对码、不重新关联、不修改系统、不启停参与、不发布。");
    if (androidConnectionUi) await goal.fill("VERIFY_ANDROID_CONNECTION_UI: 仅核验本人App首页实时连接状态、更新时间、标准图标Tab切换，以及本机准备顶部的网络/配对/连接/执行状态；当前平台网络配置尚未确认，必须如实显示待确认且不能宣称已连接。允许点击重新检查；不登录、不关联、不读取密钥或配对码、不改系统、不启停连接检查或参与、不发布。");
    if (automaticConnection) await goal.fill("VERIFY_AUTOMATIC_CONNECTION: 核验已关联本机打开App自动恢复平台连接及跨Tab保持；首次观察不得点击任何连接启动/恢复/重新检查按钮。随后明确授权一次暂停自动连接、退出并重新打开App确认暂停保留、一次恢复自动连接并核验真实连接。保持原配对与业务参与，不打开其他设置或App、不读取凭据、不重配对、不登录、不发布。");
  }
  await panel.getByLabel("验收文案", { exact: true }).fill("NATIVE PARTICIPATION TEST - NO PUBLICATION");
  if (allowInitialStart) { assert.equal(mode, "client_test"); }
  if (allowInitialStart) await panel.locator("#client-initial-start").check();
  if (allowEndpointStart) await panel.locator("#client-endpoint-start").check();
  if (allowWithdrawal) { assert.equal(mode, "client_test"); await panel.locator("#client-withdrawal-test").check(); }
  await panel.locator("#no-pub-ack").check();
  await requireAutomaticRemote();
  await save("launch-intent.json", { at: new Date().toISOString(), scope: mode, expectedResult, noPublication: true, allowInitialStart, allowEndpointStart, allowWithdrawal });
  const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/api/runtime/verifications" && r.request().method() === "POST");
  await panel.getByRole("button", { name: "从 Web 启动完整验收", exact: true }).click();
  const response = await responsePromise;
  const errorCode = response.ok() ? undefined : (await response.json().catch(() => null))?.error?.code;
  await save("launch-http-result.json", { status: response.status(), mode,
    ...(typeof errorCode === "string" && /^[A-Z0-9_]+$/.test(errorCode) ? { errorCode } : {}) });
  assert.equal(response.status(), 200, `Native task launch rejected: ${typeof errorCode === "string" && /^[A-Z0-9_]+$/.test(errorCode) ? errorCode : response.status()}`);
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
  assert.ok(result.includes(`finished · ${expectedResult}`), "Actual native diagnostic receipt must be confirmed");
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
    initiatedThrough: "pnpm test:playwright / actual Demo Web", backendWithdrawalIndependentlyRequired: mode === "client_test" && allowWithdrawal, backendParticipationRetentionRequired: mode === "client_test" && !allowWithdrawal,
    businessQueueConsumed: false, oldUnknownResolved: false, physicalStopConfirmed: false, publicationAttempted: false });
  console.log(JSON.stringify({ event: "native_web_test_result", taskId, result, cleanupConfirmed }));
  await browser.close();
}
