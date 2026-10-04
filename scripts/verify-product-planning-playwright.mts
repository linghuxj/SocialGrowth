import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { chromium, type APIResponse, type BrowserContext, type Locator, type Page } from "playwright";
// Reproducible REAL UI draft scope. Never run to bypass a policy refusal;
// admin admission must first be restored. Synthetic text here proves only
// unapproved draft UI persistence, never actual approved business direction.
const required = (key: string) => { const v = process.env[key]; if (!v) throw new Error(`${key} is required`); return v; };
const login = required("SG_PRODUCT_TEST_LOGIN_NAME"), password = required("SG_PRODUCT_TEST_PASSWORD"), output = required("SG_PRODUCT_PLANNING_SCREENSHOT_DIR");
await mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1464, height: 1074 } });
let secondContext: BrowserContext | null = null;
let cyclePhase = "draft-only";
let cycleFlowPassed = false;
let actualModelAttempts = 0;
let commandReadsByDifferentOperator = 0;
let cycleCheckpoint = "planning-draft-only";
let cyclePostObserved = false;
let cycleRouteFetchStarted = false;
let cycleRouteResponseReceived = false;
let cycleRouteFetchErrorType: string | null = null;
let cycleRouteBodyMismatch = false;
let cycleRouteBodyInvalid = false;
let firstPostStatus = 0;
let cycle: Locator | null = null;
const pageErrors: string[] = [];
const safeCycleFacts: { sequence: number; bodySha256: string; idempotencyKeySha256: string | null; status: number;
  outcome: string | null; replayed: boolean | null; responseLost: boolean }[] = [];
