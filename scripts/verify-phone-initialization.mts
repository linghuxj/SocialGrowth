import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const runtimeUrl = 'http://127.0.0.1:4318/api/runtime';
const webUrl = 'http://127.0.0.1:3000';
const token = '569627d96d993d0afaa1d74df96b89aa86f66840eca9a80135edfb7348534ebf';
const outputDir = resolve('artifacts/acceptance/web-live-acceptance');

async function main() {
  await mkdir(outputDir, { recursive: true });
  console.log('=== Step 1: 启动 Google Chrome (Playwright) 访问账号接入面板 ===');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // 1. Visit accounts page with target account object
    const accountUrl = `${webUrl}/#/accounts?object=account-4ee9e05f-77cd-44a3-8f7c-0f6b451ab145`;
    await page.goto(accountUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Expand details panel
    const summary = page.locator('summary:has-text("接入 Page / 频道")');
    await summary.waitFor({ state: 'visible', timeout: 15000 });
    await summary.click();
    console.log('Clicked summary to expand onboarding form');

    const form = page.locator('form#identity-onboard-account-4ee9e05f-77cd-44a3-8f7c-0f6b451ab145');
    await form.waitFor({ state: 'visible', timeout: 10000 });
    console.log('Found onboarding form on accounts detail drawer');

    // Screenshot initial form
    const formInitialShot = resolve(outputDir, '08-onboarding-form-initial.png');
    await page.screenshot({ path: formInitialShot, fullPage: true });
    console.log(`Initial form screenshot saved: ${formInitialShot}`);

    // Fill project
    await form.locator('select[name=project]').selectOption('project-1bdd610a-8505-489e-b7cd-dacc3925405f');
    console.log('Selected project: project-1bdd610a-8505-489e-b7cd-dacc3925405f');

    // Confirm action is initialize
    await form.locator('select[name=action]').selectOption('initialize');
    console.log('Confirmed action: initialize');

    // Confirm initializationMode is existing_only
    await form.locator('select[name=initializationMode]').selectOption('existing_only');
    console.log('Confirmed initializationMode: existing_only');

    // Fill name with exact Page name
    await form.locator('input[name=name]').fill('Xj Linghu');
    console.log('Filled name: Xj Linghu');

    // Fill expectedId
    const expectedIdInput = form.locator('input[name=expectedId]');
    if (await expectedIdInput.isVisible()) {
      await expectedIdInput.fill('61550800776808');
      console.log('Filled expectedId: 61550800776808');
    }

    // Fill loginIdentity
    const loginIdentityInput = form.locator('input[name=loginIdentity]');
    await loginIdentityInput.fill('linghuxj@gmail.com');
    console.log('Filled loginIdentity: linghuxj@gmail.com');

    // Fill authorization
    const authInput = form.locator('input[name=authorization]');
    await authInput.fill('本次授权Web手机初始化：包含环境检查、可信安装与登录身份核验，不公开发布');
    console.log('Filled authorization');

    // Fill confirmed
    await form.locator('select[name=confirmed]').selectOption('yes');
    console.log('Confirmed scope: yes');

    await page.waitForTimeout(1000);
    const formFilledShot = resolve(outputDir, '08-onboarding-form-filled.png');
    await page.screenshot({ path: formFilledShot, fullPage: true });
    console.log(`Filled form screenshot saved: ${formFilledShot}`);

    // Capture latest prior job ID before submitting
    let preJobId: string | undefined;
    try {
      const preRes = await fetch(`${runtimeUrl}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const preData = await preRes.json();
      preJobId = preData.onboarding?.[0]?.id;
    } catch {}
    console.log(`Prior latest job ID: ${preJobId}`);

    // Click submit button
    console.log('=== Step 2: 点击提交“发起一次 Artemis 账号接入任务” ===');
    const submitButton = form.locator('button[type=submit]');
    await submitButton.click();

    // Wait for submission feedback
    await page.waitForTimeout(3000);
    const formSubmittedShot = resolve(outputDir, '08-onboarding-form-submitted.png');
    await page.screenshot({ path: formSubmittedShot, fullPage: true });
    console.log(`Submitted form screenshot saved: ${formSubmittedShot}`);

    // Query status to get active onboarding job
    let activeJob: any = null;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const statusRes = await fetch(`${runtimeUrl}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const statusData = await statusRes.json();
      const latest = statusData.onboarding?.[0];
      if (latest && latest.id !== preJobId) {
        activeJob = latest;
        break;
      }
    }
    console.log('Active onboarding job:', JSON.stringify(activeJob, null, 2));

    const jobId = activeJob?.id;
    const traceId = activeJob?.traceId;
    console.log(`Onboarding Job ID: ${jobId}, Trace ID: ${traceId}`);

    console.log('=== Step 3: 打开真机大屏并监控初始化执行进展 ===');
    await page.goto(`${webUrl}/#/device-farm`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=真机群控监控大屏 (Device Farm)', { timeout: 15000 });

    const startTime = Date.now();
    let iteration = 0;
    let assistanceSubmitted = false;

    // Monitor for up to 15 minutes (allowing APK install and agent verification)
    while (Date.now() - startTime < 900000) {
      await new Promise((r) => setTimeout(r, 12000));
      iteration++;

      // Trigger ADB refresh to sync live phone screen to MinIO
      try {
        await fetch(`${runtimeUrl}/devices/refresh`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ serial: 'RFCW40MYYCV' }),
        });
      } catch {}

      // Check onboarding job status
      const pollRes = await fetch(`${runtimeUrl}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pollData = await pollRes.json();
      const job = pollData.onboarding?.find((j: any) => j.id === jobId) ?? pollData.onboarding?.[0];
      const currentStatus = job?.status ?? 'unknown';

      console.log(`[Monitor ${iteration}] Onboarding status: ${currentStatus}, reason: ${job?.reason ?? 'none'}`);

      // Capture screenshot of device farm
      try {
        await page.goto(`${webUrl}/#/device-farm`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const progressShot = resolve(outputDir, `08-device-farm-onboarding-progress-${iteration}.png`);
        await page.screenshot({ path: progressShot, fullPage: true });
        console.log(`Progress screenshot saved: ${progressShot}`);

        // Check if there is a pending human assistance (password or clarification) on device farm
        const passwordInput = page.locator('input[name=password]');
        if (await passwordInput.isVisible()) {
          console.log('=== 发现 Web 人工密码协助待办，正在填入用户授权密码 ===');
          await page.screenshot({ path: resolve(outputDir, '08-human-password-challenge-prompt.png'), fullPage: true });
          const password = process.env.SG_ACCOUNT_PASSWORD || '';
          await passwordInput.fill(password);
          await page.waitForTimeout(500);
          const form = passwordInput.locator('xpath=ancestor::form').first();
          const checkbox = form.locator('input[type=checkbox]').first();
          if (await checkbox.isVisible()) {
            await checkbox.check();
          }
          const submitPwdBtn = form.locator('button[type=submit]').first();
          if (await submitPwdBtn.isVisible()) {
            await submitPwdBtn.click();
            console.log('=== 已在 Web 控制台提交登录密码 ===');
            await page.waitForTimeout(1500);
            await page.screenshot({ path: resolve(outputDir, '08-human-password-submitted.png'), fullPage: true });
          }
        }

        const clarificationText = page.locator('textarea[name=response]');
        if (await clarificationText.isVisible()) {
          console.log('=== 发现 Web 人工澄清待办，正在填入用户授权登录账号/说明 ===');
          await page.screenshot({ path: resolve(outputDir, '08-human-clarification-prompt.png'), fullPage: true });
          await clarificationText.fill('已完成登录，账号 linghuxj@gmail.com，当前已进入 Facebook 首页');
          await page.waitForTimeout(500);
          const form = clarificationText.locator('xpath=ancestor::form').first();
          const checkbox = form.locator('input[type=checkbox]').first();
          if (await checkbox.isVisible()) {
            await checkbox.check();
          }
          const submitClarifyBtn = form.locator('button[type=submit]').first();
          if (await submitClarifyBtn.isVisible()) {
            await submitClarifyBtn.click();
            console.log('=== 已在 Web 控制台提交澄清信息 ===');
            await page.waitForTimeout(1500);
            await page.screenshot({ path: resolve(outputDir, '08-human-clarification-submitted.png'), fullPage: true });
          }
        }
      } catch (e) {
        console.error('Failed to capture progress screenshot or handle assistance:', e);
      }

      if (currentStatus === 'verified') {
        console.log('Onboarding job VERIFIED successfully!');
        break;
      }
      if (['blocked', 'unknown', 'interrupted', 'cancelled'].includes(currentStatus)) {
        console.log(`Onboarding job entered terminal state: ${currentStatus}`);
        break;
      }
    }

    // Final screenshot of onboarding panel
    await page.goto(accountUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const finalOnboardingShot = resolve(outputDir, '09-onboarding-final-status.png');
    await page.screenshot({ path: finalOnboardingShot, fullPage: true });
    console.log(`Final onboarding panel screenshot saved: ${finalOnboardingShot}`);

  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Initialization workflow error:', err);
  process.exit(1);
});
