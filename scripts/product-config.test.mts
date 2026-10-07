import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalBackendEnvironment, localPort, readPrivateEnv } from "./product-local-config.mjs";
import { configReport } from "./product-config-report.mjs";
import { readMaterialRuntimeConfig } from "../product/backend/src/material-runtime.js";

const material = { provider: "oss_s3", storageLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", endpoint: "https://s3.oss-cn-hongkong.aliyuncs.com", region: "cn-hongkong", bucket: "test-bucket", forcePathStyle: false,
  accessKeyId: "secret-id-canary", secretAccessKey: "secret-key-canary", maxObjectBytes: 1024, requestTimeoutMs: 5000 };
test("local loading preserves OSS provider and explicit precedence without modifying existing files", async () => {
  const repo = await mkdtemp(join(tmpdir(), "sg-config-")), dir = join(repo, ".runtime/product-local-live");
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, "material-storage.json"), JSON.stringify(material), { mode: 0o600 });
    await writeFile(join(dir, "backend.env"), "SG_PRODUCT_WEB_PORT=3200\nSG_PRODUCT_BACKEND_PORT=4420\n", { mode: 0o600 });
    const load = (env: NodeJS.ProcessEnv) => loadLocalBackendEnvironment(repo, { authPepper: "a".repeat(32), developmentSmsToken: "b".repeat(32) }, "/test/key.json", "postgresql://test", env);
    const loaded = await load({ SG_PRODUCT_WEB_PORT: "3300", AWS_SECRET_ACCESS_KEY: "never-forward", SG_UNRELATED_SECRET: "never-forward" });
    assert.equal(loaded.webPort, 3300); assert.equal(loaded.backendPort, 4420);
    assert.equal(loaded.env.SG_PRODUCT_EXECUTION_CALLBACK_URL, "http://127.0.0.1:4420");
    assert.equal(loaded.env.AWS_SECRET_ACCESS_KEY, undefined); assert.equal(loaded.env.SG_UNRELATED_SECRET, undefined);
    assert.equal(readMaterialRuntimeConfig(loaded.env)?.provider, "oss_s3");
    const disabled = await load({ SG_PRODUCT_MATERIAL_MODE: "unavailable" });
    assert.equal(readMaterialRuntimeConfig(disabled.env), null);
    const partial = await load({ SG_PRODUCT_MATERIAL_PROVIDER: "s3" });
    assert.throws(() => readMaterialRuntimeConfig(partial.env));
    assert.equal(partial.env.SG_PRODUCT_MATERIAL_SECRET_KEY, undefined);
    await chmod(join(dir, "backend.env"), 0o644);
    await assert.rejects(load({}), /PRIVATE_CONFIG_PERMISSIONS_REQUIRED/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});
test("ports reject invalid values; diagnostics never include secret values or raw validation errors", () => {
  for (const bad of ["0", "1023", "65536", "3e3", "3000oops"]) assert.throws(() => localPort(bad, 3100));
  const report = configReport({ SG_PRODUCT_DATABASE_URL: "secret-db-canary", SG_PRODUCT_AUTH_PEPPER: "secret-pepper-canary", SG_PRODUCT_MATERIAL_MODE: "configured", SG_PRODUCT_MATERIAL_SECRET_KEY: "secret-storage-canary" }, "production", false);
  assert.ok(report.some(c => c.capability === "material_storage" && c.status === "incomplete"));
  assert.ok(report.some(c => c.capability === "queue_integration" && c.status === "not_wired"));
  assert.doesNotMatch(JSON.stringify(report), /secret-.*-canary/);
  const legacy = configReport({ SG_MINIO_SECRET_KEY: "secret-legacy-canary" }, "executor", false);
  assert.ok(legacy.some(c => c.capability === "legacy_screenshot_config" && c.status === "incomplete"));
  assert.doesNotMatch(JSON.stringify(legacy), /secret-legacy-canary/);
});
test("protected env files reject group-readable secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-env-")), path = join(dir, "config.env");
  try { await writeFile(path, "SECRET=canary", { mode: 0o644 }); await assert.rejects(readPrivateEnv(path), /PRIVATE_CONFIG_PERMISSIONS_REQUIRED/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
