import { chromium } from "playwright";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for product Web acceptance`);
  return value;
}

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const primaryLogin = required("SG_PRODUCT_TEST_LOGIN_NAME");
const primaryPassword = required("SG_PRODUCT_TEST_PASSWORD");
const secondaryLogin = required("SG_PRODUCT_TEST_SECOND_LOGIN_NAME");
const secondaryPassword = required("SG_PRODUCT_TEST_SECOND_PASSWORD");
const browser = await chromium.launch({ headless: true });

async function signIn(page: import("playwright").Page, loginName: string, password: string) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "运营账号管理" }).waitFor();
}

try {
  const primaryContext = await browser.newContext();
  const primary = await primaryContext.newPage();
  await signIn(primary, primaryLogin, primaryPassword);

  const csrfRecoveryPage = await primaryContext.newPage();
  await csrfRecoveryPage.goto(baseUrl, { waitUntil: "networkidle" });
  await csrfRecoveryPage.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await csrfRecoveryPage.getByText("请重新登录以恢复安全操作凭据").waitFor();
  await csrfRecoveryPage.close();

  await primary.getByLabel("登录名").fill(secondaryLogin);
  await primary.getByLabel("显示名").fill("Playwright Secondary Operator");
  await primary.getByLabel("初始密码").fill(secondaryPassword);
  await primary.getByRole("button", { name: "开通账号" }).click();
  await primary.getByText("运营账号已开通").waitFor();
  await primary.getByText(secondaryLogin, { exact: true }).waitFor();

  const secondaryContext = await browser.newContext();
  const secondary = await secondaryContext.newPage();
  await signIn(secondary, secondaryLogin, secondaryPassword);

  primary.once("dialog", (dialog) => void dialog.accept());
  const secondaryRow = primary.getByRole("row").filter({ hasText: secondaryLogin });
  await secondaryRow.getByRole("button", { name: "停用" }).click();
  await primary.getByText("账号已停用，会话已撤销").waitFor();
  await secondary.getByLabel("登录名").fill("revoked.session.probe");
  await secondary.getByLabel("显示名").fill("Revoked Session Probe");
  await secondary.getByLabel("初始密码").fill(secondaryPassword);
  await secondary.getByRole("button", { name: "开通账号" }).click();
  await secondary.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await secondary.getByText("登录已失效，请重新登录").waitFor();

  primary.once("dialog", (dialog) => void dialog.accept());
  const primaryRow = primary.getByRole("row").filter({ hasText: primaryLogin });
  await primaryRow.getByRole("button", { name: "停用" }).click();
  await primary.getByText("必须至少保留一个有效运营账号").waitFor();

  await primary.getByRole("button", { name: "退出登录" }).click();
  await primary.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await secondaryContext.close();
  await primaryContext.close();
  console.log(`[playwright] product operator flow passed at ${baseUrl}`);
} finally {
  await browser.close();
}
