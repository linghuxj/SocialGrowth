import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { mediaAccountListResponseSchema } from "../product/contracts/src/index.js";

// Secrets arrive on stdin, never command arguments, screenshots or traces.
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
  if (Buffer.concat(chunks).includes(10)) break;
}
const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { platform: "facebook" | "youtube"; loginIdentifier: string; password: string };
for (const chunk of chunks) chunk.fill(0);
assert.ok(["facebook", "youtube"].includes(input.platform) && input.loginIdentifier && input.password);
const operator = JSON.parse(await readFile(process.env.SG_PRODUCT_DEPLOYMENT_LOGIN_FILE!, "utf8")) as { loginName: string; password: string };
const output = resolve(process.env.SG_PRODUCT_CREDENTIAL_OUTPUT ?? "output/playwright/core-flow-credential");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1465, height: 1074 } });
let step = "login";
try {
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "https://growth.mhtm.top", { waitUntil: "networkidle" });
  await page.getByLabel("登录名", { exact: true }).fill(operator.loginName);
  await page.getByLabel("密码", { exact: true }).fill(operator.password); operator.password = "";
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "运营工作台", exact: true }).waitFor();
  const initial = page.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/media-accounts" && r.request().method() === "GET");
  await page.getByRole("button", { name: "媒体平台账号", exact: true }).click();
  const response = await initial; assert.equal(response.status(), 200);
  const accounts = mediaAccountListResponseSchema.parse(await response.json()).accounts;
  const matches = accounts.filter(a => a.platform === input.platform && a.loginIdentifier?.toLowerCase() === input.loginIdentifier.toLowerCase());
  assert.ok(matches.length <= 1, "Ambiguous account registry; no duplicate writes");
  let changed = false;
  step = "credential_save";
  if (!matches.length) {
    const form = page.locator(".media-account-form");
    await form.locator('[name="platform"]').selectOption(input.platform);
    await form.locator('[name="loginIdentifier"]').fill(input.loginIdentifier);
    await form.locator('[name="password"]').fill(input.password);
    await form.getByRole("button", { name: "保存账号", exact: true }).click();
    changed = true;
  } else if (matches[0]!.credential?.state !== "stored_unverified") {
    const card = page.locator(".media-account-card").filter({ hasText: input.loginIdentifier });
    await card.getByRole("button", { name: matches[0]!.credential ? "替换凭据" : "保存凭据", exact: true }).click();
    await card.locator('.credential-actions input[autocomplete="username"]').fill(input.loginIdentifier);
    await card.locator('.credential-actions input[type="password"]').fill(input.password);
    await card.getByRole("button", { name: "保存凭据", exact: true }).click();
    changed = true;
  }
  input.password = "";
  const card = page.locator(".media-account-card").filter({ hasText: input.loginIdentifier });
  await card.getByText("凭据：已保存", { exact: false }).waitFor();
  step = "persisted_readback";
  const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === "/api/operator/media-accounts" && r.request().method() === "GET");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "账号与凭据状态", exact: true }) }).getByRole("button", { name: "刷新", exact: true }).click();
  const currentResponse = await refreshed; assert.equal(currentResponse.status(), 200);
  const current = mediaAccountListResponseSchema.parse(await currentResponse.json()).accounts.filter(a => a.platform === input.platform && a.loginIdentifier?.toLowerCase() === input.loginIdentifier.toLowerCase());
  assert.equal(current.length, 1); assert.equal(current[0]!.credential?.state, "stored_unverified");
  assert.equal(await page.locator('input[type="password"]').evaluateAll(nodes => nodes.every(node => !(node as HTMLInputElement).value)), true);
  await page.screenshot({ path: resolve(output, "credential-state.png") });
  const result = { passed: true, changed, platform: input.platform, accountId: current[0]!.accountId, credentialStored: true,
    credentialState: current[0]!.credential!.state, platformLoginVerified: current[0]!.parentLoginVerification === "verified", identityCount: current[0]!.publishingIdentities.length };
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({ passed: false, step, message: "Read original Web state before retrying; no secrets logged" }));
  process.exitCode = 1;
} finally { input.password = ""; operator.password = ""; await browser.close(); }
