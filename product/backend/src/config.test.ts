import assert from "node:assert/strict";
import test from "node:test";
import { readBackendConfig } from "./config.js";

test("backend uses an isolated default port", () => {
  assert.equal(readBackendConfig({}).SG_PRODUCT_BACKEND_PORT, 4320);
});

test("backend rejects invalid ports", () => {
  assert.throws(() => readBackendConfig({ SG_PRODUCT_BACKEND_PORT: "0" }));
});
