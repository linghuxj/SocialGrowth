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
const screenshotPath = process.env.SG_PRODUCT_SCREENSHOT_PATH;
const browser = await chromium.launch({ headless: true });

async function signIn(page: import("playwright").Page, loginName: string, password: string) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入" }).waitFor();
}

try {
  const primaryContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1465, height: 1074 },
  });
  await primaryContext.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseUrl,
  });
  const primary = await primaryContext.newPage();
  const browserErrors: string[] = [];
  primary.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      browserErrors.push(message.text());
    }
  });
  primary.on("pageerror", (error) => browserErrors.push(error.message));
  await signIn(primary, primaryLogin, primaryPassword);

  const invitationKeys: string[] = [];
  let initialCreation: { access: { code: string }; invitation: { invitationId: string } } | undefined;
  let replayCreation: typeof initialCreation;
  const invitationCountBefore = await primary.locator(".invitation-list tbody tr").count();
  const loseFirstCreationResponse = async (route: import("playwright").Route): Promise<void> => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as {
      metadata?: { idempotencyKey?: string };
    };
    if (payload.metadata?.idempotencyKey) invitationKeys.push(payload.metadata.idempotencyKey);
    const response = await route.fetch();
    if (!response.ok()) throw new Error(`Initial invitation creation failed with ${response.status()}`);
    initialCreation = await response.json() as typeof initialCreation;
    await route.abort("failed");
  };
  await primary.route("**/api/operator/invitations", loseFirstCreationResponse);
  await primary.getByLabel("成功注册次数上限").fill("3");
  const expiry = new Date(Date.now() + 86_400_000);
  const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
  await primary.getByLabel("有效至").fill(localExpiry);
  await primary.getByRole("button", { name: "创建邀请" }).click();
  await primary.getByText(/fetch|操作失败|网络/i).waitFor();
  await primary.unroute("**/api/operator/invitations", loseFirstCreationResponse);
  const replayRequestPromise = primary.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/operator/invitations",
  );
  const replayResponsePromise = primary.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/operator/invitations",
  );
  await primary.getByRole("button", { name: "创建邀请" }).click();
  const replayRequest = await replayRequestPromise;
  const replayResponse = await replayResponsePromise;
  if (!replayResponse.ok()) throw new Error(`Invitation replay failed with ${replayResponse.status()}`);
  replayCreation = await replayResponse.json() as typeof replayCreation;
  const replayPayload = replayRequest.postDataJSON() as { metadata?: { idempotencyKey?: string } };
  if (replayPayload.metadata?.idempotencyKey) invitationKeys.push(replayPayload.metadata.idempotencyKey);
  await primary.getByRole("heading", { name: "邀请已创建" }).waitFor();
  if (invitationKeys.length !== 2 || invitationKeys[0] !== invitationKeys[1]) {
    throw new Error("Invitation response-loss retry did not preserve its idempotency key");
  }
  const code = await primary.getByLabel("共享码").inputValue();
  const link = await primary.getByLabel("注册链接").inputValue();
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !link.includes(encodeURIComponent(code))) {
    throw new Error("Invitation access code and link are inconsistent");
  }
  if (!initialCreation || !replayCreation
    || initialCreation.invitation.invitationId !== replayCreation.invitation.invitationId
    || initialCreation.access.code !== replayCreation.access.code
    || replayCreation.access.code !== code) {
    throw new Error("Invitation response-loss retry did not recover the original invitation identity and access code");
  }
  await primary.getByText("邀请已创建。请现在复制共享码或链接；关闭后将不再显示。").waitFor();
  await primary.locator(".access-panel .copy-field button").first().click();
  const copiedCode = await primary.evaluate(() => navigator.clipboard.readText());
  if (copiedCode !== code) throw new Error("Invitation code copy did not preserve the code");
  await primary.getByText("共享码已复制；复制不代表已发送或已注册。").waitFor();
  const invitationRecordId = initialCreation.invitation.invitationId.slice(0, 8);
  const invitationRow = primary.getByRole("row").filter({ hasText: invitationRecordId });
  if (await invitationRow.count() !== 1) {
    throw new Error("Invitation response-loss retry did not produce exactly one original invitation row");
  }
  if (await primary.locator(".invitation-list tbody tr").count() !== invitationCountBefore + 1) {
    throw new Error("Invitation response-loss retry created an unexpected additional invitation row");
  }
  await invitationRow.getByText("有效", { exact: true }).waitFor();
  await invitationRow.getByText("0 / 3", { exact: true }).waitFor();
  if (screenshotPath) await primary.screenshot({
    path: screenshotPath,
    mask: [primary.getByLabel("共享码"), primary.getByLabel("注册链接")],
  });
  primary.once("dialog", (dialog) => void dialog.accept());
  await invitationRow.getByRole("button", { name: "撤销", exact: true }).click();
  await primary.getByText("邀请已撤销，已有注册与设备不受影响").waitFor();
  await primary.getByRole("row").filter({ hasText: invitationRecordId }).locator(".status.revoked").waitFor();

  for (const width of [980, 700]) {
    await primary.setViewportSize({ width, height: 900 });
    const overflows = await primary.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflows) throw new Error(`Product Web overflows horizontally at ${width}px`);
    await primary.getByRole("button", { name: "账号与设备" }).waitFor();
    await primary.getByRole("button", { name: "退出登录" }).waitFor();
    if (width === 700) {
      await primary.getByText("手机端为只读模式").waitFor();
      if (await primary.getByRole("button", { name: "创建邀请" }).count() !== 0) {
        throw new Error("Mobile read-only mode still exposes invitation creation");
      }
      await primary.getByRole("button", { name: "账号与设备" }).click();
      await primary.getByRole("tab", { name: "运营账号", exact: true }).click(); await primary.getByRole("heading", { name: "运营账号管理" }).waitFor();
      if (await primary.getByRole("button", { name: "开通账号" }).count() !== 0) {
        throw new Error("Mobile read-only mode still exposes operator creation");
      }
      await primary.getByRole("button", { name: "转电脑操作" }).first().waitFor();
      await primary.getByRole("button", { name: "提供者邀请" }).click();
      await primary.getByRole("button", { name: "提供者邀请", exact: true }).click(); await primary.getByRole("heading", { name: "邀请与接入" }).waitFor();
    }
  }
  await primary.setViewportSize({ width: 1465, height: 1074 });

  await primary.getByRole("button", { name: "账号与设备" }).click();
  await primary.getByRole("tab", { name: "运营账号", exact: true }).click(); await primary.getByRole("heading", { name: "运营账号管理" }).waitFor();

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
  await secondary.getByLabel("成功注册次数上限").fill("2");
  await secondary.getByRole("button", { name: "创建邀请" }).click();
  await secondary.getByRole("heading", { name: "邀请已创建" }).waitFor();

  primary.once("dialog", (dialog) => void dialog.accept());
  const secondaryRow = primary.getByRole("row").filter({ hasText: secondaryLogin });
  await secondaryRow.getByRole("button", { name: "停用" }).click();
  await primary.getByText("账号已停用，会话已撤销").waitFor();
  await secondary.getByRole("button", { name: "刷新" }).click();
  await secondary.getByRole("heading", { name: "登录正式产品" }).waitFor();
  await secondary.getByText("登录已失效，请重新登录").waitFor();
  if (await secondary.getByRole("heading", { name: "邀请已创建" }).count() !== 0) {
    throw new Error("Disabled real session retained one-time invitation access");
  }
  await secondary.getByLabel("登录名").fill(primaryLogin);
  await secondary.getByLabel("密码").fill(primaryPassword);
  await secondary.getByRole("button", { name: "登录", exact: true }).click();
  await secondary.getByRole("button", { name: "提供者邀请", exact: true }).click(); await secondary.getByRole("heading", { name: "邀请与接入" }).waitFor();
  if (await secondary.getByRole("heading", { name: "邀请已创建" }).count() !== 0) {
    throw new Error("Re-authentication as another operator restored one-time invitation access");
  }

  primary.once("dialog", (dialog) => void dialog.accept());
  const primaryRow = primary.getByRole("row").filter({ has: primary.getByText(primaryLogin, { exact: true }) });
  await primaryRow.getByRole("button", { name: "停用" }).click();
  await primary.getByText("必须至少保留一个有效运营账号").waitFor();

  await primary.getByRole("button", { name: "退出登录" }).click();
  await primary.getByRole("heading", { name: "登录正式产品" }).waitFor();
  if (browserErrors.length > 0) {
    throw new Error(`Product Web emitted browser errors: ${browserErrors.join(" | ")}`);
  }
  await secondaryContext.close();
  await primaryContext.close();
  console.log(`[playwright] product operator flow passed at ${baseUrl}`);
} finally {
  await browser.close();
}
