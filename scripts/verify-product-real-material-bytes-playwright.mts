import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { chromium } from "playwright";
import { materialUploadHttpMaxBytes, materialUploadTicketViewSchema } from "../product/contracts/dist/index.js";
// Authorized original Web bytes only; never invent source/first-use facts.
const required = (key: string) => { const v = process.env[key]; if (!v) throw new Error(`${key} required`); return v; };
assert.equal(required("SG_PRODUCT_REAL_MATERIAL_AUTHORIZED"), "1");
const files: unknown = JSON.parse(required("SG_PRODUCT_REAL_MATERIAL_FILES"));
assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 5 && files.every(f => typeof f === "string" && isAbsolute(f)));
const paths = files as string[], output = required("SG_PRODUCT_REAL_MATERIAL_OUTPUT");
const firstUseConfirmed = process.env.SG_PRODUCT_REAL_MATERIAL_FIRST_USE_CONFIRMED === "1";
for (const file of paths) { const s = await stat(file); assert.ok(s.isFile() && s.size > 0 && s.size <= materialUploadHttpMaxBytes); }
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), evidence: { file: string; bytes: number; sha256: string; objectId: string }[] = [];
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1464, height: 1074 } });
const transport: { method: string; status: number; stage: string; code: string | null }[] = [];
page.on("response", async response => {
  const path = new URL(response.url()).pathname;
  if (!/\/material-uploads(?:\/|$)/.test(path)) return;
  let code: string | null = null;
  if (!response.ok()) { try { const body = await response.json() as { error?: { code?: unknown } }; if (typeof body.error?.code === "string" && /^[A-Z_]+$/.test(body.error.code)) code = body.error.code; } catch { /* No raw transport details. */ } }
  transport.push({ method: response.request().method(), status: response.status(), stage: path.endsWith("/bytes") ? "bytes" : "ticket", code });
});
try {
  const errors: string[] = [];
  let declarationWrites = 0;
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("request", r => { if (r.method() === "POST" && /\/materials(?:\/|$)/.test(new URL(r.url()).pathname)) declarationWrites++; });
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill(required("SG_PRODUCT_TEST_LOGIN_NAME"));
  await page.getByLabel("密码", { exact: true }).fill(required("SG_PRODUCT_TEST_PASSWORD"));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const project = page.locator(".project-workspace"), name = `获准原文件字节验收-${Date.now()}`;
  await project.getByRole("button", { name: "新建项目" }).click(); await project.getByLabel("项目名称").fill(name);
  await project.getByRole("button", { name: "创建筹备项目" }).click(); await project.getByText(/基本信息已保存；仍在筹备/).waitFor();
  await project.getByRole("button", { name: "素材", exact: true }).click();
  const material = page.getByRole("region", { name: "项目素材", exact: true });
  for (const file of paths) {
    const raw = await readFile(file), sha256 = createHash("sha256").update(raw).digest("hex");
    await material.locator('input[type="file"]').setInputFiles(file);
    const row = material.getByRole("row").filter({ hasText: basename(file) });
    const acknowledgement = page.waitForResponse(r => r.request().method() === "PUT" && /\/material-uploads\/[a-f0-9-]+\/bytes$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
    await row.getByRole("button", { name: "上传／重试原文件", exact: true }).click();
    const response = await acknowledgement; assert.equal(response.status(), 200);
    await row.getByText("文件字节已校验", { exact: true }).waitFor();
    // Large request bodies can evict Chromium inspector response cache. The
    // Web feedback is the acceptance assertion; read the original ticket as
    // supplemental evidence only. Never resend bytes or mutate via this API.
    const ticketURL = new URL(response.url()); assert.equal(ticketURL.origin, new URL(page.url()).origin);
    const stored = await page.evaluate(async path => {
      const read = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      return { status: read.status, body: await read.json() as unknown };
    }, ticketURL.pathname.replace(/\/bytes$/, ""));
    assert.equal(stored.status, 200);
    const receipt = materialUploadTicketViewSchema.parse(stored.body); assert.equal(receipt.status, "verified_bytes");
    assert.equal(receipt.sha256, sha256); assert.equal(receipt.bytes, raw.byteLength);
    assert.equal(receipt.candidateAllowed, false); assert.equal(receipt.publicationAllowed, false);
    await row.getByRole("button", { name: "预览／资料", exact: true }).click();
    const editor = material.getByRole("region", { name: "素材资料详情" });
    const firstUse = editor.getByRole("checkbox", { name: "我已人工确认：此成品此前未发布；声明不等于系统核验通过" });
    assert.equal(await firstUse.isChecked(), false);
    if (firstUseConfirmed) {
      await editor.getByLabel("来源声明", { exact: true }).fill("本次对话中用户明确授权使用 Demo 成品，并确认此成品从未公开发布；下载目录已找到与 Demo 指纹一致的原件。制作主体及业务关系记录尚未补齐。");
      await firstUse.check();
    }
    await editor.getByRole("button", { name: "保存本条／接续原请求" }).click();
    await editor.getByText(firstUseConfirmed ? "请补齐资料和真实引用：名称、语言、业务/来源关系、说明、事实及证明。" : "请人工确认首次使用声明；文件上传不能代替来源确认。", { exact: true }).waitFor();
    assert.equal(await firstUse.isChecked(), firstUseConfirmed);
    evidence.push({ file: basename(file), bytes: receipt.bytes, sha256: receipt.sha256, objectId: receipt.objectId });
    await editor.getByRole("button", { name: "保留草稿返回" }).click();
  }
  await material.screenshot({ path: `${output}/original-bytes-verified.png` });
  assert.equal(declarationWrites, 0); assert.deepEqual(errors, []);
  await page.reload(); await page.getByRole("button", { name: "提供者邀请", exact: true }).click(); await page.getByRole("heading", { name: "邀请与接入", exact: true }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await project.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "打开项目" }).click();
  await project.getByRole("button", { name: "素材", exact: true }).click();
  await material.getByRole("heading", { name: "尚无已登记素材", exact: true }).waitFor();
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, evidence, declarationWrites, firstUseHumanConfirmed: firstUseConfirmed, sourceRecordVerified: false,
    scope: "authorized original Web upload and verified hash/size; human first-use input when explicitly confirmed; missing real references block declaration; reload has no fabricated registry entry", publication: false }, null, 2));
  console.log(JSON.stringify({ passed: true, originalFiles: evidence.length, declarationWrites, publication: false }));
} catch (error) {
  const material = page.getByRole("region", { name: "项目素材", exact: true });
  if (await material.count()) { await writeFile(`${output}/failure-material.txt`, await material.innerText()); await material.screenshot({ path: `${output}/failure-material.png` }); }
  throw error;
} finally { await writeFile(`${output}/transport.json`, JSON.stringify(transport, null, 2)); await browser.close(); }
