import assert from "node:assert/strict";
import test from "node:test";
import { readBackendConfig, readOperatorRuntimeConfig } from "./config.js";

test("backend uses an isolated default port", () => {
  assert.equal(readBackendConfig({}).SG_PRODUCT_BACKEND_PORT, 4320);
});

test("backend rejects invalid ports", () => {
  assert.throws(() => readBackendConfig({ SG_PRODUCT_BACKEND_PORT: "0" }));
});

test("operator runtime requires an explicit database and sufficiently long pepper", () => {
  assert.throws(() => readOperatorRuntimeConfig({}));
  assert.throws(() =>
    readOperatorRuntimeConfig({
      SG_PRODUCT_DATABASE_URL: "postgresql://test",
      SG_PRODUCT_AUTH_PEPPER: "too-short",
    }),
  );
  assert.equal(
    readOperatorRuntimeConfig({
      SG_PRODUCT_DATABASE_URL: "postgresql://test",
      SG_PRODUCT_AUTH_PEPPER: "a-secure-test-pepper-with-more-than-32-bytes",
    }).SG_PRODUCT_DATABASE_URL,
    "postgresql://test",
  );
});
