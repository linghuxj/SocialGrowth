import assert from "node:assert/strict";
import { chromium, type Page, type Route } from "playwright";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function login(page: Page, name: string, password: string): Promise<void> {
  await page.getByLabel("登录名").fill(name);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入" }).waitFor();
}

async function openDevices(page: Page): Promise<void> {
  await page.getByRole("button", { name: "账号与设备" }).click();
  await page.getByRole("tab", { name: "手机" }).click();
  await page.getByRole("heading", { name: "手机资源" }).waitFor();
}

function deferred(): { promise: Promise<void>; release(): void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function settleUi(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const primaryName = required("SG_PRODUCT_TEST_LOGIN_NAME");
const primaryPassword = required("SG_PRODUCT_TEST_PASSWORD");
const secondaryName = process.env.SG_PRODUCT_SECONDARY_LOGIN_NAME;
const secondaryPassword = process.env.SG_PRODUCT_SECONDARY_PASSWORD;
if (Boolean(secondaryName) !== Boolean(secondaryPassword)) {
  throw new Error("Provide both secondary operator credentials or neither");
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: "zh-CN" });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await login(page, primaryName, primaryPassword);

  // Fault injection changes only transport behavior; every success still comes from the live backend.
  let failFirstRead = true;
  const failFirst = async (route: Route): Promise<void> => {
    if (failFirstRead) {
      failFirstRead = false;
      await route.abort("failed");
    } else await route.continue();
  };
  await page.route("**/api/operator/device-facts", failFirst);
  await openDevices(page);
  await page.locator(".device-error").waitFor();
  await page.getByRole("button", { name: "重试读取" }).click();
  await page.locator(".device-read-time").waitFor();
  await page.unroute("**/api/operator/device-facts", failFirst);

  const lateFailure = deferred();
  const interceptedFailure = deferred();
  let delayFirstRead = true;
  const delayAndFail = async (route: Route): Promise<void> => {
    if (delayFirstRead) {
      delayFirstRead = false;
      interceptedFailure.release();
      await lateFailure.promise;
      await route.abort("failed");
    } else await route.continue();
  };
  await page.route("**/api/operator/device-facts", delayAndFail);
  await page.getByRole("tab", { name: "运营账号" }).click();
  await page.getByRole("tab", { name: "手机" }).click();
  await interceptedFailure.promise;
  await page.getByRole("tab", { name: "运营账号" }).click();
  const newerRead = page.waitForResponse((response) =>
    response.url().includes("/api/operator/device-facts") && response.status() === 200,
  );
  await page.getByRole("tab", { name: "手机" }).click();
  await newerRead;
  await page.locator(".device-refresh").getByText("刷新").waitFor();
  assert.equal(await page.locator(".device-error").count(), 0);
  const oldFailureObserved = page.waitForEvent("requestfailed", (request) =>
    request.url().includes("/api/operator/device-facts"),
  );
  lateFailure.release();
  await oldFailureObserved;
  await settleUi(page);
  assert.equal(await page.locator(".device-error").count(), 0, "late failure replaced the newer successful read");
  await page.unroute("**/api/operator/device-facts", delayAndFail);

  if (secondaryName && secondaryPassword) {
    const lateUnauthorized = deferred();
    const interceptedUnauthorized = deferred();
    let delayOldIdentityRead = true;
    const delayOldRead = async (route: Route): Promise<void> => {
      if (delayOldIdentityRead) {
        delayOldIdentityRead = false;
        const originalHeaders = await route.request().allHeaders();
        interceptedUnauthorized.release();
        await lateUnauthorized.promise;
        await route.continue({ headers: originalHeaders });
      } else await route.continue();
    };
    await page.route("**/api/operator/device-facts", delayOldRead);
    await page.getByRole("tab", { name: "运营账号" }).click();
    await page.getByRole("tab", { name: "手机" }).click();
    await interceptedUnauthorized.promise;
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
    await login(page, secondaryName, secondaryPassword);
    await openDevices(page);
    await page.locator(".device-read-time").waitFor();
    const oldResponse = page.waitForResponse((response) =>
      response.url().includes("/api/operator/device-facts") && response.status() === 401,
    );
    lateUnauthorized.release();
    await oldResponse;
    await settleUi(page);
    await page.getByRole("heading", { name: "手机资源" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "登录正式产品" }).count(), 0);
    await page.locator(".device-filters").getByRole("button", { name: "刷新" }).click();
    await page.locator(".device-read-time").waitFor();
    await page.unroute("**/api/operator/device-facts", delayOldRead);
  }

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  console.log(`[playwright] Live Web device read error/retry and late failure passed; old 401/new login: ${secondaryName ? "passed" : "not run (secondary credentials absent)"}`);
} finally {
  await browser.close();
}
