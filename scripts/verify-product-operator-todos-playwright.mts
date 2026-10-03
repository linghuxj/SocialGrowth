import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const baseUrl = process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100";
const output = required("SG_PRODUCT_OPERATOR_TODOS_OUTPUT");
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));

async function signIn(target: Page): Promise<void> {
  await target.goto(baseUrl, { waitUntil: "networkidle" });
  await target.getByLabel("登录名", { exact: true }).fill(required("SG_PRODUCT_TEST_LOGIN_NAME"));
  await target.getByLabel("密码", { exact: true }).fill(required("SG_PRODUCT_TEST_PASSWORD"));
  await target.getByRole("button", { name: "登录", exact: true }).click();
  await target.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await target.getByRole("button", { name: "设备接入待办", exact: true }).click();
  await target.getByRole("heading", { name: "设备接入待办", exact: true, level: 1 }).waitFor();
}

try {
  await signIn(page);
  const panel = page.locator(".operator-todos");
  await panel.getByRole("heading", { name: "待办列表", exact: true }).waitFor();

  // Cause only a real browser transport failure, then restore the route and
  // re-read from the actual service. No response body or business result is mocked.
  await page.route("**/api/operator/assistance-todos?**", route => route.abort("failed"));
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  await page.unroute("**/api/operator/assistance-todos?**");
  const recoveredFeed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/operator/assistance-todos"
    && response.request().method() === "GET");
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  const recovered = await recoveredFeed;
  assert.ok(recovered.ok(), `actual assistance feed GET failed with ${recovered.status()}`);
  await panel.getByRole("button", { name: "刷新", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".operator-todos__header button")].find(item => item.textContent?.trim() === "刷新");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await panel.getByRole("alert").waitFor({ state: "hidden" });

  const rows = panel.locator(".operator-todos__row");
  const rowCount = await rows.count();
  let visibleItems = 0;
  if (rowCount === 0) {
    await panel.getByText("没有从设备事件或人工记录读取到事项；页面不会创建演示待办。", { exact: true }).waitFor();
  } else {
    await rows.first().click();
    await panel.getByRole("heading", { name: "协助事项记录", exact: true }).waitFor();
    await panel.getByText(/来源：未分配设备 · 网络接入协助/).waitFor();
    await panel.getByText(/影响设备/).waitFor();
    await panel.getByText("此事项只表示存在历史协助请求。未读到当前设备健康、现场执行或授权恢复结果。", { exact: true }).waitFor();
    const status = await panel.locator(".operator-todos__detail-head .operator-todos__status").innerText();
    assert.ok(["待处理", "等待复核"].includes(status));
    assert.equal(await panel.getByRole("button", { name: "接续原请求", exact: true }).count(), 0);
    visibleItems = 1;
  }

  for (const width of [980, 700, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `horizontal overflow at ${width}px`);
    if (width <= 700) {
      await panel.getByText("手机端只读；请在电脑提交运营说明。", { exact: true }).waitFor();
      assert.equal(await panel.locator(".operator-todos__form").count(), 0);
    }
    await page.screenshot({ path: `${output}/todos-${width}.png`, fullPage: true,
      mask: [panel.locator(".operator-todos__row"), panel.locator(".operator-todos__facts"), panel.locator(".operator-todos__note")] });
  }
  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), page: "operator device assistance todos", actualFeedItems: rowCount,
    detailReadOnlyVerified: visibleItems === 1, emptyStateVerified: rowCount === 0, transportFailureRecovery: true,
    mobileReadOnly: true, notesSubmitted: false, deviceRechecked: false, controlRestored: false, businessResolution: false,
    producerStatus: rowCount ? "real existing feed items read" : "no item returned by current producer" };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, scope: "actual Web operator todo empty/detail read, transport recovery and read-only viewport states", ...result }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure-redacted.png`, fullPage: true,
    mask: [page.getByLabel("密码", { exact: true }), page.locator(".operator-todos__row"), page.locator(".operator-todos__facts"), page.locator(".operator-todos__note")] });
  await writeFile(`${output}/failure.json`, JSON.stringify({ checkedAt: new Date().toISOString(), message: error instanceof Error ? error.message.split("\n")[0] : "UNCONFIRMED" }, null, 2), { mode: 0o600 });
  throw error;
} finally { await browser.close(); }
