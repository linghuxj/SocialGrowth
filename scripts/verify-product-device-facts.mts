import { chromium } from "playwright";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for WP-06 Web verification`);
  return value;
}

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const loginName = required("SG_PRODUCT_TEST_LOGIN_NAME");
const password = required("SG_PRODUCT_TEST_PASSWORD");
const screenshotPath = process.env.SG_PRODUCT_DEVICE_SCREENSHOT_PATH;
const mobileScreenshotPath = process.env.SG_PRODUCT_DEVICE_MOBILE_SCREENSHOT_PATH;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1465, height: 1074 },
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      browserErrors.push(message.text());
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入" }).waitFor();

  await page.getByRole("button", { name: "账号与设备" }).click();
  await page.getByRole("tab", { name: "手机" }).click();
  await page.getByRole("heading", { name: "手机资源" }).waitFor();
  await page.locator(".device-read-time").waitFor();
  await page.getByText("连接确认目前没有权威来源", { exact: false }).waitFor();
  const deviceRows = page.locator(".device-table tbody tr");
  const initialDeviceCount = await deviceRows.count();
  if (initialDeviceCount === 0) {
    await page.getByRole("heading", { name: "尚无已关联手机" }).waitFor();
  } else {
    await deviceRows.first().getByText("未知", { exact: true }).waitFor();
    await deviceRows.first().getByRole("button", { name: /查看 .* 详情/ }).click();
    await page.getByRole("heading", { name: /事实与接入状态/ }).waitFor();
  }

  const providerButtons = page.locator(".provider-choice");
  if (await providerButtons.count() > 0) {
    await providerButtons.first().click();
    await page.getByText("正在查看指定提供者的手机").waitFor();
    await page.getByRole("button", { name: "显示全部提供者" }).click();
  }
  await page.getByPlaceholder("搜索手机、提供者或手机号末四位").fill("不会存在的手机名称-000000");
  if (initialDeviceCount > 0) {
    await page.getByRole("heading", { name: "没有符合条件的手机" }).waitFor();
  }
  await page.getByPlaceholder("搜索手机、提供者或手机号末四位").fill("");
  await page.getByLabel("归属状态").selectOption("paused");
  await page.getByLabel("归属状态").selectOption("all");
  await page.locator(".device-filters").getByRole("button", { name: "刷新" }).click();
  await page.locator(".device-read-time").waitFor();

  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("手机端为只读模式").waitFor();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (horizontalOverflow) throw new Error("Device facts page overflows horizontally at 390px");
  await page.getByRole("heading", { name: "手机资源" }).waitFor();
  if (mobileScreenshotPath) await page.screenshot({ path: mobileScreenshotPath, fullPage: true });

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  if (await page.getByRole("heading", { name: "手机资源" }).count() !== 0) {
    throw new Error("Logged-out Web still displays the device facts view");
  }
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入" }).waitFor();
  if (await page.getByRole("heading", { name: "手机资源" }).count() !== 0) {
    throw new Error("New login restored a stale device facts view");
  }
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await context.close();
  console.log(`[playwright] WP-06 Web facts entry, filters, mobile layout, logout and re-login passed at ${baseUrl}`);
} finally {
  await browser.close();
}
