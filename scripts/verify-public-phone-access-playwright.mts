import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isIP } from "node:net";
import { chromium } from "playwright";

const base = "https://macbook-pro.tail3656e0.ts.net:8443";
// Pin the browser to the independently observed public ingress. A Tailnet-only
// MagicDNS resolution must not accidentally satisfy this public-access check.
const ingress = process.env.SG_PUBLIC_PHONE_INGRESS_IP ?? "";
assert.equal(isIP(ingress), 4);
assert.ok(!/^(127\.|10\.|192\.168\.|100\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ingress));
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "output/playwright/public-phone-access-20261006");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--no-proxy-server", `--host-resolver-rules=MAP macbook-pro.tail3656e0.ts.net ${ingress},EXCLUDE localhost`] });
const page = await browser.newPage({ viewport: { width: 430, height: 850 } });
try {
  const response = await page.goto(base, { waitUntil: "networkidle", timeout: 45_000 });
  assert.equal(response?.status(), 200);
  const address = await response?.serverAddr();
  assert.equal(address?.ipAddress, ingress, "Browser must use public ingress, not Tailnet routing");
  await page.getByRole("heading", { name: "手机接入服务", exact: true }).waitFor();
  await page.getByText("此地址可通过互联网访问，不需要先安装或登录 Tailscale。", { exact: true }).waitFor();
  const health = page.waitForResponse(r => r.url() === `${base}/health/live`);
  await page.getByRole("button", { name: "检查接入服务", exact: true }).click();
  assert.equal((await health).status(), 200);
  await page.getByRole("status").filter({ hasText: "接入服务可用。可以返回 SocialGrowth App 继续。" }).waitFor();
  assert.equal(await page.getByRole("status").getAttribute("data-result"), "passed");
  await page.screenshot({ path: resolve(output, "public-service-ready.png"), fullPage: true });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ at: new Date().toISOString(), url: base,
    publicIngress: address?.ipAddress, httpsVerified: true, actualPageAndButtonVerified: true,
    backendHealthVerified: true, registrationPerformed: false, networkAdmissionPerformed: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ event: "public_phone_service_verified", url: base, publicIngress: address?.ipAddress }));
} finally { await browser.close(); }
