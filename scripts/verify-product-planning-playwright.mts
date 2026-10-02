import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
// Reproducible REAL UI draft scope. Never run to bypass a policy refusal;
// admin admission must first be restored. Synthetic text here proves only
// unapproved draft UI persistence, never actual approved business direction.
const required = (key: string) => { const v = process.env[key]; if (!v) throw new Error(`${key} is required`); return v; };
const login = required("SG_PRODUCT_TEST_LOGIN_NAME"), password = required("SG_PRODUCT_TEST_PASSWORD"), output = required("SG_PRODUCT_PLANNING_SCREENSHOT_DIR");
await mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1464, height: 1074 } });
try {
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror")); await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill(login); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click(); const project = page.locator(".project-workspace"), name = `未批准草案UI验收-${Date.now()}`;
  await project.getByRole("button", { name: "新建项目" }).click(); await project.getByLabel("项目名称").fill(name); await project.getByRole("button", { name: "创建筹备项目" }).click();
  await project.getByText(/基本信息已保存；仍在筹备/).waitFor(); await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  const planner = page.getByRole("region", { name: "项目目标与周期草案" }); await planner.getByText(/项目版本 \d+，草案版本 0/).waitFor({ timeout: 10_000 });
  assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), ""); assert.equal(await planner.getByLabel("目标语言标签（逗号分隔）").inputValue(), "");
  const goal = "合成验收输入：草案不构成正式批准"; await planner.getByLabel("正式开通前阶段目标").fill(goal);
  await planner.getByRole("checkbox", { name: "Facebook 图文", exact: true }).check();
  assert.equal(await planner.getByRole("checkbox", { name: "Facebook 图文", exact: true }).isChecked(), true);
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click(); await planner.getByLabel("业务时区", { exact: true }).selectOption("Asia/Shanghai");
  await planner.getByLabel("复盘间隔（天）", { exact: true }).fill("01"); await planner.getByRole("button", { name: "保存全部草案" }).click(); await planner.getByText(/请核对文本、非重复国家/).waitFor();
  assert.equal(await planner.getByLabel("复盘间隔（天）", { exact: true }).inputValue(), "01");
  await planner.getByLabel("复盘间隔（天）", { exact: true }).fill("7"); await planner.getByLabel("项目每周期引流最低任务数").fill("0");
  await planner.getByRole("button", { name: "保存全部草案" }).click(); await planner.getByText("目标与周期草案已保存，尚未批准；没有生成排期、开启周期或派发任务。", { exact: true }).waitFor();
  await planner.getByRole("button", { name: "目标与范围", exact: true }).click(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), goal);
  await planner.getByLabel("正式开通前阶段目标").fill("尚未保存的本人输入"); await project.getByRole("button", { name: "概览", exact: true }).click();
  await project.getByRole("button", { name: "设置 · 目标与周期" }).click(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), "尚未保存的本人输入");
  await planner.getByRole("button", { name: "刷新当前草案" }).click(); await planner.getByRole("region", { name: "当前草案核对" }).waitFor(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), "尚未保存的本人输入");
  await planner.getByRole("button", { name: "放弃本次输入" }).click(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), goal);
  await page.screenshot({ path: `${output}/planning-unapproved-desktop.png`, fullPage: true });
  await page.reload(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor(); await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "准备清单" }).click(); await project.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await planner.getByText(/草案版本 1/).waitFor(); assert.equal(await planner.getByLabel("正式开通前阶段目标").inputValue(), goal);
  assert.equal(await planner.getByRole("checkbox", { name: "Facebook 图文", exact: true }).isChecked(), true);
  await planner.getByRole("button", { name: "周期与观察", exact: true }).click(); assert.equal(await planner.getByLabel("项目每周期引流最低任务数").inputValue(), "0");
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByText("手机端为只读模式", { exact: true }).waitFor();
  assert.equal(await planner.getByRole("button", { name: "保存全部草案" }).count(), 0); assert.equal(await planner.getByLabel("业务时区", { exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false); await page.screenshot({ path: `${output}/planning-unapproved-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, scope: "real unapproved planning draft UI / persistence / retained inputs / readonly", actualApproval: "not tested", actualAI: "not tested", Artemis: "not tested" }));
} catch (error) {
  // Only the synthetic planning panel; never login values, invitation codes,
  // cookies, network headers or backend response bodies.
  const planner = page.getByRole("region", { name: "项目目标与周期草案" });
  if (await planner.count()) {
    await writeFile(`${output}/planning-failure-panel.txt`, await planner.innerText());
    await planner.screenshot({ path: `${output}/planning-failure-panel.png` });
  }
  throw error;
} finally { await browser.close(); }
