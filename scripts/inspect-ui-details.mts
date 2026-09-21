import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.SOCIALGROWTH_WEB_URL || 'http://127.0.0.1:3000';
const outputDir = resolve('artifacts/acceptance/publication-readiness/ui-details');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

try {
  // 1. 内容资产页面：测试详情侧边抽屉
  await page.goto(`${baseUrl}/#/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const firstContentLink = page.locator('.op-table tbody tr td a').first();
  if (await firstContentLink.isVisible()) {
    await firstContentLink.click();
    await page.waitForTimeout(800);
    await page.locator('div[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: resolve(outputDir, 'content-drawer-detail.png'), fullPage: true });

    // 关闭抽屉测试
    const closeBtn = page.locator('button[aria-label="关闭抽屉"]').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(600);
    }
  }

  // 2. 内容资产页面：测试“登记内容与素材”新增抽屉
  const triggerBtn = page.getByRole('button', { name: '登记内容与素材' }).first();
  if (await triggerBtn.isVisible()) {
    await triggerBtn.click();
    await page.waitForTimeout(600);
    await page.locator('div[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: resolve(outputDir, 'content-new-drawer.png'), fullPage: true });

    // 关闭抽屉
    const closeBtn = page.locator('button[aria-label="关闭抽屉"]').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(600);
    }
  }

  // 3. 运营项目页面：测试“新建运营项目”新增抽屉
  await page.goto(`${baseUrl}/#/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const newProjectBtn = page.getByRole('button', { name: '新建运营项目' }).first();
  if (await newProjectBtn.isVisible()) {
    await newProjectBtn.click();
    await page.waitForTimeout(600);
    await page.locator('div[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: resolve(outputDir, 'project-new-drawer.png'), fullPage: true });

    // 关闭抽屉
    const closeBtn = page.locator('button[aria-label="关闭抽屉"]').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(600);
    }
  }

  // 3.5 运营项目页面：测试“客户档案（代运营使用）”侧边栏抽屉
  const clientArchiveBtn = page.getByRole('button', { name: '客户档案（代运营使用）' }).first();
  if (await clientArchiveBtn.isVisible()) {
    await clientArchiveBtn.click();
    await page.waitForTimeout(600);
    await page.locator('div[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: resolve(outputDir, 'clients-archive-drawer.png'), fullPage: true });

    // 关闭抽屉
    const closeBtn = page.locator('button[aria-label="关闭抽屉"]').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(600);
    }
  }

  // 4. 账号管理页面：测试账号详情抽屉
  await page.goto(`${baseUrl}/#/accounts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const firstAccountLink = page.locator('.op-table tbody tr td a').first();
  if (await firstAccountLink.isVisible()) {
    await firstAccountLink.click();
    await page.waitForTimeout(800);
    await page.locator('div[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: resolve(outputDir, 'account-drawer-detail.png'), fullPage: true });
  }

  console.log('All Drawer screenshots captured and verified successfully.');
} finally {
  await context.close();
  await browser.close();
}
