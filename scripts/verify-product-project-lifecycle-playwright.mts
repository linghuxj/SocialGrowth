import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`${key} required`); return value; };
const output = required("SG_PRODUCT_PROJECT_LIFECYCLE_OUTPUT");
const file = required("SG_PRODUCT_MATERIAL_TEST_FILE");
const declaration = JSON.parse(required("SG_PRODUCT_MATERIAL_TEST_DECLARATION")) as Record<string, string>;
const login = required("SG_PRODUCT_TEST_LOGIN_NAME"), password = required("SG_PRODUCT_TEST_PASSWORD");
await mkdir(output, { recursive: true });

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const lifecycleRouteFailure = deferred<Error>();
function waitForLifecycleSignal<T>(signal: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), 30_000);
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete();
    };
    signal.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    lifecycleRouteFailure.promise.then(error => finish(() => reject(error)));
  });
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 950 }, locale: "zh-CN" });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const pageErrors: string[] = [];
page.on("pageerror", () => pageErrors.push("pageerror"));
page.on("dialog", dialog => dialog.type() === "confirm" ? dialog.accept() : dialog.dismiss());
type ReadRoute = "lifecycle-intents" | "current-checks" | "materials-list";
const readEvidence: Array<{ event: "response" | "finished" | "failed"; route: ReadRoute; status: number | null; errorCode: string | null }> = [];
const readEvidenceTasks: Promise<void>[] = [];
const safeErrorCodes = new Set(["AUTHENTICATION_REQUIRED", "AUTHORIZATION_DENIED", "CONTRACT_VERSION_UNSUPPORTED", "FACT_VERSION_STALE",
  "INPUT_INVALID", "INTERNAL_ERROR", "MATERIAL_NOT_FOUND", "PROJECT_NOT_FOUND", "RESOURCE_NOT_FOUND"]);
function readRoute(url: string): ReadRoute | null {
  const path = new URL(url).pathname;
  if (/^\/api\/operator\/projects\/[0-9a-f-]{36}\/lifecycle-intents$/i.test(path)) return "lifecycle-intents";
  if (/^\/api\/operator\/projects\/[0-9a-f-]{36}\/business-plan\/current-checks$/i.test(path)) return "current-checks";
  if (/^\/api\/operator\/projects\/[0-9a-f-]{36}\/materials$/i.test(path)) return "materials-list";
  return null;
}
page.on("requestfailed", request => {
  if (request.method() !== "GET") return;
  const route = readRoute(request.url());
  if (route) readEvidence.push({ event: "failed", route, status: null, errorCode: "transport_failed" });
});
page.on("response", response => {
  if (response.request().method() !== "GET") return;
  const route = readRoute(response.url());
  if (!route) return;
  const status = response.status();
  readEvidenceTasks.push((async () => {
    let errorCode: string | null = null;
    if (!response.ok()) {
      try {
        const body = await response.json() as { error?: { code?: unknown } };
        errorCode = typeof body.error?.code === "string" && safeErrorCodes.has(body.error.code) ? body.error.code : "unrecognized";
      } catch { errorCode = "unreadable_error_envelope"; }
    }
    readEvidence.push({ event: "response", route, status, errorCode });
  })());
});
page.on("requestfinished", request => {
  if (request.method() !== "GET") return;
  const route = readRoute(request.url());
  if (!route) return;
  readEvidenceTasks.push((async () => {
    const response = await request.response();
    readEvidence.push({ event: "finished", route, status: response?.status() ?? null, errorCode: null });
  })());
});

