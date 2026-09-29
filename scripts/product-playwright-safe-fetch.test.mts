import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, type Route } from "playwright";

import { fetchCapturedBrowserRequest } from "./product-playwright-safe-fetch.mjs";

test("transport failures do not retain captured Cookie values or raw Playwright call logs", async () => {
  const fakeToken = "fake-session-token-for-log-redaction-check";
  const fakeRoute = {
    fetch: async ({ headers }: { headers: Record<string, string> }) => {
      throw new Error(`request failed; Call log: cookie: ${headers.cookie}`);
    },
  } as unknown as Route;
  let message = "";
  try {
    await fetchCapturedBrowserRequest(fakeRoute, { cookie: `sg_operator_session=${fakeToken}` });
  } catch (error) {
    assert.ok(error instanceof Error);
    message = error.message;
    assert.equal(error.cause, undefined);
  }
  assert.equal(message, "Old-session browser request forwarding failed");
  assert.equal(message.includes(fakeToken), false);
  assert.equal(message.includes("Call log"), false);
});

test("real Playwright fetch failure with a fake browser Cookie reports only a sanitized error", async () => {
  const fakeToken = "fake-playwright-browser-cookie-do-not-log";
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: "sg_operator_session", value: fakeToken, url: "http://127.0.0.1:1" }]);
    const page = await context.newPage();
    let capturedMessage = "";
    await page.route("**/*", async (route) => {
      const headers = await route.request().allHeaders();
      assert.ok(headers.cookie?.includes(fakeToken));
      try {
        await fetchCapturedBrowserRequest(route, headers);
      } catch (error) {
        assert.ok(error instanceof Error);
        capturedMessage = error.message;
        assert.equal(error.cause, undefined);
        await route.abort("failed");
      }
    });
    await page.goto("http://127.0.0.1:1/unreachable").catch(() => {});
    assert.equal(capturedMessage, "Old-session browser request forwarding failed");
    assert.equal(capturedMessage.includes(fakeToken), false);
    assert.equal(capturedMessage.includes("Call log"), false);
    await context.close();
  } finally {
    await browser.close();
  }
});