type CycleReadEvidence = {
  observedAt: string;
  configurationRevision: number;
  currentCycle: { cycleId: string; cycleNumber: number; configVersion: number; businessTimeZone: string; reviewIntervalDays: number;
    trafficMinimumPerCycle: number; startsAt: string; endsAt: string } | null;
  nextConfiguration: { configurationRevision: number; basedOnCycleId: string; businessTimeZone: string; reviewIntervalDays: number;
    trafficMinimumPerCycle: number; effectiveStartsAt: string; projectedEndsAt: string; requestId: string } | null;
  nextCycle: null;
  executionAllowed: false;
  publicationAllowed: false;
};
async function readCycleFromVisiblePage(target: Page, region: Locator): Promise<CycleReadEvidence> {
  const responsePromise = target.waitForResponse(response => new URL(response.url()).pathname.endsWith("/review-cycle-config")
    && response.request().method() === "GET", { timeout: 20_000 });
  await region.getByRole("button", { name: "刷新周期事实", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, "visible page cycle refresh must return an authoritative read");
  return await response.json() as CycleReadEvidence;
}
try {
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill(login); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click(); const project = page.locator(".project-workspace"), name = `周期配置全链路UI验收-${Date.now()}`;
  await project.getByRole("button", { name: "新建项目" }).click(); await project.getByLabel("项目名称").fill(name); await project.getByRole("button", { name: "创建筹备项目" }).click();
  await project.getByText(/基本信息已保存；仍在筹备/).waitFor(); await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  const planner = page.getByRole("region", { name: "项目目标与周期草案" }); await planner.getByText(/项目版本 \d+，草案版本 0/).waitFor({ timeout: 10_000 });
  assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), ""); assert.equal(await planner.getByLabel("目标语言标签（逗号分隔）").inputValue(), "");
  const goal = "合成验收输入：草案不构成正式批准"; await planner.getByLabel("正式开通前阶段目标").fill(goal);
  await planner.getByRole("checkbox", { name: "Facebook 图文", exact: true }).check();
  assert.equal(await planner.getByRole("checkbox", { name: "Facebook 图文", exact: true }).isChecked(), true);
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click(); await planner.getByLabel("业务时区", { exact: true }).selectOption("Asia/Shanghai");
  await planner.getByLabel("复盘间隔（天）", { exact: true }).fill("01"); await planner.getByRole("button", { name: "保存全部草案" }).click(); await planner.getByText(/请核对文本、非重复国家/).waitFor();
  assert.equal(await planner.getByLabel("复盘间隔（天）", { exact: true }).inputValue(), "01");
  await planner.getByLabel("复盘间隔（天）", { exact: true }).fill("7"); await planner.getByLabel("项目每周期引流最低任务数").fill("0");
  await planner.getByRole("button", { name: "保存全部草案" }).click(); await planner.getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  await planner.getByRole("button", { name: "目标与范围", exact: true }).click(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), goal);
  await planner.getByLabel("正式开通前阶段目标").fill("尚未保存的本人输入"); await project.getByRole("button", { name: "概览", exact: true }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), "尚未保存的本人输入");
  await planner.getByRole("button", { name: "刷新当前草案" }).click(); await planner.getByRole("region", { name: "当前草案核对" }).waitFor(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), "尚未保存的本人输入");
  await planner.getByRole("button", { name: "放弃本次输入" }).click(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), goal);
  await page.screenshot({ path: `${output}/planning-unapproved-desktop.png`, fullPage: true });
  await page.reload(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor(); await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click(); await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await planner.getByText(/草案版本 1/).waitFor(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), goal);
  assert.equal(await planner.getByRole("checkbox", { name: "Facebook 图文", exact: true }).isChecked(), true);
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click(); assert.equal(await planner.getByLabel("项目每周期引流最低任务数").inputValue(), "0");

  if (process.env.SG_PRODUCT_ARTEMIS_ROOT !== undefined) {
  assert.ok(isAbsolute(process.env.SG_PRODUCT_ARTEMIS_ROOT), "configured planning acceptance requires an explicitly selected absolute Artemis root");
  // Save a complete synthetic direction scope through the existing form. The
  // first start is intentionally in the past so this UI-created period is
  // active at the time of confirmation; no database or clock is changed.
  cyclePhase = "complete-ui-draft";
  await planner.getByRole("button", { name: "目标与范围", exact: true }).click();
  await planner.getByLabel("正式开通前阶段目标", { exact: true }).fill("合成验收：核对下周期配置；不代表真实平台内容");
  await planner.getByLabel("正式开通后阶段目标", { exact: true }).fill("合成验收：保留引流并观察，不推断收益");
  await planner.getByLabel("正式开通后优先级", { exact: true }).selectOption("balanced");
  await planner.getByLabel("目标国家标签（逗号分隔）").fill("CN");
  await planner.getByLabel("目标语言标签（逗号分隔）").fill("zh");
  await planner.getByLabel("内容规则说明", { exact: true }).fill("合成验收输入；身份未登记；不得公开发布");
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
  const firstStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
  await planner.getByLabel("业务时区", { exact: true }).selectOption("Asia/Shanghai");
  await planner.getByLabel("首次统计起点（ISO 时间，须含时区）").fill(firstStart);
  for (const [label, value] of [["复盘间隔（天）", "7"], ["项目每周期引流最低任务数", "0"], ["内容观察窗口（小时）", "24"], ["结束后收尾观察（天）", "0"], ["每日总发布上界", "1"]]) {
    await planner.getByLabel(label!, { exact: true }).fill(value!);
  }
  await planner.getByLabel("发布有效窗口开始（ISO 含时区）").fill(firstStart);
  await planner.getByLabel("发布有效窗口结束（ISO 含时区，结束不含）").fill(windowEnd);
  await planner.getByRole("button", { name: "保存全部草案", exact: true }).click();
  await planner.getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  cyclePhase = "real-model-direction";
  const direction = page.getByRole("region", { name: "初始业务方向" });
  await direction.getByLabel("发布身份范围", { exact: true }).fill("facebook/UI_SYNTHETIC_UNREGISTERED/开通前");
  actualModelAttempts += 1;
  await direction.getByRole("button", { name: "生成初始方向", exact: true }).click();
  const proposalState = direction.getByText(/真实模型方向已生成|配置模型未返回可用方向/);
  await proposalState.waitFor({ timeout: 55_000 });
  if (!(await proposalState.innerText()).startsWith("真实模型")) {
    await writeFile(`${output}/result.json`, JSON.stringify({ passed: false, blocked: "configured model returned no usable proposal on the single UI attempt", realModelAttemptedOnce: true, cycleConfiguration: "not started", executionAllowed: false, publicationAllowed: false }, null, 2), { mode: 0o600 });
    throw new Error("Configured model did not return a usable proposal; cycle configuration was not attempted");
  }
  await direction.getByRole("heading", { name: "待核对方向与范围", exact: true }).waitFor();
  await direction.getByRole("button", { name: "确认方向", exact: true }).click();
  await direction.getByText("方向已确认并留存批准范围；执行条件尚未就绪。", { exact: true }).waitFor();
  await direction.getByText("当前未派发手机任务，未开启公开发布。", { exact: true }).waitFor();
  cycleCheckpoint = "direction-confirmed";

  // Create a temporary real operator through the UI and let that operator
  // load revision 0 before A changes it. Credentials stay in process memory.
  cyclePhase = "create-second-operator";
  const operatorBLogin = `cycle-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const operatorBPassword = `SgCycle-${randomUUID()}-aA9!`;
  await page.getByRole("button", { name: "账号与设备", exact: true }).click();
  await page.getByRole("tab", { name: "运营账号", exact: true }).click();
  await page.getByLabel("登录名", { exact: true }).fill(operatorBLogin);
  await page.getByLabel("显示名", { exact: true }).fill("周期配置临时验收账号");
  await page.getByLabel("初始密码", { exact: true }).fill(operatorBPassword);
  await page.getByRole("button", { name: "开通账号", exact: true }).click();
  await page.getByText("运营账号已开通", { exact: true }).waitFor();
  secondContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1464, height: 1074 } });
  const pageB = await secondContext.newPage();
  pageB.on("pageerror", () => pageErrors.push("pageerror"));
  await pageB.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await pageB.getByLabel("登录名", { exact: true }).fill(operatorBLogin);
  await pageB.getByLabel("密码", { exact: true }).fill(operatorBPassword);
  await pageB.getByRole("button", { name: "登录", exact: true }).click();
  await pageB.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await pageB.getByRole("button", { name: "项目", exact: true }).click();
  const projectB = pageB.locator(".project-workspace");
  await projectB.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  await projectB.getByRole("button", { name: "设置 · 目标与周期" }).click();
  const plannerB = pageB.getByRole("region", { name: "项目目标与周期草案" });
  await plannerB.getByRole("button", { name: "周期与观察", exact: true }).click();
  const cycleB = pageB.getByRole("region", { name: "下周期配置确认" });
  await cycleB.getByText(/当前周期（不可修改）/).waitFor();
  const baselineCycle = await readCycleFromVisiblePage(pageB, cycleB);
  cycleCheckpoint = "B-current-cycle-read";
  assert.ok(baselineCycle.currentCycle, "real UI must read a current active cycle before testing configuration");
  assert.ok(Date.parse(baselineCycle.currentCycle.startsAt) <= Date.parse(baselineCycle.observedAt)
    && Date.parse(baselineCycle.observedAt) < Date.parse(baselineCycle.currentCycle.endsAt),
  "current cycle must be active at the backend's read timestamp");
  assert.equal(baselineCycle.nextCycle, null);
  assert.equal(baselineCycle.executionAllowed, false); assert.equal(baselineCycle.publicationAllowed, false);
  const timezoneB = cycleB.getByLabel("下周期业务时区", { exact: true });
  const intervalB = cycleB.getByLabel("下周期复盘间隔（天）", { exact: true });
  const minimumB = cycleB.getByLabel("下周期每周期引流最低数", { exact: true });
  assert.equal(await timezoneB.isEnabled(), true, "the second authenticated operator must be able to edit a real current cycle");
  assert.equal(await intervalB.isEnabled(), true); assert.equal(await minimumB.isEnabled(), true);
  cycleCheckpoint = "B-cycle-form-editable";
  await timezoneB.selectOption("America/New_York");
  await intervalB.fill("21");
  await minimumB.fill("5");
  assert.equal(await cycleB.getByRole("button", { name: "确认下周期配置", exact: true }).isEnabled(), true,
    "the second operator stale-version command must be enabled after editing");
  cycleCheckpoint = "B-stale-write-form-ready";

  // Return to A and make one real initial config request. The route forwards
  // it to the server and drops only the genuine response to create uncertainty.
  cyclePhase = "cycle-config-lost-response";
  await page.getByRole("button", { name: "项目", exact: true }).click();
  cycleCheckpoint = "A-project-navigation-open";
  const returnToProjectList = project.getByRole("button", { name: "返回项目列表", exact: true });
  if (await returnToProjectList.count()) await returnToProjectList.click();
  cycleCheckpoint = "A-project-list-open";
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  cycleCheckpoint = "A-planning-project-open";
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  cycleCheckpoint = "A-cycle-settings-open";
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
  cycleCheckpoint = "A-cycle-panel-open";
  cycle = page.getByRole("region", { name: "下周期配置确认" });
  await cycle.getByText(/当前周期（不可修改）/).waitFor();
  const currentRead = await readCycleFromVisiblePage(page, cycle);
  cycleCheckpoint = "A-current-cycle-read";
  assert.ok(currentRead.currentCycle, "real UI must read the current cycle before enabling its next configuration");
  assert.deepEqual(currentRead.currentCycle, baselineCycle.currentCycle, "current-cycle facts remain unchanged between operators");
  assert.equal(currentRead.nextConfiguration, null, "no existing next configuration is assumed");
  assert.equal(currentRead.nextCycle, null); assert.equal(currentRead.executionAllowed, false); assert.equal(currentRead.publicationAllowed, false);
  assert.ok(Date.parse(currentRead.currentCycle.startsAt) <= Date.parse(currentRead.observedAt)
    && Date.parse(currentRead.observedAt) < Date.parse(currentRead.currentCycle.endsAt),
  "the current cycle must still be active at the UI read timestamp");
  await cycle.getByLabel("下周期业务时区", { exact: true }).selectOption("Asia/Tokyo");
  await cycle.getByLabel("下周期复盘间隔（天）", { exact: true }).fill("14");
  await cycle.getByLabel("下周期每周期引流最低数", { exact: true }).fill("2");
  cycleCheckpoint = "A-config-form-filled";
  assert.equal(await cycle.getByRole("button", { name: "确认下周期配置", exact: true }).isVisible(), true);
  assert.equal(await cycle.getByRole("button", { name: "确认下周期配置", exact: true }).isEnabled(), true);
  cycleCheckpoint = "A-current-cycle-read-and-form-ready";
  let firstBody = "";
  let lostResponse = false;
  await page.route("**/api/operator/projects/*/review-cycle-config", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postData() ?? "";
    cyclePostObserved = true;
    if (firstBody && body !== firstBody) {
      cycleRouteBodyMismatch = true;
      await route.abort("failed");
      return;
    }
    else firstBody = body;
    let request: { metadata?: { idempotencyKey?: unknown } };
    try { request = JSON.parse(body) as { metadata?: { idempotencyKey?: unknown } }; }
    catch {
      cycleRouteBodyInvalid = true;
      await route.abort("failed");
      return;
    }
    const key = typeof request.metadata?.idempotencyKey === "string" ? request.metadata.idempotencyKey : "";
    cycleRouteFetchStarted = true;
    let response: APIResponse;
    try {
      response = await route.fetch({ timeout: 60_000 });
      cycleRouteResponseReceived = true;
    } catch (error) {
      cycleRouteFetchErrorType = error instanceof Error ? error.name : "unknown";
      await route.abort("failed");
      return;
    }
    const responseBody = await response.text();
    let outcome: string | null = null, replayed: boolean | null = null;
    try {
      const receipt = JSON.parse(responseBody) as { outcome?: unknown; replayed?: unknown };
      if (typeof receipt.outcome === "string") outcome = receipt.outcome;
      if (typeof receipt.replayed === "boolean") replayed = receipt.replayed;
    } catch { /* The page will report and retain any malformed response as unknown. */ }
    if (!lostResponse) {
      firstPostStatus = response.status();
      lostResponse = true;
      safeCycleFacts.push({ sequence: safeCycleFacts.length + 1, bodySha256: createHash("sha256").update(body).digest("hex"),
        idempotencyKeySha256: createHash("sha256").update(key).digest("hex"), status: response.status(), outcome, replayed, responseLost: true });
      await route.abort("failed");
      return;
    }
    safeCycleFacts.push({ sequence: safeCycleFacts.length + 1, bodySha256: createHash("sha256").update(body).digest("hex"),
      idempotencyKeySha256: createHash("sha256").update(key).digest("hex"), status: response.status(), outcome, replayed, responseLost: false });
    await route.fulfill({ response, body: responseBody });
  });
  page.once("dialog", dialog => void dialog.accept());
  cycleCheckpoint = "confirm-click-awaiting-network";
  await cycle.getByRole("button", { name: "确认下周期配置", exact: true }).click();
  await cycle.getByRole("alert").filter({ hasText: "保存回执未确认，结果未知" }).waitFor();
  cycleCheckpoint = "unknown-command-visible";
  assert.ok(firstPostStatus >= 200 && firstPostStatus < 300, "the server accepted the actual UI command before the response was lost");
  assert.equal(await cycle.getByRole("button", { name: "明确接续同一请求", exact: true }).count(), 1);
  assert.equal(await cycle.getByRole("button", { name: "确认下周期配置", exact: true }).count(), 0, "unknown command freezes new input");

  let commandReads = 0, cyclePostsWhileOperatorB = 0;
  const trackCommandReads = (p: Page) => p.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/review-cycle-config\/commands\//.test(path)) commandReads++;
    if (request.method() === "POST" && path.endsWith("/review-cycle-config")) cyclePostsWhileOperatorB++;
  });
  trackCommandReads(page);
  // Reload restores only the frozen body/key and non-secret actor context;
  // it must not query or resend a command automatically.
  cyclePhase = "reload-with-unknown-command";
  await page.reload(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
  await cycle.getByLabel("冻结的原请求").waitFor();
  assert.equal(await cycle.getByRole("button", { name: "明确接续同一请求", exact: true }).isEnabled(), true);
  assert.equal(commandReads, 0); assert.equal(cyclePostsWhileOperatorB, 0);

  // B's form was loaded from revision 0. A's accepted command advances it; B's
  // own UI write must receive the real stale-version rejection.
  cyclePhase = "stale-version-competition";
  pageB.once("dialog", dialog => void dialog.accept());
  await cycleB.getByRole("button", { name: "确认下周期配置", exact: true }).click();
  await cycleB.getByRole("alert").filter({ hasText: "配置版本已过期" }).waitFor();
  await cycleB.getByText(/Asia\/Tokyo · 14 天/).waitFor();
  assert.deepEqual(pageErrors, []);

  // Logout A and login B in the same tab. The original command stays visible
  // but neither lookup nor POST is sent under the different operator.
  cyclePhase = "different-operator-fence";
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("登录名", { exact: true }).fill(operatorBLogin); await page.getByLabel("密码", { exact: true }).fill(operatorBPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
  await cycle.getByText(/当前登录身份不同，仅保留未知事实/).waitFor();
  assert.equal(await cycle.getByRole("button", { name: "只读核对原请求回执", exact: true }).isEnabled(), false);
  assert.equal(await cycle.getByRole("button", { name: "明确接续同一请求", exact: true }).isEnabled(), false);
  assert.equal(commandReads, 0, "the different operator must not query A's command");
  assert.equal(cyclePostsWhileOperatorB, 0, "the different operator must not submit A's original command");
  commandReadsByDifferentOperator = commandReads;

  // A logs in again with a fresh session and explicitly replays the original
  // byte-identical body/key. No automatic replay occurs on reload or login.
  cyclePhase = "same-operator-relogin-replay";
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("登录名", { exact: true }).fill(login); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
  await cycle.getByRole("button", { name: "明确接续同一请求", exact: true }).waitFor();
  await cycle.getByRole("button", { name: "明确接续同一请求", exact: true }).click();
  await cycle.getByText(/运营已确认下周期配置，版本 \d+。该配置尚未物化或生效/).waitFor();
  assert.equal(safeCycleFacts.length, 2); assert.equal(safeCycleFacts[0]?.bodySha256, safeCycleFacts[1]?.bodySha256);
  assert.equal(safeCycleFacts[0]?.idempotencyKeySha256, safeCycleFacts[1]?.idempotencyKeySha256);
  assert.equal(safeCycleFacts[0]?.outcome, "confirmed"); assert.equal(safeCycleFacts[0]?.replayed, false);
  assert.equal(safeCycleFacts[1]?.outcome, "confirmed"); assert.equal(safeCycleFacts[1]?.replayed, true);
  assert.equal(cycleRouteBodyMismatch, false, "explicit replay must preserve the original request body");
  assert.equal(cycleRouteBodyInvalid, false, "the UI mutation must send a valid request body");
  await cycle.getByText(/Asia\/Tokyo · 14 天/).waitFor();
  const confirmedCycle = await readCycleFromVisiblePage(page, cycle);
  assert.deepEqual(confirmedCycle.currentCycle, baselineCycle.currentCycle, "configuration did not rewrite the current cycle or its history");
  assert.equal(confirmedCycle.configurationRevision, 1);
  assert.equal(confirmedCycle.nextCycle, null, "successor cycle remains unmaterialized");
  assert.equal(confirmedCycle.executionAllowed, false); assert.equal(confirmedCycle.publicationAllowed, false);
  assert.ok(confirmedCycle.nextConfiguration);
  assert.equal(confirmedCycle.nextConfiguration.configurationRevision, confirmedCycle.configurationRevision);
  assert.equal(confirmedCycle.nextConfiguration.businessTimeZone, "Asia/Tokyo");
  assert.equal(confirmedCycle.nextConfiguration.reviewIntervalDays, 14);
  assert.equal(confirmedCycle.nextConfiguration.trafficMinimumPerCycle, 2);
  assert.equal(Date.parse(confirmedCycle.nextConfiguration.effectiveStartsAt), Date.parse(baselineCycle.currentCycle.endsAt),
    "effective start must be the exact current-cycle end instant");
  assert.ok(confirmedCycle.nextConfiguration.projectedEndsAt, "confirmed configuration has a calendar preview");
  await writeFile(`${output}/cycle-config-safe-facts.json`, JSON.stringify({ firstPostStatus, lostResponse, commandReadsByDifferentOperator: commandReads,
    sameOriginalBodyAndKeyReplay: safeCycleFacts.length === 2 && safeCycleFacts[0]?.bodySha256 === safeCycleFacts[1]?.bodySha256
      && safeCycleFacts[0]?.idempotencyKeySha256 === safeCycleFacts[1]?.idempotencyKeySha256,
    postFacts: safeCycleFacts, staleVersionRejectedInUi: true, currentCyclePreserved: true,
    configuredNext: { businessTimeZone: confirmedCycle.nextConfiguration.businessTimeZone,
      reviewIntervalDays: confirmedCycle.nextConfiguration.reviewIntervalDays,
      trafficMinimumPerCycle: confirmedCycle.nextConfiguration.trafficMinimumPerCycle,
      effectiveStartsAtMatchesCurrentEnd: true, latestConfigRevision: confirmedCycle.configurationRevision },
    nextCycleMaterialized: false, executionAllowed: false, publicationAllowed: false }, null, 2), { mode: 0o600 });

  // Remove the temporary account through the actual operator UI after all
  // account-scoped checks. No generated credential is written to artifacts.
  cyclePhase = "cleanup-temporary-operator";
  await secondContext.close(); secondContext = null;
  await page.getByRole("button", { name: "账号与设备", exact: true }).click();
  await page.getByRole("tab", { name: "运营账号", exact: true }).click();
  const operatorRow = page.getByRole("row").filter({ hasText: operatorBLogin });
  await operatorRow.getByRole("button", { name: "停用", exact: true }).click();
  page.once("dialog", dialog => void dialog.accept());
  await page.getByText("账号已停用，会话已撤销", { exact: true }).waitFor();

  cycleFlowPassed = true;
  }

  await page.getByRole("button", { name: "项目", exact: true }).click();
  const returnToProjectListForMobile = project.getByRole("button", { name: "返回项目列表", exact: true });
  if (await returnToProjectListForMobile.count()) await returnToProjectListForMobile.click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click();
  cyclePhase = "mobile-readonly";
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await planner.getByRole("button", { name: "保存全部草案" }).count(), 0); assert.equal(await planner.getByLabel("业务时区", { exact: true }).isDisabled(), true);
  if (cycle) {
    assert.equal(await cycle.getByRole("button", { name: "确认下周期配置", exact: true }).count(), 0);
    assert.equal(await cycle.getByLabel("下周期业务时区", { exact: true }).isDisabled(), true);
  }
  assert.equal(cycleFlowPassed, process.env.SG_PRODUCT_ARTEMIS_ROOT !== undefined,
    "the configured Artemis environment must execute cycle-config acceptance; draft-only runs must not claim it");
  assert.equal(actualModelAttempts, cycleFlowPassed ? 1 : 0, "cycle acceptance makes exactly one actual model request");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.screenshot({ path: `${output}/${cycleFlowPassed ? "planning-cycle-mobile" : "planning-draft-mobile"}.png`, fullPage: true });
  assert.deepEqual(errors, []);
  if (cycleFlowPassed) {
  console.log(JSON.stringify({ passed: true,
      scope: "real planning UI plus one actual model-confirmed synthetic direction, active current cycle, next configuration, stale-version rejection and explicit same-actor original-request replay",
      actualModelAttempts, cycleConfigAcceptanceExecuted: true, differentOperatorCommandReads: commandReadsByDifferentOperator,
      exactOriginalBodyAndKeyReplay: safeCycleFacts.length === 2 && safeCycleFacts[0]?.bodySha256 === safeCycleFacts[1]?.bodySha256
        && safeCycleFacts[0]?.idempotencyKeySha256 === safeCycleFacts[1]?.idempotencyKeySha256,
      backendPageErrors: pageErrors, nextCycleMaterialized: false, execution: "not performed", publication: "not performed" }));
  } else {
    console.log(JSON.stringify({ passed: true, scope: "real planning UI draft-only persistence and mobile readonly", actualModelAttempts: 0, cycleConfigAcceptanceExecuted: false,
      nextCycleConfiguration: "not requested", execution: "not performed", publication: "not performed" }));
  }
} catch (error) {
  // Never persist page text/screenshots in this flow: after the lost-response
  // point the visible panel includes a replay-capable request key.
  await writeFile(`${output}/cycle-config-failure.json`, JSON.stringify({ phase: cyclePhase, errorType: error instanceof Error ? error.name : "unknown",
    cycleCheckpoint, actualModelAttempts, cycleConfigAcceptanceExecuted: cycleFlowPassed,
    cyclePostObserved, cycleRouteFetchStarted, cycleRouteResponseReceived, cycleRouteFetchErrorType, firstPostStatus,
    cycleRouteBodyMismatch, cycleRouteBodyInvalid,
    safeCycleFacts, credentialsRecorded: false, requestBodyRecorded: false, executionAllowed: false, publicationAllowed: false }, null, 2), { mode: 0o600 });
  throw error;
} finally { if (secondContext) await secondContext.close(); await browser.close(); }
