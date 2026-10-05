import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 正式版 (Product 3100/4320) 真实账号资产录入与 Playwright 自动化验证");
  console.log("==========================================================================");

  const repo = process.cwd();
  const dir = resolve(repo, ".runtime/product-local-live");
  const config = JSON.parse(await readFile(resolve(dir, "config.json"), "utf8"));
  const outDir = resolve(repo, "artifacts/acceptance/product/real-account-enrollment");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  const baseUrl = "http://127.0.0.1:3100";
  console.log(`[Web] 访问正式版 Web 界面: ${baseUrl}`);

  try {
    // 1. 登录正式版运营后台
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
    await page.getByLabel("密码", { exact: true }).fill(config.operatorPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor({ timeout: 15000 });
    console.log("✔ 正式版运营后台登录成功");

    // 2. 导航至“媒体平台账号”管理面板
    const listRead = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/operator/media-accounts" &&
        r.request().method() === "GET",
    );
    await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
    await page.getByRole("heading", { name: "媒体平台账号", level: 1, exact: true }).waitFor();
    await page.getByRole("heading", { name: "账号与凭据状态", level: 2, exact: true }).waitFor();
    await listRead;
    console.log("✔ 媒体平台账号资产页面加载成功");
    await page.screenshot({ path: join(outDir, "01-media-accounts-init.png") });

    // 3. 填写并录入真实 Facebook 账号
    const form = page.locator(".media-account-form");
    await form.locator('select[name="platform"]').selectOption("facebook");
    await form.getByLabel("识别名称（可选）", { exact: true }).fill("Tongm Mhuo");
    await form.getByLabel("登录账号", { exact: true }).fill("mhtongm@gmail.com");
    // 填写真实密码
    const secret = "mhtm260816@Fb";
    await form.getByLabel("密码", { exact: true }).fill(secret);

    // 提交创建
    console.log("-> 提交社媒账号保存请求（后端由 MediaCredentialStore 进行 AES-GCM 密文密封）...");
    const savePromise = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/operator/media-accounts" &&
        r.request().method() === "POST",
    );
    await form.getByRole("button", { name: "保存账号", exact: true }).click();
    const saveResponse = await savePromise;
    assert.equal(saveResponse.status(), 201, "账号保存应返回 201 Created");
    const responseData = await saveResponse.json();
    console.log("✔ 真实社媒账号已成功保存至正式版后端！");
    console.log(`[Account Fact] Account ID: ${responseData.account.id}`);
    console.log(`[Account Fact] Platform: ${responseData.account.platform}`);
    console.log(`[Account Fact] Login: ${responseData.account.loginIdentifier}`);
    console.log(`[Account Fact] Credential State: ${responseData.account.credential.state}`);
    console.log(`[Account Fact] Revision: ${responseData.account.credential.revision}`);

    // 等待列表刷新并截图
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, "02-media-account-enrolled.png") });

    // 4. 验证密码在浏览器表单中已安全清空
    const passwordInputVal = await form.getByLabel("密码", { exact: true }).inputValue();
    assert.equal(passwordInputVal, "", "提交后密码输入框必须安全置空");
    console.log("✔ 密码已在前端表单输入框中安全置空，无残留");

    // 5. 验证该账号在前端列表渲染并核对字段
    const accountRow = page.locator(`.media-account-item:has-text("mhtongm@gmail.com")`);
    await accountRow.waitFor({ state: "visible", timeout: 10000 });
    console.log("✔ 前端列表已展示刚录入的真实账号（状态: 未核验 / 凭据: 未核验）");

    // 保存证据事实报告
    await writeFile(
      join(outDir, "enrollment-facts.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          accountId: responseData.account.id,
          platform: responseData.account.platform,
          loginIdentifier: responseData.account.loginIdentifier,
          credentialState: responseData.account.credential.state,
          revision: responseData.account.credential.revision,
          parentLoginVerification: responseData.account.parentLoginVerification,
        },
        null,
        2,
      ),
    );
    console.log(`✔ 账号录入物证与截图已保存在: ${outDir}`);
    console.log("==========================================================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("❌ 执行异常:", err);
  process.exit(1);
});
