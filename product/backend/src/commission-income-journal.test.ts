import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { CommissionIncomeJournal, CommissionJournalError } from "./commission-income-journal.js";
import { OperatorAuthService } from "./operator-auth-service.js";
test("unconfigured producer closes reconcile before any DB connection or client claims", async () => {
  let connections = 0;
  const pool = { connect: async () => { connections++; throw new Error("should-never-connect"); } } as unknown as Pool;
  const journal = new CommissionIncomeJournal(pool, new OperatorAuthService(pool, "synthetic-unit-only-pepper-00000000000001"));
  const request = { metadata: { contractVersion, requestId: "request-commission-unit-0001", idempotencyKey: "commission-unit-key-0001" },
    incomeId: "00000000-0000-4000-8000-000000000001", expectedCurrentRevision: 0 };
  await assert.rejects(journal.reconcile("", "", request), (e: unknown) => e instanceof CommissionJournalError && e.code === "PRODUCER_UNAVAILABLE");
  await assert.rejects(journal.reconcile("", "", { ...request, received: true }), (e: unknown) => e instanceof CommissionJournalError && e.code === "INPUT_INVALID");
  assert.equal(connections, 0);
});
