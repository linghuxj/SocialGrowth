import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Real Web form validation only. No device mutation, mock state, API writes or creation.
const accountName = process.argv[2];
if (!accountName) throw new Error('Supply an existing unbound local test account name.');
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? 'artifacts/acceptance/device-initialization-web');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const results: string[] = [], errors: string[] = [], mutations: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/runtime/') && r.method() !== 'GET') mutations.push(r.method() + ' ' + new URL(r.url()).pathname); });
try {
  const stateResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/runtime/state');
  await page.goto(`${process.env.SOCIALGROWTH_WEB_URL ?? 'http://127.0.0.1:3000'}/#/accounts`);
  const { state } = await (await stateResponse).json();
  const account = state.accounts.find((a: { name: string }) => a.name === accountName);
  assert.ok(account && !account.deviceRef, 'This verification only permits an unbound local fixture.');
  await page.getByRole('link', { name: accountName, exact: true }).click();
  await page.getByText('接入 Page / 频道', { exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: '发起一次 Artemis 账号接入任务', exact: true }) });
  await form.waitFor();
  assert.equal(await form.getByLabel('接入方式', { exact: true }).inputValue(), 'initialize');
  assert.equal(await form.getByLabel('初始化身份处理', { exact: true }).inputValue(), 'existing_only');
  results.push('新入口默认手机初始化，默认不授予创建权限');
  assert.equal(await form.getByLabel('所属登录账号的唯一标识', { exact: true }).getAttribute('required'), '');
  assert.equal(await form.getByLabel('完整 Page ID / 频道 ID').getAttribute('required'), null);
  assert.equal(await form.getByLabel('Page 类别').count(), 0);
  results.push('必须指定父登录身份；未绑定初始化允许 Agent 读取已有身份 ID，不要求素材');
  await form.getByLabel('初始化身份处理', { exact: true }).selectOption('create_if_missing');
  assert.equal(await form.getByLabel('完整 Page ID / 频道 ID').count(), 0);
  assert.equal(await form.getByLabel('Page 类别').getAttribute('required'), '');
  results.push('明确选择缺少时创建后才显示 Page 创建资料');
  await form.getByLabel('接入方式', { exact: true }).selectOption('verify');
  assert.equal(await form.getByLabel('初始化身份处理').count(), 0);
  assert.equal(await form.getByLabel('完整 Page ID / 频道 ID').getAttribute('required'), '');
  results.push('切回单独核验保留完整 ID 要求，不带入创建范围');
  await form.getByLabel('接入方式', { exact: true }).selectOption('initialize');
  await form.getByLabel('初始化身份处理', { exact: true }).selectOption('existing_only');
  await form.getByLabel('所属登录账号的唯一标识', { exact: true }).fill('');
  await form.getByRole('button', { name: '发起一次 Artemis 账号接入任务', exact: true }).click();
  assert.equal(await form.getByLabel('所属登录账号的唯一标识', { exact: true }).evaluate((el: HTMLInputElement) => el.validity.valueMissing), true);
  assert.equal(mutations.length, 0);
  assert.deepEqual(errors, []);
  results.push('缺少必要登录身份时提交被表单阻止，无设备接管、初始化或发布写请求');
  await page.screenshot({ path: resolve(output, 'initialization-form.png'), fullPage: true });
} catch (error) {
  errors.push(error instanceof Error ? error.message : 'UNKNOWN');
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results, errors, mutations, nativeInitializationVerified: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ results, errors, mutations }));
  await browser.close();
}