const workspace = page.locator(".project-workspace");
const outputFacts: {
  pauseDelayedAck: { bodySha256: string; keySha256: string; status: number; changed: boolean } | null;
  endFirstResponse: { bodySha256: string; keySha256: string; requestIdSha256: string; status: number; changed: boolean; replayed: boolean } | null;
  endUnknownReplay: { bodySha256: string; replayBodySha256: string; keySha256: string; replayKeySha256: string; firstStatus: number; replayStatus: number; replayed: boolean } | null;
  withdrawal: { status: number; changed: boolean; replayed: boolean; requestIdSha256: string } | null;
} = { pauseDelayedAck: null, endFirstResponse: null, endUnknownReplay: null, withdrawal: null };
let projectAId: string | null = null;
let projectARequestId: string | null = null;
let pauseFirstBody: string | null = null;
let pauseFirstKeySha256: string | null = null;
let endFirstBody: string | null = null;
let endFirstKeySha256: string | null = null;
let endRequestId: string | null = null;
let endFirstStatus: number | null = null;
let stage = "browser setup";
let holdARead = false;
const pauseResponseCaptured = deferred<{ status: number; changed: boolean }>();
const releasePauseResponse = deferred();
const heldARead = deferred();
const releaseHeldAReads = deferred();
const aReadDelivered = deferred();
let firstEndCommitted = false;
let endPostCount = 0;
let pausePostCount = 0;
const lifecycleRoutePattern = "**/api/operator/projects/*/lifecycle-intents";

await page.route(lifecycleRoutePattern, async route => {
  try {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const projectId = pathname.split("/").at(-2)!.toLowerCase();
  if (request.method() === "GET" && holdARead && projectAId === projectId) {
    const response = await route.fetch();
    heldARead.resolve();
    await releaseHeldAReads.promise;
    await route.fulfill({ response });
    aReadDelivered.resolve();
    return;
  }
  if (request.method() !== "POST") { await route.continue(); return; }
  const body = request.postData() ?? "";
  const parsed = JSON.parse(body) as { metadata?: { requestId?: string; idempotencyKey?: string }; intent?: string };
  const requestId = parsed.metadata?.requestId ?? "";
  const keySha256 = sha256(parsed.metadata?.idempotencyKey ?? "");

  if (parsed.intent === "pause" && pausePostCount === 0) {
    pausePostCount++;
    projectAId = projectId;
    projectARequestId = requestId;
    const response = await route.fetch();
    const receipt = await response.json() as { projectId: string; intent: string; changed: boolean; replayed: boolean };
    assert.equal(response.status(), 201);
    assert.equal(receipt.projectId.toLowerCase(), projectId);
    assert.equal(receipt.intent, "pause_requested");
    assert.equal(receipt.changed, true);
    assert.equal(receipt.replayed, false);
    outputFacts.pauseDelayedAck = { bodySha256: sha256(body), keySha256, status: response.status(), changed: receipt.changed };
    pauseResponseCaptured.resolve({ status: response.status(), changed: receipt.changed });
    await releasePauseResponse.promise;
    await route.fulfill({ response });
    return;
  }

  if (parsed.intent === "end" && projectAId === projectId) {
    endPostCount++;
    if (!firstEndCommitted) {
      firstEndCommitted = true;
      endFirstBody = body;
      endFirstKeySha256 = keySha256;
      endRequestId = requestId;
      const response = await route.fetch();
      endFirstStatus = response.status();
      const receipt = await response.json() as { projectId: string; intent: string; changed: boolean; replayed: boolean };
      assert.ok(response.status() >= 200 && response.status() < 300);
      assert.equal(receipt.projectId.toLowerCase(), projectId);
      assert.equal(receipt.intent, "end_requested");
      assert.equal(receipt.changed, true);
      assert.equal(receipt.replayed, false);
      outputFacts.endFirstResponse = { bodySha256: sha256(body), keySha256, requestIdSha256: sha256(requestId),
        status: response.status(), changed: receipt.changed, replayed: receipt.replayed };
      await route.abort("failed");
      return;
    }
    assert.ok(endFirstBody !== null && body === endFirstBody, "unknown continuation must preserve the exact original lifecycle body");
    assert.ok(keySha256 === endFirstKeySha256, "unknown continuation must preserve the original lifecycle idempotency key");
    holdARead = false;
    releaseHeldAReads.resolve();
    await waitForLifecycleSignal(aReadDelivered.promise, "held lifecycle read delivery");
    const response = await route.fetch();
    const receipt = await response.json() as { projectId: string; intent: string; changed: boolean; replayed: boolean };
    assert.ok(response.status() >= 200 && response.status() < 300);
    assert.equal(receipt.projectId.toLowerCase(), projectId);
    assert.equal(receipt.intent, "end_requested");
    assert.equal(receipt.replayed, true);
    outputFacts.endUnknownReplay = { bodySha256: sha256(endFirstBody!), replayBodySha256: sha256(body), keySha256: endFirstKeySha256!,
      replayKeySha256: keySha256, firstStatus: endFirstStatus!, replayStatus: response.status(), replayed: receipt.replayed };
    await route.fulfill({ response });
    return;
  }
  await route.continue();
  } catch (error) {
    lifecycleRouteFailure.resolve(error instanceof Error ? error : new Error("intercepted lifecycle route failed"));
    throw error;
  }
});

