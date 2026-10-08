import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { chromium } from "playwright";
import { listProjectsResponseSchema, projectResponseSchema, materialUploadInventoryResponseSchema, materialUploadHttpMaxBytes } from "../product/contracts/src/index.js";

// Web upload only. Existing pending tickets stop the run; never retry an
// unknown upload, create source declarations, grant publication, or use API writes.
const required = (key: string) => { const value = process.env[key]; assert.ok(value, `${key} required`); return value; };
const output = resolve(required("SG_PRODUCT_REAL_MATERIAL_OUTPUT"));
await mkdir(output, { recursive: true, mode: 0o700 });
const login = JSON.parse(await readFile(required("SG_PRODUCT_DEPLOYMENT_LOGIN_FILE"), "utf8"));
const inspect = process.env.SG_PRODUCT_REAL_MATERIAL_INSPECT === "1";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1464, height: 1074 } });
const errors: string[] = [], writes: string[] = [];
const transport: { method: string; status: number; stage: string; code: string | null }[] = [];
let step = "login";
page.on("pageerror", e => errors.push(e.name));
page.on("request", r => { const path = new URL(r.url()).pathname; if (r.method() !== "GET" && path.startsWith("/api/") && path !== "/api/operator/login") writes.push(path); });
page.on("response", async r => {
  const path = new URL(r.url()).pathname;
  if (!path.includes("/material-uploads")) return;
  let code: string | null = null;
  if (!r.ok()) { try { const body = await r.json(); if (typeof body?.error?.code === "string" && /^[A-Z_]+$/.test(body.error.code)) code = body.error.code; } catch { /* Never store raw responses. */ } }
  transport.push({ method: r.request().method(), status: r.status(), stage: path.endsWith("/bytes") ? "bytes" : "ticket", code });
});
try {
  await page.goto(process.env.SG_PRODUCT_WEB_URL ?? "http://127.0.0.1:3100");
  await page.getByLabel("登录名", { exact: true }).fill(login.loginName);
  await page.getByLabel("密码", { exact: true }).fill(login.password); login.password = "";
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "运营工作台", exact: true }).waitFor();
  const projectsRead = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/operator/projects");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  const projects = listProjectsResponseSchema.parse(await (await projectsRead).json()).projects;
  await page.getByRole("heading", { name: "项目列表", exact: true }).waitFor();
  if (inspect) {
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await writeFile(resolve(output, "projects.json"), JSON.stringify(projects.map(p => ({ projectId: p.projectId, name: p.name })), null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ inspectedProjects: projects.length, businessWrites: 0 }));
  } else {
    assert.equal(required("SG_PRODUCT_REAL_MATERIAL_AUTHORIZED"), "1");
    const name = required("SG_PRODUCT_REAL_MATERIAL_PROJECT_NAME");
    const targets = projects.filter(p => p.name === name); assert.ok(targets.length <= 1, "Ambiguous project name");
    const workspace = page.locator(".project-workspace");
    let project = targets[0];
    if (!project) {
      assert.equal(process.env.SG_PRODUCT_REAL_MATERIAL_CREATE_IF_MISSING, "1", "Existing project required unless creation explicitly selected");
      step = "create-preparing-project";
      await workspace.getByRole("button", { name: "新建项目", exact: true }).click();
      await workspace.getByLabel("项目名称", { exact: true }).fill(name);
      const ack = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/operator/projects");
      await workspace.getByRole("button", { name: "创建筹备项目", exact: true }).click();
      const response = await ack; assert.equal(response.status(), 201);
      project = projectResponseSchema.parse(await response.json()).project;
      await workspace.getByText(/基本信息已保存；仍在筹备/).waitFor();
      await workspace.getByRole("button", { name: "返回项目列表", exact: true }).click();
    }
    const files: unknown = JSON.parse(required("SG_PRODUCT_REAL_MATERIAL_FILES"));
    assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 5 && files.every(f => typeof f === "string" && isAbsolute(f)));
    const material = page.getByRole("region", { name: "项目素材", exact: true });
    const inventory = page.getByRole("region", { name: "已保存的文件上传记录", exact: true });
    async function openMaterial() {
      await workspace.getByRole("row").filter({ has: page.getByText(name, { exact: true }) }).getByRole("button", { name: "打开项目", exact: true }).click();
      const read = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/operator/projects/${project.projectId}/material-uploads`);
      await workspace.getByRole("button", { name: "素材", exact: true }).click();
      const response = await read; assert.equal(response.status(), 200);
      const result = materialUploadInventoryResponseSchema.parse(await response.json());
      assert.equal(result.nextAfterObjectId, null, "Stop rather than assume hidden older uploads absent");
      return result.tickets;
    }
    step = "original-inventory";
    const before = await openMaterial();
    if (process.env.SG_PRODUCT_REAL_MATERIAL_INSPECT_INVENTORY === "1") {
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      await writeFile(resolve(output, "inventory.json"), JSON.stringify({ projectId: project.projectId, projectName: name, tickets: before }, null, 2), { mode: 0o600 });
      await writeFile(resolve(output, "inventory-material.txt"), await material.innerText(), { mode: 0o600 });
      await inventory.screenshot({ path: resolve(output, "original-inventory.png") });
      console.log(JSON.stringify({ inspectedTickets: before.length, businessWrites: 0 }));
    } else {
    const evidence: { file: string; bytes: number; sha256: string; objectId: string; reused: boolean }[] = [];
    for (const file of files as string[]) {
      const bytes = await readFile(file); assert.ok(bytes.length > 0 && bytes.length <= materialUploadHttpMaxBytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = before.filter(t => t.sha256 === sha256 && t.bytes === bytes.length);
      assert.ok(existing.every(t => t.status === "verified_bytes"), "Original pending upload needs reconciliation, not resubmission");
      let ticket = existing[0];
      if (!ticket) {
        step = `upload-${basename(file)}`;
        await material.locator('input[type="file"]').setInputFiles(file);
        const row = material.getByRole("row").filter({ hasText: basename(file) });
        const ack = page.waitForResponse(r => r.request().method() === "PUT" && /\/material-uploads\/[a-f0-9-]+\/bytes$/.test(new URL(r.url()).pathname), { timeout: 120_000 });
        await row.getByRole("button", { name: "上传／重试原文件", exact: true }).click();
        assert.equal((await ack).status(), 200);
        await row.getByText("文件字节已校验", { exact: true }).waitFor();
        const read = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/operator/projects/${project.projectId}/material-uploads`);
        await inventory.getByRole("button", { name: "读取上传记录", exact: true }).click();
        const current = materialUploadInventoryResponseSchema.parse(await (await read).json());
        ticket = current.tickets.find(t => t.sha256 === sha256 && t.bytes === bytes.length);
      }
      assert.ok(ticket); assert.equal(ticket.status, "verified_bytes");
      assert.equal(ticket.candidateAllowed, false); assert.equal(ticket.publicationAllowed, false);
      evidence.push({ file: basename(file), bytes: ticket.bytes, sha256, objectId: ticket.objectId, reused: existing.length > 0 });
    }
    step = "reload-original-receipts";
    await page.reload();
    await page.getByRole("button", { name: "项目", exact: true }).click();
    const persisted = await openMaterial();
    for (const item of evidence) {
      const ticket = persisted.find(t => t.objectId === item.objectId); assert.ok(ticket);
      assert.equal(ticket.sha256, item.sha256); assert.equal(ticket.bytes, item.bytes); assert.equal(ticket.status, "verified_bytes");
      const row = inventory.getByRole("listitem").filter({ hasText: item.sha256 });
      await row.locator("summary").click();
      await row.getByText(item.objectId, { exact: true }).waitFor();
      await row.getByText("原文件字节已校验", { exact: true }).waitFor();
    }
    assert.ok(writes.every(p => /^\/api\/operator\/projects\/[a-f0-9-]+\/material-uploads(?:\/[a-f0-9-]+\/bytes)?$/.test(p) || (p === "/api/operator/projects" && !targets.length)), "Only project creation and original file upload writes allowed");
    assert.deepEqual(errors, []);
    await inventory.screenshot({ path: resolve(output, "persisted-original-files.png") });
    await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, projectId: project.projectId, projectName: name, evidence, reloadPreservesVerifiedUpload: true, writes, publication: false, businessAcceptance: "file_bytes_only", at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ passed: true, originalFiles: evidence.length, publication: false, businessAcceptance: "file_bytes_only" }));
    }
  }
} catch {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ passed: false, step, writes, acceptance: "not_completed" }), { mode: 0o600 });
  const material = page.getByRole("region", { name: "项目素材", exact: true });
  if (await material.isVisible()) { await writeFile(resolve(output, "failure-material.txt"), await material.innerText(), { mode: 0o600 }); await material.screenshot({ path: resolve(output, "failure-material.png") }); }
  console.error(JSON.stringify({ passed: false, step })); process.exitCode = 1;
} finally { login.password = ""; await writeFile(resolve(output, "transport.json"), JSON.stringify(transport, null, 2), { mode: 0o600 }); await browser.close(); }
