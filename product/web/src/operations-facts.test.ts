import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import { readFact, factValue } from "./operations-facts.js";
import { ProductApiError } from "./operator-api.js";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
const sessionKey = "socialgrowth.operator.csrf";
const error401 = () => new ProductApiError({ contractVersion, requestId: "request-test-ops", error: { code: "AUTHENTICATION_REQUIRED", message: "expired", retryable: false } }, 401);
test("zero and empty successfully read values stay loaded; source failure is unknown", async () => {
  storage.set(sessionKey, "test-session");
  assert.equal(factValue(await readFact(async () => 0)), 0);
  assert.deepEqual(factValue(await readFact(async () => [])), []);
  assert.deepEqual(await readFact(async () => { throw new Error("network failure"); }), { status: "unknown", reason: "unavailable" });
});
test("current expired read notifies caller while old 401 cannot expire replacement login", async () => {
  storage.set(sessionKey, "old-session"); let expired = 0;
  assert.deepEqual(await readFact(async () => { storage.delete(sessionKey); throw error401(); }, () => expired++), { status: "unknown", reason: "unauthorized" });
  assert.equal(expired, 1);
  storage.set(sessionKey, "old-session");
  assert.deepEqual(await readFact(async () => { storage.set(sessionKey, "replacement"); throw error401(); }, () => expired++), { status: "unknown", reason: "stale" });
  assert.equal(expired, 1);
});
test("late successful read cannot become current facts after login replacement", async () => {
  storage.set(sessionKey, "old-session");
  assert.deepEqual(await readFact(async () => { storage.set(sessionKey, "replacement"); return { count: 10 }; }), { status: "unknown", reason: "stale" });
});