await page.route("**/api/operator/projects/*/materials/*/withdrawal", async route => {
  if (route.request().method() !== "POST") { await route.continue(); return; }
  const response = await route.fetch();
  const receipt = await response.json() as { changed: boolean; replayed: boolean; requestId: string };
  assert.ok(response.status() >= 200 && response.status() < 300);
  assert.equal(receipt.changed, true);
  assert.equal(receipt.replayed, false);
  outputFacts.withdrawal = { status: response.status(), changed: receipt.changed, replayed: receipt.replayed, requestIdSha256: sha256(receipt.requestId) };
  await route.fulfill({ response });
});

async function returnToList() {
  const back = workspace.getByRole("button", { name: "返回项目列表", exact: true });
  if (await back.count()) await back.click();
}
async function createProject(name: string) {
  await returnToList();
  await workspace.getByRole("button", { name: "新建项目", exact: true }).click();
  await workspace.getByLabel("项目名称", { exact: true }).fill(name);
  await workspace.getByRole("button", { name: "创建筹备项目", exact: true }).click();
  await workspace.getByText(/基本信息已保存；仍在筹备/).waitFor();
  await returnToList();
}
async function openProject(name: string) {
  await returnToList();
  await workspace.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "打开项目", exact: true }).click();
}
async function openLifecycle(name: string) {
  await openProject(name);
  await workspace.getByRole("button", { name: "项目生命周期", exact: true }).click();
  const panel = workspace.getByRole("region", { name: "项目生命周期", exact: true });
  const intentValue = panel.getByRole("region", { name: "项目意图事实", exact: true }).locator(".project-lifecycle__facts dd").first()
    .filter({ hasText: /^(尚无项目生命周期意图|已记录暂停意图|已记录恢复前复核意图|已记录正式结束意图)$/ });
  stage = "wait for lifecycle panel heading";
  await panel.getByRole("heading", { name: "项目暂停、恢复与结束", exact: true }).waitFor();
  stage = "wait for lifecycle intent data text";
  await intentValue.waitFor();
  return panel;
}
async function saveSyntheticMaterial(projectName: string) {
  await openProject(projectName);
  await workspace.getByRole("button", { name: "素材", exact: true }).click();
  const material = workspace.getByRole("region", { name: "项目素材", exact: true });
  await material.locator('input[type="file"]').setInputFiles(file);
  await material.getByRole("button", { name: "上传／重试原文件", exact: true }).click();
  await material.getByText("文件字节已校验", { exact: true }).waitFor();
  await material.getByRole("button", { name: "预览／资料", exact: true }).click();
  const editor = material.getByRole("region", { name: "素材资料详情" });
  await editor.getByLabel("内容名称", { exact: true }).fill(declaration.name!);
  await editor.getByLabel("语言标签", { exact: true }).fill(declaration.language!);
  await editor.getByLabel("成品类型").selectOption(declaration.mediaKind ?? "image_text");
  await editor.getByLabel("业务类型").selectOption(declaration.businessKind ?? "product");
  for (const [label, key] of [["内容说明", "description"], ["业务事实", "businessFacts"], ["来源声明", "sourceStatement"],
    ["已有来源证明记录标识（逗号分隔 UUID）", "sourceEvidenceIds"], ["商品／短剧业务标识 UUID", "businessEntityId"],
    ["来源主体标识 UUID", "sourceId"], ["原成品来源记录 UUID", "sourceRecordId"]]) {
    await editor.getByLabel(label!, { exact: true }).fill(declaration[key!]!);
  }
  await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await editor.getByText("请人工确认首次使用声明；文件上传不能代替来源确认。", { exact: true }).waitFor();
  await editor.getByRole("checkbox", { name: "我已人工确认：此成品此前未发布；声明不等于系统核验通过" }).check();
  await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await material.getByText(/资料已保存 v1 · 待检查：项目尚无已确认的方向与范围。/).waitFor();
  await editor.getByRole("heading", { name: "当前待检查", exact: true }).waitFor();
}

