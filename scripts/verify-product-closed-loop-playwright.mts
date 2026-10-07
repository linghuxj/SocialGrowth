import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const name = process.env.SG_PRODUCT_CLOSED_LOOP_PROJECT_NAME;
assert.ok(name, "An existing authorized test project is required; never seed business success");
const output = resolve(process.env.SG_PRODUCT_CLOSED_LOOP_OUTPUT ?? "output/playwright/closed-loop-20261005/workbench");
await mkdir(output, { recursive: true });
const password = process.env.SG_PRODUCT_TEST_PASSWORD ?? JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")).operatorPassword;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
const checks: string[] = [], errors: string[] = [], businessWrites: string[] = [];
page.on("pageerror", () => errors.push("pageerror"));
page.on("request", request => {
  const path = new URL(request.url()).pathname;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !/\/operator\/(login|logout)$/.test(path)) businessWrites.push(path);
});
try {
  await page.goto(base);
  await page.getByLabel("登录名", { exact: true }).fill(process.env.SG_PRODUCT_TEST_LOGIN_NAME ?? "device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace");
  await project.getByRole("row").filter({ has: page.getByText(name, { exact: true }) }).getByRole("button", { name: "打开项目", exact: true }).click();
  await project.getByRole("button", { name: "AI 自动化总控", exact: true }).click();
  const flow = page.getByRole("region", { name: "项目任务执行与复核闭环", exact: true });
  await flow.getByText("服务未连接，任务不具备派发条件", { exact: true }).waitFor();
  await flow.getByText("核验器未连接，结果保持未知", { exact: true }).waitFor();
  await flow.getByText("当前排期没有可显示的任务记录", { exact: true }).waitFor();
  await flow.getByText(/效果数据来源尚未接入/).waitFor();
  checks.push("新测试项目真实读取：无任务、执行与核验未连接；复盘延期，不显示假成功");
  await flow.screenshot({ path: resolve(output, "workflow-current.png") });

  const pattern = "**/api/operator/projects/*/business-plan/workflow";
  await page.route(pattern, route => route.abort("failed"));
  await flow.getByRole("button", { name: "重新读取闭环", exact: true }).click();
  await flow.getByText("任务闭环事实读取失败；这不代表项目没有任务或一切正常。", { exact: true }).waitFor();
  await flow.getByText(/以下为上次读取结果/).waitFor();
  await page.unroute(pattern);
  await flow.getByRole("button", { name: "重试读取", exact: true }).click();
  await flow.getByText(/以下为上次读取结果/).waitFor({ state: "hidden" });
  checks.push("真实GET中断保留历史标识，重试恢复当前结果");

  await flow.getByRole("button", { name: "查看排期与任务", exact: true }).click();
  const readiness = page.getByRole("region", { name: "计划任务当前条件", exact: true });
  await readiness.getByText("执行许可：关闭 · 发布许可：关闭", { exact: true }).waitFor();
  checks.push("闭环页面实际导航至当前任务条件，许可仍关闭");
  await project.getByRole("button", { name: "素材", exact: true }).click();
  const inventory = page.getByRole("region", { name: "已保存的文件上传记录", exact: true });
  await inventory.getByText("原文件字节已校验", { exact: true }).first().waitFor();
  assert.ok(await inventory.getByRole("listitem").count());
  await inventory.screenshot({ path: resolve(output, "original-file-receipts.png") });
  checks.push("本项目原件上传记录在新的浏览器会话仍可见，未冒充素材准入");
  const receipt = inventory.getByRole("listitem").filter({ hasText: "443193fb-5c6f-4346-bac2-6e03edc2842d" });
  await receipt.getByRole("button", { name: "继续填写此文件资料", exact: true }).click();
  const editor = project.getByRole("region", { name: "素材资料详情", exact: true });
  await editor.getByText(/文件版本只读：443193fb-5c6f-4346-bac2-6e03edc2842d/).waitFor();
  assert.equal(await editor.getByLabel("语言标签", { exact: true }).inputValue(), "");
  assert.equal(await editor.getByLabel("来源主体标识 UUID", { exact: true }).inputValue(), "");
  assert.equal(await editor.getByRole("checkbox", { name: /我已人工确认/ }).isChecked(), false);
  const draft = JSON.parse(await readFile("output/playwright/closed-loop-20261005/test-brief.json", "utf8"));
  await editor.getByLabel("业务类型", { exact: true }).selectOption("drama");
  await editor.getByLabel("内容名称", { exact: true }).fill(draft.draftTitle);
  await editor.getByLabel("内容说明", { exact: true }).fill(draft.draftDescription);
  await editor.screenshot({ path: resolve(output, "continue-original-test-draft.png") });
  checks.push("已上传原文件可继续填写内部草稿；来源与语言未知、首次使用未代填，不重传或保存业务事实");

  await project.getByRole("button", { name: "AI 自动化总控", exact: true }).click();
  await flow.getByRole("heading", { name: "任务执行与复核", exact: true }).waitFor();
  for (const width of [980, 700, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width <= 700) await page.getByText("手机端为只读模式", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `page overflow at ${width}`);
    await page.screenshot({ path: resolve(output, `workflow-${width}.png`), fullPage: true });
  }
  checks.push("980/700/390px均可读，窄屏只读且无整页横向溢出");
  assert.deepEqual(errors, []); assert.deepEqual(businessWrites, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "passed", projectName: name, checks, businessWrites: 0,
    physicalExecution: "blocked: trusted runtime and verification are unconnected", publication: false,
    nonemptyTaskOrRecoveryUi: "not verified on this empty real test project", effectReview: "deferred until real data" }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, businessWrites: 0, physicalExecution: "blocked", publication: false }));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ result: "failed", checks, businessWrites: businessWrites.length, error: error instanceof Error ? error.message : "unknown" }, null, 2));
  throw error;
} finally { await browser.close(); }
