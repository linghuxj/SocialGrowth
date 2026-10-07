import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { readBackendConfig, readOperatorRuntimeConfig, readSmsRuntimeConfig } from "../product/backend/src/config.js";
import { readMaterialRuntimeConfig } from "../product/backend/src/material-runtime.js";
import { readTaskQueueConfig } from "../product/backend/src/task-recheck-queue.js";
import { readScreenshotStorageConfig } from "../product/executor/src/runtime/storage/screenshot-config.js";

export type ConfigStatus = "configured" | "disabled" | "incomplete" | "missing_dependency" | "not_wired";
export interface ConfigCheck { capability: string; status: ConfigStatus; missing?: string[]; note?: string; }
export function configReport(env: NodeJS.ProcessEnv, profile: "local" | "production" | "executor", runtime: boolean): ConfigCheck[] {
  const checks: ConfigCheck[] = [];
  const check = (capability: string, read: () => unknown, note?: string) => {
    try { const result = read(); checks.push({ capability, status: result === null ? "disabled" : "configured", ...(note ? { note } : {}) }); }
    catch { checks.push({ capability, status: "incomplete", note: "配置缺失、格式无效或模式冲突；不输出原始错误及配置值" }); }
  };
  const group = (capability: string, names: string[], required = false) => {
    const missing = names.filter(name => !env[name]);
    const status = missing.length === 0 ? "configured" : missing.length === names.length && !required ? "disabled" : "incomplete";
    checks.push({ capability, status, ...(status === "incomplete" ? { missing } : {}) });
  };
  const files = (capability: string, names: string[]) => {
    if (!runtime) return;
    const missing = names.filter(name => env[name] && !existsSync(env[name]!));
    if (missing.length) checks.push({ capability, status: "missing_dependency", missing });
  };
  const executable = (name: string) => (env.PATH ?? process.env.PATH ?? "").split(delimiter).some(dir => {
    try { accessSync(join(dir, name), constants.X_OK); return true; } catch { return false; }
  });
  if (profile !== "executor") {
    check("backend", () => readBackendConfig(env));
    check("database_auth_and_keys", () => readOperatorRuntimeConfig(env));
    check("sms", () => { readSmsRuntimeConfig(env); return (env.SG_PRODUCT_SMS_MODE ?? "unavailable") === "unavailable" ? null : true; }, "仅支持开发验证码；真实短信供应商尚未接入");
    if (profile === "production" && env.SG_PRODUCT_SMS_MODE === "development_capture") checks.push({ capability: "production_sms", status: "incomplete", note: "生产禁止开发验证码模式" });
    check("material_storage", () => readMaterialRuntimeConfig(env));
    const modelMode = env.SG_PRODUCT_BUSINESS_MODEL_MODE ?? "unavailable";
    check("business_model", () => {
      if (modelMode === "unavailable" && !env.SG_PRODUCT_ARTEMIS_ROOT) return null;
      if (modelMode !== "artemis_configured" || !env.SG_PRODUCT_ARTEMIS_ROOT) throw new Error();
      return true;
    });
    if (runtime && modelMode === "artemis_configured") {
      const root = env.SG_PRODUCT_ARTEMIS_ROOT ?? "";
      const missing = [".venv/bin/python", ".env"].filter(path => !existsSync(join(root, path))).map(path => `ARTEMIS_ROOT/${path}`);
      for (const name of ["ffmpeg", "ffprobe"]) if (!executable(name)) missing.push(name);
      // Same source bridge needed by ArtemisBusinessModel; paths must be valid in this runtime.
      if (!existsSync(new URL("./artemis-business-model.py", import.meta.url))) missing.push("artemis-business-model.py");
      if (missing.length) checks.push({ capability: "model_and_video_dependencies", status: "missing_dependency", missing });
    }
    group("executor_connection", ["SG_PRODUCT_EXECUTION_RUNTIME_URL", "SG_PRODUCT_EXECUTION_RUNTIME_TOKEN"]);
    group("execution_binding", ["SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID", "SG_PRODUCT_EXECUTION_SERIAL", "SG_PRODUCT_EXECUTION_DEVICE_ID", "SG_PRODUCT_EXECUTION_IDENTITY_ID", "SG_PRODUCT_EXECUTION_CANONICAL_REF", "SG_PRODUCT_EXECUTION_ACCOUNT_ID", "SG_PRODUCT_EXECUTION_PAGE_NAME"]);
    group("media_input_grant", ["SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE", "SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID", "SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS", "SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS"]);
    files("key_files", ["SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE", "SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE"]);
    group("device_network", ["SG_PRODUCT_TAILNET_PILOT_CONFIG", "SG_PRODUCT_TAILNET_PILOT_AUTH_KEY_FILE", "SG_PRODUCT_TAILSCALE_CLI"]);
    group("device_adb", ["SG_PRODUCT_CENTER_ADB", "SG_PRODUCT_CENTER_ADB_USER_HOME"]);
    files("network_paths", ["SG_PRODUCT_TAILNET_PILOT_CONFIG", "SG_PRODUCT_TAILNET_PILOT_AUTH_KEY_FILE", "SG_PRODUCT_TAILSCALE_CLI", "SG_PRODUCT_CENTER_ADB", "SG_PRODUCT_CENTER_ADB_USER_HOME", "SG_PRODUCT_CENTER_ADB_TAILSCALE_CLI"]);
    check("queue_config", () => readTaskQueueConfig(env));
    checks.push({ capability: "queue_integration", status: "not_wired", note: "正式应用未注册此队列组件；Redis 健康不代表队列启用" });
  } else {
    group("executor_auth", ["SG_RUNTIME_TOKEN", "SG_MEDIA_SIGNING_KEY", "SG_DEVICE_TOKENS"], true);
    check("executor_device_tokens", () => {
      const tokens: unknown = JSON.parse(env.SG_DEVICE_TOKENS ?? "{}");
      if (!tokens || typeof tokens !== "object" || Array.isArray(tokens) || Object.values(tokens).some(v => typeof v !== "string" || v.length < 1)) throw new Error();
      return true;
    });
    group("executor_binding", ["SG_PRODUCT_EXECUTION_RUNTIME_TOKEN", "SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID", "SG_PRODUCT_EXECUTION_SERIAL", "SG_PRODUCT_EXECUTION_DEVICE_ID", "SG_PRODUCT_EXECUTION_IDENTITY_ID", "SG_PRODUCT_EXECUTION_CANONICAL_REF", "SG_PRODUCT_EXECUTION_ACCOUNT_ID", "SG_PRODUCT_EXECUTION_RUNTIME_ACCOUNT_ID", "SG_PRODUCT_EXECUTION_PAGE_NAME"]);
    if (env.SG_PRODUCT_EXECUTION_RUNTIME_TOKEN) group("executor_callback", ["SG_PRODUCT_EXECUTION_CALLBACK_URL", "SG_ARTEMIS_ROOT"], true);
    check("screenshot_storage", () => readScreenshotStorageConfig(env));
    if (Object.keys(env).some(key => key.startsWith("SG_MINIO_"))) checks.push({ capability: "legacy_screenshot_config", status: "incomplete", note: "旧 SG_MINIO_* 不再读取；需显式迁移为 SG_SCREENSHOT_*，已有文件未修改" });
    group("app_provisioning", ["SG_APP_CATALOG", "SG_ANDROID_BUILD_TOOLS"]);
    files("executor_paths", ["SG_ARTEMIS_ROOT", "SG_APP_CATALOG", "SG_ANDROID_BUILD_TOOLS", "SG_PYTHON_PATH"]);
    if (runtime && env.SG_ARTEMIS_ROOT && !existsSync(join(env.SG_ARTEMIS_ROOT, ".venv/bin/python"))) checks.push({ capability: "executor_python", status: "missing_dependency", missing: ["ARTEMIS_ROOT/.venv/bin/python"] });
  }
  return checks;
}
