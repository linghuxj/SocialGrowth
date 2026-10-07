import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: "zh-CN" });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("登录名").fill(required("SG_PRODUCT_TEST_LOGIN_NAME"));
  await page.getByLabel("密码").fill(required("SG_PRODUCT_TEST_PASSWORD"));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "邀请与接入" }).waitFor();
  await page.getByLabel("成功注册次数上限").fill("1");
  const expiry = new Date(Date.now() + 86_400_000);
  const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
  await page.getByLabel("有效至").fill(localExpiry);
  await page.getByRole("button", { name: "创建邀请" }).click();
  await page.getByRole("heading", { name: "邀请已创建" }).waitFor();
  const code = await page.getByLabel("共享码").inputValue();
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("Web did not expose one valid invitation code");
  const deepLink = `socialgrowth://provider/register?invitation=${encodeURIComponent(code)}`;
  const args = process.env.SG_PRODUCT_ADB_SERIAL
    ? ["-s", process.env.SG_PRODUCT_ADB_SERIAL, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deepLink]
    : ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deepLink];
  const opened = spawnSync("adb", args, { encoding: "utf8" });
  if (opened.status !== 0) throw new Error("Could not open invitation deep link on the test phone");
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  console.log("[playwright+adb] Created one real invitation through Web and opened it on the test phone; code withheld");
} finally {
  await browser.close();
}
