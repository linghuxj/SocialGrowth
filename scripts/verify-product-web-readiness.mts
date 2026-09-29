import { chromium } from "playwright";

const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "SocialGrowth 正式产品" }).waitFor();
  await page.getByText("环境标识：product", { exact: true }).waitFor();
  console.log(`[playwright] product Web readiness passed at ${baseUrl}`);
} finally {
  await browser.close();
}
