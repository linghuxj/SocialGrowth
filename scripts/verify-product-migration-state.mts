import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const output = process.argv[2];
if (!output) throw new Error("Provide snapshot output path");
const env = parseEnv(await readFile(".env.runtime", "utf8"));
const database = resolve(env.SG_RUNTIME_DATA ?? ".runtime", "runtime.sqlite");
const db = new DatabaseSync(database, { readOnly: true });
const tables: Record<string, { rows: number; sha256: string }> = {};
const active: Record<string, number> = {};
try {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const table = String(row.name); if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name");
    const records = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    tables[table] = { rows: records.length, sha256: createHash("sha256").update(JSON.stringify(records)).digest("hex") };
  }
  active.tasks = Number(db.prepare("SELECT count(*) n FROM tasks WHERE status IN ('queued','running')").get()?.n);
  for (const [table, field, states] of [["web_verifications", "status", ["running"]], ["agent_controls", "state", ["active", "waiting", "revalidate"]], ["agent_requests", "status", ["waiting", "claimed"]], ["human_assistance", "status", ["waiting", "submitted", "claimed"]]] as const) {
    active[table] = Number(db.prepare(`SELECT count(*) n FROM ${table} WHERE json_extract(body,?) IN (${states.map(() => "?").join(",")})`).get(`$.${field}`, ...states)?.n);
  }
} finally { db.close(); }
const config = JSON.parse(await readFile(".runtime/product-local-live/config.json", "utf8")) as { databasePassword: string };
const { Pool } = createRequire(resolve("product/backend/package.json"))("pg") as typeof import("pg");
const pool = new Pool({ connectionString: `postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/sg_product_local_live`, max: 1 });
let central: { state: string; count: number }[];
try {
  central = (await pool.query<{ state: string; count: number }>("SELECT state,count(*)::int AS count FROM socialgrowth_product.business_plan_workflow_jobs GROUP BY state ORDER BY state")).rows;
} finally { await pool.end(); }
const snapshot = { createdAt: new Date().toISOString(), database, tables, active, central, readOnly: true };
await writeFile(output, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify({ tables: Object.keys(tables).length, active, central, secretsExported: false }));
if (Object.values(active).some(value => value !== 0) || central.some(row => ["queued", "claimed", "running"].includes(row.state))) process.exitCode = 2;