try {
  stage = "open login page";
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  stage = "operator login";
  await page.getByLabel("登录名", { exact: true }).fill(login);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();

  const suffix = Date.now();
  const projectA = `生命周期隔离 A ${suffix}`, projectB = `生命周期隔离 B ${suffix}`;
  stage = "create project A through UI";
  await createProject(projectA);
  stage = "create project B through UI";
  await createProject(projectB);

  // A new project begins with no approved direction. Create only an actual UI
  // material declaration, then exercise withdrawal against its current version.
  stage = "save synthetic material through project B UI";
  await saveSyntheticMaterial(projectB);
  stage = "open project B lifecycle facts";
  let lifecycleB = await openLifecycle(projectB);
  stage = "withdraw project B v0 material through UI";
  const materialCard = lifecycleB.getByRole("region", { name: "项目素材内部撤回", exact: true });
  await materialCard.getByRole("button", { name: "撤回此素材版本", exact: true }).click();
  await materialCard.getByText(/内部撤回已记录/).waitFor();
  assert.ok(outputFacts.withdrawal !== null);

  // Commit a real pause through the page, but hold only its actual response
  // while the operator switches projects. The delayed A receipt must not paint
  // into B's lifecycle panel.
  stage = "open project A lifecycle facts";
  const lifecycleA = await openLifecycle(projectA);
  const actionA = lifecycleA.getByRole("region", { name: "项目意图事实", exact: true });
  const visiblePauseResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/lifecycle-intents")
    && response.request().method() === "POST");
  stage = "submit project A pause intent";
  await actionA.getByRole("button", { name: "请求暂停发布", exact: true }).click();
  const pauseReceipt = await waitForLifecycleSignal(pauseResponseCaptured.promise, "pause response capture");
  assert.equal(pauseReceipt.status, 201);
  stage = "verify delayed A response isolation while viewing B";
  await returnToList();
  lifecycleB = await openLifecycle(projectB);
  const bFactsDuringPause = await lifecycleB.innerText();
  assert.ok(bFactsDuringPause.includes("尚无项目生命周期意图"));
  assert.ok(!bFactsDuringPause.includes(projectARequestId!), "project A request must not appear in project B facts");
  releasePauseResponse.resolve();
  const pauseBrowserResponse = await visiblePauseResponse;
  assert.equal(pauseBrowserResponse.status(), 201);
  await page.waitForLoadState("networkidle");
  const bFactsAfterPause = await lifecycleB.innerText();
  assert.ok(bFactsAfterPause.includes("尚无项目生命周期意图"));
  assert.ok(!bFactsAfterPause.includes(projectARequestId!), "late project A response must not contaminate project B");

  const pauseA = await openLifecycle(projectA);
  await pauseA.getByText("已记录暂停意图", { exact: true }).waitFor();
  stage = "submit project A resume review intent";
  await pauseA.getByRole("region", { name: "项目意图事实", exact: true })
    .getByRole("button", { name: "请求检查恢复条件", exact: true }).click();
  await pauseA.getByText("已记录恢复前复核意图", { exact: true }).waitFor();

  // The actual end command commits in the isolated backend; abort only its
  // response to exercise unknown-state preservation, then explicitly replay
  // the same immutable body/key through the UI after a real scoped GET.
  stage = "submit project A end intent and preserve unknown response";
  const endA = pauseA.getByRole("region", { name: "项目意图事实", exact: true });
  await endA.getByRole("checkbox", { name: /我确认项目正式结束不可普通恢复/ }).check();
  await endA.getByRole("button", { name: "正式结束项目", exact: true }).click();
  await pauseA.getByRole("status").filter({
    hasText: /写请求回执未能确认，结果未知；原请求内容与请求键保持冻结。请核对当前事实或接续原请求。/,
  }).waitFor();
  const frozenEnd = endA.getByRole("button", { name: "接续原请求", exact: true });
  await frozenEnd.waitFor();
  assert.equal(await frozenEnd.isEnabled(), true, "the frozen original request must remain explicitly continuable");
  assert.equal(endPostCount, 1);
  assert.ok(endFirstBody !== null && endFirstKeySha256 !== null && endRequestId !== null);

  stage = "switch project during frozen project A unknown";
  await returnToList();
  lifecycleB = await openLifecycle(projectB);
  const bFactsDuringEndUnknown = await lifecycleB.innerText();
  assert.ok(bFactsDuringEndUnknown.includes("尚无项目生命周期意图"));
  assert.ok(!bFactsDuringEndUnknown.includes(endRequestId!), "project A unknown request must remain isolated from project B");

  stage = "reconcile and replay the frozen original project A request";
  holdARead = true;
  await openProject(projectA);
  await workspace.getByRole("button", { name: "项目生命周期", exact: true }).click();
  const reopenedA = workspace.getByRole("region", { name: "项目生命周期", exact: true });
  await reopenedA.getByRole("heading", { name: "项目暂停、恢复与结束", exact: true }).waitFor();
  await waitForLifecycleSignal(heldARead.promise, "held project A read arrival");
  const continuedEnd = reopenedA.getByRole("button", { name: "接续原请求", exact: true });
  await continuedEnd.waitFor();
  await continuedEnd.click();
  await reopenedA.getByRole("region", { name: "项目意图事实", exact: true })
    .locator(".project-lifecycle__facts dd").first().filter({ hasText: /^已记录正式结束意图$/ }).waitFor();
  assert.equal(endPostCount, 2);
  assert.ok(outputFacts.endUnknownReplay !== null);
  assert.equal(outputFacts.endUnknownReplay.bodySha256, outputFacts.endUnknownReplay.replayBodySha256);
  assert.equal(outputFacts.endUnknownReplay.keySha256, outputFacts.endUnknownReplay.replayKeySha256);
  assert.equal(pageErrors.length, 0);

  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, scope: "real UI login, two UI-created projects, UI material save/withdrawal on unapproved v0 project, pause/resume/end intents, delayed old-project response isolation, committed-but-lost response recovery with exact original body/key replay", projects: 2,
    projectIdsRecordedAsHashesOnly: true, pauseResponseDelayedUntilProjectB: true, lateResponseDidNotContaminateProjectB: true,
    unknownEndRecoveredBySameKey: true, materialWithdrawalStayedInternal: true, readEvidence,
    actions: outputFacts, executionAllowed: false, publicationAllowed: false, actualDeviceAction: false, actualPublication: false }, null, 2), { mode: 0o600 });
  await writeFile(`${output}/read-http-facts.json`, JSON.stringify(readEvidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, scope: "project-lifecycle UI", projects: 2, executionAllowed: false, publicationAllowed: false }));
} catch (error) {
  await Promise.allSettled(readEvidenceTasks);
  const selectedPanel = page.getByRole("region", { name: "项目生命周期", exact: true });
  const statusOrAlert = await selectedPanel.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => []);
  const safeMessage = statusOrAlert.join(" ");
  const alertCategory = safeMessage.includes("运营会话已失效") ? "session_expired" : safeMessage.includes("生命周期事实暂时无法读取") ? "lifecycle_read_unavailable"
    : safeMessage.includes("请求结果未知") || safeMessage.includes("结果未知；原请求内容与请求键保持冻结") ? "request_outcome_unknown"
      : safeMessage ? "other_safe_alert" : "none";
  const panel = selectedPanel;
  const visible = await panel.isVisible().catch(() => false);
  const intentRegion = panel.getByRole("region", { name: "项目意图事实", exact: true });
  const intentLabel = await intentRegion.locator(".project-lifecycle__facts dd").first().innerText().catch(() => "");
  const intentLabelIsKnown = /^(尚无项目生命周期意图|已记录暂停意图|已记录恢复前复核意图|已记录正式结束意图)$/.test(intentLabel.trim());
  const lifecycleVersionText = await intentRegion.locator(".project-lifecycle__section-heading > span").innerText().catch(() => "");
  const lifecycleVersionMatch = /^生命周期版本 v(\d+)$/.exec(lifecycleVersionText.trim());
  const projectVersionText = await workspace.locator("#project-basics .section-heading > span").innerText().catch(() => "");
  const projectVersionMatch = /^已保存版本 (\d+)$/.exec(projectVersionText.trim());
  const pauseButton = intentRegion.getByRole("button", { name: "请求暂停发布", exact: true });
  const resumeButton = intentRegion.getByRole("button", { name: "请求检查恢复条件", exact: true });
  const endButton = intentRegion.getByRole("button", { name: "正式结束项目", exact: true });
  const uiState = {
    panelPresent: await panel.count().catch(() => 0) > 0,
    panelVisible: visible,
    lifecycleHeadingVisible: await panel.getByRole("heading", { name: "项目暂停、恢复与结束", exact: true }).isVisible().catch(() => false),
    lifecycleFactRegionPresent: await intentRegion.count().catch(() => 0) > 0,
    lifecycleFactRegionVisible: await panel.getByRole("region", { name: "项目意图事实", exact: true }).isVisible().catch(() => false),
    knownIntentVisible: intentLabelIsKnown,
    intentLabel: intentLabelIsKnown ? intentLabel.trim() : null,
    lifecycleRevisionLabelPresent: lifecycleVersionMatch !== null,
    lifecycleRevision: lifecycleVersionMatch ? Number(lifecycleVersionMatch[1]) : null,
    projectVersionLabelPresent: projectVersionMatch !== null,
    projectVersion: projectVersionMatch ? Number(projectVersionMatch[1]) : null,
    pauseButtonEnabled: await pauseButton.isEnabled().catch(() => false),
    resumeButtonEnabled: await resumeButton.isEnabled().catch(() => false),
    endButtonEnabled: await endButton.isEnabled().catch(() => false),
    loadingStatusVisible: await panel.getByText("正在读取项目意图与当前素材事实…", { exact: true }).isVisible().catch(() => false),
    errorAlertVisible: await panel.locator(".project-lifecycle__alert").isVisible().catch(() => false),
    unknownStatusVisible: await panel.getByRole("status").filter({ hasText: /请求结果未知|写请求回执未能确认，结果未知/ }).isVisible().catch(() => false),
    continuationButtonPresent: await panel.getByRole("button", { name: "接续原请求", exact: true }).count().catch(() => 0) > 0,
    continuationButtonEnabled: await panel.getByRole("button", { name: "接续原请求", exact: true }).isEnabled().catch(() => false),
    readonlyReceiptCheckPresent: await panel.getByRole("button", { name: "只读核对原回执", exact: true }).count().catch(() => 0) > 0,
    navigationSelected: await workspace.getByRole("button", { name: "项目生命周期", exact: true }).getAttribute("aria-current").catch(() => null) === "page",
  };
  await writeFile(`${output}/failure.json`, JSON.stringify({ failureType: error instanceof Error ? error.name : "unknown", stage, pageErrors, readEvidence, alertCategory, uiState, actions: outputFacts,
    pausePostCount, endPostCount, endFirstResponseObserved: outputFacts.endFirstResponse, actualDirectionSource: "no approved direction created", actualExternalAction: false }, null, 2), { mode: 0o600 });
  throw new Error("Project lifecycle Playwright failed; see finite safe result artifacts");
} finally {
  holdARead = false;
  releasePauseResponse.resolve();
  releaseHeldAReads.resolve();
  await context.close();
  await browser.close();
}
