import assert from "node:assert/strict";
import test from "node:test";
import { compareDatabaseRestoreInventories, DatabaseInventoryError } from "./database-restore-inventory.js";
const fixture = () => ({ format: "2026-10-01.database-inventory-v1", postgresMajor: 17, tables: [{ table: "synthetic", rows: 0, bytes: 0, sha256: "a".repeat(64) }],
  definitions: { relations: "b".repeat(64), columns: "b".repeat(64), constraints: "b".repeat(64), triggers: "b".repeat(64), indexes: "b".repeat(64), functions: "b".repeat(64), policies: "b".repeat(64) } });
test("inventory equality is only declared schema/row equivalence, never recovery/execute approval", () => {
  const left = fixture(), right = structuredClone(left), before = structuredClone(left);
  assert.deepEqual(compareDatabaseRestoreInventories(left, right), { sameSchemaAndRows: true, requiresReconciliation: true, executionAllowed: false, publicationAllowed: false });
  right.tables[0]!.rows = 1; assert.equal(compareDatabaseRestoreInventories(left, right).sameSchemaAndRows, false); assert.deepEqual(left, before);
});
test("every definition digest and row metadata mismatch refuses equality without returning raw data", () => {
  for (const field of Object.keys(fixture().definitions) as (keyof ReturnType<typeof fixture>["definitions"])[]) {
    const r = fixture(); r.definitions[field] = "c".repeat(64); assert.equal(compareDatabaseRestoreInventories(fixture(), r).sameSchemaAndRows, false);
  }
  for (const field of ["table", "bytes", "sha256"] as const) {
    const r = fixture(); Object.assign(r.tables[0]!, { [field]: field === "bytes" ? 1 : field === "table" ? "other" : "c".repeat(64) }); assert.equal(compareDatabaseRestoreInventories(fixture(), r).sameSchemaAndRows, false);
  }
});
test("strict inventory bound/order/duplicates/unknown fields fail with fixed errors", () => {
  for (const patch of [{ format: "future" }, { postgresMajor: 18 }, { tables: [] }, { executionAllowed: true }, { tables: [...fixture().tables, ...fixture().tables] },
    { tables: [{ ...fixture().tables[0], table: "z" }, { ...fixture().tables[0], table: "a" }] }, { tables: [{ ...fixture().tables[0], table: "unsafe;SQL" }] },
    { tables: [{ ...fixture().tables[0], rows: 10001 }] }, { tables: [{ ...fixture().tables[0], bytes: 8 * 1024 * 1024 + 1 }] },
    { tables: Array.from({ length: 11 }, (_, i) => ({ ...fixture().tables[0], table: `table_${String(i).padStart(2, "0")}`, rows: 10000 })) },
    { tables: Array.from({ length: 17 }, (_, i) => ({ ...fixture().tables[0], table: `table_${String(i).padStart(2, "0")}`, bytes: 8 * 1024 * 1024 })) },
    { definitions: { ...fixture().definitions, password: "synthetic" } }]) {
    assert.throws(() => compareDatabaseRestoreInventories({ ...fixture(), ...patch }, fixture()), e => e instanceof DatabaseInventoryError && e.code === "INVENTORY_INVALID" && e.message === e.code && !("cause" in e));
  }
});
