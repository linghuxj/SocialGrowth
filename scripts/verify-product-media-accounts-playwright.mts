import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Locator, type Page } from "playwright";

const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`${key} required`); return value; };
const output = required("SG_PRODUCT_MEDIA_ACCOUNTS_OUTPUT");
const loginName = required("SG_PRODUCT_TEST_LOGIN_NAME");
const loginPassword = required("SG_PRODUCT_TEST_PASSWORD");
const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
if (new URL(base).hostname !== "127.0.0.1" || process.env.SG_PRODUCT_MEDIA_ACCOUNTS_OWNED_ENV !== "1") {
  throw new Error("owned isolated loopback product Web required");
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
const passed: string[] = [];
const blocked: string[] = [];
const failed: string[] = [];
const productHttp: Array<{ endpoint: "media-accounts" | "account-assignments"; method: string; status: number }> = [];
let step = "environment";
let pageErrorCount = 0;
let failureDiagnostics: Record<string, unknown> | undefined;
page.on("pageerror", () => { pageErrorCount++; failed.push("browser-page-error"); });
page.on("response", response => {
  const path = new URL(response.url()).pathname;
  const endpoint = path === "/api/operator/media-accounts" ? "media-accounts"
    : path === "/api/operator/resources/account-assignments" ? "account-assignments" : null;
  if (endpoint) productHttp.push({ endpoint, method: response.request().method(), status: response.status() });
});

async function enterProduct() {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill(loginName);
  await page.getByLabel("密码", { exact: true }).fill(loginPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
}
async function openMediaAccounts() {
  const listRead = page.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/media-accounts" && r.request().method() === "GET");
  await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
  await page.getByRole("heading", { name: "媒体平台账号", level: 1, exact: true }).waitFor();
  await page.getByRole("heading", { name: "账号与凭据状态", level: 2, exact: true }).waitFor();
  await listRead;
}
async function ensureOptionalPersonaOpen(form: Locator) {
  const details = form.locator("details.optional-persona");
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) {
    await form.locator("details.optional-persona > summary").click();
  }
  assert.equal(await details.evaluate((element: HTMLDetailsElement) => element.open), true);
}
function waitForProjectAssignmentResponse(surface: Page, selectedProjectId: string) {
  const expectedProjectId = selectedProjectId.toLowerCase();
  return surface.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/operator/resources/account-assignments"
      && response.request().method() === "GET"
      && url.searchParams.get("projectId")?.toLowerCase() === expectedProjectId;
  });
}
async function parseProjectAssignmentResponse(responsePromise: Promise<import("playwright").Response>, selectedProjectId: string) {
  const expectedProjectId = selectedProjectId.toLowerCase();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const facts = await response.json() as {
    projectId: string | null;
    assignments: unknown[];
    eligibleDevices: Array<{ deviceId: string }>;
  };
  assert.equal(facts.projectId?.toLowerCase(), expectedProjectId);
  assert.ok(Array.isArray(facts.assignments));
  assert.ok(Array.isArray(facts.eligibleDevices));
  return facts;
}
async function readProjectAssignments(surface: Page, selectedProjectId: string) {
  return parseProjectAssignmentResponse(waitForProjectAssignmentResponse(surface, selectedProjectId), selectedProjectId);
}
async function chooseProjectAndReadAssignments(surface: Page, selector: Locator, selectedProjectId: string) {
  const responsePromise = waitForProjectAssignmentResponse(surface, selectedProjectId);
  await selector.selectOption(selectedProjectId);
  return parseProjectAssignmentResponse(responsePromise, selectedProjectId);
}
async function createAccount(name: string, platform: "facebook" | "youtube", login: string, secret: string, optional = false) {
  const form = page.locator(".media-account-form");
  step = `create-${platform}-select-platform`;
  await form.locator('select[name="platform"]').selectOption(platform);
  step = `create-${platform}-fill-display-name`;
  await form.getByLabel("识别名称（可选）", { exact: true }).fill(name);
  step = `create-${platform}-fill-login`;
  await form.getByLabel("登录账号", { exact: true }).fill(login);
  step = `create-${platform}-fill-password`;
  await form.getByLabel("密码", { exact: true }).fill(secret);
  if (optional) {
    step = `create-${platform}-open-optional-persona`;
    await ensureOptionalPersonaOpen(form);
    step = `create-${platform}-fill-optional-persona`;
    await form.getByLabel("真实姓名", { exact: true }).fill("自动化测试资料（非真实）");
  }
  step = `create-${platform}-wait-post`;
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/media-accounts" && r.request().method() === "POST");
  step = `create-${platform}-submit`;
  await form.getByRole("button", { name: "保存账号", exact: true }).click();
  step = `create-${platform}-await-response`;
  return response;
}

