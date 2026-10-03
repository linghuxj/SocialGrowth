// Opt-in temporary LOCAL acceptance environment. No Demo/historical secrets,
// business seeds, device worker or platform publication. Direction scope uses
// the user's explicitly selected existing Artemis model environment.
// Run only with authorized temporary services and admitted browser access.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
const sqlOnly = process.env.SG_PRODUCT_CORE_SQL_ONLY === "1";
if (!sqlOnly && consent !== "1") throw new Error("First confirm actual browser policy admission; this runner cannot bypass a browser refusal");
const scopes = (process.env.SG_PRODUCT_CORE_SCOPES ?? "materials,planning").split(",");
assert.ok(scopes.length > 0 && scopes.every(scope => ["identity", "materials", "planning", "direction", "real-material-bytes", "operator-todos", "business-plan-postgres"].includes(scope)) && new Set(scopes).size === scopes.length);
const webMode = process.env.SG_PRODUCT_CORE_WEB_MODE ?? "development";
assert.ok(["development", "preview"].includes(webMode), "web mode must be development or preview");
const postgresOnlyScope = scopes.length === 1 && scopes[0] === "business-plan-postgres";
const storageNeeded = !(scopes.length === 1 && ["identity", "business-plan-postgres"].includes(scopes[0]));
const webPort = Number(process.env.SG_PRODUCT_CORE_WEB_PORT ?? "3300");
const backendPort = Number(process.env.SG_PRODUCT_CORE_BACKEND_PORT ?? "4420");
for (const [name, port] of [["SG_PRODUCT_CORE_WEB_PORT", webPort], ["SG_PRODUCT_CORE_BACKEND_PORT", backendPort]]) {
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, `${name} must be a loopback port between 1024 and 65535`);
}
assert.notEqual(webPort, backendPort, "web and backend require separate ports");
if (sqlOnly) assert.ok((scopes.length === 1 && scopes[0] === "direction") || postgresOnlyScope, "SQL-only supplemental scope must be explicit");
if (scopes.includes("business-plan-postgres")) {
  assert.deepEqual(scopes, ["business-plan-postgres"], "business-plan PostgreSQL scope must run alone");
  assert.equal(sqlOnly, true, "business-plan PostgreSQL scope requires SQL-only mode");
}
const artemisRoot = scopes.includes("direction") && !sqlOnly ? process.env.SG_PRODUCT_CORE_ARTEMIS_ROOT : null;
if (scopes.includes("direction") && !sqlOnly) assert.ok(artemisRoot && artemisRoot.startsWith("/"), "Direction requires an explicitly selected existing Artemis environment");
const realMaterialFiles = scopes.includes("real-material-bytes") ? process.env.SG_PRODUCT_CORE_REAL_MATERIAL_FILES : null;
if (scopes.includes("real-material-bytes")) assert.ok(realMaterialFiles && process.env.SG_PRODUCT_CORE_REAL_MATERIAL_AUTHORIZED === "1", "Actual files require explicit existing authorization");
const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SG_") && !key.startsWith("AWS_")));
const secrets = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), randomBytes(24).toString("hex"), randomBytes(24).toString("hex")];
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
async function waitFor(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Startup observation only. */ }
    await new Promise(yes => setTimeout(yes, 250));
  }
  throw new Error("Owned service readiness deadline exceeded");
}
let pool, s3;
try {
  await portFree(webPort); await portFree(backendPort);
  // Fresh managed worktrees do not have ignored dist/ output from a prior
  // developer build. Produce the backend runtime from this checkout before
  // starting its isolated service.
  await run("contracts-build", "pnpm", ["--filter", "@socialgrowth/product-contracts", "build"], {});
  await run("backend-build", "pnpm", ["--filter", "@socialgrowth/product-backend", "build"], {});
  if (webMode === "preview") await run("web-build", "pnpm", ["--filter", "@socialgrowth/product-web", "build"], {});
  const suffix = randomUUID(), owner = `sg-core-local-${suffix}`;
  for (const [kind, image, variables, containerPort, command] of [
    ["pg", "postgres:17.11", { POSTGRES_DB: "sg_core_local", POSTGRES_USER: "sg_core_local", POSTGRES_PASSWORD: secrets[0] }, 5432, []],
    ...(storageNeeded ? [["storage", "minio/minio:RELEASE.2024-01-11T07-46-16Z", { MINIO_ROOT_USER: "sg-core-local", MINIO_ROOT_PASSWORD: secrets[1] }, 9000, ["server", "/data"]]] : []),
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
  pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 2_000 });
  try { await waitFor(async () => (await pool.query("SELECT 1")).rowCount === 1, 60_000); }
  catch (error) {
    await writeFile(join(output, "postgres-startup.log"), redact(docker(["logs", pg.cid])));
    throw error;
  }
  await writeFile(join(output, "environment.json"), JSON.stringify({ scope: sqlOnly ? "synthetic non-UI PostgreSQL supplemental only" : "temporary environment starting", containers }, null, 2));
  if (scopes.includes("direction")) {
    await run("direction-postgres", "pnpm", ["--filter", "@socialgrowth/product-backend", "exec", "tsx", "--test", "src/project-direction-service.postgres-test.ts"], { SG_PRODUCT_TEST_DATABASE_URL: url, SG_PRODUCT_TEST_ALLOW_RESET: "1" });
    await run("business-plan-postgres", "pnpm", ["--filter", "@socialgrowth/product-backend", "exec", "tsx", "--test", "src/business-plan-service.postgres-test.ts"], { SG_PRODUCT_TEST_DATABASE_URL: url, SG_PRODUCT_TEST_ALLOW_RESET: "1" });
  }
  if (postgresOnlyScope) await run("business-plan-postgres", "pnpm", ["--filter", "@socialgrowth/product-backend", "exec", "tsx", "--test", "src/business-plan-service.postgres-test.ts"], { SG_PRODUCT_TEST_DATABASE_URL: url, SG_PRODUCT_TEST_ALLOW_RESET: "1" });
  if (!sqlOnly) {
  const migrations = (await readdir(join(repo, "product/backend/migrations"))).filter(f => /^\d{4}.*\.sql$/.test(f)).sort();
  for (const file of migrations) await pool.query(await readFile(join(repo, "product/backend/migrations", file), "utf8"));
  const endpoint = storage ? `http://127.0.0.1:${storage.port}` : null, bucket = `sg-core-${suffix}`;
  if (storage) {
    await waitFor(async () => (await fetch(`${endpoint}/minio/health/live`)).ok);
    s3 = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "sg-core-local", secretAccessKey: secrets[1] } });
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  const environment = {
    SG_PRODUCT_DATABASE_URL: url, SG_PRODUCT_AUTH_PEPPER: secrets[2], SG_PRODUCT_TRUST_PROXY_HOPS: "1", SG_PRODUCT_SMS_MODE: "unavailable",
    SG_PRODUCT_BACKEND_HOST: "127.0.0.1", SG_PRODUCT_BACKEND_PORT: String(backendPort), SG_PRODUCT_WEB_PORT: String(webPort), SG_PRODUCT_MATERIAL_MODE: storage ? "configured" : "unavailable",
    ...(storage ? {
    SG_PRODUCT_MATERIAL_LOCATION_ID: randomUUID(), SG_PRODUCT_MATERIAL_ENDPOINT: endpoint, SG_PRODUCT_MATERIAL_BUCKET: bucket,
    SG_PRODUCT_MATERIAL_REGION: "us-east-1", SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: "true", SG_PRODUCT_MATERIAL_ACCESS_KEY: "sg-core-local",
    SG_PRODUCT_MATERIAL_SECRET_KEY: secrets[1], SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: realMaterialFiles ? "67108864" : "16777216", SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: "5000",
    } : {}),
    SG_PRODUCT_TEST_LOGIN_NAME: "core-local-operator", SG_PRODUCT_TEST_PASSWORD: secrets[3], SG_PRODUCT_WEB_URL: `http://127.0.0.1:${webPort}`,
    ...(scopes.includes("identity") ? { SG_PRODUCT_TEST_SECOND_LOGIN_NAME: "core-local-secondary", SG_PRODUCT_TEST_SECOND_PASSWORD: secrets[4] } : {}),
    ...(artemisRoot ? { SG_PRODUCT_BUSINESS_MODEL_MODE: "artemis_configured", SG_PRODUCT_ARTEMIS_ROOT: artemisRoot } : {}),
  };
  await run("operator-initialize", "pnpm", ["--filter", "@socialgrowth/product-backend", "operator:admin", "initialize", "--login-name", "core-local-operator", "--display-name", "合成验收运营", "--request-id", `init-${suffix}`], environment, secrets[3]);
  service("backend", "pnpm", ["--filter", "@socialgrowth/product-backend", "start"], environment);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${backendPort}/health/live`)).ok);
  service("web", "pnpm", ["--filter", "@socialgrowth/product-web", "exec", "vite", ...(webMode === "preview" ? ["preview"] : []), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
    SG_PRODUCT_WEB_PORT: String(webPort), SG_PRODUCT_BACKEND_PORT: String(backendPort),
  });
  await waitFor(async () => (await fetch(environment.SG_PRODUCT_WEB_URL)).ok);
  const fixture = join(work, "synthetic-ui.png");
  await writeFile(fixture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7QAAAABJRU5ErkJggg==", "base64"));
  const declaration = { name: "合成页面验收素材", language: "en", businessEntityId: randomUUID(), sourceId: randomUUID(), sourceRecordId: randomUUID(),
    description: "合成 PNG；仅验上传和声明页面", businessFacts: "非真实商品事实", sourceStatement: "本次生成的合成文件，非真实来源证明", sourceEvidenceIds: randomUUID() };
  await writeFile(join(output, "environment.json"), JSON.stringify({ scope: realMaterialFiles ? "authorized actual original bytes; synthetic operator/project only; no first-use/source assertion" : "synthetic local UI only", containers, migrations, web: environment.SG_PRODUCT_WEB_URL,
    sourceReferences: "synthetic UUIDs, not verified rights", webMode, storageConfigured: Boolean(storage), browserAdmission: "explicit opt-in; browser flow result recorded separately" }, null, 2));
  if (scopes.includes("identity")) await run("identity-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "identity" });
  if (scopes.includes("materials")) await run("materials-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "materials",
    SG_PRODUCT_MATERIAL_TEST_FILE: fixture, SG_PRODUCT_MATERIAL_SCREENSHOT_DIR: join(output, "materials"), SG_PRODUCT_MATERIAL_TEST_DECLARATION: JSON.stringify(declaration) });
  if (realMaterialFiles) await run("real-material-bytes-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "real-material-bytes", SG_PRODUCT_REAL_MATERIAL_FILES: realMaterialFiles, SG_PRODUCT_REAL_MATERIAL_AUTHORIZED: "1", SG_PRODUCT_REAL_MATERIAL_FIRST_USE_CONFIRMED: process.env.SG_PRODUCT_CORE_REAL_MATERIAL_FIRST_USE_CONFIRMED ?? "0", SG_PRODUCT_REAL_MATERIAL_OUTPUT: join(output, "real-material-bytes") });
  if (scopes.includes("planning")) await run("planning-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "planning", SG_PRODUCT_PLANNING_SCREENSHOT_DIR: join(output, "planning") });
  if (scopes.includes("operator-todos")) await run("operator-todos-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "operator-todos", SG_PRODUCT_OPERATOR_TODOS_OUTPUT: join(output, "operator-todos") });
  if (scopes.includes("direction")) await run("direction-playwright", "pnpm", ["test:playwright"], { ...environment, SG_WEB_TARGET: "product", SG_PRODUCT_WEB_SCOPE: "direction", SG_PRODUCT_DIRECTION_SCREENSHOT_DIR: join(output, "direction"),
    SG_PRODUCT_DIRECTION_MATERIAL_CANDIDATE: process.env.SG_PRODUCT_DIRECTION_MATERIAL_CANDIDATE ?? "0", SG_PRODUCT_DIRECTION_PLAN_RESPONSE_DELAY_MS: process.env.SG_PRODUCT_DIRECTION_PLAN_RESPONSE_DELAY_MS ?? "0",
    SG_PRODUCT_DIRECTION_NARROW_PLAN_FLOW: process.env.SG_PRODUCT_DIRECTION_NARROW_PLAN_FLOW ?? "0",
    SG_PRODUCT_MATERIAL_TEST_FILE: fixture, SG_PRODUCT_MATERIAL_SCREENSHOT_DIR: join(output, "materials"), SG_PRODUCT_MATERIAL_TEST_DECLARATION: JSON.stringify(declaration) });
  const facts = (await pool.query(`SELECT (SELECT count(*)::int FROM socialgrowth_product.projects) projects,
    (SELECT count(*)::int FROM socialgrowth_product.material_variant_revisions) material_revisions,
    (SELECT count(*)::int FROM socialgrowth_product.project_planning_drafts WHERE status='unapproved_draft') unapproved_drafts,
    (SELECT count(*)::int FROM socialgrowth_product.project_direction_proposals) direction_proposals,
    (SELECT count(*)::int FROM socialgrowth_product.project_direction_approvals) direction_approvals,
    (SELECT count(*)::int FROM socialgrowth_product.material_upload_tickets WHERE status='verified_bytes') verified_byte_tickets`)).rows[0];
  await writeFile(join(output, "readonly-facts.json"), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify({ passed: true, scope: realMaterialFiles ? "actual authorized original bytes; no declaration/eligibility" : "author real UI checks; synthetic business inputs", scopes, facts, output }));
  } else console.log(JSON.stringify({ passed: true, scope: "isolated PostgreSQL supplemental only; no browser, real model or phone" }));
} finally {
  for (const { child } of children.toReversed()) {
    if (child.exitCode === null) { const ended = once(child, "exit"); process.kill(-child.pid, "SIGTERM"); await ended; }
  }
  const backendLog = children.find(item => item.name === "backend")?.log ?? "";
  const stages = new Set(["connection", "idempotency_read", "preflight", "model_fact_read", "persist_insufficient", "persist_plan", "model_describe", "model_coordinator"]);
  const categories = new Set(["serialization_conflict", "deadlock", "lock_timeout", "statement_timeout", "integrity_constraint", "other", "database_unavailable", "rollback_failed", "application_internal", "describe_timeout", "describe_unavailable", "configuration_missing", "input_invalid", "facts_unavailable", "model_unavailable", "deadline_exceeded", "clock_invalid"]);
  const directionCategories = new Set(["BUSINESS_MODEL_MODEL_TIMEOUT", "BUSINESS_MODEL_MODEL_RATE_LIMITED", "BUSINESS_MODEL_MODEL_CONFIGURATION_REJECTED", "BUSINESS_MODEL_MODEL_REQUEST_REJECTED", "BUSINESS_MODEL_MODEL_RESPONSE_INVALID", "BUSINESS_MODEL_CONFIGURED_MODEL_UNAVAILABLE", "BUSINESS_MODEL_UNAVAILABLE", "BUSINESS_MODEL_DEADLINE", "BUSINESS_MODEL_SCHEMA_INVALID", "BUSINESS_MODEL_NON_JSON_RESPONSE"]);
  const diagnostics = [];
  for (const line of backendLog.split("\n")) {
    try {
      const value = JSON.parse(line);
      if (value?.event === "business_plan_failure" && stages.has(value.stage) && categories.has(value.category)) diagnostics.push({ event: value.event, stage: value.stage, category: value.category });
      else if (value?.event === "project_direction_model_failed" && directionCategories.has(value.category)) diagnostics.push({ event: value.event, category: value.category });
      else if (value?.event === "direction_output_invalid" && Number.isSafeInteger(value.bytes) && value.bytes >= 0
        && Array.isArray(value.fields) && value.fields.every(field => ["direction", "rationale", "limitations", "object"].includes(String(field))))
        diagnostics.push({ event: value.event, bytes: value.bytes, fields: value.fields });
    } catch { /* Drop all backend log text outside the finite diagnostics schema. */ }
  }
  for (const item of children) await writeFile(join(output, `${item.name}.log`), item.name === "backend" ? `${diagnostics.map(entry => JSON.stringify(entry)).join("\n")}\n` : item.log);
  if (pool) {
    try {
      const counts = (await pool.query(`SELECT
        (SELECT count(*)::int FROM socialgrowth_product.business_plan_commands) AS command_count,
        (SELECT count(*)::int FROM socialgrowth_product.business_plan_revisions) AS revision_count,
        (SELECT count(*)::int FROM socialgrowth_product.business_plan_tasks) AS task_count,
        (SELECT count(*)::int FROM socialgrowth_product.business_plan_outbox) AS outbox_count`)).rows[0];
      const commands = await pool.query(`SELECT request_key,payload_digest,response->>'outcome' AS outcome,response->'plan'->>'revision' AS plan_revision
        FROM socialgrowth_product.business_plan_commands ORDER BY recorded_at`);
      const allowedOutcomes = new Set(["planned", "unchanged", "insufficient_data", "direction_confirmation_required"]);
      const rows = commands.rows.map(row => ({ idempotencyKeySha256: createHash("sha256").update(String(row.request_key)).digest("hex"),
        payloadDigestSha256: Buffer.isBuffer(row.payload_digest) ? row.payload_digest.toString("hex") : null,
        outcome: allowedOutcomes.has(String(row.outcome)) ? row.outcome : "unknown",
        planRevision: row.plan_revision !== null && Number.isSafeInteger(Number(row.plan_revision)) ? Number(row.plan_revision) : null }));
      await writeFile(join(output, "business-plan-readonly-facts.json"), JSON.stringify({ source: "isolated temporary PostgreSQL; read-only supplemental evidence",
        commandCount: counts.command_count, commandReceipts: rows, revisionCount: counts.revision_count, taskCount: counts.task_count, outboxCount: counts.outbox_count }, null, 2), { mode: 0o600 });
    } catch {
      await writeFile(join(output, "business-plan-readonly-facts.json"), JSON.stringify({ source: "isolated temporary PostgreSQL; read-only supplemental evidence", available: false, category: "read_only_query_failed" }, null, 2), { mode: 0o600 });
    }
  }
  await writeFile(join(output, "business-plan-diagnostics.json"), JSON.stringify({ entries: diagnostics }, null, 2), { mode: 0o600 });
  await pool?.end(); s3?.destroy();
  for (const owned of containers.toReversed()) {
    const current = JSON.parse(docker(["inspect", owned.cid]))[0];
    assert.equal(current.Id, owned.cid); assert.equal(current.Config.Labels["socialgrowth.fixture"], owned.owner);
    docker(["rm", "-f", "-v", owned.cid]);
  }
  await rm(work, { recursive: true });
  await writeFile(join(output, "cleanup.json"), JSON.stringify({ ownedServicesExited: true, ownedContainerIdsRemoved: containers.map(c => c.cid), temporaryCredentialsRemoved: true }, null, 2));
}
