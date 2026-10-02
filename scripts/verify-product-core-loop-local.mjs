// Opt-in temporary LOCAL acceptance environment. No Demo/historical secrets,
// business seeds, device worker, real model calls or platform publication.
// Run only with authorized temporary services and admitted browser access.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const repo = resolve(new URL("..", import.meta.url).pathname);
const backendRequire = createRequire(join(repo, "product/backend/package.json"));
const { Pool } = backendRequire("pg");
const { S3Client, CreateBucketCommand } = backendRequire("@aws-sdk/client-s3");
const output = resolve(process.env.SG_PRODUCT_CORE_OUTPUT ?? join(repo, "artifacts/acceptance/product/B3", `core-local-${Date.now()}`));
const consent = process.env.SG_PRODUCT_CORE_BROWSER_ADMITTED;
if (consent !== "1") throw new Error("First confirm actual browser policy admission; this runner cannot bypass a browser refusal");
const scopes = (process.env.SG_PRODUCT_CORE_SCOPES ?? "materials,planning").split(",");
assert.ok(scopes.length > 0 && scopes.every(scope => ["materials", "planning"].includes(scope)) && new Set(scopes).size === scopes.length);
const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SG_") && !key.startsWith("AWS_")));
const secrets = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), randomBytes(24).toString("hex")];
const redact = text => secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), String(text));
const containers = [], children = [];
const work = await mkdtemp(join(tmpdir(), "socialgrowth-core-local-"));
await mkdir(output, { recursive: true });
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", env: ambient });
  if (result.status !== 0) throw new Error("Owned Docker operation failed");
  return result.stdout.trim();
}
async function portFree(port) {
  const server = createServer();
  await new Promise((yes, no) => { server.once("error", no); server.listen(port, "127.0.0.1", yes); });
  await new Promise(yes => server.close(yes));
}
async function run(name, command, args, environment, stdin) {
  const child = spawn(command, args, { cwd: repo, env: { ...ambient, ...environment }, stdio: ["pipe", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", value => { log += redact(value); }); child.stderr.on("data", value => { log += redact(value); });
  child.stdin.end(stdin); const [code] = await once(child, "exit");
  await writeFile(join(output, `${name}.log`), log);
  console.log(JSON.stringify({ step: name, exitCode: code }));
  assert.equal(code, 0, `${name} failed; see sanitized log`);
}
function service(name, command, args, environment) {
  const child = spawn(command, args, { cwd: repo, env: { ...ambient, ...environment }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const item = { name, child, log: "" }; children.push(item);
  child.stdout.on("data", value => { item.log += redact(value); }); child.stderr.on("data", value => { item.log += redact(value); });
  return child;
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if (await check()) return; } catch { /* Startup observation only. */ }
    await new Promise(yes => setTimeout(yes, 250));
  }
  throw new Error("Owned service readiness deadline exceeded");
}
let pool, s3;
try {
  await portFree(3100); await portFree(4320);
  const suffix = randomUUID(), owner = `sg-core-local-${suffix}`;
  for (const [kind, image, variables, containerPort, command] of [
    ["pg", "postgres:17.11", { POSTGRES_DB: "sg_core_local", POSTGRES_USER: "sg_core_local", POSTGRES_PASSWORD: secrets[0] }, 5432, []],
    ["storage", "registry.hub.docker.com/minio/minio:RELEASE.2024-01-11T07-46-16Z", { MINIO_ROOT_USER: "sg-core-local", MINIO_ROOT_PASSWORD: secrets[1] }, 9000, ["server", "/data"]],
  ]) {
    const imageId = docker(["image", "inspect", "--format", "{{.Id}}", image]);
    const envFile = join(work, `${kind}.env`);
    await writeFile(envFile, Object.entries(variables).map(([k, v]) => `${k}=${v}`).join("\n"), { mode: 0o600 });
    const cid = docker(["run", "--name", `${owner}-${kind}`, "--label", `socialgrowth.fixture=${owner}`, "-d", "--env-file", envFile,
      "-p", `127.0.0.1::${containerPort}`, ...(kind === "storage" ? ["--tmpfs", "/data:rw"] : []), imageId, ...command]);
    const detail = JSON.parse(docker(["inspect", cid]))[0];
    assert.equal(detail.Config.Labels["socialgrowth.fixture"], owner);
    const port = detail.NetworkSettings.Ports[`${containerPort}/tcp`][0]; assert.equal(port.HostIp, "127.0.0.1");
    containers.push({ cid, owner, kind, port: port.HostPort, imageId });
  }
  const pg = containers.find(c => c.kind === "pg"), storage = containers.find(c => c.kind === "storage");
  const url = `postgres://sg_core_local:${secrets[0]}@127.0.0.1:${pg.port}/sg_core_local`;
  pool = new Pool({ connectionString: url, max: 2 }); await waitFor(async () => (await pool.query("SELECT 1")).rowCount === 1);
  const migrations = (await readdir(join(repo, "product/backend/migrations"))).filter(f => /^\d{4}.*\.sql$/.test(f)).sort();
  for (const file of migrations) await pool.query(await readFile(join(repo, "product/backend/migrations", file), "utf8"));
  const endpoint = `http://127.0.0.1:${storage.port}`, bucket = `sg-core-${suffix}`;
  await waitFor(async () => (await fetch(`${endpoint}/minio/health/live`)).ok);
  s3 = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "sg-core-local", secretAccessKey: secrets[1] } });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  const environment = {
    SG_PRODUCT_DATABASE_URL: url, SG_PRODUCT_AUTH_PEPPER: secrets[2], SG_PRODUCT_TRUST_PROXY_HOPS: "1", SG_PRODUCT_SMS_MODE: "unavailable",
    SG_PRODUCT_BACKEND_HOST: "127.0.0.1", SG_PRODUCT_BACKEND_PORT: "4320", SG_PRODUCT_MATERIAL_MODE: "configured",
    SG_PRODUCT_MATERIAL_LOCATION_ID: randomUUID(), SG_PRODUCT_MATERIAL_ENDPOINT: endpoint, SG_PRODUCT_MATERIAL_BUCKET: bucket,
    SG_PRODUCT_MATERIAL_REGION: "us-east-1", SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: "true", SG_PRODUCT_MATERIAL_ACCESS_KEY: "sg-core-local",
    SG_PRODUCT_MATERIAL_SECRET_KEY: secrets[1], SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "16777216", SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: "5000",
    SG_PRODUCT_TEST_LOGIN_NAME: "core-local-operator", SG_PRODUCT_TEST_PASSWORD: secrets[3], SG_PRODUCT_WEB_URL: "http://127.0.0.1:3100",
  };
  await run("operator-initialize", "pnpm", ["--filter", "@socialgrowth/product-backend", "operator:admin", "initialize", "--login-name", "core-local-operator", "--display-name", "合成验收运营", "--request-id", `init-${suffix}`], environment, secrets[3]);
  service("backend", "pnpm", ["--filter", "@socialgrowth/product-backend", "start"], environment);
  await waitFor(async () => (await fetch("http://127.0.0.1:4320/health/live")).ok);
  service("web", "pnpm", ["--filter", "@socialgrowth/product-web", "exec", "vite", "--host", "127.0.0.1", "--port", "3100", "--strictPort"], {});
  await waitFor(async () => (await fetch(environment.SG_PRODUCT_WEB_URL)).ok);
  const fixture = join(work, "synthetic-ui.png");
  await writeFile(fixture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7QAAAABJRU5ErkJggg==", "base64"));
  const declaration = { name: "合成页面验收素材", language: "en", businessEntityId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID(),
    description: "合成 PNG；仅验上传和声明页面", businessFacts: "非真实商品事实", sourceStatement: "本次生成的合成文件，非真实来源证明", sourceEvidenceIds: randomUUID() };
  await writeFile(join(output, "environment.json"), JSON.stringify({ scope: "synthetic local UI only", containers, migrations, web: environment.SG_PRODUCT_WEB_URL,
    sourceReferences: "synthetic UUIDs, not verified rights", browserAdmission: "actual IAB localhost navigation succeeded before runner" }, null, 2));
  if (scopes.includes("materials")) await run("materials-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "materials",
    SG_PRODUCT_MATERIAL_TEST_FILE: fixture, SG_PRODUCT_MATERIAL_SCREENSHOT_DIR: join(output, "materials"), SG_PRODUCT_MATERIAL_TEST_DECLARATION: JSON.stringify(declaration) });
  if (scopes.includes("planning")) await run("planning-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "planning", SG_PRODUCT_PLANNING_SCREENSHOT_DIR: join(output, "planning") });
  const facts = (await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.projects) projects,
    (SELECT count(*)::int FROM socialgrowth_product.material_variant_revisions) material_revisions,
    (SELECT count(*)::int FROM socialgrowth_product.project_planning_drafts WHERE status='unapproved_draft') unapproved_drafts`)).rows[0];
  await writeFile(join(output, "readonly-facts.json"), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify({ passed: true, scope: "C1/C2a author real UI checks; synthetic business inputs", scopes, facts, output }));
} finally {
  for (const { child } of children.toReversed()) {
    if (child.exitCode === null) { const ended = once(child, "exit"); process.kill(-child.pid, "SIGTERM"); await ended; }
  }
  for (const item of children) await writeFile(join(output, `${item.name}.log`), item.log);
  await pool?.end(); s3?.destroy();
  for (const owned of containers.toReversed()) {
    const current = JSON.parse(docker(["inspect", owned.cid]))[0];
    assert.equal(current.Id, owned.cid); assert.equal(current.Config.Labels["socialgrowth.fixture"], owned.owner);
    docker(["rm", "-f", "-v", owned.cid]);
  }
  await rm(work, { recursive: true });
  await writeFile(join(output, "cleanup.json"), JSON.stringify({ ownedServicesExited: true, ownedContainerIdsRemoved: containers.map(c => c.cid), temporaryCredentialsRemoved: true }, null, 2));
}
