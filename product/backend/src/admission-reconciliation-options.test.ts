import assert from "node:assert/strict";
import test from "node:test";
import { readAdmissionReconciliationOptions } from "./admission-reconciliation-options.js";

const environment = { SG_PRODUCT_ADMISSION_RECONCILE_ENABLED: "1", SG_PRODUCT_DATABASE_URL: "postgresql://isolated-test-only" };

test("admission maintenance is explicitly enabled and always bounded with a resumable cursor", () => {
  assert.deepEqual(readAdmissionReconciliationOptions([], environment), { databaseUrl: environment.SG_PRODUCT_DATABASE_URL, limit: 100, cursor: null });
  const cursor = "018f47ac-7a69-7db4-a572-8c62f3650191";
  assert.equal(readAdmissionReconciliationOptions(["--", "--limit", "1000", "--cursor", cursor], environment).cursor, cursor);
  for (const config of [{}, { SG_PRODUCT_DATABASE_URL: "sensitive-url" }, { SG_PRODUCT_ADMISSION_RECONCILE_ENABLED: "true", SG_PRODUCT_DATABASE_URL: "sensitive-url" }]) {
    assert.throws(() => readAdmissionReconciliationOptions([], config), (error: unknown) => error instanceof Error && !error.message.includes("sensitive-url") && error.cause === undefined);
  }
});

test("maintenance rejects unbounded, duplicate, unknown and secret-bearing CLI arguments without echoing them", () => {
  for (const args of [["--limit", "0"], ["--limit", "1001"], ["--limit", "1e2"], ["--limit", "Infinity"],
    ["--limit", "1", "--limit", "2"], ["--cursor", "secret-marker"], ["--password", "secret-marker"], ["--cursor"]]) {
    assert.throws(() => readAdmissionReconciliationOptions(args, environment), (error: unknown) => error instanceof Error && !error.message.includes("secret-marker") && error.cause === undefined);
  }
});
