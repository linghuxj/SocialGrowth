import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
assert.equal(new URL(base).hostname, "127.0.0.1", "Local authorized test only");
const projectId = process.env.SG_PRODUCT_CORE_PROJECT_ID;
const objectId = process.env.SG_PRODUCT_CORE_OBJECT_ID;
assert.ok(projectId && objectId, "Existing authorized project and original upload required");
const projectName = process.env.SG_PRODUCT_CORE_PROJECT_NAME;
assert.ok(projectName);
const output = resolve(process.env.SG_PRODUCT_CORE_OUTPUT ?? "output/playwright/core-materials-20261006");
await mkdir(output, { recursive: true });
const password = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")).operatorPassword;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
const checks: string[] = [], errors: string[] = [];
let step = "login";
page.on("pageerror", () => errors.push("pageerror"));
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace");
  await project.getByRole("row").filter({ has: page.getByText(projectName, { exact: true }) }).getByRole("button", { name: "打开项目", exact: true }).click();
  let analysis: unknown = null;
  if (process.env.SG_PRODUCT_CORE_ONLY_REUSE !== "1") {
  await project.getByRole("button", { name: "素材", exact: true }).click();
  step = "original upload";
  const inventory = page.getByRole("region", { name: "已保存的文件上传记录", exact: true });
  const receipt = inventory.getByRole("listitem").filter({ hasText: objectId });
  await receipt.getByRole("button", { name: "继续填写此文件资料", exact: true }).click();
  const editor = page.getByRole("region", { name: "素材资料详情", exact: true });
  step = "real AI analysis";
  const analyzed = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/${objectId}/analyze`) && r.request().method() === "POST", { timeout: 90000 });
  await editor.getByRole("button", { name: "AI 提取切片信息", exact: true }).click();
  await editor.getByRole("button", { name: "正在分析切片…", exact: true }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "保存素材资料", exact: true }).isEnabled(), false);
  const response = await analyzed;
  assert.equal(response.ok(), true, `analysis HTTP ${response.status()}`);
  const result = await response.json();
  analysis = result;
  assert.equal(result.projectId, projectId); assert.equal(result.objectId, objectId);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.output.title && result.output.summary && result.output.limitations.length);
  await editor.getByRole("button", { name: "应用到素材资料", exact: true }).click();
  assert.equal(await editor.getByLabel("内容名称", { exact: true }).inputValue(), result.output.title.replace(/\s+/g, " ").trim());
  assert.ok(await editor.getByLabel("语言标签", { exact: true }).inputValue());
  checks.push("真实原件抽帧及 Artemis 模型提取成功，点击应用后才填入表单；分析中禁止保存");
  step = "save material without invented source";
  await editor.getByLabel("业务类型", { exact: true }).selectOption("drama");
  const saved = page.waitForResponse(r => new URL(r.url()).pathname.includes("materials") && r.request().method() === "POST" && !new URL(r.url()).pathname.endsWith("/analyze"));
  await editor.getByRole("button", { name: "保存素材资料", exact: true }).click();
  const saveResponse = await saved;
  assert.equal(saveResponse.ok(), true, `save HTTP ${saveResponse.status()}`);
  await project.getByText(/已保存 1 项，0 项仍需处理/).waitFor();
  checks.push("来源、来源证明和集序留空，保存内容资料；没有代填首次发布事实");
  await editor.screenshot({ path: resolve(output, "material-desktop.png") });
  }
  step = "reuse existing resources";
  await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
  await page.getByLabel("筹备项目", { exact: true }).selectOption(projectId);
  const reuse = page.getByRole("button", { name: "移用已有账号到所选项目", exact: true });
  if (await reuse.count()) {
    const moved = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/reuse-preparing-resources") && r.request().method() === "POST");
    await reuse.click();
    const movedResponse = await moved; assert.equal(movedResponse.ok(), true, `resource reuse HTTP ${movedResponse.status()}`);
    await page.getByText("已有账号、手机和发布身份已移用到当前项目；原账号资料与历史记录保留。", { exact: true }).waitFor();
    checks.push("Web 实际移用既有账号、手机与 Page 身份，保留原账号与历史");
  } else {
    await page.getByText(/本项目已占用：/).waitFor();
    checks.push("Web 读取已移用资源，不重复迁移或新增账号");
  }
  await page.reload();
  await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
  await page.getByLabel("筹备项目", { exact: true }).selectOption(projectId);
  await page.getByText(/本项目已占用：/).waitFor();
  checks.push("刷新后新项目仍占用原账号与手机");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  if (process.env.SG_PRODUCT_CORE_OLD_PROJECT_NAME) {
    await project.getByRole("row").filter({ has: page.getByText(process.env.SG_PRODUCT_CORE_OLD_PROJECT_NAME, { exact: true }) }).getByRole("button", { name: "打开项目", exact: true }).click();
    await project.getByRole("button", { name: "AI 自动化总控", exact: true }).click();
    await page.getByRole("region", { name: "AI 自动化总控", exact: true }).getByText("已读取 3 行报告快照；请核对指标名称、覆盖时间与内容归因后判断效果。", { exact: true }).waitFor();
    checks.push("资源移用后，旧项目原有三行效果快照仍可从真实Web读取");
    await project.getByRole("button", { name: "返回项目列表", exact: true }).click();
  }
  await project.getByRole("row").filter({ has: page.getByText(projectName, { exact: true }) }).getByRole("button", { name: "打开项目", exact: true }).click();
  await project.getByRole("button", { name: "素材", exact: true }).click();
  await page.getByRole("region", { name: "已保存的文件上传记录", exact: true }).getByRole("listitem").filter({ hasText: objectId }).getByRole("button", { name: "继续填写此文件资料", exact: true }).click();
  const persistedEditor = page.getByRole("region", { name: "素材资料详情", exact: true });
  assert.ok(await persistedEditor.getByLabel("内容名称", { exact: true }).inputValue());
  assert.ok(await persistedEditor.getByLabel("内容说明", { exact: true }).inputValue());
  await persistedEditor.getByText("补充来源与关联资料（选填）", { exact: true }).click();
  assert.equal(await persistedEditor.getByLabel("来源主体标识 UUID（选填）", { exact: true }).inputValue(), "");
  assert.equal(await persistedEditor.getByRole("checkbox", { name: /已确认此成品此前未发布/ }).isChecked(), false);
  await persistedEditor.getByText("补充来源与关联资料（选填）", { exact: true }).click();
  await persistedEditor.screenshot({ path: resolve(output, "material-persisted-desktop.png") });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  await page.screenshot({ path: resolve(output, "material-390.png"), fullPage: true });
  checks.push("保存后的内容与未知来源状态可读取；390px只读、无整页横向溢出");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "passed", checks, projectId, objectId, modelAnalysis: analysis, publication: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, publication: false }));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "failed", step, checks, error: error instanceof Error ? error.message : "unknown" }, null, 2));
  console.error(JSON.stringify({ passed: false, step }));
  throw error;
} finally { await browser.close(); }
