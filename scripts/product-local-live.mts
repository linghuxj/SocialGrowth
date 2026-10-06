import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { stopOwnedProcessGroups } from "./product-local-process-lifecycle.js";
import { parseMaterialStorageConfig } from "../product/backend/src/material-object-storage.js";

async function main(): Promise<void> {
  // Persistent, owned LOOPBACK development environment. No phone/controller,
  // fabricated device facts, platform credentials, grants or queue consumption.
  // Development SMS follows R-157; it never asserts real SMS delivery.
  const repo = process.cwd(), dir = resolve(repo, ".runtime/product-local-live");
  const mode = process.argv[2];
  assert.ok(mode === "prepare" || mode === "serve", "Use prepare or serve");
  interface LocalConfig {
    version: 1; containerId: string | null; clusterId: string | null;
    databasePassword: string; authPepper: string; developmentSmsToken: string;
    operatorPassword: string;
  }
  interface PgClient {
    query<T extends object = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
    release(): void;
  }
  interface PgPool extends Pick<PgClient, "query"> {
    connect(): Promise<PgClient>;
    end(): Promise<void>;
  }
  const { Pool } = createRequire(resolve(repo, "product/backend/package.json"))("pg") as {
    Pool: new (options: { connectionString: string; max: number }) => PgPool;
  };
  const container = "socialgrowth-product-local-live", volume = `${container}-data`;
  const label = "socialgrowth.scope=product-local-live", database = "sg_product_local_live";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(dir), dir);
  const directory = await lstat(dir);
  assert.equal(directory.mode & 0o077, 0, "Private directory required");
  async function privateFile(path: string, value: string): Promise<void> {
    try { const old = await lstat(path); assert.ok(old.isFile() && !old.isSymbolicLink()); assert.equal(old.mode & 0o077, 0); }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
    await writeFile(path, value, { mode: 0o600 }); await chmod(path, 0o600);
  }
  let config: LocalConfig;
  try {
    const file = await lstat(resolve(dir, "config.json"));
    assert.ok(file.isFile() && !file.isSymbolicLink()); assert.equal(file.mode & 0o077, 0);
    config = JSON.parse(await readFile(resolve(dir, "config.json"), "utf8")) as LocalConfig;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    config = { version: 1, containerId: null, clusterId: null, databasePassword: randomBytes(32).toString("hex"),
      authPepper: randomBytes(32).toString("hex"), developmentSmsToken: randomBytes(32).toString("hex"), operatorPassword: randomBytes(32).toString("hex") };
  }
  assert.equal(config.version, 1);
  for (const value of [config.databasePassword, config.authPepper, config.developmentSmsToken, config.operatorPassword]) assert.match(value, /^[a-f0-9]{64}$/);
  const save = () => privateFile(resolve(dir, "config.json"), JSON.stringify(config, null, 2));
  await save();
  const mediaKeyPath = resolve(dir, "media-credential-keys.json");
  try {
    const file = await lstat(mediaKeyPath);
    assert.ok(file.isFile() && !file.isSymbolicLink());
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const encryptionKey = randomBytes(32), digestKey = randomBytes(32);
    try {
      await privateFile(mediaKeyPath, JSON.stringify({
        encryption: { keyId: "local-live-encryption-v1", keyBase64: encryptionKey.toString("base64") },
        currentDigestKeyId: "local-live-digest-v1",
        digestKeys: [{ keyId: "local-live-digest-v1", keyBase64: digestKey.toString("base64") }],
      }, null, 2));
    } finally { encryptionKey.fill(0); digestKey.fill(0); }
  }
  async function run(binary: string, args: string[], env?: NodeJS.ProcessEnv, input?: string): Promise<string> {
    const child = spawn(binary, args, { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", bytes => output += String(bytes));
    child.stderr.on("data", () => { /* Raw service/config errors stay off ordinary output. */ });
    const ended = once(child, "close"); child.stdin.end(input);
    const [code] = await ended; assert.equal(code, 0, `${binary} operation failed; no automatic reset`);
    return output;
  }
  async function inspect(type: "container" | "volume", name: string): Promise<Record<string, unknown> | null> {
    // Listing differentiates absence from a broken daemon; never create on an
    // ambiguous inspect failure or replace an existing resource.
    const listed = await run("docker", type === "container" ? ["ps", "-a", "--format", "{{.Names}}"] : ["volume", "ls", "--format", "{{.Name}}"]);
    if (!listed.split("\n").includes(name)) return null;
    const objects = JSON.parse(await run("docker", [type, "inspect", name])) as Record<string, unknown>[];
    assert.equal(objects.length, 1); return objects[0]!;
  }
  async function free(port: number): Promise<void> {
    const server = createServer();
    await new Promise<void>((yes, no) => { server.once("error", no); server.listen(port, "127.0.0.1", yes); });
    await new Promise<void>(yes => server.close(() => yes()));
  }
  const existingVolume = await inspect("volume", volume);
  if (existingVolume) assert.equal((existingVolume.Labels as Record<string, string>)?.["socialgrowth.scope"], "product-local-live");
  else await run("docker", ["volume", "create", "--label", label, volume]);
  let existing = await inspect("container", container);
  if (!existing) {
    assert.equal(config.containerId, null, "Original container absent; recovery required, no replacement");
    await free(55432);
    await privateFile(resolve(dir, "postgres.env"), `POSTGRES_USER=socialgrowth\nPOSTGRES_DB=${database}\nPOSTGRES_PASSWORD=${config.databasePassword}\n`);
    // Use the installed version explicitly; do not wait on an implicit pull or
    // silently substitute a different image after an ambiguous run outcome.
    await run("docker", ["run", "--pull=never", "-d", "--name", container, "--label", label, "--env-file", resolve(dir, "postgres.env"),
      "-p", "127.0.0.1:55432:5432", "-v", `${volume}:/var/lib/postgresql/data`, "postgres:17.11"]);
    existing = await inspect("container", container);
  }
  assert.ok(existing);
  const metadata = existing.Config as { Labels?: Record<string, string> };
  assert.equal(metadata.Labels?.["socialgrowth.scope"], "product-local-live");
  const mounts = existing.Mounts as { Type: string; Name: string; Destination: string }[];
  assert.equal(mounts.length, 1); assert.deepEqual(mounts.map(m => [m.Type, m.Name, m.Destination]), [["volume", volume, "/var/lib/postgresql/data"]]);
  if (config.containerId) assert.equal(existing.Id, config.containerId);
  else { config.containerId = String(existing.Id); await save(); }
  if (!(existing.State as { Running?: boolean }).Running) await run("docker", ["start", container]);
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await run("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "socialgrowth", "-d", database]); break; }
    catch { assert.ok(attempt < 59, "Owned PostgreSQL unavailable"); await new Promise(yes => setTimeout(yes, 500)); }
  }
  const databaseUrl = `postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/${database}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SG_|AWS_|ARTEMIS_|OPENAI_)/.test(key)));
  const backendPort = process.env.SG_PRODUCT_BACKEND_PORT ?? "4320";
  assert.match(backendPort, /^[0-9]{4,5}$/); assert.ok(Number(backendPort) <= 65535);
  const env = { ...ambient, SG_PRODUCT_DATABASE_URL: databaseUrl, SG_PRODUCT_AUTH_PEPPER: config.authPepper,
    SG_PRODUCT_SMS_MODE: "development_capture", SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: config.developmentSmsToken,
    SG_PRODUCT_BACKEND_HOST: "127.0.0.1", SG_PRODUCT_BACKEND_PORT: backendPort, SG_PRODUCT_TRUST_PROXY_HOPS: "1",
    SG_PRODUCT_MATERIAL_MODE: "unavailable", SG_PRODUCT_BUSINESS_MODEL_MODE: "unavailable",
    SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE: mediaKeyPath };
  // Persist explicitly installed pilot paths across normal pnpm dev restarts.
  // This file contains paths only, never Auth Key contents or admission facts.
  const networkNames = ["SG_PRODUCT_TAILNET_PILOT_CONFIG", "SG_PRODUCT_TAILNET_PILOT_AUTH_KEY_FILE",
    "SG_PRODUCT_TAILSCALE_CLI", "SG_PRODUCT_CENTER_ADB", "SG_PRODUCT_CENTER_ADB_USER_HOME", "SG_PRODUCT_CENTER_ADB_TAILSCALE_CLI"];
  let localNetwork: Record<string, string> = {};
  try {
    const path = resolve(dir, "network.env"), file = await lstat(path);
    assert.ok(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0);
    if (process.getuid) assert.equal(file.uid, process.getuid());
    localNetwork = parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  for (const [name, value] of Object.entries(localNetwork)) {
    assert.ok(networkNames.includes(name), "Unsupported local network configuration");
    assert.ok(value.startsWith("/") && !/[\r\n\0]/.test(value), "Absolute network path required");
    // A present configuration with missing targets must fail, not silently
    // disable the connection authority as if no configuration were installed.
    await lstat(value);
    Object.assign(env, { [name]: value });
  }
  // Explicit environment paths still override installed local paths.
  for (const name of networkNames) {
    const value = process.env[name];
    if (value) Object.assign(env, { [name]: value });
  }
  // Optional, explicitly installed local configuration. Never discover an
  // existing bucket, invent business proof, or fall back to ambient AWS keys.
  const materialConfigPath = resolve(dir, "material-storage.json");
  try {
    const file = await lstat(materialConfigPath);
    assert.ok(file.isFile() && !file.isSymbolicLink());
    assert.equal(file.mode & 0o077, 0, "Private material configuration required");
    if (process.getuid) assert.equal(file.uid, process.getuid());
    const material = parseMaterialStorageConfig(JSON.parse(await readFile(materialConfigPath, "utf8")));
    Object.assign(env, {
      SG_PRODUCT_MATERIAL_MODE: "configured", SG_PRODUCT_MATERIAL_LOCATION_ID: material.storageLocationId,
      SG_PRODUCT_MATERIAL_ENDPOINT: material.endpoint, SG_PRODUCT_MATERIAL_REGION: material.region,
      SG_PRODUCT_MATERIAL_BUCKET: material.bucket, SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: String(material.forcePathStyle),
      SG_PRODUCT_MATERIAL_ACCESS_KEY: material.accessKeyId, SG_PRODUCT_MATERIAL_SECRET_KEY: material.secretAccessKey,
      SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: String(material.maxObjectBytes),
      SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: String(material.requestTimeoutMs),
      ...(material.sessionToken ? { SG_PRODUCT_MATERIAL_SESSION_TOKEN: material.sessionToken } : {}),
    });
  } catch (error) {
    // A present-but-invalid file is a configuration failure, never silently
    // ignored as an unconfigured service.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Existing repository Artemis installation is the explicit local model and
  // execution configuration. Its secrets remain in its private dotenv file.
  const artemisRoot = resolve(repo, "integrations/google-artemis");
  try {
    await lstat(resolve(artemisRoot, ".venv/bin/python"));
    await lstat(resolve(artemisRoot, ".env"));
    Object.assign(env, { SG_PRODUCT_BUSINESS_MODEL_MODE: "artemis_configured", SG_PRODUCT_ARTEMIS_ROOT: artemisRoot });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    const runtime = parseEnv(await readFile(resolve(repo, ".env.runtime"), "utf8"));
    if (runtime.SG_RUNTIME_URL && runtime.SG_RUNTIME_TOKEN) Object.assign(env, {
      SG_PRODUCT_EXECUTION_RUNTIME_URL: runtime.SG_RUNTIME_URL, SG_PRODUCT_EXECUTION_RUNTIME_TOKEN: runtime.SG_RUNTIME_TOKEN,
    });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    const path = resolve(dir, "execution-binding.json"), file = await lstat(path);
    assert.ok(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0);
    const binding = JSON.parse(await readFile(path, "utf8")) as { deviceId: string; serial: string; runtimeBindingId: string; pageName?: string; identityId?: string; canonicalIdentityRef?: string; accountId?: string; runtimeAccountId?: string };
    assert.match(binding.deviceId, /^[a-f0-9-]{36}$/); assert.match(binding.serial, /^[A-Za-z0-9_-]{1,100}$/);
    assert.match(binding.runtimeBindingId, /^[A-Za-z0-9_-]{1,150}$/);
    if (binding.pageName !== undefined) assert.ok(typeof binding.pageName === "string" && binding.pageName.trim() === binding.pageName && binding.pageName.length > 0 && binding.pageName.length <= 150 && !/[\r\n]/.test(binding.pageName));
    if (binding.identityId !== undefined) assert.match(binding.identityId, /^[a-f0-9-]{36}$/);
    if (binding.accountId !== undefined) assert.match(binding.accountId, /^[a-f0-9-]{36}$/);
    if (binding.runtimeAccountId !== undefined) assert.match(binding.runtimeAccountId, /^[A-Za-z0-9_-]{1,150}$/);
    if (binding.canonicalIdentityRef !== undefined) assert.ok(typeof binding.canonicalIdentityRef === "string" && binding.canonicalIdentityRef.trim() === binding.canonicalIdentityRef && binding.canonicalIdentityRef.length > 0 && binding.canonicalIdentityRef.length <= 512 && !/[\r\n]/.test(binding.canonicalIdentityRef));
    Object.assign(env, { SG_PRODUCT_EXECUTION_DEVICE_ID: binding.deviceId, SG_PRODUCT_EXECUTION_SERIAL: binding.serial,
      SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID: binding.runtimeBindingId,
      ...(binding.identityId ? { SG_PRODUCT_EXECUTION_IDENTITY_ID: binding.identityId } : {}),
      ...(binding.accountId ? { SG_PRODUCT_EXECUTION_ACCOUNT_ID: binding.accountId } : {}),
      ...(binding.runtimeAccountId ? { SG_PRODUCT_EXECUTION_RUNTIME_ACCOUNT_ID: binding.runtimeAccountId } : {}),
      ...(binding.canonicalIdentityRef ? { SG_PRODUCT_EXECUTION_CANONICAL_REF: binding.canonicalIdentityRef } : {}),
      ...(binding.pageName ? { SG_PRODUCT_EXECUTION_PAGE_NAME: binding.pageName } : {}) });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    const actual = (await pool.query<{ database: string; cluster: string }>("SELECT current_database() AS database, system_identifier::text AS cluster FROM pg_control_system()")).rows[0]!;
    assert.equal(actual.database, database);
    if (config.clusterId) assert.equal(actual.cluster, config.clusterId); else { config.clusterId = actual.cluster; await save(); }
    await pool.query("CREATE TABLE IF NOT EXISTS public.sg_local_migrations(name text PRIMARY KEY, sha256 text NOT NULL)");
    const client = await pool.connect();
    try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('socialgrowth-product-local-migrations',0))");
    for (const name of (await readdir(resolve(repo, "product/backend/migrations"))).filter(n => /^\d{4}.*\.sql$/.test(n)).sort()) {
      const sql = await readFile(resolve(repo, "product/backend/migrations", name), "utf8"), digest = hash(sql);
      const prior = (await client.query<{ sha256: string }>("SELECT sha256 FROM public.sg_local_migrations WHERE name=$1", [name])).rows[0];
      if (prior) { assert.equal(prior.sha256, digest, "Applied migration changed; recovery required"); continue; }
      assert.match(sql.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
      const body = sql.trim().replace(/^BEGIN;/, "").replace(/COMMIT;$/, "");
      try {
        await client.query("BEGIN"); await client.query(body);
        await client.query("INSERT INTO public.sg_local_migrations(name,sha256) VALUES($1,$2)", [name, digest]); await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    } finally {
      try { await client.query("SELECT pg_advisory_unlock(hashtextextended('socialgrowth-product-local-migrations',0))"); }
      finally { client.release(); }
    }
    const operators = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM socialgrowth_product.operators")).rows[0]!.count;
    if (operators === 0) await run("pnpm", ["--filter", "@socialgrowth/product-backend", "operator:admin", "initialize", "--login-name", "device-live-local",
      "--display-name", "本机真机联调运营", "--request-id", `initialize-${randomUUID()}`], env, config.operatorPassword);
    await privateFile(resolve(dir, "ready.json"), JSON.stringify({ checkedAt: new Date().toISOString(), database, clusterId: config.clusterId,
      containerId: config.containerId, smsMode: "development_capture", phoneFactsSeeded: false, executorConfigured: ["SG_PRODUCT_EXECUTION_RUNTIME_URL", "SG_PRODUCT_EXECUTION_RUNTIME_TOKEN", "SG_PRODUCT_EXECUTION_DEVICE_ID", "SG_PRODUCT_EXECUTION_IDENTITY_ID", "SG_PRODUCT_EXECUTION_ACCOUNT_ID", "SG_PRODUCT_EXECUTION_RUNTIME_ACCOUNT_ID", "SG_PRODUCT_EXECUTION_CANONICAL_REF", "SG_PRODUCT_EXECUTION_PAGE_NAME"].every(key => key in env),
      materialMode: env.SG_PRODUCT_MATERIAL_MODE,
      web: "http://127.0.0.1:3100", backend: `http://127.0.0.1:${backendPort}` }, null, 2));
  } finally { await pool.end(); }
  console.log("[product-local] persistent owned database prepared; execution permissions checked per task; no device facts seeded");
  if (mode === "serve") {
    await free(3100); await free(Number(backendPort));
    const children: ReturnType<typeof spawn>[] = [];
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; stopOwnedProcessGroups(children); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const serve = (name: string, args: string[]) => {
      const child = spawn("pnpm", args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
      // Full logs may contain user-entered data; keep private and never print.
      let log = ""; child.stdout?.on("data", v => log += String(v)); child.stderr?.on("data", v => log += String(v));
      child.once("close", () => { void privateFile(resolve(dir, `${name}.log`), log).catch(() => { process.exitCode = 1; }); stop(); });
      return once(child, "close");
    };
    async function ready(url: string): Promise<void> {
      for (let n = 0; n < 100; n++) {
        try { if ((await fetch(url)).ok) return; } catch { /* retry health only */ }
        assert.ok(!stopping && n < 99, "Local service unavailable"); await new Promise(yes => setTimeout(yes, 250));
      }
    }
    try {
      const backend = serve("backend", ["--filter", "@socialgrowth/product-backend", "start"]);
      await ready(`http://127.0.0.1:${backendPort}/health/live`);
      const web = serve("web", ["--filter", "@socialgrowth/product-web", "exec", "vite", "--host", "127.0.0.1", "--port", "3100", "--strictPort"]);
      await ready("http://127.0.0.1:3100");
      console.log(`[product-local] Web 3100 / backend ${backendPort} ready; Ctrl+C stops owned services, database retained`);
      await Promise.all([backend, web]);
    } finally { stop(); }
  }
}
await main().catch(() => {
  // Assertions and PG errors can include raw private configuration. Emit only
  // the bounded operation; retain original resources for explicit recovery.
  console.error(JSON.stringify({ event: "product_local_environment_unavailable", automaticReset: false }));
  process.exitCode = 1;
});
