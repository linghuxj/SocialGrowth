import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

async function main() {
  const repo = process.cwd();
  const dir = resolve(repo, ".runtime/product-local-live");
  const config = JSON.parse(await readFile(resolve(dir, "config.json"), "utf8"));
  const outDir = resolve(repo, "artifacts/acceptance/product/page-preparation");
  await mkdir(outDir, { recursive: true });

  const baseUrl = "http://127.0.0.1:3100";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  page.on("console", msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", err => console.error(`[Browser PageError]`, err));
  page.on("response", res => {
    if (res.status() >= 400) {
      console.log(`[Browser HTTP ${res.status()}] ${res.url()}`);
    }
  });

  console.log("-> 登录正式版 Web 运营后台 http://127.0.0.1:3100 ...");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(config.operatorPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor({ timeout: 15000 });
  console.log("✔ 登录成功");

  console.log("-> 进入项目列表...");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.waitForTimeout(1000);

  const headingList = page.getByRole("heading", { name: "项目列表", level: 1, exact: true });
  if (await headingList.isVisible()) {
    await page.locator("tr", { hasText: "霸道总裁北美短剧出海" }).first().getByRole("button", { name: "准备清单" }).click();
  }
  await page.getByRole("heading", { name: "霸道总裁北美短剧出海", level: 1 }).waitFor();

  console.log("-> 切换到【设置 · 目标与周期】面板...");
  await page.getByRole("button", { name: "设置 · 目标与周期" }).click();
  await page.getByRole("heading", { name: "发布身份初始化", level: 3 }).waitFor();

  console.log("-> 点击【读取初始化记录】...");
  await page.getByRole("button", { name: "读取初始化记录" }).click();
  await page.waitForTimeout(2000);

  const shot = join(outDir, "05-web-page-preparation-evidence.png");
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`✔ Web 证据截图已保存: ${shot}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Web 验证失败:", err);
  process.exit(1);
});
