import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Read current business facts through the real Web. This diagnostic does not
// certify publication, phone setup, or an end-to-end business outcome.
const projectName = process.env.SG_PRODUCT_CORE_PROJECT_NAME;
assert.ok(projectName, "Select the existing authorized project");
const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1");
const output = resolve(process.env.SG_PRODUCT_CORE_OUTPUT ?? "output/playwright/core-chain-20261006/status");
await mkdir(output, { recursive: true, mode: 0o700 });
const privateConfig = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
page.setDefaultTimeout(30_000);
const mutations: string[] = [], browserErrors: string[] = [], readFailures: { path: string; status: number }[] = [];
let signedIn = false;
page.on("response", response => {
  const path = new URL(response.url()).pathname;
  if (signedIn && response.request().method() === "GET" && path.startsWith("/api/operator/") && !response.ok()) readFailures.push({ path, status: response.status() });
});
page.on("request", request => {
  const path = new URL(request.url()).pathname;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !/\/operator\/(login|logout)$/.test(path)) mutations.push(path);
});
page.on("pageerror", () => browserErrors.push("pageerror"));
let step = "login";
const observations: Record<string, unknown> = {};
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(privateConfig.operatorPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace");
  const row = project.getByRole("row").filter({ has: page.getByText(projectName, { exact: true }) });
  await row.waitFor();
  signedIn = true;
  assert.equal(await row.count(), 1, "Project target must be unambiguous");
  await row.getByRole("button", { name: "打开项目", exact: true }).click();
  observations.project = { existingProjectOpened: true };
  step = "materials";
  await project.getByRole("button", { name: "素材", exact: true }).click();
  const inventory = page.getByRole("region", { name: "已保存的文件上传记录", exact: true });
  await inventory.waitFor();
  await inventory.getByText("原文件字节已校验", { exact: true }).first().waitFor();
  observations.materials = { originalBytesVerified: true, uploadRecords: await inventory.getByRole("listitem").count(), publicRightsVerified: false };
  await inventory.screenshot({ path: resolve(output, "materials.png") });
  if (process.env.SG_PRODUCT_CORE_CONTENT_NAME) {
    const clip = inventory.getByRole("listitem").filter({ hasText: "443193fb-5c6f-4346-bac2-6e03edc2842d" });
    assert.equal(await clip.count(), 1, "Keep the original authorized clip");
    await clip.getByRole("button", { name: "继续填写此文件资料", exact: true }).click();
    const editor = page.getByRole("region", { name: "素材资料详情", exact: true });
    const title = await editor.getByLabel("内容名称", { exact: true }).inputValue();
    assert.equal(title, process.env.SG_PRODUCT_CORE_CONTENT_NAME);
    observations.selectedClip = { objectId: "443193fb-5c6f-4346-bac2-6e03edc2842d", title, existingClipRetained: true };
    await editor.screenshot({ path: resolve(output, "selected-clip.png") });
  }
  step = "task conditions";
  const workflowRead = page.waitForResponse(r => r.request().method() === "GET" && /\/business-plan\/workflow$/.test(new URL(r.url()).pathname));
  await project.getByRole("button", { name: "排期与任务", exact: true }).click();
  const readiness = page.getByRole("region", { name: "计划任务当前条件", exact: true });
  await readiness.getByText(/发布准备状态：/).waitFor();
  const workflowResponse = await workflowRead;
  const workflowBody = await workflowResponse.json();
  observations.workflow = { httpStatus: workflowResponse.status(), ports: workflowBody.ports, tasks: workflowBody.tasks?.map((task: { workflow: { state: string; blockers: string[] } }) => ({ state: task.workflow.state, blockers: task.workflow.blockers })) };
  if (process.env.SG_PRODUCT_CORE_QUERY_ORIGINAL === "1") {
    const originalRead = page.waitForResponse(r => r.request().method() === "GET" && /\/tasks\/[^/]+\/preflight$/.test(new URL(r.url()).pathname));
    await readiness.getByRole("button", { name: "查询原核查状态", exact: true }).click();
    const originalResponse = await originalRead;
    const original = await originalResponse.json();
    observations.originalQuery = { httpStatus: originalResponse.status(), errorCode: original.error?.code,
      tasks: original.tasks?.map((task: { workflow: { state: string; blockers: string[] } }) => ({ state: task.workflow.state, blockers: task.workflow.blockers })) };
    await readiness.getByRole("button", { name: "查询原核查状态", exact: true }).waitFor();
  }
  const readinessText = await readiness.innerText();
  observations.execution = { preparationInProgress: /正在核验|正在检查|正在准备/.test(readinessText),
    prepared: readinessText.includes("发布准备已核对，尚未发布"), retryOffered: readinessText.includes("重新核验 Page 并继续准备"),
    publicPermission: /发布许可：关闭|公开发布：未开启|公开发布：关闭/.test(readinessText) ? "closed" : "unconfirmed", uncertaintyVisible: readinessText.includes("未知") };
  await readiness.screenshot({ path: resolve(output, "task-conditions.png") });
  step = "feedback";
  const feedbackRead = page.waitForResponse(r => r.request().method() === "GET" && /\/projects\/[^/]+\/feedback$/.test(new URL(r.url()).pathname));
  await project.getByRole("button", { name: "效果与复盘", exact: true }).click();
  const response = await feedbackRead;
  assert.ok(response.ok(), `Feedback GET HTTP ${response.status()}`);
  const feedback = await response.json();
  assert.ok(Array.isArray(feedback.metrics));
  const panel = page.getByRole("region", { name: "项目效果与复盘", exact: true });
  await panel.getByText(/当前没有可信复盘建议读取来源/).waitFor();
  const collectionRead = page.waitForResponse(r => r.request().method() === "GET" && /\/feedback\/collection$/.test(new URL(r.url()).pathname));
  await panel.getByRole("button", { name: "查询原采集状态", exact: true }).click();
  const collectionResponse = await collectionRead;
  const collectionBody = await collectionResponse.json();
  observations.feedback = { sourceState: feedback.sourceState, metricRows: feedback.metrics.length,
    contentMetricRows: feedback.metrics.filter((m: { subject: { kind: string } }) => m.subject.kind === "content").length,
    trustedReviewConnected: false, collectionHttpStatus: collectionResponse.status(),
    collectionState: collectionResponse.ok() ? collectionBody.collection?.state ?? "not_started" : "unavailable",
    collectionErrorCode: collectionResponse.ok() ? null : collectionBody?.error?.code ?? "unknown",
    realCollectionButtonVisible: await panel.getByRole("button", { name: "读取 Page 效果", exact: true }).isVisible() };
  await panel.screenshot({ path: resolve(output, "feedback.png"), mask: [panel.locator(".project-feedback__metric")] });
  assert.deepEqual(mutations, [], "Status diagnosis must not change business state");
  assert.deepEqual(browserErrors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ checkedAt: new Date().toISOString(), diagnosticPassed: true,
    coreChainAccepted: false, observations, readFailures, businessMutations: 0, browserErrors: 0 }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ diagnosticPassed: true, coreChainAccepted: false, observations, businessMutations: 0 }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure-redacted.png"), fullPage: true, mask: [page.getByLabel("密码", { exact: true })] });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ diagnosticPassed: false, coreChainAccepted: false, step,
    observations, businessMutations: mutations.length, error: error instanceof Error ? error.message : "unknown" }, null, 2), { mode: 0o600 });
  throw error;
} finally { await browser.close(); }
