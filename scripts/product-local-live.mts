import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  const env = { ...ambient, SG_PRODUCT_DATABASE_URL: databaseUrl, SG_PRODUCT_AUTH_PEPPER: config.authPepper,
    SG_PRODUCT_SMS_MODE: "development_capture", SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: config.developmentSmsToken,
    SG_PRODUCT_BACKEND_HOST: "127.0.0.1", SG_PRODUCT_BACKEND_PORT: "4320", SG_PRODUCT_TRUST_PROXY_HOPS: "1",
    SG_PRODUCT_MATERIAL_MODE: "unavailable", SG_PRODUCT_BUSINESS_MODEL_MODE: "unavailable" };
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
      containerId: config.containerId, smsMode: "development_capture", phoneFactsSeeded: false, executorEnabled: false,
      web: "http://127.0.0.1:3100", backend: "http://127.0.0.1:4320" }, null, 2));
  } finally { await pool.end(); }
  console.log("[product-local] persistent owned database prepared; no device facts seeded; executor disabled");
  if (mode === "serve") {
    await free(3100); await free(4320);
    const children: ReturnType<typeof spawn>[] = [];
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; for (const child of children) if (child.exitCode === null && child.pid) process.kill(-child.pid, "SIGTERM"); };
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
      await ready("http://127.0.0.1:4320/health/live");
      const web = serve("web", ["--filter", "@socialgrowth/product-web", "exec", "vite", "--host", "127.0.0.1", "--port", "3100", "--strictPort"]);
      await ready("http://127.0.0.1:3100");
      console.log("[product-local] Web 3100 / backend 4320 ready; Ctrl+C stops owned services, database retained");
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
