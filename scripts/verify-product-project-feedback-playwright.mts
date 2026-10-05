import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const output = required("SG_PRODUCT_PROJECT_FEEDBACK_OUTPUT");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", () => errors.push("pageerror"));

async function signIn(target: Page): Promise<void> {
  await target.goto(baseUrl, { waitUntil: "networkidle" });
  await target.getByLabel("登录名", { exact: true }).fill(required("SG_PRODUCT_TEST_LOGIN_NAME"));
  await target.getByLabel("密码", { exact: true }).fill(required("SG_PRODUCT_TEST_PASSWORD"));
  await target.getByRole("button", { name: "登录", exact: true }).click();
  await target.getByRole("button", { name: "提供者邀请", exact: true }).click(); await target.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
}

const projectListResponse = (target: Page) => target.waitForResponse(response =>
  response.request().method() === "GET" && new URL(response.url()).pathname === "/api/operator/projects");
const feedbackResponse = (target: Page, projectId: string) => target.waitForResponse(response =>
  response.request().method() === "GET"
  && new URL(response.url()).pathname === `/api/operator/projects/${projectId}/feedback`);
const projectPanel = page.locator(".project-workspace");
const feedbackPanel = page.locator(".project-feedback");

try {
  await signIn(page);
  const projectsRead = projectListResponse(page);
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const projectsResponse = await projectsRead;
  assert.ok(projectsResponse.ok(), `actual project list GET returned ${projectsResponse.status()}`);
  const projectPayload = await projectsResponse.json() as { projects?: Array<{ projectId: string }> };
  assert.ok(Array.isArray(projectPayload.projects), "actual project list response has no projects array");
  let projects = projectPayload.projects;
  let createdProjectThroughUI = false;
  let selectedProjectId: string;
  if (projects.length === 0) {
    // Isolated-runner fixture created through the real project form; no
    // identity, metric, report or positive effectiveness fact is added.
    await projectPanel.getByRole("button", { name: "新建项目", exact: true }).click();
    await projectPanel.getByLabel("项目名称", { exact: true }).fill("工程反馈验收筹备项目");
    const createResponseWait = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/operator/projects");
    await projectPanel.getByRole("button", { name: "创建筹备项目", exact: true }).click();
    const createResponse = await createResponseWait;
    assert.ok(createResponse.ok(), `actual project form POST returned ${createResponse.status()}`);
    const createBody = await createResponse.json() as { project?: { projectId?: string } };
    assert.ok(typeof createBody.project?.projectId === "string");
    selectedProjectId = createBody.project.projectId;
    projects = [{ projectId: selectedProjectId }];
    createdProjectThroughUI = true;
  } else {
    selectedProjectId = projects[0]!.projectId;
    await projectPanel.getByRole("button", { name: "打开项目", exact: true }).first().click();
  }
  {
    const assertProjectFeedback = async (projectId: string) => {
      const responseWait = feedbackResponse(page, projectId);
      await page.getByRole("button", { name: "效果与复盘", exact: true }).click();
      const response = await responseWait;
      assert.ok(response.ok(), `actual project feedback GET returned ${response.status()}`);
      const body = await response.json() as { projectId?: string; sourceState?: string; metrics?: unknown[] };
      assert.equal(body.projectId?.toLowerCase(), projectId.toLowerCase(), "feedback response belongs to selected project");
      assert.ok(["available", "not_configured", "unknown", "unavailable"].includes(body.sourceState ?? ""));
      assert.ok(Array.isArray(body.metrics));
      await feedbackPanel.getByRole("heading", { name: /已读取权威快照|效果来源尚未接入|效果来源当前不可用|暂无权威来源报告/ }).waitFor();
      await feedbackPanel.getByText("内容级效果归因未知：尚缺已核验任务与平台实际发布内容的可信关联。账号级数据不会拆分到单条内容，也不会用于跨来源比较。", { exact: true }).waitFor();
      if (body.metrics.length === 0) {
        await feedbackPanel.getByText("目前没有可展示的报告行；这不代表指标为零、内容无效果或采集完整。", { exact: true }).waitFor();
      }
      return body;
    };

    const firstProjectId = selectedProjectId;
    const first = await assertProjectFeedback(firstProjectId);

    // Exercise an actual browser transport failure, then recover through a fresh
    // UI-triggered GET. No business response or metric value is fabricated.
    const feedbackRoute = "**/api/operator/projects/*/feedback";
    await page.route(feedbackRoute, route => route.abort("failed"));
    await feedbackPanel.getByRole("button", { name: "刷新反馈事实", exact: true }).click();
    await feedbackPanel.getByRole("alert").waitFor();
    await page.unroute(feedbackRoute);
    const recoveredRead = feedbackResponse(page, firstProjectId);
    await feedbackPanel.getByRole("button", { name: "重试读取", exact: true }).click();
    const recovered = await recoveredRead;
    assert.ok(recovered.ok(), `actual recovered feedback GET returned ${recovered.status()}`);
    await feedbackPanel.getByRole("heading", { name: /已读取权威快照|效果来源尚未接入|效果来源当前不可用|暂无权威来源报告/ }).waitFor();

    let switchedProject = false;
    if (projects.length > 1) {
      await projectPanel.getByRole("button", { name: "返回项目列表", exact: true }).click();
      await projectPanel.getByRole("button", { name: "打开项目", exact: true }).nth(1).click();
      const second = await assertProjectFeedback(projects[1]!.projectId);
      assert.equal(second.projectId?.toLowerCase(), projects[1]!.projectId.toLowerCase());
      switchedProject = true;
    }

    for (const width of [980, 700, 390]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `horizontal overflow at ${width}px`);
      await page.screenshot({ path: `${output}/feedback-${width}.png`, fullPage: true, mask: [
        page.getByLabel("密码", { exact: true }),
        feedbackPanel.locator(".project-feedback__metric"),
        feedbackPanel.locator(".project-feedback__facts"),
        feedbackPanel.locator(".project-feedback__footnote"),
      ] });
    }
    assert.deepEqual(errors, []);
    const result = { checkedAt: new Date().toISOString(), actualProjects: projects.length,
      feedbackSourceState: first.sourceState, feedbackMetricRows: first.metrics.length,
      projectScopedRead: true, switchedProjectVerified: switchedProject,
      transportFailureRecovery: true, viewportWidths: [980, 700, 390], browserErrors: 0,
      createdProjectThroughUI, syntheticMetrics: 0, contentAttribution: "unknown" };
    await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result));
  }
} catch {
  await page.screenshot({ path: `${output}/failure-redacted.png`, fullPage: true, mask: [
    page.getByLabel("密码", { exact: true }),
    feedbackPanel.locator(".project-feedback__metric"),
    feedbackPanel.locator(".project-feedback__facts"),
    feedbackPanel.locator(".project-feedback__footnote"),
  ] });
  await writeFile(`${output}/failure.json`, JSON.stringify({ checkedAt: new Date().toISOString(), failure: "browser acceptance assertion failed; raw error omitted" }, null, 2), { mode: 0o600 });
  throw new Error("Project feedback Playwright acceptance failed; see redacted failure artifact");
} finally { await browser.close(); }
