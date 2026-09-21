import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read-only prerequisite verification. Never submits tasks or publishes content.
const baseUrl = process.env.SOCIALGROWTH_WEB_URL || 'http://127.0.0.1:3000';
const outputDir = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT || 'artifacts/acceptance/publication-readiness');
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const results: Array<{ route: string; status: string; detail?: string }> = [];
try {
  for (const [route, heading] of [
    ['home', '工作台'], ['accounts', '账号管理'], ['content', '内容资产'], ['receipts', '执行记录'],
  ]) {
    try {
      const apiPath = route === 'home' ? '/api/runtime/state' : route === 'receipts' ? '/api/runtime/status' : undefined;
      // Capture actual page requests; never synthesize application state through API calls.
      const runtimeResponse = apiPath
        ? page.waitForResponse(r => new URL(r.url()).pathname === apiPath, { timeout: 20_000 }).catch(() => null)
        : undefined;
      const response = await page.goto(`${baseUrl}/#/${route}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      // Hash-only navigation is client-side and legitimately returns no new Response.
      if (response && !response.ok()) throw new Error(`HTTP_${response.status()}`);
      await page.locator('header.op-header').waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByRole('heading', { name: heading, exact: true, level: 1 }).waitFor({ state: 'visible', timeout: 15_000 });
      if (runtimeResponse) {
        const result = await runtimeResponse;
        if (!result?.ok()) throw new Error(`RUNTIME_HTTP_${result?.status() ?? 'NO_RESPONSE'}`);
      }
      await page.waitForFunction(
        () => {
          const text = document.body.innerText;
          return !text.includes('正在连接执行服务') && !text.includes('无法连接执行服务');
        },
        undefined,
        { timeout: 15_000 },
      );
      await page.screenshot({ path: resolve(outputDir, `${route}.png`), fullPage: true });
      await writeFile(resolve(outputDir, `${route}.txt`), await page.locator('body').innerText(), { mode: 0o600 });
      results.push({ route, status: 'page_and_runtime_ready' });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : 'UNKNOWN_BROWSER_ERROR';
      results.push({ route, status: 'blocked', detail });
      break;
    }
  }
} finally {
  await context.close();
  await browser.close();
  const evidence = { checkedAt: new Date().toISOString(), baseUrl, tool: 'Playwright / Google Chrome', readOnly: true, publicationAttempted: false, results };
  await writeFile(resolve(outputDir, 'browser-readiness.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
}
if (results.some(result => result.status === 'blocked')) process.exitCode = 2;
