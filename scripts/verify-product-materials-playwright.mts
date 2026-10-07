import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { chromium } from "playwright";
import { fetchCapturedBrowserRequest } from "./product-playwright-safe-fetch.mjs";

// Run ONLY after the administrator has restored browser-policy access. This
// script is a reproducible UI acceptance target, never a policy workaround.
// No request routing, backend calls, database seeds or fake business results.
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const login = required("SG_PRODUCT_TEST_LOGIN_NAME"), password = required("SG_PRODUCT_TEST_PASSWORD");
const file = required("SG_PRODUCT_MATERIAL_TEST_FILE"), output = required("SG_PRODUCT_MATERIAL_SCREENSHOT_DIR");
const details = JSON.parse(required("SG_PRODUCT_MATERIAL_TEST_DECLARATION")) as Record<string, string>;
for (const key of ["name", "language", "businessEntityId", "sourceId", "sourceRecordId", "description", "businessFacts", "sourceStatement", "sourceEvidenceIds"]) {
  if (typeof details[key] !== "string" || !details[key]) throw new Error(`Missing human-confirmed declaration field ${key}`);
}
if (!isAbsolute(file) || !(await stat(file)).isFile()) throw new Error("Explicit actual test file required");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const releaseOld = deferred(), releaseAfterAdoption = deferred();
function deferred() { let release!: () => void; const promise = new Promise<void>(yes => { release = yes; }); return { promise, release }; }
async function reached(promise: Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_yes, no) => { timeout = setTimeout(() => no(new Error("Material read interception deadline exceeded")), 10_000); })]); }
  finally { clearTimeout(timeout); }
}
try {
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1487, height: 1058 } }), errors: string[] = [], scopeReads: { path: string; status: number }[] = [], scopeRequests: { path: string; failure?: string }[] = [], operatorReads: { method: string; path: string; status?: number; failure?: string; finishedMs?: number }[] = [], started = new Map<string, number>();
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/operator/projects/")) {
      const key = `${request.method()} ${path}`; started.set(key, Date.now());
      operatorReads.push({ method: request.method(), path: path.split("/").slice(-2).join("/") });
    }
  });
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/\/direction$|\/planning-draft$/.test(path)) scopeRequests.push({ path: path.split("/").at(-1)! });
  });
  page.on("requestfailed", request => {
    const path = new URL(request.url()).pathname;
    const api = operatorReads.findLast(entry => entry.path === path.split("/").slice(-2).join("/") && !entry.status && !entry.failure);
    if (api) api.failure = request.failure()?.errorText ?? "unknown";
    const matching = scopeRequests.findLast(entry => entry.path === path.split("/").at(-1)! && !entry.failure);
    if (matching) matching.failure = request.failure()?.errorText ?? "unknown";
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    const api = operatorReads.findLast(entry => entry.path === path.split("/").slice(-2).join("/") && !entry.status && !entry.failure);
    if (api) api.status = response.status();
    if (/\/direction$|\/planning-draft$/.test(path)) scopeReads.push({ path: path.split("/").at(-1)!, status: response.status() });
  });
  page.on("requestfinished", request => {
    const path = new URL(request.url()).pathname, key = `${request.method()} ${path}`, began = started.get(key);
    const api = operatorReads.findLast(entry => entry.path === path.split("/").slice(-2).join("/") && !entry.finishedMs);
    if (api && began !== undefined) api.finishedMs = Date.now() - began;
  });
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill(login); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace"), name = `素材页面验收-${Date.now()}`;
  await project.getByRole("button", { name: "新建项目" }).click(); await project.getByLabel("项目名称").fill(name);
  await project.getByRole("button", { name: "创建筹备项目" }).click(); await project.getByText(/基本信息已保存；仍在筹备/).waitFor();
  await project.getByRole("button", { name: "素材", exact: true }).click();
  const material = page.getByRole("region", { name: "项目素材", exact: true });
  await material.locator('input[type="file"]').setInputFiles(file);
  await material.getByRole("button", { name: "上传／重试原文件", exact: true }).click();
  await material.getByText("文件字节已校验", { exact: true }).waitFor();
  await material.getByRole("button", { name: "预览／资料", exact: true }).click();
  const editor = material.getByRole("region", { name: "素材资料详情" });
  try { await editor.getByText("尚无可用于素材核验的已确认方向；资料仍可保存为待检查。", { exact: true }).waitFor(); }
  catch (error) {
    await writeFile(`${output}/scope-read-failure.json`, JSON.stringify({ operatorReads, scopeRequests, scopeReads, editorText: await editor.innerText(), error: error instanceof Error ? error.name : "unknown" }, null, 2));
    await page.screenshot({ path: `${output}/scope-read-failure.png`, fullPage: true });
    throw error;
  }
  assert.equal(await editor.getByRole("checkbox", { name: "我已按上述当前范围检查这份成品及其内容规则" }).count(), 0);
  await editor.getByLabel("内容名称", { exact: true }).fill(details.name!); await editor.getByLabel("语言标签", { exact: true }).fill(details.language!);
  await editor.getByLabel("成品类型").selectOption(details.mediaKind ?? "image_text"); await editor.getByLabel("业务类型").selectOption(details.businessKind ?? "product");
  for (const [label, key] of [["内容说明", "description"], ["业务事实", "businessFacts"], ["来源声明", "sourceStatement"], ["已有来源证明记录标识（逗号分隔 UUID）", "sourceEvidenceIds"], ["商品／短剧业务标识 UUID", "businessEntityId"], ["来源主体标识 UUID", "sourceId"], ["原成品来源记录 UUID", "sourceRecordId"]]) await editor.getByLabel(label!, { exact: true }).fill(details[key!]!);
  await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await editor.getByText("请人工确认首次使用声明；文件上传不能代替来源确认。", { exact: true }).waitFor();
  await editor.getByRole("checkbox", { name: "我已人工确认：此成品此前未发布；声明不等于系统核验通过" }).check();
  await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await material.getByText("已保存 1 项，0 项仍需处理。候选状态按当前素材与批准范围读取；发布许可仍关闭。", { exact: true }).waitFor();
  await material.getByText("资料已保存 v1 · 待检查：项目尚无已确认的方向与范围。", { exact: true }).waitFor();
  await editor.getByRole("heading", { name: "当前待检查" }).waitFor();
  await editor.getByText("发布许可：未开启。候选状态不派发任务，也不代表外部来源或权利已验证。", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/material-saved.png`, fullPage: true });
  // C1-READ-01: only delay real browser GET acknowledgements. A second actual
  // Web session saves v2; no API writes, DB seeds or synthetic success replies.
  await editor.getByLabel("内容说明", { exact: true }).fill(`${details.description}；本人未保存草稿`);
  const firstFetched = deferred(), thirdFetched = deferred(); let reads = 0;
  const path = "**/api/operator/projects/*/materials/*";
  await page.route(path, async route => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    const ordinal = ++reads;
    const response = await fetchCapturedBrowserRequest(route, await route.request().allHeaders());
    assert.equal(response.status(), 200);
    const facts = await response.json() as { currentRevision: number };
    if (ordinal === 1) { assert.equal(facts.currentRevision, 1); firstFetched.release(); await releaseOld.promise; }
    if (ordinal === 3) { assert.equal(facts.currentRevision, 2); thirdFetched.release(); await releaseAfterAdoption.promise; }
    await route.fulfill({ response });
  });
  await editor.getByRole("button", { name: "读取当前版本核对" }).click(); await reached(firstFetched.promise);
  const other = await browser.newPage({ locale: "zh-CN", viewport: { width: 1487, height: 1058 } });
  await other.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await other.getByLabel("登录名", { exact: true }).fill(login); await other.getByLabel("密码", { exact: true }).fill(password);
  await other.getByRole("button", { name: "登录", exact: true }).click(); await other.getByRole("button", { name: "提供者邀请", exact: true }).click(); await other.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await other.getByRole("button", { name: "项目", exact: true }).click();
  await other.locator(".project-workspace").getByRole("row").filter({ hasText: name }).getByRole("button", { name: "打开项目" }).click();
  await other.locator(".project-workspace").getByRole("button", { name: "素材", exact: true }).click();
  const otherMaterial = other.getByRole("region", { name: "项目素材", exact: true });
  await otherMaterial.getByRole("button", { name: "预览／资料", exact: true }).click();
  const otherEditor = otherMaterial.getByRole("region", { name: "素材资料详情" });
  await otherEditor.getByLabel("内容说明", { exact: true }).fill(`${details.description}；另一会话已保存版本2`);
  await otherEditor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await otherMaterial.getByText("资料已保存 v2 · 待检查：项目尚无已确认的方向与范围。", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "读取当前版本核对" }).click();
  await editor.getByRole("heading", { name: "当前保存 v2", exact: true }).waitFor();
  const oldDelivered = page.waitForResponse(response => /\/materials\/[a-f0-9-]+$/.test(new URL(response.url()).pathname));
  releaseOld.release(); await oldDelivered; await page.waitForLoadState("networkidle");
  assert.equal(await editor.getByRole("heading", { name: "当前保存 v2", exact: true }).count(), 1);
  assert.equal(await editor.getByRole("heading", { name: "当前保存 v1", exact: true }).count(), 0);
  await editor.getByRole("button", { name: "读取当前版本核对" }).click(); await reached(thirdFetched.promise);
  await editor.getByRole("button", { name: "已核对，采用最新版本" }).click();
  const retiredDelivered = page.waitForResponse(response => /\/materials\/[a-f0-9-]+$/.test(new URL(response.url()).pathname));
  releaseAfterAdoption.release(); await retiredDelivered; await page.waitForLoadState("networkidle");
  assert.equal(await editor.locator(".project-conflict").count(), 0, "Adopted baseline must not be reopened by an in-flight acknowledgement");
  assert.equal(await editor.getByLabel("内容说明", { exact: true }).inputValue(), `${details.description}；本人未保存草稿`);
  await page.screenshot({ path: `${output}/material-read-race.png`, fullPage: true });
  await page.unroute(path); await other.close();
  await page.reload(); await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "打开项目" }).click();
  await project.getByRole("button", { name: "素材", exact: true }).click();
  await material.getByText("资料已保存 v2 · 待检查：项目尚无已确认的方向与范围。", { exact: true }).waitFor();
  await material.getByRole("button", { name: "预览／资料" }).click(); assert.equal(await editor.getByLabel("内容名称", { exact: true }).inputValue(), details.name);
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await material.locator('input[type="file"]').count(), 0); assert.equal(await material.getByRole("button", { name: "保存本条／接续原请求" }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.screenshot({ path: `${output}/material-readonly-mobile.png`, fullPage: true }); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, scope: "project creation / actual file / human declaration / saved pending_validation / real v1-after-v2 read race / adoption retires read / reload / mobile readonly", candidateAdmission: "not tested", Artemis: "not tested" }));
} finally { releaseOld.release(); releaseAfterAdoption.release(); await browser.close(); }
