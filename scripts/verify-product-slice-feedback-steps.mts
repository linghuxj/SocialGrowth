import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright";
import { projectFeedbackResponseSchema } from "../product/contracts/src/metric-feedback.ts";

// Browser steps shared with the existing core-execution verification entry.
// Analysis is deliberately not applied/saved: preserve the original task scope.
export async function revalidateSliceAndFeedback(page: Page, project: Locator, output: string) {
  const projectId = process.env.SG_PRODUCT_CORE_PROJECT_ID;
  const objectId = process.env.SG_PRODUCT_CORE_OBJECT_ID;
  assert.ok(projectId && objectId);
  const unexpectedWrites: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method()) && !new URL(request.url()).pathname.endsWith("/analyze"))
      unexpectedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await project.getByRole("button", { name: "素材", exact: true }).click();
  const inventory = page.getByRole("region", { name: "已保存的文件上传记录", exact: true });
  const upload = inventory.getByRole("listitem").filter({ hasText: objectId });
  await upload.getByRole("button", { name: "继续填写此文件资料", exact: true }).click();
  const editor = page.getByRole("region", { name: "素材资料详情", exact: true });
  const originalTitle = await editor.getByLabel("内容名称", { exact: true }).inputValue();
  const originalDescription = await editor.getByLabel("内容说明", { exact: true }).inputValue();
  assert.ok(originalTitle && originalDescription, "Saved clip information must persist");
  const analyzed = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/${objectId}/analyze`), { timeout: 120000 });
  await editor.getByRole("button", { name: "AI 提取切片信息", exact: true }).click();
  const response = await analyzed;
  assert.ok(response.ok(), `Real clip analysis HTTP ${response.status()}`);
  const analysis = await response.json();
  assert.equal(analysis.projectId, projectId); assert.equal(analysis.objectId, objectId);
  assert.equal(analysis.sha256, "6564ad3fd4573e103b66e32ace7455dac41ee8ca4f00c640f129a4a97db347ac");
  assert.ok(analysis.durationSeconds > 0 && analysis.width > 0 && analysis.height > 0);
  assert.ok(analysis.output.title && analysis.output.summary && analysis.output.limitations.length);
  await editor.getByRole("button", { name: "应用到素材资料", exact: true }).waitFor();
  assert.equal(await editor.getByLabel("内容名称", { exact: true }).inputValue(), originalTitle);
  assert.equal(await editor.getByLabel("内容说明", { exact: true }).inputValue(), originalDescription);
  await editor.screenshot({ path: resolve(output, "clip-analysis.png") });

  await project.getByRole("button", { name: "效果与复盘", exact: true }).click();
  const feedback = page.getByRole("region", { name: "项目效果与复盘", exact: true });
  const refreshRead = page.waitForResponse(response => response.request().method() === "GET"
    && new URL(response.url()).pathname === `/api/operator/projects/${projectId}/feedback`);
  await feedback.getByRole("button", { name: "刷新反馈事实", exact: true }).click();
  const feedbackResponse = await refreshRead;
  assert.ok(feedbackResponse.ok(), `Feedback HTTP ${feedbackResponse.status()}`);
  const facts = projectFeedbackResponseSchema.parse(await feedbackResponse.json());
  assert.equal(facts.projectId, projectId);
  if (facts.metrics.length === 0) await feedback.getByText("目前没有可展示的报告行；这不代表指标为零、内容无效果或采集完整。", { exact: true }).waitFor();
  await feedback.screenshot({ path: resolve(output, "feedback-desktop.png") });
  await page.setViewportSize({ width: 390, height: 950 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await feedback.screenshot({ path: resolve(output, "feedback-390.png") });
  await page.setViewportSize({ width: 1465, height: 1074 });
  await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
  await page.getByLabel("筹备项目", { exact: true }).selectOption(projectId);
  await page.getByText(/本项目已占用：/).waitFor();
  assert.equal(await page.getByRole("button", { name: "移用已有账号到所选项目", exact: true }).count(), 0);
  assert.deepEqual(unexpectedWrites, [], "Revalidation must not alter material, binding or task revisions");
  await writeFile(resolve(output, "slice-feedback-facts.json"), JSON.stringify({ checkedAt: new Date().toISOString(), projectId,
    objectId, analysis, accountReservation: "existing_resource_retained", pageBinding: "not_verified_original_audit_unknown",
    feedback: facts, publication: false, unexpectedWrites }, null, 2), { mode: 0o600 });
}
