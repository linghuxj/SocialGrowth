// Explicit release step, not an application-startup side effect.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.SG_PRODUCT_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
let client;
try {
  if (!process.env.SG_PRODUCT_DATABASE_URL) throw new Error("database configuration required");
  client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(731042019)");
  await client.query(`CREATE TABLE IF NOT EXISTS public.socialgrowth_schema_migrations (
    name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(new URL("./migrations/", import.meta.url))).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (files.length === 0) throw new Error("migrations missing");
  const applied = (await client.query("SELECT name, sha256 FROM public.socialgrowth_schema_migrations")).rows;
  if (applied.some(row => !files.includes(row.name))) throw new Error("database has migrations absent from this release");
  for (const name of files) {
    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    const previous = applied.find(row => row.name === name);
    if (previous) {
      if (previous.sha256 !== digest) throw new Error(`migration changed: ${name}`);
      continue;
    }
    // Existing migrations own BEGIN/COMMIT. Put their body and ledger together.
    if (!/^BEGIN;\s/.test(sql) || !/COMMIT;\s*$/.test(sql)) throw new Error(`migration transaction format invalid: ${name}`);
    await client.query("BEGIN");
    try {
      await client.query(sql.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, ""));
      await client.query("INSERT INTO public.socialgrowth_schema_migrations(name,sha256) VALUES($1,$2)", [name, digest]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    console.log(JSON.stringify({ applied: name }));
  }
  console.log(JSON.stringify({ migrations: files.length, status: "current" }));
} catch (error) {
  // Do not log connection URLs, SQL detail or credentials.
  console.error(JSON.stringify({ status: "failed", code: typeof error?.code === "string" ? error.code : "MIGRATION_FAILED" }));
  process.exitCode = 1;
} finally {
  if (client) { await client.query("SELECT pg_advisory_unlock(731042019)").catch(() => {}); client.release(); }
  await pool.end();
}
