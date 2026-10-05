import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const required = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} required`); return v; };
const output = required("SG_PRODUCT_PROJECT_SCREENSHOT_DIR"), base = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } }), page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("登录名").fill(required("SG_PRODUCT_TEST_LOGIN_NAME")); await page.getByLabel("密码").fill(required("SG_PRODUCT_TEST_PASSWORD"));
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("button", { name: "项目", exact: true }).click();
  const panel = page.locator(".project-workspace"), row = panel.getByRole("row").filter({ hasText: "运营A待保存版本" }); await row.waitFor();
  await row.getByRole("button", { name: "打开项目", exact: true }).click(); await panel.getByRole("heading", { name: "打开项目", exact: true }).waitFor();
  await page.screenshot({ path: `${output}/readiness-desktop.png` }); await page.screenshot({ path: `${output}/readiness-full.png`, fullPage: true });
  for (const width of [980, 700, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    if (width <= 700) {
      await page.getByText("手机端为只读模式", { exact: true }).waitFor();
      assert.equal(await panel.getByRole("button", { name: "保存基本信息" }).count(), 0);
      const box = await panel.getByRole("cell", { name: /缺阶段目标及批准边界，不启动发布/ }).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, "Mobile must expose impact text without horizontal table scrolling");
    }
    await page.screenshot({ path: `${output}/readiness-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, scope: "existing real saved project viewport regression", widths: [1465,980,700,390], mobileImpactVisible: true, unexpectedBrowserErrors: 0, mutations: "login only; no project changes" }));
} finally { await browser.close(); }
