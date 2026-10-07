// Read-only business smoke test against the actual deployed Web.
// The credential file stays outside Git; passwords never enter command arguments.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser | undefined;
let step = "configuration";
const output = resolve(process.env.SG_PRODUCT_DEPLOYMENT_OUTPUT ?? "artifacts/acceptance/deployment");
try {
  const url = process.env.SG_PRODUCT_WEB_URL;
  const file = process.env.SG_PRODUCT_DEPLOYMENT_LOGIN_FILE;
  if (!url || !file) throw new Error("configuration required");
  const input: unknown = JSON.parse(await readFile(file, "utf8"));
  if (typeof input !== "object" || input === null || !("loginName" in input) || !("password" in input)
    || typeof input.loginName !== "string" || typeof input.password !== "string") throw new Error("credentials required");
  await mkdir(output, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
  let errors = 0;
  page.on("pageerror", () => errors++);
  step = "open Web";
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await page.getByLabel("登录名").fill(input.loginName);
  await page.getByLabel("密码").fill(input.password);
  step = "login";
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).first().waitFor();
  step = "project view";
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("heading", { name: "项目列表", exact: true }).waitFor();
  await page.locator(".project-list-panel .empty-state, .project-list-panel tbody tr").first().waitFor();
  await page.screenshot({ path: resolve(output, "projects.png"), fullPage: true });
  step = "session reload";
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "退出登录", exact: true }).first().waitFor();
  step = "logout";
  await page.getByRole("button", { name: "退出登录", exact: true }).first().click();
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  if (errors) throw new Error("page errors");
  const result = { passed: true, url, checks: ["operator login", "project view", "session survives reload", "logout"], businessWrites: 0,
    limitations: "No cloud file, provider SMS, phone execution or public publishing acceptance" };
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({ passed: false, step, message: "Deployment Web verification failed; no credentials or raw browser errors are logged." }));
  process.exitCode = 1;
} finally { await browser?.close(); }
