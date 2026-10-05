import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.SG_PRODUCT_REAL_DEVICE_SCOPE, "authorized");
const phase = process.env.SG_PRODUCT_DEVICE_PHASE ?? "prepare";
assert.ok(["prepare", "registration", "verify"].includes(phase));
const privateDir = resolve(".runtime/product-local-live");
const config = JSON.parse(await readFile(resolve(privateDir, "config.json"), "utf8")) as { operatorPassword: string };
const ready = JSON.parse(await readFile(resolve(privateDir, "ready.json"), "utf8")) as { web: string; database: string; executorEnabled: boolean };
assert.equal(ready.web, "http://127.0.0.1:3100"); assert.equal(ready.database, "sg_product_local_live"); assert.equal(ready.executorEnabled, false);
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/blocker-resolution-live-20261002/web");
await mkdir(output, { recursive: true, mode: 0o700 });
const save = (name: string, data: unknown, dir = output) => writeFile(resolve(dir, name), JSON.stringify(data, null, 2), { mode: 0o600 });
const accessPath = resolve(privateDir, "invitation-access.json");
interface SavedInvitation { status: string; invitationId?: string }
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30_000);
try {
  await page.goto(ready.web);
  await page.getByLabel("登录名", { exact: true }).fill("device-live-local");
  await page.getByLabel("密码", { exact: true }).fill(config.operatorPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  if (phase === "prepare") {
    let saved: SavedInvitation | null = null;
    try { saved = JSON.parse(await readFile(accessPath, "utf8")) as SavedInvitation; }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
    if (saved?.status === "launch_intent") {
      // A prior UI assertion failed after the response: reconcile the unused
      // original in the actual UI. Never recover secrets from DB/audit or
      // silently issue a second active invitation.
      const rows = page.locator(".invitation-list tbody tr");
      assert.equal(await rows.count(), 1, "Ambiguous original invitations require operator review");
      assert.match(await rows.first().innerText(), /0 \/ 1/);
      assert.match(await rows.first().innerText(), /0 台/);
      page.once("dialog", dialog => { void dialog.accept(); });
      await rows.first().getByRole("button", { name: "撤销", exact: true }).click();
      await rows.first().getByRole("button", { name: "已撤销", exact: true }).waitFor();
      await save("invitation-access.json", { status: "unused_original_revoked", at: new Date().toISOString() }, privateDir);
      saved = null;
    }
    if (saved?.status === "unused_original_revoked") saved = null;
    if (saved) {
      assert.equal(saved.status, "created", "Original Web creation unresolved; no duplicate invitation");
      await page.getByRole("row").filter({ hasText: saved.invitationId!.slice(0, 8) }).waitFor();
    } else {
      await page.getByLabel("成功注册次数上限", { exact: true }).fill("1");
      const expiry = new Date(Date.now() + 86_400_000);
      await page.getByLabel("有效至", { exact: true }).fill(new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
      await save("invitation-access.json", { status: "launch_intent", at: new Date().toISOString() }, privateDir);
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/operator/invitations" && response.request().method() === "POST");
      await page.getByRole("button", { name: "创建邀请", exact: true }).click();
      const response = await responsePromise; assert.ok(response.ok());
      const created = await response.json() as { invitation: { invitationId: string }; access: { code: string } };
      await page.getByRole("heading", { name: "邀请已创建", exact: true }).waitFor();
      assert.match(created.access.code, /^[A-Za-z0-9_-]{43}$/);
      await save("invitation-access.json", { status: "created", invitationId: created.invitation.invitationId,
        code: created.access.code, createdAt: new Date().toISOString() }, privateDir);
      assert.equal(await page.getByLabel("共享码").inputValue(), created.access.code);
      saved = { status: "created", invitationId: created.invitation.invitationId };
    }
    await page.screenshot({ path: resolve(output, "invitation-redacted.png"), mask: [page.locator(".access-panel")] });
    await save("prepare-result.json", { checkedAt: new Date().toISOString(), invitationId: saved.invitationId,
      actualWebInvitationCreated: true, providerRegistered: false, realDeviceAssociated: false, phoneFactsSeeded: false,
      waitingFor: "management App registration and actual Samsung association", businessAcceptancePassed: false });
    console.log(JSON.stringify({ event: "web_invitation_ready", invitationId: saved.invitationId, businessAcceptancePassed: false }));
  } else if (phase === "registration") {
    const saved = JSON.parse(await readFile(accessPath, "utf8")) as SavedInvitation;
    assert.equal(saved.status, "created"); assert.ok(saved.invitationId);
    const row = page.getByRole("row").filter({ hasText: saved.invitationId.slice(0, 8) });
    await row.waitFor(); const progress = await row.innerText();
    assert.match(progress, /1 \/ 1/); assert.match(progress, /1 位提供者/);
    await page.getByRole("button", { name: "账号与设备", exact: true }).click();
    await page.getByRole("tab", { name: "手机", exact: true }).click();
    await page.getByRole("heading", { name: "账号与设备", exact: true, level: 1 }).waitFor();
    await page.locator(".header-actions").getByRole("button", { name: "刷新", exact: true }).click();
    await page.locator(".provider-choice").first().waitFor();
    assert.equal(await page.locator(".provider-choice").count(), 1);
    await page.screenshot({ path: resolve(output, "provider-registered-web.png") });
    await save("registration-result.json", { checkedAt: new Date().toISOString(), invitationId: saved.invitationId,
      actualAppRegistrationObservedInWeb: true, consumedInvitationUses: 1, providerCount: 1,
      smsMode: "development_capture", actualSmsDeliveryVerified: false, phoneExecutionReady: false });
    console.log(JSON.stringify({ event: "management_app_registration_visible_in_web", phoneExecutionReady: false }));
  } else {
    await page.getByRole("button", { name: "账号与设备", exact: true }).click();
    await page.getByRole("tab", { name: "手机", exact: true }).click();
    await page.getByRole("heading", { name: "账号与设备", exact: true, level: 1 }).waitFor();
    await page.locator(".header-actions").getByRole("button", { name: "刷新", exact: true }).click();
    const providers = page.locator(".provider-choice");
    await providers.first().waitFor();
    assert.equal(await providers.count(), 1, "Exactly one actual management provider must register through App");
    await providers.first().click();
    const devices = page.locator(".device-list-panel tbody tr");
    await devices.first().waitFor();
    assert.equal(await devices.count(), 1, "Exactly one Samsung must be associated through the native scanner");
    const device = devices.first();
    assert.match(await device.locator(".device-name").innerText(), /Samsung|SM-S9110|SM_S9110/);
    assert.match(await device.locator(".device-state").innerText(), /^已关联\s*·\s*待完成接入$/);
    assert.equal(await device.locator(".device-unknown").innerText(), "未知");
    await device.getByRole("button", { name: /^查看 .* 详情$/ }).click();
    await page.locator(".device-detail-panel").waitFor();
    await page.screenshot({ path: resolve(output, "associated-device-web.png") });
    await save("verify-result.json", { checkedAt: new Date().toISOString(), actualWebDeviceVisible: true,
      deviceAssociated: true, accessReady: false, physicalControllerReady: false, doublePhysicalPhoneScanAccepted: false });
    console.log(JSON.stringify({ event: "real_device_visible_in_web", accessReady: false }));
  }
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure-redacted.png"), mask: [page.locator(".access-panel"), page.getByLabel("密码", { exact: true })] });
  await save("failure.json", { phase, at: new Date().toISOString(), message: error instanceof Error ? error.message.split("\n")[0] : "UNCONFIRMED" });
  throw error;
} finally { await browser.close(); }
