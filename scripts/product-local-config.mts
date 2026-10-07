import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { parseMaterialStorageConfig } from "../product/backend/src/material-object-storage.js";

const optionalNames = /^(?:SG_PRODUCT_(?:WEB_PORT|BACKEND_PORT|SMS_MODE|SMS_ALIYUN_(?:ACCESS_KEY_ID|ACCESS_KEY_SECRET|SECURITY_TOKEN|SIGN_NAME|REGISTRATION_TEMPLATE|LOGIN_TEMPLATE|CODE_PARAMETER|TIMEOUT_MS)|BUSINESS_MODEL_MODE|ARTEMIS_ROOT|MATERIAL_(?:MODE|PROVIDER|LOCATION_ID|ENDPOINT|REGION|BUCKET|FORCE_PATH_STYLE|ACCESS_KEY|SECRET_KEY|SESSION_TOKEN|MAX_OBJECT_BYTES|REQUEST_TIMEOUT_MS)|EXECUTION_(?:RUNTIME_URL|RUNTIME_TOKEN|RUNTIME_BINDING_ID|SERIAL|DEVICE_ID|IDENTITY_ID|CANONICAL_REF|ACCOUNT_ID|RUNTIME_ACCOUNT_ID|PAGE_NAME|CALLBACK_URL)|MEDIA_INPUT_GRANT_(?:KEY_FILE|KEY_ID|NOT_BEFORE_MILLIS|NOT_AFTER_MILLIS)|TAILNET_PILOT_CONFIG|TAILNET_PILOT_AUTH_KEY_FILE|TAILSCALE_CLI|CENTER_ADB|CENTER_ADB_USER_HOME|CENTER_ADB_TAILSCALE_CLI))$/;
export function localPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error("LOCAL_PORT_INVALID");
  return Number(value);
}
export async function readPrivateEnv(path: string): Promise<NodeJS.ProcessEnv> {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0
    || (process.getuid && file.uid !== process.getuid())) throw new Error("PRIVATE_CONFIG_PERMISSIONS_REQUIRED");
  return parseEnv(await readFile(path, "utf8"));
}
export async function readLocalBackendOverrides(repo: string, environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  let file: NodeJS.ProcessEnv = {};
  try { file = await readPrivateEnv(resolve(repo, ".runtime/product-local-live/backend.env")); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (Object.keys(file).some(key => !optionalNames.test(key))) throw new Error("LOCAL_CONFIG_UNSUPPORTED_FIELD");
  return { ...file, ...Object.fromEntries(Object.entries(environment).filter(([key, value]) => optionalNames.test(key) && value !== undefined)) };
}
export async function loadLocalBackendEnvironment(repo: string,
  config: { authPepper: string; developmentSmsToken: string }, mediaKeyPath: string, databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env) {
  const dir = resolve(repo, ".runtime/product-local-live");
  const ambient = Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(SG_|AWS_|ARTEMIS_|OPENAI_)/.test(key)));
  const overrides = await readLocalBackendOverrides(repo, environment);
  const backendPort = localPort(overrides.SG_PRODUCT_BACKEND_PORT, 4320);
  const webPort = localPort(overrides.SG_PRODUCT_WEB_PORT, 3100);
  assert.notEqual(backendPort, webPort, "Local service ports must differ");
  const env: NodeJS.ProcessEnv = { ...ambient, SG_PRODUCT_DATABASE_URL: databaseUrl, SG_PRODUCT_AUTH_PEPPER: config.authPepper,
    SG_PRODUCT_SMS_MODE: "development_capture", SG_PRODUCT_DEVELOPMENT_SMS_TOKEN: config.developmentSmsToken,
    SG_PRODUCT_BACKEND_HOST: "127.0.0.1", SG_PRODUCT_BACKEND_PORT: String(backendPort), SG_PRODUCT_TRUST_PROXY_HOPS: "1",
    SG_PRODUCT_MATERIAL_MODE: "unavailable", SG_PRODUCT_BUSINESS_MODEL_MODE: "unavailable",
    SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE: mediaKeyPath };
  // Persist explicitly installed pilot paths across normal pnpm dev restarts.
  // This file contains paths only, never Auth Key contents or admission facts.
  const networkNames = ["SG_PRODUCT_TAILNET_PILOT_CONFIG", "SG_PRODUCT_TAILNET_PILOT_AUTH_KEY_FILE",
    "SG_PRODUCT_TAILSCALE_CLI", "SG_PRODUCT_CENTER_ADB", "SG_PRODUCT_CENTER_ADB_USER_HOME", "SG_PRODUCT_CENTER_ADB_TAILSCALE_CLI"];
  let localNetwork: Record<string, string> = {};
  try {
    const path = resolve(dir, "network.env"), file = await lstat(path);
    assert.ok(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0);
    if (process.getuid) assert.equal(file.uid, process.getuid());
    localNetwork = parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  for (const [name, value] of Object.entries(localNetwork)) {
    assert.ok(networkNames.includes(name), "Unsupported local network configuration");
    // Reject control bytes in explicitly supplied filesystem paths.
    // eslint-disable-next-line no-control-regex
    assert.ok(value.startsWith("/") && !/[\r\n\0]/.test(value), "Absolute network path required");
    // A present configuration with missing targets must fail, not silently
    // disable the connection authority as if no configuration were installed.
    await lstat(value);
    Object.assign(env, { [name]: value });
  }
  // Explicit environment paths still override installed local paths.
  for (const name of networkNames) {
    const value = environment[name];
    if (value) Object.assign(env, { [name]: value });
  }
  // Optional, explicitly installed local configuration. Never discover an
  // existing bucket, invent business proof, or fall back to ambient AWS keys.
  const materialConfigPath = resolve(dir, "material-storage.json");
  try {
    const file = await lstat(materialConfigPath);
    assert.ok(file.isFile() && !file.isSymbolicLink());
    assert.equal(file.mode & 0o077, 0, "Private material configuration required");
    if (process.getuid) assert.equal(file.uid, process.getuid());
    const material = parseMaterialStorageConfig(JSON.parse(await readFile(materialConfigPath, "utf8")));
    Object.assign(env, {
      SG_PRODUCT_MATERIAL_MODE: "configured", SG_PRODUCT_MATERIAL_PROVIDER: material.provider ?? "s3", SG_PRODUCT_MATERIAL_LOCATION_ID: material.storageLocationId,
      SG_PRODUCT_MATERIAL_ENDPOINT: material.endpoint, SG_PRODUCT_MATERIAL_REGION: material.region,
      SG_PRODUCT_MATERIAL_BUCKET: material.bucket, SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE: String(material.forcePathStyle),
      SG_PRODUCT_MATERIAL_ACCESS_KEY: material.accessKeyId, SG_PRODUCT_MATERIAL_SECRET_KEY: material.secretAccessKey,
      SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES: String(material.maxObjectBytes),
      SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS: String(material.requestTimeoutMs),
      ...(material.sessionToken ? { SG_PRODUCT_MATERIAL_SESSION_TOKEN: material.sessionToken } : {}),
    });
  } catch (error) {
    // A present-but-invalid file is a configuration failure, never silently
    // ignored as an unconfigured service.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Existing repository Artemis installation is the explicit local model and
  // execution configuration. Its secrets remain in its private dotenv file.
  const artemisRoot = resolve(repo, "integrations/google-artemis");
  try {
    await lstat(resolve(artemisRoot, ".venv/bin/python"));
    await lstat(resolve(artemisRoot, ".env"));
    Object.assign(env, { SG_PRODUCT_BUSINESS_MODEL_MODE: "artemis_configured", SG_PRODUCT_ARTEMIS_ROOT: artemisRoot });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    const runtime = parseEnv(await readFile(resolve(repo, ".env.runtime"), "utf8"));
    if (runtime.SG_RUNTIME_URL && runtime.SG_RUNTIME_TOKEN) Object.assign(env, {
      SG_PRODUCT_EXECUTION_RUNTIME_URL: runtime.SG_RUNTIME_URL, SG_PRODUCT_EXECUTION_RUNTIME_TOKEN: runtime.SG_RUNTIME_TOKEN,
    });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    const path = resolve(dir, "execution-binding.json"), file = await lstat(path);
    assert.ok(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0);
    const binding = JSON.parse(await readFile(path, "utf8")) as { deviceId: string; serial: string; runtimeBindingId: string; pageName?: string; identityId?: string; canonicalIdentityRef?: string; accountId?: string; runtimeAccountId?: string };
    assert.match(binding.deviceId, /^[a-f0-9-]{36}$/); assert.match(binding.serial, /^[A-Za-z0-9_-]{1,100}$/);
    assert.match(binding.runtimeBindingId, /^[A-Za-z0-9_-]{1,150}$/);
    if (binding.pageName !== undefined) assert.ok(typeof binding.pageName === "string" && binding.pageName.trim() === binding.pageName && binding.pageName.length > 0 && binding.pageName.length <= 150 && !/[\r\n]/.test(binding.pageName));
    if (binding.identityId !== undefined) assert.match(binding.identityId, /^[a-f0-9-]{36}$/);
    if (binding.accountId !== undefined) assert.match(binding.accountId, /^[a-f0-9-]{36}$/);
    if (binding.runtimeAccountId !== undefined) assert.match(binding.runtimeAccountId, /^[A-Za-z0-9_-]{1,150}$/);
    if (binding.canonicalIdentityRef !== undefined) assert.ok(typeof binding.canonicalIdentityRef === "string" && binding.canonicalIdentityRef.trim() === binding.canonicalIdentityRef && binding.canonicalIdentityRef.length > 0 && binding.canonicalIdentityRef.length <= 512 && !/[\r\n]/.test(binding.canonicalIdentityRef));
    Object.assign(env, { SG_PRODUCT_EXECUTION_DEVICE_ID: binding.deviceId, SG_PRODUCT_EXECUTION_SERIAL: binding.serial,
      SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID: binding.runtimeBindingId,
      ...(binding.identityId ? { SG_PRODUCT_EXECUTION_IDENTITY_ID: binding.identityId } : {}),
      ...(binding.accountId ? { SG_PRODUCT_EXECUTION_ACCOUNT_ID: binding.accountId } : {}),
      ...(binding.runtimeAccountId ? { SG_PRODUCT_EXECUTION_RUNTIME_ACCOUNT_ID: binding.runtimeAccountId } : {}),
      ...(binding.canonicalIdentityRef ? { SG_PRODUCT_EXECUTION_CANONICAL_REF: binding.canonicalIdentityRef } : {}),
      ...(binding.pageName ? { SG_PRODUCT_EXECUTION_PAGE_NAME: binding.pageName } : {}) });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Replacing a storage group never mixes credentials with the legacy JSON.
  if (Object.keys(overrides).some(key => key.startsWith("SG_PRODUCT_MATERIAL_"))) {
    for (const key of Object.keys(env)) if (key.startsWith("SG_PRODUCT_MATERIAL_")) delete env[key];
  }
  if (overrides.SG_PRODUCT_BUSINESS_MODEL_MODE === "unavailable") delete env.SG_PRODUCT_ARTEMIS_ROOT;
  if (overrides.SG_PRODUCT_SMS_MODE && overrides.SG_PRODUCT_SMS_MODE !== "development_capture") delete env.SG_PRODUCT_DEVELOPMENT_SMS_TOKEN;
  Object.assign(env, overrides, { SG_PRODUCT_WEB_PORT: String(webPort), SG_PRODUCT_BACKEND_PORT: String(backendPort) });
  // The local executor callback follows an explicitly selected backend port.
  env.SG_PRODUCT_EXECUTION_CALLBACK_URL ??= `http://127.0.0.1:${backendPort}`;
  return { env, backendPort, webPort };
}
