import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { chromium } from "playwright";

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
try {
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1487, height: 1058 } }), errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill(login); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
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
  await editor.getByLabel("内容名称", { exact: true }).fill(details.name!); await editor.getByLabel("语言标签", { exact: true }).fill(details.language!);
  await editor.getByLabel("成品类型").selectOption(details.mediaKind ?? "image_text"); await editor.getByLabel("业务类型", { exact: true }).selectOption(details.businessKind ?? "product");
  for (const [label, key] of [["内容说明", "description"], ["业务事实", "businessFacts"], ["来源声明", "sourceStatement"], ["已有来源证明记录标识（逗号分隔 UUID）", "sourceEvidenceIds"], ["商品／短剧业务标识 UUID", "businessEntityId"], ["来源主体标识 UUID", "sourceId"], ["原成品来源记录 UUID", "sourceRecordId"]]) await editor.getByLabel(label!, { exact: true }).fill(details[key!]!);
  await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await editor.getByText("请人工确认首次使用声明；文件上传不能代替来源确认。", { exact: true }).waitFor();
  await editor.getByRole("checkbox", { name: "我已人工确认：此成品此前未发布；声明不等于系统核验通过" }).check();
  await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
  await material.getByText("已保存 1 项，0 项仍需处理。保存结果仅为待检查，不代表候选或发布。", { exact: true }).waitFor();
  await material.getByText("资料已保存 v1 · 待检查", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/material-saved.png`, fullPage: true });
  await page.reload(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click();
  await project.getByRole("button", { name: "素材", exact: true }).click();
  await material.getByText("资料已保存 v1 · 待检查", { exact: true }).waitFor();
  await material.getByRole("button", { name: "预览／资料" }).click(); assert.equal(await editor.getByLabel("内容名称", { exact: true }).inputValue(), details.name);
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await material.locator('input[type="file"]').count(), 0); assert.equal(await material.getByRole("button", { name: "保存本条／接续原请求" }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.screenshot({ path: `${output}/material-readonly-mobile.png`, fullPage: true }); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, scope: "project creation / actual file / human declaration / saved pending_validation / reload / mobile readonly", candidateAdmission: "not tested", Artemis: "not tested" }));
} finally { await browser.close(); }
