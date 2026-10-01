import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { Pool } from "pg";
import { withDatabaseInventorySnapshot, compareDatabaseRestoreInventories, DatabaseInventoryError, type DatabaseRestoreInventory } from "./database-restore-inventory.js";
const cid = process.env.SG_PRODUCT_TEST_INVENTORY_CONTAINER_ID;
if (!cid || !/^[a-f0-9]{64}$/.test(cid) || process.env.SG_PRODUCT_TEST_ALLOW_RESET !== "1") throw new Error("Requires explicitly owned isolated inventory fixture");
const docker = (args: string[], input?: Buffer) => execFileSync("docker", args, { input, timeout: 30000, maxBuffer: 128 * 1024 * 1024 });
const source = new Pool({ connectionString: "postgresql://sg_inventory:synthetic-inventory-drill-only-00001@127.0.0.1:32878/sg_inventory_source", max: 1 });
const target = new Pool({ connectionString: "postgresql://sg_inventory:synthetic-inventory-drill-only-00001@127.0.0.1:32878/sg_inventory_restore", max: 1 });
const s = "socialgrowth_product", operatorId = randomUUID(), projectId = randomUUID(); let expected: DatabaseRestoreInventory, targetCreated = false;
async function guard() {
  const ids = docker(["ps", "-aq"]).toString().trim().split(/\s+/);
  // Explicit selected metadata only: do not retrieve any foreign Config.Env.
  const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Running":{{json .State.Running}},"AutoRemove":{{json .HostConfig.AutoRemove}},"Ports":{{json .NetworkSettings.Ports}},"Mounts":{{json .Mounts}}}';
  const all: { Id: string; Name: string; Image: string; Running: boolean; AutoRemove: boolean; Ports: unknown; Mounts: { Type: string; Name: string; Destination: string }[] }[] = docker(["inspect", "--format", format, ...ids]).toString().trim().split("\n").map(v => JSON.parse(v));
  const own = all.find(v => v.Id === cid); assert.ok(own); assert.equal(own.Name, "/sg-wp27-inventory-pg"); assert.equal(own.Running, true); assert.equal(own.AutoRemove, true);
  assert.equal(own.Image, "sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74"); assert.deepEqual(own.Ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "32878" }] });
  assert.equal(own.Mounts.length, 1); assert.equal(own.Mounts[0]!.Type, "volume"); assert.equal(own.Mounts[0]!.Destination, "/var/lib/postgresql/data"); assert.equal(all.filter(v => v.Mounts.some(m => m.Name === own.Mounts[0]!.Name)).length, 1);
  assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "socialgrowth.fixture"}}', cid!]).toString().trim(), "wp27-restore-inventory");
  const cluster = docker(["exec", cid!, "psql", "-U", "sg_inventory", "-d", "sg_inventory_source", "-Atc", "SELECT system_identifier FROM pg_control_system()"]).toString().trim(); assert.match(cluster, /^[0-9]{19}$/);
  for (const [p, db] of [[source, "sg_inventory_source"], ...(targetCreated ? [[target, "sg_inventory_restore"]] : [])] as [Pool, string][]) {
    assert.deepEqual((await p.query("SELECT current_database() db,current_user usr,system_identifier::text cluster FROM pg_control_system()")).rows[0], { db, usr: "sg_inventory", cluster });
  }
  console.log("owned metadata/TCP cluster PASS", cid, cluster);
}
const capture = (pool: Pool) => withDatabaseInventorySnapshot(pool, async v => v.inventory);
const same = (left: DatabaseRestoreInventory, right: DatabaseRestoreInventory) => compareDatabaseRestoreInventories(left, right).sameSchemaAndRows;
const unavailable = (e: unknown) => e instanceof DatabaseInventoryError && e.code === "INVENTORY_UNAVAILABLE" && e.message === e.code && !("cause" in e);
before(async () => {
  await guard(); await source.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  if (!(await source.query("SELECT 1 FROM pg_database WHERE datname='sg_inventory_restore'")).rowCount) await source.query("CREATE DATABASE sg_inventory_restore"); targetCreated = true; await guard(); await target.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  const dir = new URL("../migrations/", import.meta.url), names = (await readdir(dir)).filter(v => /^\d{4}.*\.sql$/.test(v)).sort(); for (const name of names) await source.query(await readFile(new URL(name, dir), "utf8"));
  await source.query(`INSERT INTO ${s}.operators(operator_id,login_name,display_name,password_hash,status) VALUES($1,$2,'Synthetic inventory','not-a-password','active')`, [operatorId, `fixture-${operatorId}`]);
  await source.query(`INSERT INTO ${s}.projects(project_id,name,kind,created_by_operator_id) VALUES($1,'Snapshot original','company_owned',$2)`, [projectId, operatorId]);
});
after(async () => { try { await guard(); await source.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); if (targetCreated) await target.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } finally { await target.end(); await source.end(); } });
test("actual owned read-only snapshot and same-snapshot dump restore preserve 66 tables plus column/index/function definitions", async () => {
  const dump = await withDatabaseInventorySnapshot(source, async v => {
    expected = structuredClone(v.inventory); assert.equal(expected.tables.length, 66);
    // Actual concurrent source mutation AFTER snapshot but BEFORE dump; use
    // a separate owned connection, not the held read-only pool connection.
    docker(["exec", cid!, "psql", "-U", "sg_inventory", "-d", "sg_inventory_source", "-Atc", `UPDATE ${s}.projects SET name='Source now newer' WHERE project_id='${projectId}'`]);
    return docker(["exec", cid!, "pg_dump", "-U", "sg_inventory", "-d", "sg_inventory_source", "-Fc", "--no-owner", "--no-acl", `--snapshot=${v.snapshotId}`]);
  });
  await guard(); docker(["exec", "-i", cid!, "pg_restore", "-U", "sg_inventory", "-d", "sg_inventory_restore", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"], dump); dump.fill(0);
  assert.equal(same(expected, await capture(target)), true); assert.equal(same(expected, await capture(source)), false);
  const result = compareDatabaseRestoreInventories(expected, await capture(target)); assert.equal(result.requiresReconciliation, true); assert.equal(result.executionAllowed, false); assert.equal(result.publicationAllowed, false);
});
test("explicit canonical session formatting avoids host timezone/date/byte output accidents and restores local settings", async () => {
  await target.query("SET TimeZone='America/New_York'"); await target.query("SET DateStyle='SQL,DMY'"); await target.query("SET bytea_output='escape'");
  assert.equal(same(expected, await capture(target)), true);
  assert.equal((await target.query("SHOW TimeZone")).rows[0].TimeZone, "America/New_York"); assert.equal((await target.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "off");
});
test("actual missing non-constraint index and changed function body are detected even when all rows remain identical", async () => {
  await guard(); const definition = (await target.query(`SELECT pg_get_indexdef('${s}.operator_sessions_operator_idx'::regclass) definition`)).rows[0].definition;
  await target.query(`DROP INDEX ${s}.operator_sessions_operator_idx`); const missing = await capture(target); assert.deepEqual(missing.tables, expected.tables); assert.notEqual(missing.definitions.indexes, expected.definitions.indexes); assert.equal(same(expected, missing), false); await target.query(definition);
  const functionDefinition = (await target.query(`SELECT pg_get_functiondef('${s}.material_reject_change()'::regprocedure) definition`)).rows[0].definition;
  await target.query(`CREATE OR REPLACE FUNCTION ${s}.material_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
  const changed = await capture(target); assert.deepEqual(changed.tables, expected.tables); assert.notEqual(changed.definitions.functions, expected.definitions.functions); assert.equal(same(expected, changed), false); await target.query(functionDefinition); assert.equal(same(expected, await capture(target)), true);
});
test("actual added column and changed CHECK term are detected without normalizing away semantic differences", async () => {
  await guard(); await target.query(`ALTER TABLE ${s}.projects ADD COLUMN synthetic_extra text`); const column = await capture(target); assert.notEqual(column.definitions.columns, expected.definitions.columns); assert.equal(same(expected, column), false); await target.query(`ALTER TABLE ${s}.projects DROP COLUMN synthetic_extra`);
  await target.query(`ALTER TABLE ${s}.projects DROP CONSTRAINT projects_name_check`); await target.query(`ALTER TABLE ${s}.projects ADD CONSTRAINT projects_name_check CHECK(length(name)>=1 AND length(name)<=151 AND name=btrim(name))`);
  const term = await capture(target); assert.notEqual(term.definitions.constraints, expected.definitions.constraints); assert.equal(same(expected, term), false);
  await target.query(`ALTER TABLE ${s}.projects DROP CONSTRAINT projects_name_check`); await target.query(`ALTER TABLE ${s}.projects ADD CONSTRAINT projects_name_check CHECK(length(name)>=1 AND length(name)<=150 AND name=btrim(name))`); assert.equal(same(expected, await capture(target)), true);
});
test("actual callback exception rolls back/releases pool and returns fixed error without raw secrets", async () => {
  await assert.rejects(withDatabaseInventorySnapshot(target, async () => { throw new Error("synthetic-secret-callback-fault"); }), unavailable);
  assert.equal(target.idleCount, 1); assert.equal((await target.query("SHOW transaction_isolation")).rows[0].transaction_isolation, "read committed"); assert.equal(same(expected, await capture(target)), true);
});
test("actual non-owner RLS cannot silently capture a partial successful inventory", async () => {
  await guard(); const role = `inventory_${randomUUID().replaceAll("-", "")}`, limited = new Pool({ connectionString: `postgresql://${role}:synthetic-limited-only@127.0.0.1:32878/sg_inventory_restore`, max: 1 });
  await target.query(`CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-limited-only'`);
  try {
    await target.query(`GRANT USAGE ON SCHEMA ${s} TO ${role}`); await target.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO ${role}`);
    await target.query(`ALTER TABLE ${s}.projects ENABLE ROW LEVEL SECURITY`); await target.query(`CREATE POLICY synthetic_deny ON ${s}.projects USING(false)`);
    assert.equal((await limited.query(`SELECT count(*)::text count FROM ${s}.projects`)).rows[0].count, "0"); let callbacks = 0;
    await assert.rejects(withDatabaseInventorySnapshot(limited, async () => { callbacks++; }), unavailable); assert.equal(callbacks, 0);
  } finally {
    await limited.end(); await target.query(`DROP POLICY IF EXISTS synthetic_deny ON ${s}.projects`); await target.query(`ALTER TABLE ${s}.projects DISABLE ROW LEVEL SECURITY`);
    await target.query(`REVOKE SELECT ON ALL TABLES IN SCHEMA ${s} FROM ${role}`); await target.query(`REVOKE USAGE ON SCHEMA ${s} FROM ${role}`); await target.query(`DROP ROLE ${role}`);
  }
  assert.equal(same(expected, await capture(target)), true);
});
test("unsupported view and actual row preflight overflow close before callback without truncating a successful inventory", async () => {
  await guard(); await target.query(`CREATE VIEW ${s}.synthetic_unsupported AS SELECT 1 AS value`); let callbacks = 0;
  try { await assert.rejects(withDatabaseInventorySnapshot(target, async () => { callbacks++; }), unavailable); } finally { await target.query(`DROP VIEW ${s}.synthetic_unsupported`); }
  await target.query(`INSERT INTO ${s}.operator_login_throttles(login_name,client_scope_digest,failure_count) SELECT 'fixture-'||i,decode(md5(i::text),'hex'),0 FROM generate_series(1,10001) i`);
  try { await assert.rejects(withDatabaseInventorySnapshot(target, async () => { callbacks++; }), unavailable); } finally { await target.query(`DELETE FROM ${s}.operator_login_throttles`); }
  assert.equal(callbacks, 0); assert.equal(same(expected, await capture(target)), true);
});
test("actual oversized row byte preflight closes before transferring values or invoking dump callback", async () => {
  await guard(); await target.query(`CREATE TABLE ${s}.synthetic_large(payload text)`); let callbacks = 0;
  try {
    await target.query(`INSERT INTO ${s}.synthetic_large VALUES(repeat('x',8*1024*1024+1))`);
    await assert.rejects(withDatabaseInventorySnapshot(target, async () => { callbacks++; }), unavailable);
  } finally { await target.query(`DROP TABLE ${s}.synthetic_large`); }
  assert.equal(callbacks, 0); assert.equal(same(expected, await capture(target)), true);
});
