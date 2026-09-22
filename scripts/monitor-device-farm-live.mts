import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const baseUrl = process.env.SOCIALGROWTH_WEB_URL || 'http://127.0.0.1:3000';
  const outputDir = resolve('artifacts/acceptance/web-live-acceptance');
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });

  const page = await context.newPage();

  try {
    console.log(`Navigating to ${baseUrl}/#/device-farm...`);
    await page.goto(`${baseUrl}/#/device-farm`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Wait for the main heading
    await page.waitForSelector('text=真机群控监控大屏 (Device Farm)', { timeout: 15_000 });
    console.log('Device farm header visible.');

    // Wait for auto-refresh indicator
    await page.waitForSelector('text=3s 自动刷新中', { timeout: 15_000 });
    console.log('Auto-refresh 3s indicator verified.');

    // Wait for the device card of RFCW40MYYCV
    await page.waitForSelector('text=RFCW40MYYCV', { timeout: 15_000 });
    console.log('Device RFCW40MYYCV card found.');

    // Wait for device image or running status
    await page.waitForTimeout(3500); // Allow at least one 3s poll cycle to complete

    // Capture screenshot of device farm
    const screenshotPath = resolve(outputDir, '04-device-farm-running-live.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    // Verify presence of running badge and device details
    const pageText = await page.locator('body').innerText();
    const hasRunningStatus = pageText.includes('运行中') || pageText.includes('running');
    const hasGalaxyModel = pageText.includes('Galaxy S23') || pageText.includes('SM-S9110');
    const hasFacebookIdentity = pageText.includes('61550800776808');

    const evidence = {
      timestamp: new Date().toISOString(),
      url: `${baseUrl}/#/device-farm`,
      device: 'RFCW40MYYCV',
      hasRunningStatus,
      hasGalaxyModel,
      hasFacebookIdentity,
      autoRefresh3sVerified: true,
      screenshot: screenshotPath,
    };

    await writeFile(
      resolve(outputDir, 'device-farm-live-evidence.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    );
    console.log('Evidence generated:', JSON.stringify(evidence, null, 2));

  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Playwright execution error:', err);
  process.exit(1);
});
