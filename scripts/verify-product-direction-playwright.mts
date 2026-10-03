import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
// Actual Web operations and configured model. No business API writes, DB seeds
// or synthetic model output. UI data is deliberately synthetic and unready.
const required = (key: string) => { const v = process.env[key]; if (!v) throw new Error(`${key} required`); return v; };
const output = required("SG_PRODUCT_DIRECTION_SCREENSHOT_DIR"); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1464, height: 1074 }, locale: "zh-CN" });
const page = await context.newPage(), second = await browser.newPage({ viewport: { width: 1464, height: 1074 }, locale: "zh-CN" }), name = `真实模型合成方向验收-${Date.now()}`;
const project = (p: Page) => p.locator(".project-workspace"), planner = (p: Page) => p.getByRole("region", { name: "项目目标与周期草案" }), direction = (p: Page) => p.getByRole("region", { name: "初始业务方向" });
const errors: string[] = []; for (const p of [page, second]) p.on("pageerror", () => errors.push("pageerror"));
const modelAttempts: { outcome: "proposed" | "unavailable"; elapsedMs: number }[] = [];
const safeScopeFacts: Array<Record<string, unknown>> = [];
const scopeFactReads: Promise<void>[] = [];
const planResponseDelayMs = Number(process.env.SG_PRODUCT_DIRECTION_PLAN_RESPONSE_DELAY_MS ?? "0");
const narrowPlanFlow = process.env.SG_PRODUCT_DIRECTION_NARROW_PLAN_FLOW === "1";
if (narrowPlanFlow) assert.equal(process.env.SG_PRODUCT_DIRECTION_MATERIAL_CANDIDATE, "1", "narrow plan flow requires the real material UI slice");
assert.ok(Number.isInteger(planResponseDelayMs) && planResponseDelayMs >= 0 && planResponseDelayMs <= 60_000, "plan response delay must be 0..60000ms");
let originalPlanRequestBody: string | null = null, planPostResponses = 0;
const planPostFacts: Array<{ sequence: number; bodySha256: string; idempotencyKeySha256: string | null; status: number; errorCode: string | null; retryable: boolean | null; backendElapsedMs: number }> = [];
const safePlanErrorCodes = new Set(["AUTHENTICATION_REQUIRED", "AUTHORIZATION_DENIED", "INVALID_CREDENTIALS", "LOGIN_RATE_LIMITED", "OPERATOR_ALREADY_EXISTS", "OPERATOR_DISABLED", "LAST_ACTIVE_OPERATOR", "CONTRACT_VERSION_UNSUPPORTED", "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_RESULT_EXPIRED", "INSTALLATION_BOOTSTRAP_RATE_LIMITED", "INPUT_INVALID", "INTERNAL_ERROR", "INVITATION_EXPIRED", "INVITATION_EXHAUSTED", "INVITATION_REVOKED", "PHONE_ALREADY_REGISTERED", "PHONE_NOT_REGISTERED", "PHONE_VERIFICATION_CODE_INVALID", "PHONE_VERIFICATION_EXPIRED", "PHONE_VERIFICATION_INVALID", "PHONE_VERIFICATION_RATE_LIMITED", "PROVIDER_DISABLED", "SMS_DELIVERY_UNAVAILABLE", "ASSOCIATION_SESSION_EXPIRED", "ASSOCIATION_SESSION_CONSUMED", "ASSOCIATION_TARGET_CHANGED", "DEVICE_ALREADY_ASSOCIATED", "FACT_VERSION_STALE"]);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
if (planResponseDelayMs > 0) await page.route("**/api/operator/projects/*/business-plan", async route => {
  if (route.request().method() !== "POST") return route.continue();
  const body = route.request().postData() ?? "";
  if (originalPlanRequestBody === null) originalPlanRequestBody = body;
  else assert.equal(body, originalPlanRequestBody, "explicit continuation must preserve the exact original plan request body/key");
  let idempotencyKeySha256: string | null = null;
  try {
    const metadata = (JSON.parse(body) as { metadata?: { idempotencyKey?: unknown } }).metadata;
    if (typeof metadata?.idempotencyKey === "string") idempotencyKeySha256 = sha256(metadata.idempotencyKey);
  } catch { /* Only digests and fixed result codes are persisted. */ }
  const started = performance.now();
  const actualResponse = await route.fetch();
  planPostResponses++;
  let errorCode: string | null = null, retryable: boolean | null = null;
  if (!actualResponse.ok()) {
    try {
      const value = await actualResponse.json() as { error?: { code?: unknown; retryable?: unknown } };
      if (typeof value.error?.code === "string" && safePlanErrorCodes.has(value.error.code)) errorCode = value.error.code;
      if (typeof value.error?.retryable === "boolean") retryable = value.error.retryable;
    } catch { /* Preserve status and hashes only when the error envelope is unreadable. */ }
  }
  planPostFacts.push({ sequence: planPostResponses, bodySha256: sha256(body), idempotencyKeySha256, status: actualResponse.status(), errorCode,
    retryable, backendElapsedMs: Math.round(performance.now() - started) });
  await writeFile(`${output}/business-plan-http-facts.json`, JSON.stringify(planPostFacts, null, 2), { mode: 0o600 });
  if (planPostResponses === 1) await new Promise(resolve => setTimeout(resolve, planResponseDelayMs));
  await route.fulfill({ response: actualResponse });
});
page.on("response", response => {
  const path = new URL(response.url()).pathname;
  if (!/^\/api\/operator\/projects\/[0-9a-f-]+\/(?:direction|materials(?:\/[0-9a-f-]+)?)$/i.test(path)) return;
  scopeFactReads.push((async () => {
    try {
      const body = await response.json() as Record<string, unknown>;
      const approval = body.approval as Record<string, unknown> | undefined;
      const proposal = approval?.proposal as Record<string, unknown> | undefined;
      const declaration = body.declaration as Record<string, unknown> | undefined;
      if (path.endsWith("/direction")) safeScopeFacts.push({ resource: "direction", status: response.status(), projectVersion: body.projectVersion ?? null,
        approvalId: approval?.approvalId ?? null, proposalProjectVersion: proposal?.projectVersion ?? null });
      else if (response.request().method() === "POST" || /\/materials\/[0-9a-f-]+$/i.test(path)) safeScopeFacts.push({ resource: "material", method: response.request().method(), status: response.status(),
        candidateStatus: body.status ?? null, candidateAllowed: body.candidateAllowed ?? null, eligibilityReason: body.eligibilityReason ?? null,
        expectedApprovedDirectionId: declaration?.expectedApprovedDirectionId ?? null,
        expectedApprovedProjectVersion: declaration?.expectedApprovedProjectVersion ?? null,
        contentRulesReviewed: declaration?.contentRulesReviewed ?? null });
    } catch { safeScopeFacts.push({ resource: "scope", status: response.status(), protocol: "unreadable" }); }
  })());
});
async function open(p: Page, initial = false) {
  await p.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  if (initial) { await p.getByLabel("登录名", { exact: true }).fill(required("SG_PRODUCT_TEST_LOGIN_NAME")); await p.getByLabel("密码", { exact: true }).fill(required("SG_PRODUCT_TEST_PASSWORD")); await p.getByRole("button", { name: "登录", exact: true }).click(); }
  await p.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor(); await p.getByRole("button", { name: "项目", exact: true }).click();
  if (!initial || p === second) { await project(p).getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click(); await project(p).getByRole("button", { name: "设置 · 目标与周期" }).click(); await planner(p).getByText(/项目版本 \d+，草案版本/).waitFor(); }
}
async function generate() {
  // Exercise actual operator recovery through the UI, not a hidden provider
  // retry or an ignored failed test. Only a known unavailable result permits
  // one explicit new command; unknown results must retain the original key.
  const maxAttempts = narrowPlanFlow ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const started = Date.now(); await direction(page).getByRole("button", { name: "生成初始方向", exact: true }).click();
    const feedback = direction(page).getByText(/^(真实模型方向已生成，请逐项核对范围后确认。|配置模型未返回可用方向；未采用模板，请读取结果后重试。)$/);
    await feedback.waitFor({ timeout: 55_000 });
    const proposed = (await feedback.innerText()).startsWith("真实模型");
    modelAttempts.push({ outcome: proposed ? "proposed" : "unavailable", elapsedMs: Date.now() - started });
    await writeFile(`${output}/model-attempts.json`, JSON.stringify(modelAttempts, null, 2));
    if (proposed) { await direction(page).getByRole("heading", { name: "待核对方向与范围" }).waitFor(); return; }
    assert.equal(await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).count(), 0);
    await direction(page).getByRole("button", { name: "读取方向结果", exact: true }).click();
  }
  throw new Error(narrowPlanFlow ? "Configured model unavailable on the single narrow-flow attempt; business acceptance blocked" : "Configured model unavailable after one explicit UI recovery; business acceptance blocked");
}
try {
  await open(page, true); await project(page).getByRole("button", { name: "新建项目" }).click(); await project(page).getByLabel("项目名称").fill(name); await project(page).getByRole("button", { name: "创建筹备项目" }).click();
  await project(page).getByText(/基本信息已保存；仍在筹备/).waitFor(); await project(page).getByRole("button", { name: "设置 · 目标与周期" }).click(); await planner(page).getByText(/草案版本 0/).waitFor();
  await direction(page).getByText("尚无已确认方向", { exact: true }).waitFor();
  await planner(page).getByLabel("正式开通前阶段目标", { exact: true }).fill("合成验收：完善明确范围；无真实发布授权");
  await planner(page).getByLabel("正式开通后阶段目标", { exact: true }).fill("合成验收：观察内容，禁止推定真实收益");
  await planner(page).getByLabel("正式开通后优先级", { exact: true }).selectOption("balanced");
  await planner(page).getByLabel("目标国家标签（逗号分隔）").fill("CN"); await planner(page).getByLabel("目标语言标签（逗号分隔）").fill("zh");
  await planner(page).getByRole("checkbox", { name: "Facebook 图文", exact: true }).check(); await planner(page).getByLabel("内容规则说明", { exact: true }).fill("仅合成验收素材；来源未验证；不得公开发布");
  await planner(page).getByRole("button", { name: "周期与观察", exact: true }).click();
  await planner(page).getByLabel("业务时区", { exact: true }).selectOption("Asia/Shanghai");
  const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 8 * 86400000).toISOString();
  await planner(page).getByLabel("首次统计起点（ISO 时间，须含时区）").fill(start);
  for (const [label, value] of [["复盘间隔（天）", "7"], ["项目每周期引流最低任务数", "0"], ["内容观察窗口（小时）", "24"], ["结束后收尾观察（天）", "0"], ["每日总发布上界", "1"]]) await planner(page).getByLabel(label!, { exact: true }).fill(value!);
  await planner(page).getByLabel("发布有效窗口开始（ISO 含时区）").fill(start); await planner(page).getByLabel("发布有效窗口结束（ISO 含时区，结束不含）").fill(end);
  await planner(page).getByRole("button", { name: "保存全部草案", exact: true }).click(); await planner(page).getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  await direction(page).getByLabel("发布身份范围", { exact: true }).fill("facebook/UI_SYNTHETIC_UNREGISTERED/开通前"); await generate();
  assert.ok((await direction(page).locator(".direction-copy").first().innerText()).length > 0);
  if (!narrowPlanFlow) {
    // A real second browser page edits the stored planning draft through the UI.
    await open(second, true); await planner(second).getByLabel("正式开通前阶段目标", { exact: true }).fill("合成验收：第二窗口修改目标，旧方向不可确认");
    await planner(second).getByRole("button", { name: "保存全部草案", exact: true }).click(); await planner(second).getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
    await direction(page).getByRole("button", { name: "确认方向", exact: true }).click(); await direction(page).getByText(/输入或版本不满足要求/).waitFor();
    assert.equal(await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).count(), 0);
    await direction(page).getByRole("button", { name: "读取方向结果", exact: true }).click(); await generate();
    assert.ok((await direction(page).innerText()).includes("第二窗口修改目标"));
  }
  // In narrow mode this immediately confirms the first real proposal. Drop only
  // the transport response AFTER that real confirmation has committed; no business
  // result is replaced, and recovery must use the original command.
  let lost = false;
  await page.route("**/direction/confirm", async route => { if (lost) { await route.continue(); return; } await route.fetch(); lost = true; await route.abort("failed"); });
  await direction(page).getByRole("button", { name: "确认方向", exact: true }).click(); await direction(page).getByText(/提交结果尚未确认/).waitFor();
  await direction(page).getByRole("button", { name: "读取方向结果", exact: true }).click(); await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).waitFor();
  await direction(page).getByRole("button", { name: "接续原方向请求", exact: true }).click(); await direction(page).getByText("方向已确认并留存批准范围；执行条件尚未就绪。", { exact: true }).waitFor();
  assert.equal(lost, true); await page.unroute("**/direction/confirm");
  assert.equal(await direction(page).getByRole("button", { name: "生成初始方向", exact: true }).count(), 0);
  await direction(page).getByText("当前未派发手机任务，未开启公开发布。", { exact: true }).waitFor();
  await direction(page).screenshot({ path: `${output}/direction-approved-desktop.png` });
  await page.reload(); await open(page); await direction(page).getByText("方向已确认 · 执行条件未就绪", { exact: true }).waitFor();
  assert.ok((await direction(page).innerText()).includes(narrowPlanFlow ? "合成验收：完善明确范围" : "第二窗口修改目标"));
  if (process.env.SG_PRODUCT_DIRECTION_MATERIAL_CANDIDATE === "1") {
    const materialFile = required("SG_PRODUCT_MATERIAL_TEST_FILE");
    const materialOutput = required("SG_PRODUCT_MATERIAL_SCREENSHOT_DIR");
    const materialDetails = JSON.parse(required("SG_PRODUCT_MATERIAL_TEST_DECLARATION")) as Record<string, string>;
    await mkdir(materialOutput, { recursive: true });
    await project(page).getByRole("button", { name: "素材", exact: true }).click();
    const materials = page.getByRole("region", { name: "项目素材", exact: true });
    await materials.locator('input[type="file"]').setInputFiles(materialFile);
    await materials.getByRole("button", { name: "上传／重试原文件", exact: true }).click();
    await materials.getByText("文件字节已校验", { exact: true }).waitFor();
    await materials.getByRole("button", { name: "预览／资料", exact: true }).click();
    const materialEditor = materials.getByRole("region", { name: "素材资料详情" });
    await materialEditor.getByText("当前已确认方向范围", { exact: true }).waitFor();
    for (const [label, key] of [["内容名称", "name"], ["语言标签", "language"], ["内容说明", "description"], ["业务事实", "businessFacts"], ["来源声明", "sourceStatement"], ["已有来源证明记录标识（逗号分隔 UUID）", "sourceEvidenceIds"], ["商品／短剧业务标识 UUID", "businessEntityId"], ["来源主体标识 UUID", "sourceId"], ["原成品来源记录 UUID", "sourceRecordId"]]) {
      await materialEditor.getByLabel(label!, { exact: true }).fill(key === "language" ? "zh" : materialDetails[key!]!);
    }
    await materialEditor.getByLabel("成品类型").selectOption(materialDetails.mediaKind ?? "image_text");
    await materialEditor.getByLabel("业务类型").selectOption(materialDetails.businessKind ?? "product");
    await materialEditor.getByRole("checkbox", { name: "我已按上述当前范围检查这份成品及其内容规则" }).check();
    await materialEditor.getByRole("button", { name: "保存本条／接续原请求" }).click();
    await materialEditor.getByText("请人工确认首次使用声明；文件上传不能代替来源确认。", { exact: true }).waitFor();
    await materialEditor.getByRole("checkbox", { name: "我已人工确认：此成品此前未发布；声明不等于系统核验通过" }).check();
    await materialEditor.getByRole("button", { name: "保存本条／接续原请求" }).click();
    await materials.getByText(/资料已保存 v1 · 素材候选$/).waitFor();
    await materialEditor.getByRole("heading", { name: "当前为素材候选", exact: true }).waitFor();
    await materialEditor.getByText("发布许可：未开启。候选状态不派发任务，也不代表外部来源或权利已验证。", { exact: true }).waitFor();
    await page.screenshot({ path: `${materialOutput}/candidate-approved-scope.png`, fullPage: true });
    await project(page).getByRole("button", { name: "排期与任务", exact: true }).click();
    const planTasks = project(page).getByRole("region", { name: "排期与任务", exact: true });
    await planTasks.getByRole("heading", { name: "排期与任务", exact: true, level: 2 }).waitFor();
    await planTasks.getByText("执行许可：关闭", { exact: true }).waitFor(); await planTasks.getByText("发布许可：关闭", { exact: true }).waitFor();
    const actualPlanResponse = planResponseDelayMs > 0 ? page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/business-plan")
      && response.request().method() === "POST", { timeout: 120_000 }) : null;
    await planTasks.getByRole("button", { name: "根据当前范围安排", exact: true }).click();
    if (planResponseDelayMs > 0) {
      await planTasks.getByRole("alert").filter({ hasText: "安排请求超过等待时限，结果未知" }).waitFor({ timeout: 75_000 });
      const currentRead = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/business-plan") && response.request().method() === "GET");
      await planTasks.getByRole("button", { name: "读取当前事实", exact: true }).click();
      assert.ok((await currentRead).ok(), "current plan facts must be read over the actual GET before retry is enabled");
      await planTasks.getByRole("button", { name: "接续同一安排请求", exact: true }).waitFor();
      assert.equal(await planTasks.getByRole("button", { name: "接续同一安排请求", exact: true }).isEnabled(), true);
      const firstResponse = await actualPlanResponse!;
      assert.equal(originalPlanRequestBody === null, false);
      if (!firstResponse.ok()) {
        await planTasks.getByRole("alert").filter({ hasText: "安排结果尚未确认" }).waitFor();
        const reconciliationRead = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/business-plan") && response.request().method() === "GET", { timeout: 30_000 });
        await planTasks.getByRole("button", { name: "读取当前事实", exact: true }).click();
        const currentResponse = await reconciliationRead;
        assert.ok(currentResponse.ok(), `read-only reconciliation GET returned ${currentResponse.status()}`);
        await planTasks.getByRole("button", { name: "接续同一安排请求", exact: true }).waitFor();
        const frozen = planTasks.getByRole("button", { name: "接续同一安排请求", exact: true });
        assert.equal(await frozen.isEnabled(), true);
        await writeFile(`${materialOutput}/business-plan-result.json`, JSON.stringify({ outcome: "http_error_reconciled_unknown", arrangeHttpStatus: firstResponse.status(),
          errorCode: planPostFacts[0]?.errorCode ?? null, retryable: planPostFacts[0]?.retryable ?? null, bodySha256: planPostFacts[0]?.bodySha256 ?? null,
          idempotencyKeySha256: planPostFacts[0]?.idempotencyKeySha256 ?? null, onlyOriginalPostObserved: planPostFacts.length === 1,
          readonlyGetAfterHttpError: true, currentPlanVisible: await planTasks.getByRole("heading", { name: "当前排期", exact: true }).count() === 1,
          taskRows: await planTasks.locator(".business-plan__tasks tbody tr").count(), sameRequestContinuationAvailable: true,
          continuationClicked: false, executionAllowed: false, publicationAllowed: false }, null, 2), { mode: 0o600 });
        throw new Error("Actual business-plan POST returned a non-success response; current facts reconciled, original request remains frozen and was not replayed");
      }
      const replayResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/business-plan")
        && response.request().method() === "POST", { timeout: 30_000 });
      await planTasks.getByRole("button", { name: "接续同一安排请求", exact: true }).click();
      const replayed = await replayResponse;
      assert.ok(replayed.ok(), `same-key stored plan command replay returned ${replayed.status()}`);
      assert.equal(planPostResponses, 2, "only the original actual model command and its stored-response replay are allowed");
      assert.equal(planPostFacts[0]?.bodySha256, planPostFacts[1]?.bodySha256, "replay body digest remains identical");
      assert.equal(planPostFacts[0]?.idempotencyKeySha256, planPostFacts[1]?.idempotencyKeySha256, "replay idempotency-key digest remains identical");
    }
    await planTasks.getByText(/已根据当前权威事实生成并保存排期与待核查任务。|当前排期未变化。|当前资料不足，服务没有安排新任务。|模型要求运营先确认方向调整；请回到方向页复核提案。/).waitFor({ timeout: 90_000 });
    const planOutcome = await planTasks.locator(".business-plan__message").innerText();
    const planTaskRows = await planTasks.locator(".business-plan__tasks tbody tr").count();
    assert.equal(await planTasks.getByText("执行许可：关闭", { exact: true }).count(), 1);
    assert.equal(await planTasks.getByText("发布许可：关闭", { exact: true }).count(), 1);
    await writeFile(`${materialOutput}/business-plan-result.json`, JSON.stringify({ outcome: planOutcome, currentPlanVisible: await planTasks.getByRole("heading", { name: "当前排期", exact: true }).count() === 1,
      taskRows: planTaskRows, executionAllowed: false, publicationAllowed: false, actionByBrowser: "no external platform execution or publication",
      delayedActualResponseUnknownRecovery: planResponseDelayMs > 0, sameOriginalBodyAndKeyReplay: planResponseDelayMs > 0 && planPostResponses === 2, bodySha256: planPostFacts[0]?.bodySha256 ?? null,
      idempotencyKeySha256: planPostFacts[0]?.idempotencyKeySha256 ?? null }, null, 2));
    if (await planTasks.getByText("已根据当前权威事实生成并保存排期与待核查任务。", { exact: true }).count()) {
      await planTasks.getByRole("heading", { name: "当前排期", exact: true }).waitFor();
      await planTasks.getByText("待核查当前条件").first().waitFor();
    }
    await page.screenshot({ path: `${materialOutput}/business-plan-task-result.png`, fullPage: true });
    await project(page).getByRole("button", { name: "设置 · 目标与周期", exact: true }).click();
    await planner(page).getByLabel("目标语言标签（逗号分隔）").fill("zh,en");
    await planner(page).getByRole("button", { name: "保存全部草案", exact: true }).click();
    await planner(page).getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
    await project(page).getByRole("button", { name: "素材", exact: true }).click();
    await materials.getByText(/资料已保存 v1 · 待检查：已确认方向与当前项目或周期草案不一致，请重新核对。$/).waitFor();
    await materials.getByRole("button", { name: "预览／资料", exact: true }).click();
    const staleEditor = materials.getByRole("region", { name: "素材资料详情" });
    await staleEditor.getByRole("heading", { name: "当前待检查", exact: true }).waitFor();
    const staleConfirmation = staleEditor.getByRole("checkbox", { name: "我已按上述当前范围检查这份成品及其内容规则" });
    assert.equal(await staleConfirmation.isChecked(), false, "A changed scope must never retain the old human confirmation");
    await staleEditor.getByText("发布许可：未开启。候选状态不派发任务，也不代表外部来源或权利已验证。", { exact: true }).waitFor();
    await page.screenshot({ path: `${materialOutput}/stale-scope-pending.png`, fullPage: true });
    await project(page).getByRole("button", { name: "设置 · 目标与周期", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await direction(page).getByRole("button", { name: "确认方向", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await direction(page).screenshot({ path: `${output}/direction-approved-mobile.png` }); assert.deepEqual(errors, []);
  await Promise.all(scopeFactReads);
  await writeFile(`${output}/safe-scope-facts.json`, JSON.stringify(safeScopeFacts, null, 2), { mode: 0o600 });
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, actualModel: true, scope: narrowPlanFlow ? "synthetic UI inputs with one configured real model proposal; immediate human confirmation, lost response original replay, reload, mobile readonly" : "synthetic UI inputs with configured real model; stale direction rejection, immutable confirmation, lost response original replay, reload, mobile readonly", execution: "blocked", publication: "not performed" }, null, 2));
  console.log(JSON.stringify({ passed: true, actualModel: true, actualPhone: false, actualPublication: false }));
} catch (error) {
  await Promise.allSettled(scopeFactReads);
  await writeFile(`${output}/failure-direction.txt`, `Safe scope facts: ${JSON.stringify(safeScopeFacts)}\n\nFailure: ${error instanceof Error ? error.name : "unknown"}`);
  if (await direction(page).isVisible().catch(() => false)) await direction(page).screenshot({ path: `${output}/failure-direction.png` });
  throw error;
} finally { await browser.close(); }
