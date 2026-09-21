import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read/verify one previously authorized identity via the Web. NEVER creates or binds identities.
const [accountName, projectName, platformName, expectedId] = process.argv.slice(2);
if (!accountName || !projectName || !platformName || !expectedId) throw new Error('Provide account display name, authorized project, actual platform name and expected ID.');
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? 'artifacts/acceptance/identity-onboarding-web');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const base = process.env.SOCIALGROWTH_WEB_URL ?? 'http://127.0.0.1:3000';
let result = 'not_started', taskId = '';
try {
  await page.goto(`${base}/#/accounts`);
  await page.getByRole('link', { name: accountName, exact: true }).click();
  await page.getByText('接入 Page / 频道', { exact: true }).click();
  const form = page.getByText('接入 Page / 频道', { exact: true }).locator('..');
  await form.getByLabel('运营项目', { exact: true }).selectOption({ label: projectName });
  await form.getByLabel('接入方式').selectOption('verify');
  await form.getByLabel('平台 Page / 频道准确名称').fill(platformName);
  await form.getByLabel('完整 Page ID / 频道 ID').fill(expectedId);
  await form.getByLabel('本次账号操作授权依据').fill('本次已授权 Web 账号接入核验；沿用原指定身份，仅核验、不创建、不公开发布');
  await form.getByLabel('确认操作范围').selectOption('yes');
  await form.getByRole('button', { name: '发起一次 Artemis 账号接入任务', exact: true }).click();
  await form.getByText('已保存，列表和操作审计已更新。', { exact: true }).waitFor({ timeout: 30000 });
  const first = page.getByRole('region', { name: '账号接入任务', exact: true }).locator('article').first();
  taskId = await first.locator('code').innerText();
  console.log(JSON.stringify({ status: 'web_started', taskId }));
  await first.getByRole('link', { name: '任务与人工待办', exact: true }).click();
  const record = page.getByRole('region', { name: '账号接入任务', exact: true }).locator('article').filter({ hasText: taskId });
  await record.waitFor();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const text = await record.innerText();
    if (!text.includes('· running ·')) { result = text; break; }
    // This automated acceptance does not invent or reuse credentials. Stop at a real human gate.
    const waiting = page.locator('[data-challenge-id] form, [data-agent-request-id] form');
    if (await waiting.count()) { result = 'HUMAN_INPUT_REQUIRED'; break; }
    await page.waitForTimeout(2000);
  }
  if (result === 'not_started') result = 'VERIFICATION_WINDOW_EXCEEDED';
  if (await record.getByRole('button', { name: '停止本次账号操作', exact: true }).count()) {
    await record.getByRole('button', { name: '停止本次账号操作', exact: true }).click();
    await record.getByRole('button', { name: '停止本次账号操作', exact: true }).waitFor({ state: 'detached', timeout: 60000 });
  }
  await page.screenshot({ path: resolve(output, 'identity-task.png'), fullPage: true });
  console.log(JSON.stringify({ taskId, result }));
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), taskId, result, initiatedThrough: 'Playwright / real Web form', creationAttempted: false, publicationAttempted: false, bindingModified: false }, null, 2), { mode: 0o600 });
  await browser.close();
}
