import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
const schema = "socialgrowth_product", format = "2026-10-01.database-inventory-v1";
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const inventorySchema = z.strictObject({ format: z.literal(format), postgresMajor: z.literal(17),
  tables: z.array(z.strictObject({ table: identifier, rows: z.int().min(0).max(10000), bytes: z.int().min(0).max(8 * 1024 * 1024), sha256: digest })).min(1).max(1000),
  definitions: z.strictObject({ relations: digest, columns: digest, constraints: digest, triggers: digest, indexes: digest, functions: digest, policies: digest })
}).refine(v => v.tables.every((t, i) => i === 0 || t.table > v.tables[i - 1]!.table)
  && v.tables.reduce((n, t) => n + t.rows, 0) <= 100000 && v.tables.reduce((n, t) => n + t.bytes, 0) <= 128 * 1024 * 1024);
export type DatabaseRestoreInventory = z.infer<typeof inventorySchema>;
export class DatabaseInventoryError extends Error {
  constructor(readonly code: "INVENTORY_INVALID" | "INVENTORY_UNAVAILABLE") { super(code); }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parse(input: unknown): DatabaseRestoreInventory {
  const p = inventorySchema.safeParse(input); if (!p.success) throw new DatabaseInventoryError("INVENTORY_INVALID"); return p.data;
}
function canonicalConstraint(row: { relname: string; conname: string; definition: string }) {
  // Only the three original, real pg_dump AND reparsing equivalences. No
  // general SQL rewrite/parenthesis stripping or ignored constraint definitions.
  for (const [table, constraint, column] of [["projects", "projects_name_check", "name"], ["projects", "projects_customer_name_check", "customer_name"], ["device_assistance_notes", "device_assistance_notes_text_check", "text"]]) {
    if (row.relname === table && row.conname === constraint && row.definition === `CHECK ((((length(${column}) >= 1) AND (length(${column}) <= 150)) AND (${column} = btrim(${column}))))`)
      return { ...row, definition: `CHECK (((length(${column}) >= 1) AND (length(${column}) <= 150) AND (${column} = btrim(${column}))))` };
  }
  return row;
}
async function inventory(c: PoolClient): Promise<DatabaseRestoreInventory> {
  const version = Number((await c.query("SHOW server_version_num")).rows[0].server_version_num);
  if (Math.floor(version / 10000) !== 17) throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
  const relations = (await c.query(`SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname COLLATE "C"`, [schema])).rows as { relname: string; relkind: string }[];
  if (!relations.length || relations.length > 5000 || relations.some(r => !identifier.safeParse(r.relname).success || !["r", "i"].includes(r.relkind))) throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
  const tables: DatabaseRestoreInventory["tables"] = []; let totalRows = 0, totalBytes = 0;
  for (const r of relations.filter(v => v.relkind === "r")) {
    // Never receive raw row values before bounded aggregate preflight. Same
    // read-only repeatable snapshot, not a count on another connection.
    const totals = (await c.query(`SELECT count(*)::text rows,coalesce(sum(octet_length(row_to_json(t)::text)),0)::text bytes FROM ${schema}.${r.relname} t`)).rows[0];
    const rows = Number(totals.rows), bytes = Number(totals.bytes); totalRows += rows; totalBytes += bytes;
    if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(bytes) || rows > 10000 || bytes > 8 * 1024 * 1024 || totalRows > 100000 || totalBytes > 128 * 1024 * 1024) throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
    const values = (await c.query(`SELECT row_to_json(t)::text value FROM ${schema}.${r.relname} t ORDER BY row_to_json(t)::text COLLATE "C" LIMIT 10001`)).rows.map((v: { value: string }) => v.value);
    if (values.length !== rows) throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE"); tables.push({ table: r.relname, rows, bytes, sha256: hash(values) });
  }
  const columns = (await c.query(`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) default_expression,cn.nspname collation_schema,co.collname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type ty ON ty.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=ty.typnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND tn.nspname='pg_catalog' ORDER BY c.relname COLLATE "C",a.attnum`, [schema])).rows;
  const unsupportedTypes = (await c.query(`SELECT count(*)::text count FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND tn.nspname<>'pg_catalog'`, [schema])).rows[0];
  if (unsupportedTypes.count !== "0") throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
  const constraints = (await c.query(`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) definition,k.convalidated,k.condeferrable,k.condeferred FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname COLLATE "C",k.conname COLLATE "C"`, [schema])).rows.map(canonicalConstraint);
  const triggers = (await c.query(`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname COLLATE "C",t.tgname COLLATE "C"`, [schema])).rows;
  const indexes = (await c.query(`SELECT c.relname,i.relname indexname,pg_get_indexdef(x.indexrelid) definition,x.indisvalid,x.indisready,x.indisunique,x.indisprimary FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname COLLATE "C",i.relname COLLATE "C"`, [schema])).rows;
  const functions = (await c.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,p.prokind,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C"`, [schema])).rows;
  if ((await c.query(`SELECT count(*)::text count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind NOT IN ('f','p')`, [schema])).rows[0].count !== "0") throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
  const policies = (await c.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles::text roles,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) with_check FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname COLLATE "C",p.polname COLLATE "C"`, [schema])).rows;
  return parse({ format, postgresMajor: 17, tables, definitions: { relations: hash(relations), columns: hash(columns), constraints: hash(constraints), triggers: hash(triggers), indexes: hash(indexes), functions: hash(functions), policies: hash(policies) } });
}
// TRUSTED SERVER MAINTENANCE ONLY; no HTTP/fs/pg_restore or production runner.
// Technical bounds are not capacity/RPO/RTO. Exported snapshot lives only until
// callback ends; its consumer MUST use this exact snapshot for the trusted dump.
// Digests are internal sensitive metadata, not source approval or current facts.
export async function withDatabaseInventorySnapshot<T>(pool: Pool, useSnapshot: (value: { snapshotId: string; inventory: DatabaseRestoreInventory }) => Promise<T>): Promise<T> {
  let c: PoolClient | undefined, destroy = false;
  try {
    c = await pool.connect(); await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET LOCAL statement_timeout='5s'"); await c.query("SET LOCAL idle_in_transaction_session_timeout='30s'"); await c.query("SET LOCAL row_security=off");
    await c.query("SET LOCAL search_path=pg_catalog"); await c.query("SET LOCAL TimeZone='UTC'"); await c.query("SET LOCAL DateStyle='ISO,YMD'");
    await c.query("SET LOCAL bytea_output='hex'"); await c.query("SET LOCAL extra_float_digits=3"); await c.query("SET LOCAL IntervalStyle='postgres'");
    const result = await inventory(c), snapshotId: string = (await c.query("SELECT pg_export_snapshot() snapshot")).rows[0].snapshot;
    if (!/^[0-9A-Fa-f-]{1,100}$/.test(snapshotId)) throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
    const output = await useSnapshot({ snapshotId, inventory: structuredClone(result) }); await c.query("COMMIT"); return output;
  } catch {
    if (c) { try { await c.query("ROLLBACK"); } catch { destroy = true; } }
    throw new DatabaseInventoryError("INVENTORY_UNAVAILABLE");
  } finally { c?.release(destroy); }
}
export function compareDatabaseRestoreInventories(expected: unknown, restored: unknown) {
  const left = parse(expected), right = parse(restored);
  return { sameSchemaAndRows: JSON.stringify(left) === JSON.stringify(right), requiresReconciliation: true as const, executionAllowed: false as const, publicationAllowed: false as const };
}
