import assert from "node:assert/strict";
import { chromium, type Page, type Route } from "playwright";

import { fetchCapturedBrowserRequest } from "./product-playwright-safe-fetch.mjs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function deferred(): { promise: Promise<void>; release(): void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function signIn(page: Page, loginName: string, password: string): Promise<void> {
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入" }).waitFor();
}

async function openDevices(page: Page): Promise<void> {
  await page.getByRole("button", { name: "账号与设备" }).click();
  await page.getByRole("tab", { name: "手机" }).click();
  await page.getByRole("heading", { name: "手机资源" }).waitFor();
}

async function waitForInterception(signal: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Old-session device read was not intercepted within 10 seconds")), 10_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const firstName = required("SG_PRODUCT_TEST_LOGIN_NAME");
const firstPassword = required("SG_PRODUCT_TEST_PASSWORD");
const secondName = required("SG_PRODUCT_TEST_SECOND_LOGIN_NAME");
const secondPassword = required("SG_PRODUCT_TEST_SECOND_PASSWORD");
assert.notEqual(firstName, secondName, "Identity race requires two distinct legal operator accounts");

const browser = await chromium.launch({ headless: true });
const releaseOldRead = deferred();
try {
  const context = await browser.newContext({ locale: "zh-CN" });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await signIn(page, firstName, firstPassword);
  await page.getByRole("button", { name: "账号与设备" }).click();
  await page.getByRole("heading", { name: "运营账号管理" }).waitFor();
  const secondOperatorRow = page.getByRole("row").filter({ has: page.getByText(secondName, { exact: true }) });
  if (await secondOperatorRow.count() === 0) {
    await page.getByLabel("登录名").fill(secondName);
    await page.getByLabel("显示名").fill("WP06 Identity Race Second");
    await page.getByLabel("初始密码").fill(secondPassword);
    await page.getByRole("button", { name: "开通账号" }).click();
    await page.getByText("运营账号已开通").waitFor();
    await secondOperatorRow.waitFor();
  }

  const intercepted = deferred();
  let holdFirstRead = true;
  const holdOldRequest = async (route: Route): Promise<void> => {
    if (!holdFirstRead) { await route.continue(); return; }
    holdFirstRead = false;
    const originalHeaders = await route.request().allHeaders();
    assert.ok(originalHeaders.cookie, "browser request did not carry the original operator session");
    intercepted.release();
    await releaseOldRead.promise;
    // Forward the browser's captured original headers after its server session is revoked.
    // The backend, not the test, determines whether this old request is a 401.
    const response = await fetchCapturedBrowserRequest(route, originalHeaders);
    assert.equal(response.status(), 401, "intercepted old-session request did not receive a real backend 401");
    await route.fulfill({ response });
  };
  await page.route("**/api/operator/device-facts", holdOldRequest);
  await openDevices(page);
  await waitForInterception(intercepted.promise);

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await signIn(page, secondName, secondPassword);

  const newRead = page.waitForResponse((response) =>
    response.url().includes("/api/operator/device-facts") && response.status() === 200,
  );
  await openDevices(page);
  await newRead;
  await page.locator(".device-refresh").getByText("刷新").waitFor();
  const newReadLabel = await page.locator(".device-read-time").textContent();
  assert.ok(newReadLabel, "new identity had no completed device read");

  const old401 = page.waitForResponse((response) =>
    response.url().includes("/api/operator/device-facts") && response.status() === 401,
  );
  releaseOldRead.release();
  await old401;
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByRole("heading", { name: "登录正式产品" }).count(), 0,
    "old 401 returned the new identity to login");
  assert.equal(await page.locator(".device-error").count(), 0, "old 401 replaced the new identity's successful read");
  assert.equal(await page.locator(".device-read-time").textContent(), newReadLabel,
    "old 401 changed the new identity's device facts");
  await page.unroute("**/api/operator/device-facts", holdOldRequest);

  // A real UI mutation proves the new login's CSRF capability survived the old 401.
  await page.getByRole("button", { name: "提供者与分佣" }).click();
  await page.getByRole("button", { name: "创建邀请" }).click();
  await page.getByRole("heading", { name: "邀请已创建" }).waitFor();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  console.log("[playwright] Real old-session 401 arrived after new operator's 200; new UI and CSRF-backed invitation creation survived");
} finally {
  releaseOldRead.release();
  await browser.close();
}
