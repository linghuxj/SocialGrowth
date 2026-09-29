import assert from "node:assert/strict";
import test from "node:test";
import { readBackendConfig, readOperatorRuntimeConfig } from "./config.js";

test("backend uses an isolated default port", () => {
  const config = readBackendConfig({});
  assert.equal(config.SG_PRODUCT_BACKEND_PORT, 4320);
  assert.equal(config.SG_PRODUCT_SMS_MODE, "unavailable");
  assert.equal(config.SG_PRODUCT_TRUST_PROXY_HOPS, 0);
});

test("backend rejects invalid ports", () => {
  assert.throws(() => readBackendConfig({ SG_PRODUCT_BACKEND_PORT: "0" }));
  assert.throws(() => readBackendConfig({ SG_PRODUCT_TRUST_PROXY_HOPS: "-1" }));
});

test("backend accepts an explicit bounded trusted proxy hop count", () => {
  assert.equal(
    readBackendConfig({ SG_PRODUCT_TRUST_PROXY_HOPS: "1" }).SG_PRODUCT_TRUST_PROXY_HOPS,
    1,
  );
});

test("development SMS capture requires a loopback host and independent token", () => {
  const token = "development-sms-token-with-at-least-32-bytes";
  assert.throws(() =>
    readBackendConfig({ SG_PRODUCT_SMS_MODE: "development_capture" }),
  );
  assert.throws(() =>
    readBackendConfig({
      SG_PRODUCT_BACKEND_HOST: "0.0.0.0",
      SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: token,
      SG_PRODUCT_SMS_MODE: "development_capture",
    }),
  );
  assert.throws(() =>
    readBackendConfig({ SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: token }),
  );
  assert.equal(
    readBackendConfig({
      SG_PRODUCT_BACKEND_HOST: "127.0.0.1",
      SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: token,
      SG_PRODUCT_SMS_MODE: "development_capture",
    }).SG_PRODUCT_SMS_MODE,
    "development_capture",
  );
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
  assert.equal(
    readOperatorRuntimeConfig({
      SG_PRODUCT_DATABASE_URL: "postgresql://test",
      SG_PRODUCT_AUTH_PEPPER: "a-secure-test-pepper-with-more-than-32-bytes",
    }).SG_PRODUCT_SMS_CODE_LENGTH,
    6,
  );
  assert.throws(() =>
    readOperatorRuntimeConfig({
      SG_PRODUCT_DATABASE_URL: "postgresql://test",
      SG_PRODUCT_AUTH_PEPPER: "a-secure-test-pepper-with-more-than-32-bytes",
      SG_PRODUCT_SMS_CODE_LENGTH: "9",
    }),
  );
});