try {
  step = "operator-login";
  await enterProduct();
  step = "media-account-form-required-fields";
  await openMediaAccounts();
  const form = page.locator(".media-account-form");
  let createPostCount = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/operator/media-accounts" && request.method() === "POST") createPostCount++; });
  assert.equal(await form.getByRole("button", { name: "保存账号" }).isDisabled(), false);
  await form.locator('select[name="platform"]').selectOption("facebook");
  await form.getByLabel("密码").fill(`Temporary-${crypto.randomUUID()}`);
  await form.getByRole("button", { name: "保存账号", exact: true }).click();
  assert.equal(await form.getByLabel("登录账号").evaluate((el: HTMLInputElement) => el.validity.valueMissing), true);
  assert.equal(createPostCount, 0);
  await form.getByLabel("登录账号").fill("missing-password@example.invalid");
  await form.getByLabel("密码").fill("");
  await form.getByRole("button", { name: "保存账号", exact: true }).click();
  assert.equal(await form.getByLabel("密码").evaluate((el: HTMLInputElement) => el.validity.valueMissing), true);
  assert.equal(createPostCount, 0);
  passed.push("真实点击后浏览器校验缺失登录账号/密码，未发送创建请求");

  step = "create-account-and-secret-nonreadback";
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const fbLogin = `media-fb-${suffix}@example.invalid`;
  let fbDisplayName = `验收演示 Facebook ${suffix}`;
  const fbPassword = `NotARealPlatformSecret-${crypto.randomUUID()}`;
  const fbResponsePromise = createAccount(fbDisplayName, "facebook", fbLogin, fbPassword, true);
  const fbResponse = await (await fbResponsePromise).json();
  assert.equal(fbResponse.account.platform, "facebook");
  assert.equal(fbResponse.account.loginIdentifier, fbLogin);
  assert.equal(fbResponse.account.canonicalAccountRef, null);
  assert.equal(fbResponse.account.parentLoginVerification, "registered_unverified");
  assert.equal(fbResponse.account.credential.state, "stored_unverified");
  assert.equal(fbResponse.account.persona.name, "自动化测试资料（非真实）");
  assert.equal(fbResponse.actionPermissionGranted, false);
  assert.equal(fbResponse.publicationAllowed, false);
  await page.getByText("账号资料已保存；登录和平台身份仍未核验。密码已清除。", { exact: true }).waitFor();
  await page.getByText(fbLogin, { exact: true }).waitFor();
  assert.equal(await page.locator(".media-account-list").getByText(fbPassword, { exact: true }).count(), 0);
  passed.push("通过Web创建合成账号，保存状态仍未核验且密码未回显");

  step = "profile-edit-and-clear-optional-persona";
  const fbCardForProfile = page.locator(".media-account-card").filter({ hasText: fbLogin });
  await fbCardForProfile.getByRole("button", { name: "编辑识别资料", exact: true }).click();
  fbDisplayName = `Facebook资料已更正 ${suffix}`;
  await fbCardForProfile.getByLabel(`更正 ${fbLogin} 的识别名称`).fill(fbDisplayName);
  await fbCardForProfile.getByLabel(`更正 ${fbLogin} 的真实姓名`).fill("");
  const profileResponsePromise = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/profile") && r.request().method() === "POST");
  await fbCardForProfile.getByRole("button", { name: "保存资料修改", exact: true }).click();
  const profileResponse = await (await profileResponsePromise).json();
  assert.equal(profileResponse.account.displayName, fbDisplayName);
  assert.equal(profileResponse.account.loginIdentifier, fbLogin);
  assert.equal(profileResponse.account.persona, null);
  assert.equal(profileResponse.account.credential.state, "stored_unverified");
  await page.getByText("账号识别资料已更新；平台账号与登录核验状态未改变。", { exact: true }).waitFor();
  await page.locator(".media-account-card").filter({ hasText: fbLogin }).getByRole("heading", { name: fbDisplayName, exact: true }).waitFor();
  passed.push("真实Web更正账号识别名并清空可选资料，账号及核验状态仍保留");

  step = "unknown-ack-lookup-applied";
  const ytLogin = `media-yt-${suffix}@example.invalid`;
  const ytPassword = `NotARealPlatformSecret-${crypto.randomUUID()}`;
  const routePath = "**/api/operator/media-accounts";
  let dropped = false;
  await page.route(routePath, async route => {
    if (dropped || route.request().method() !== "POST") { await route.continue(); return; }
    dropped = true;
    const actual = await route.fetch();
    assert.equal(actual.status(), 201);
    await route.abort("failed");
  });
  const formForUnknown = page.locator(".media-account-form");
  step = "create-youtube-select-platform";
  await formForUnknown.locator('select[name="platform"]').selectOption("youtube");
  // Leave optional display name and real-person fields empty; client defaults
  // the display label to the login identifier without inventing a persona.
  step = "create-youtube-fill-login";
  await formForUnknown.getByLabel("登录账号", { exact: true }).fill(ytLogin);
  step = "create-youtube-fill-password";
  await formForUnknown.getByLabel("密码", { exact: true }).fill(ytPassword);
  step = "create-youtube-open-optional-persona";
  await ensureOptionalPersonaOpen(formForUnknown);
  step = "create-youtube-submit";
  await formForUnknown.getByRole("button", { name: "保存账号", exact: true }).click();
  step = "create-youtube-await-unknown-ack";
  await page.getByRole("group", { name: "未知操作恢复" }).getByRole("button", { name: "查询原操作" }).waitFor();
  const savedPending = await page.evaluate(() => sessionStorage.getItem("sg.media-accounts.pending.v1") ?? "");
  assert.equal(savedPending.includes(ytPassword), false);
  const recoveredAccountList = page.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/media-accounts" && r.request().method() === "GET");
  await page.getByRole("group", { name: "未知操作恢复" }).getByRole("button", { name: "查询原操作" }).click();
  await page.getByText(/原操作已提交/).waitFor();
  const recoveredAccounts = await (await recoveredAccountList).json();
  const recoveredAccount = recoveredAccounts.accounts.find((account: { loginIdentifier: string }) => account.loginIdentifier === ytLogin);
  assert.ok(recoveredAccount);
  assert.equal(recoveredAccount.displayName, ytLogin);
  assert.equal(recoveredAccount.persona, null);
  assert.equal(recoveredAccount.canonicalAccountRef, null);
  assert.equal(recoveredAccount.credential.state, "stored_unverified");
  const youtubeCard = page.locator(".media-account-card").filter({ hasText: ytLogin });
  await youtubeCard.locator("code").getByText(ytLogin, { exact: true }).waitFor();
  await page.unroute(routePath);
  assert.equal(await page.locator(".media-account-card").filter({ hasText: ytLogin }).count(), 1);
  passed.push("实际服务已提交但丢失响应后，查询原键确认同一账号，未重复创建");

  step = "refresh-secret-nonreadback";
  await page.reload();
  await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await openMediaAccounts();
  await page.getByText(fbLogin, { exact: true }).waitFor();
  const youtubeCardAfterReload = page.locator(".media-account-card").filter({ hasText: ytLogin });
  await youtubeCardAfterReload.locator("code").getByText(ytLogin, { exact: true }).waitFor();
  assert.equal(await page.getByText(fbPassword, { exact: true }).count(), 0);
  assert.equal(await page.getByText(ytPassword, { exact: true }).count(), 0);
  passed.push("刷新后列表仍可读账号状态，页面不回显密码");

  step = "credential-rotation-invalidation";
  const facebookCard = page.locator(".media-account-card").filter({ hasText: fbLogin });
  await facebookCard.getByRole("button", { name: "替换凭据", exact: true }).click();
  await facebookCard.getByLabel(`替换 ${fbDisplayName} 的密码`).fill(`Rotated-${crypto.randomUUID()}`);
  await facebookCard.getByRole("button", { name: "保存凭据", exact: true }).click();
  await page.getByText("凭据已替换并保存；平台登录仍未核验。", { exact: true }).waitFor();
  await facebookCard.getByText("凭据：已保存，未核验", { exact: true }).waitFor();
  passed.push("真实Web凭据轮换后状态仍显示未核验");
  await facebookCard.getByRole("button", { name: "使凭据失效", exact: true }).click();
  await page.getByText("本系统保存的凭据已失效；这不代表平台密码已修改或已退出登录。", { exact: true }).waitFor();
  await facebookCard.getByText("凭据：已失效", { exact: true }).waitFor();
  passed.push("真实Web凭据失效清楚区分本地秘密和平台密码状态");

  step = "project-account-phone-assignment";
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const projectName = `媒体账号验收筹备-${suffix}`;
  const workspace = page.locator(".project-workspace");
  await workspace.getByRole("button", { name: "新建项目" }).click();
  await workspace.getByLabel("项目名称").fill(projectName);
  await workspace.getByRole("button", { name: "创建筹备项目" }).click();
  await page.getByText(/基本信息已保存；仍在筹备/).waitFor();
  await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
  const projectSelect = page.getByLabel("筹备项目", { exact: true });
  const projectOption = projectSelect.locator("option").filter({ hasText: projectName });
  const projectId = await projectOption.getAttribute("value");
  assert.ok(projectId);
  const projectFacts = await chooseProjectAndReadAssignments(page, projectSelect, projectId);
  assert.equal(projectFacts.assignments.length, 0);
  await page.getByText("本项目尚无账号与手机分配。", { exact: true }).waitFor();
  if (projectFacts.eligibleDevices.length === 0) {
    await page.getByText("当前没有可分配手机。需要先通过产品支持的真实设备接入流程建立资源；此处不会创建或伪造手机记录。", { exact: true }).waitFor();
    blocked.push("本环境没有真实可分配手机；项目账号持久分配与竞争拒绝无法通过Web验收。未创建或播种手机事实。");
  } else {
    const accountCheck = page.getByRole("checkbox", { name: new RegExp(ytLogin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    const deviceSelect = page.locator('.media-accounts-workspace select[name="deviceId"]');
    await deviceSelect.waitFor();
    await deviceSelect.locator("option").nth(projectFacts.eligibleDevices.length).waitFor();
    assert.equal(await deviceSelect.locator("option").count(), projectFacts.eligibleDevices.length + 1);
    const deviceId = await deviceSelect.locator("option").nth(1).getAttribute("value");
    assert.ok(deviceId);
    const context = page.context();
    const competitor = await context.newPage();
    await competitor.goto(base); await competitor.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
    const competitorAccountsRead = competitor.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/media-accounts" && r.request().method() === "GET");
    await competitor.getByRole("button", { name: "媒体平台账号", exact: true }).click();
    await competitor.getByRole("heading", { name: "媒体平台账号", level: 1, exact: true }).waitFor();
    await competitorAccountsRead;
    const competitionProjectName = `媒体账号竞争验收-${suffix}`;
    await competitor.getByRole("button", { name: "项目", exact: true }).click();
    const competitorWorkspace = competitor.locator(".project-workspace");
    await competitorWorkspace.getByRole("button", { name: "新建项目" }).click();
    await competitorWorkspace.getByLabel("项目名称").fill(competitionProjectName);
    await competitorWorkspace.getByRole("button", { name: "创建筹备项目" }).click();
    await competitor.getByText(/基本信息已保存；仍在筹备/).waitFor();
    await competitor.getByRole("button", { name: "媒体平台账号", exact: true }).click();
    const competitorProjectSelect = competitor.getByLabel("筹备项目", { exact: true });
    const competitorOption = competitorProjectSelect.locator("option").filter({ hasText: competitionProjectName });
    const competitorProjectId = await competitorOption.getAttribute("value");
    assert.ok(competitorProjectId);
    const competitorProjectFacts = await chooseProjectAndReadAssignments(competitor, competitorProjectSelect, competitorProjectId);
    assert.equal(competitorProjectFacts.assignments.length, 0);
    await competitor.getByText("本项目尚无账号与手机分配。", { exact: true }).waitFor();
    assert.ok(competitorProjectFacts.eligibleDevices.some(device => device.deviceId.toLowerCase() === deviceId.toLowerCase()));
    const competitorDeviceSelect = competitor.locator('.media-accounts-workspace select[name="deviceId"]');
    await competitorDeviceSelect.waitFor();
    await competitorDeviceSelect.locator("option").nth(competitorProjectFacts.eligibleDevices.length).waitFor();
    assert.equal(await competitorDeviceSelect.locator("option").count(), competitorProjectFacts.eligibleDevices.length + 1);
    await competitorDeviceSelect.selectOption(deviceId);
    await competitor.getByRole("checkbox", { name: new RegExp(ytLogin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).check();
    const firstRefreshFactsPromise = readProjectAssignments(page, projectId);
    const competitorRefreshFactsPromise = readProjectAssignments(competitor, competitorProjectId);
    await Promise.all([
      page.locator(".media-accounts-workspace").getByRole("button", { name: "刷新", exact: true }).click(),
      competitor.locator(".media-accounts-workspace").getByRole("button", { name: "刷新", exact: true }).click(),
    ]);
    const [firstRefreshFacts, competitorRefreshFacts] = await Promise.all([firstRefreshFactsPromise, competitorRefreshFactsPromise]);
    assert.equal(firstRefreshFacts.assignments.length, 0);
    assert.equal(competitorRefreshFacts.assignments.length, 0);
    assert.ok(firstRefreshFacts.eligibleDevices.some(device => device.deviceId.toLowerCase() === deviceId.toLowerCase()));
    assert.ok(competitorRefreshFacts.eligibleDevices.some(device => device.deviceId.toLowerCase() === deviceId.toLowerCase()));
    await page.getByText("本项目尚无账号与手机分配。", { exact: true }).waitFor();
    await competitor.getByText("本项目尚无账号与手机分配。", { exact: true }).waitFor();
    const firstPost = page.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/resources/account-assignments" && r.request().method() === "POST");
    const secondPost = competitor.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/resources/account-assignments" && r.request().method() === "POST");
    await deviceSelect.selectOption(deviceId);
    await accountCheck.check();
    await Promise.all([
      page.getByRole("button", { name: "确认分配", exact: true }).click(),
      competitor.getByRole("button", { name: "确认分配", exact: true }).click(),
    ]);
    const [firstResult, secondResult] = await Promise.all([firstPost, secondPost]);
    assert.deepEqual([firstResult.status(), secondResult.status()].sort(), [201, 409]);
    const winner = firstResult.status() === 201 ? page : competitor;
    const loser = firstResult.status() === 409 ? page : competitor;
    await winner.getByText("账号与手机分配已持久保存；这不代表账号登录成功。", { exact: true }).waitFor();
    await loser.getByRole("alert").getByText(/资源状态已变化/).waitFor();
    await Promise.all([
      winner.locator(".media-accounts-workspace").getByRole("button", { name: "刷新", exact: true }).click(),
      loser.locator(".media-accounts-workspace").getByRole("button", { name: "刷新", exact: true }).click(),
    ]);
    await winner.getByText("本项目已占用：", { exact: false }).waitFor();
    await loser.getByText("本项目尚无账号与手机分配。", { exact: true }).waitFor();
    await loser.locator(".media-account-card").filter({ hasText: ytLogin }).getByText(/已占用/).waitFor();
    passed.push("真实Web分配竞争的201胜者随机确认；刷新两侧后只存在一条持久绑定，另一方保持未分配");
    await competitor.close();
  }

  step = "unknown-key-not-found-after-reload";
  // Simulate loss before the request reaches the product server. After reload,
  // only the non-secret command key survives; a not_found result cannot mint a
  // replacement key or retry a request whose password body was discarded.
  let stoppedBeforeServer = false;
  await page.route("**/api/operator/media-accounts", async route => {
    if (!stoppedBeforeServer && route.request().method() === "POST") {
      stoppedBeforeServer = true; await route.abort("failed"); return;
    }
    await route.continue();
  });
  const unrecoverableLogin = `media-unresolved-${suffix}@example.invalid`;
  const unresolvedForm = page.locator(".media-account-form");
  await unresolvedForm.locator('select[name="platform"]').selectOption("facebook");
  await unresolvedForm.getByLabel("登录账号", { exact: true }).fill(unrecoverableLogin);
  await unresolvedForm.getByLabel("密码", { exact: true }).fill(`NeverPersist-${crypto.randomUUID()}`);
  await unresolvedForm.getByRole("button", { name: "保存账号", exact: true }).click();
  await page.getByRole("group", { name: "未知操作恢复" }).waitFor();
  const unresolvedPending = await page.evaluate(() => sessionStorage.getItem("sg.media-accounts.pending.v1") ?? "");
  assert.equal(unresolvedPending.includes("NeverPersist"), false);
  let mobileRecoveryPosts = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/operator/media-accounts" && request.method() === "POST") mobileRecoveryPosts++; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("note").filter({ hasText: "手机端为只读模式" }).waitFor();
  const liveRecovery = page.getByRole("group", { name: "未知操作恢复" });
  await liveRecovery.getByRole("button", { name: "查询原操作" }).waitFor();
  assert.equal(await liveRecovery.getByRole("button", { name: "继续原请求" }).count(), 0);
  assert.equal(mobileRecoveryPosts, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.unroute("**/api/operator/media-accounts");
  await page.reload(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor(); await openMediaAccounts();
  const recovery = page.getByRole("group", { name: "未知操作恢复" });
  await recovery.getByRole("button", { name: "查询原操作" }).click();
  await page.getByText(/原键当前未查到结果，且原请求内容未保留/).waitFor();
  assert.equal(await recovery.getByRole("button", { name: "继续原请求" }).count(), 0);
  assert.equal(await page.getByText(unrecoverableLogin, { exact: true }).count(), 0);
  blocked.push("刷新后原键查无结果：只保留操作键、不保存密码，也不生成新键重建；需等权威回读或人工核对");
  passed.push("未知请求刷新恢复遵守不重复创建边界；窄屏在保留原请求闭包时不显示续接写按钮且无额外POST");

  // Screenshot only after clearing every password field and closing any temporary credential editor.
  await page.locator("input[type=password]").evaluateAll((nodes: HTMLInputElement[]) => nodes.forEach(input => { input.value = ""; }));
  await page.screenshot({ path: `${output}/media-accounts-desktop.png`, fullPage: true });
  step = "narrow-viewport";
  await page.setViewportSize({ width: 390, height: 844 });
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(width.content <= width.viewport + 1, "narrow viewport overflows horizontally");
  assert.equal(await page.locator(".media-account-form").count(), 0);
  assert.equal(await page.getByRole("button", { name: "保存账号", exact: true }).count(), 0);
  assert.equal(await page.getByRole("note").filter({ hasText: "手机端为只读模式" }).count(), 1);
  await page.screenshot({ path: `${output}/media-accounts-mobile.png`, fullPage: true });
  passed.push("390px窄屏无横向溢出；写操作遵守只读模式");
  assert.deepEqual(failed, []);
} catch (error) {
  failed.push(`${step}:${error instanceof Error ? error.name : "unknown-error"}`);
  const safeCount = async (locator: ReturnType<typeof page.locator>) => { try { return await locator.count(); } catch { return -1; } };
  const diagnostics = {
    urlPath: (() => { try { return new URL(page.url()).pathname; } catch { return "unavailable"; } })(),
    mediaNavButtonCount: await safeCount(page.getByRole("button", { name: "媒体平台账号", exact: true })),
    exactMediaHeadingCount: await safeCount(page.getByRole("heading", { name: "媒体平台账号", exact: true })),
    levelOneMediaHeadingCount: await safeCount(page.getByRole("heading", { name: "媒体平台账号", level: 1, exact: true })),
    mediaCreateFormCount: await safeCount(page.locator(".media-account-form")),
    loginFieldCount: await safeCount(page.getByLabel("登录账号", { exact: true })),
    passwordFieldCount: await safeCount(page.getByLabel("密码", { exact: true })),
    pageErrorCount,
    recentProductHttp: productHttp.slice(-8),
  };
  failureDiagnostics = diagnostics;
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ passed, blocked, failed, diagnostics: failureDiagnostics, secretValuesRecorded: false, platformLoginVerified: false, deviceActions: 0, publicationActions: 0 }, null, 2));
  console.log(JSON.stringify({ passed, blocked, failed }));
  await browser.close();
}
