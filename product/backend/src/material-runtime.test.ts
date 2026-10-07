import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { MaterialRuntime, readMaterialRuntimeConfig } from "./material-runtime.js";
import { MaterialStorageError } from "./material-object-storage.js";
import type { OperatorAuthService } from "./operator-auth-service.js";
const env = { SG_PRODUCT_MATERIAL_MODE: "configured", SG_PRODUCT_MATERIAL_LOCATION_ID: "a0000000-0000-4000-8000-000000000001",
  SG_PRODUCT_MATERIAL_ENDPOINT: "http://127.0.0.1:32903", SG_PRODUCT_MATERIAL_REGION: "us-east-1", SG_PRODUCT_MATERIAL_BUCKET: "synthetic-fixture",
  SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: "true", SG_PRODUCT_MATERIAL_ACCESS_KEY: "fixture-only-access", SG_PRODUCT_MATERIAL_SECRET_KEY: "fixture-only-secret",
  SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "4096", SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: "1000" };
test("storage unavailable never uses ambient SDK credentials and partial server config fails safely", () => {
  assert.equal(readMaterialRuntimeConfig({ AWS_ACCESS_KEY_ID: "never-use", AWS_SECRET_ACCESS_KEY: "never-use" }), null);
  for (const input of [{ SG_PRODUCT_MATERIAL_ENDPOINT: env.SG_PRODUCT_MATERIAL_ENDPOINT }, { ...env, SG_PRODUCT_MATERIAL_MODE: "unavailable" }, { ...env, SG_PRODUCT_MATERIAL_SECRET_KEY: undefined }]) {
    assert.throws(() => readMaterialRuntimeConfig(input), e => e instanceof MaterialStorageError && !e.cause && e.message === "CONFIGURATION_REQUIRED");
  }
});
test("trusted config validates every explicit bound and endpoint without disclosing secrets", () => {
  assert.equal(readMaterialRuntimeConfig(env)?.forcePathStyle, true);
  for (const patch of [{ SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: "yes" }, { SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "" }, { SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "134217729" }, { SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: "0x1000" },
    { SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: "0" }, { SG_PRODUCT_MATERIAL_ENDPOINT: "http://fixture.invalid" }, { SG_PRODUCT_MATERIAL_ENDPOINT: "https://fixture.invalid/?secret=hidden" }, { SG_PRODUCT_MATERIAL_ENDPOINT: "https://secret:password@fixture.invalid" }]) {
    assert.throws(() => readMaterialRuntimeConfig({ ...env, ...patch }), e => e instanceof MaterialStorageError && !e.message.includes("secret"));
  }
});
test("runtime is nonserializing, missing configuration closes writes, shutdown closes only owned SDK", async () => {
  const pool = { connect: async () => { throw new Error("must-not-connect"); } } as unknown as Pool;
  const auth = {} as OperatorAuthService, runtime = new MaterialRuntime(pool, auth, null);
  assert.equal(JSON.stringify(runtime), "{}");
  const id = env.SG_PRODUCT_MATERIAL_LOCATION_ID;
  await assert.rejects(runtime.uploads().prepare("", "", { metadata: { contractVersion: "2026-09-29.identity-v1", requestId: "request-runtime", idempotencyKey: "idempotency-runtime" }, projectId: id, objectId: id, sha256: "a".repeat(64), bytes: 1, contentType: "video/mp4" }), e => e instanceof Error && e.message === "CONFIGURATION_REQUIRED");
  runtime.onApplicationShutdown();
  const configured = new MaterialRuntime(pool, auth, readMaterialRuntimeConfig(env));
  assert.equal(JSON.stringify(configured), "{}"); assert.ok(configured.registry()); configured.onApplicationShutdown();
});

test("cloud provider is explicit and invalid or partial provider configuration stays closed", () => {
  assert.equal(readMaterialRuntimeConfig({ ...env, SG_PRODUCT_MATERIAL_PROVIDER: "oss_s3" })?.provider, "oss_s3");
  assert.equal(readMaterialRuntimeConfig({ ...env, SG_PRODUCT_MATERIAL_PROVIDER: "s3" })?.provider, "s3");
  for (const input of [{ ...env, SG_PRODUCT_MATERIAL_PROVIDER: "oss" }, { SG_PRODUCT_MATERIAL_PROVIDER: "oss_s3" }]) {
    assert.throws(() => readMaterialRuntimeConfig(input), e => e instanceof MaterialStorageError && e.code === "CONFIGURATION_REQUIRED");
  }
});
