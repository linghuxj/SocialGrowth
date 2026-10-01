import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { OperatorAuthService } from "./operator-auth-service.js";
import { TaskRecheckJournal, TaskRecheckJournalError } from "./task-recheck-journal.js";
import { ProductTransactionError } from "./product-transaction-error.js";
test("pending journal rejects malformed locators/commands before touching DB, with private dependencies", async () => {
  let calls = 0; const pool = { connect: async () => { calls++; throw new Error("must-not-disclose-database-url"); } } as unknown as Pool;
  const journal = new TaskRecheckJournal(pool, {} as OperatorAuthService); assert.equal(JSON.stringify(journal), "{}");
  await assert.rejects(journal.read("", "bad", "bad"), e => e instanceof ProductTransactionError && e.code === "INPUT_INVALID");
  await assert.rejects(journal.save("", "", { executionAllowed: true }), e => e instanceof ProductTransactionError && e.code === "INPUT_INVALID"); assert.equal(calls, 0);
});
test("relay unavailable default does not touch DB/transport; invalid lease does not become retry/action authority", async () => {
  let calls = 0; const journal = new TaskRecheckJournal({ connect: async () => { calls++; throw new Error("private"); } } as unknown as Pool, {} as OperatorAuthService);
  await assert.rejects(journal.relayOne(), e => e instanceof TaskRecheckJournalError && e.code === "TRANSPORT_REQUIRED");
  for (const lease of [0, 99, 60001, NaN, 1.2]) await assert.rejects(journal.relayOne({ send: async () => { calls++; return null; } }, lease), e => e instanceof ProductTransactionError && e.code === "INPUT_INVALID"); assert.equal(calls, 0);
  await assert.rejects(journal.relayOne({ send: async () => null }), e => e instanceof ProductTransactionError && e.code === "INTERNAL_ERROR" && !e.message.includes("private")); assert.equal(calls, 1);
});
