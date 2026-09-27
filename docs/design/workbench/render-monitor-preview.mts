import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Static design review only. No runtime requests, service startup or device actions.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1300 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(new URL('./device-monitor-preview.html', import.meta.url).href);
  const screen = page.locator('#enlargeButton img');
  await screen.evaluate(async (image: HTMLImageElement) => image.decode());
  assert.equal(await screen.evaluate((image: HTMLImageElement) => image.naturalWidth), 1080);
  assert.equal(await page.getByRole('button', { name: '申请接管', exact: true }).isDisabled(), true);
  await page.screenshot({ path: fileURLToPath(new URL('./device-monitor-preview-v2.png', import.meta.url)), fullPage: true });
  await page.getByRole('button', { name: '放大归档真机截图，仅查看' }).click();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  assert.equal(await page.locator('#enlargeButton').evaluate((element) => element === document.activeElement), true);
  await page.getByRole('button', { name: '未连接视图', exact: true }).click();
  assert.equal(await page.locator('#archivePanel').isVisible(), false);
  assert.equal(await page.getByRole('heading', { name: '尚未取得当前设备状态' }).isVisible(), true);
  await page.screenshot({ path: fileURLToPath(new URL('./device-monitor-unconnected-v2.png', import.meta.url)), fullPage: true });
  await page.getByRole('button', { name: '查看历史真机参考', exact: true }).click();
  assert.equal(await screen.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1100, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  const result = {
    kind: 'static-design-preview-check',
    checkedAt: new Date().toISOString(),
    browser: `Chrome ${browser.version()}`,
    command: 'pnpm exec tsx docs/design/workbench/render-monitor-preview.mts',
    checks: ['archive-image-loads-at-original-1080-width', 'takeover-disabled', 'enlarge-and-escape-close', 'focus-restored', 'unconnected-view-does-not-show-archive-as-live', 'return-to-archive', 'no-horizontal-overflow-at-1500-and-1100', 'no-page-errors'],
    runtimeConnected: false,
    deviceCommandsSent: false,
    businessAcceptance: 'not-run',
  };
  await writeFile(new URL('./device-monitor-preview-check.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
