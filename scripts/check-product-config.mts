import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { configReport } from "./product-config-report.mjs";
import { loadLocalBackendEnvironment, readPrivateEnv } from "./product-local-config.mjs";

async function main() {
  const { values } = parseArgs({ options: { profile: { type: "string", default: "local" }, "env-file": { type: "string" }, runtime: { type: "boolean", default: false } } });
  const profile = values.profile;
  if (profile !== "local" && profile !== "production" && profile !== "executor") throw new Error();
  let env: NodeJS.ProcessEnv;
  if (profile === "local") {
    if (values["env-file"]) throw new Error();
    const repo = process.cwd(), dir = resolve(repo, ".runtime/product-local-live");
    const config = JSON.parse(await readFile(resolve(dir, "config.json"), "utf8")) as { authPepper: string; developmentSmsToken: string; databasePassword: string };
    env = (await loadLocalBackendEnvironment(repo, config, resolve(dir, "media-credential-keys.json"),
      `postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/sg_product_local_live`)).env;
  } else {
    if (!values["env-file"]) throw new Error();
    // Isolated file: never supplement it with ambient developer credentials.
    env = await readPrivateEnv(resolve(values["env-file"]));
    if (profile === "production") Object.assign(env, { SG_PRODUCT_BACKEND_HOST: "0.0.0.0", SG_PRODUCT_BACKEND_PORT: "4320", SG_PRODUCT_TRUST_PROXY_HOPS: "1" });
  }
  const checks = configReport(env, profile, values.runtime || profile === "local");
  console.log(JSON.stringify({ profile, scope: "static_configuration_only", runtimeDependencies: values.runtime || profile === "local" ? "current_machine_only" : "not_checked",
    note: "未连接数据库、对象存储或手机；configured 只表示配置检查通过，不代表业务可用", checks }, null, 2));
  if (checks.some(c => c.status === "incomplete" || c.status === "missing_dependency")) process.exitCode = 1;
}
main().catch(() => { console.error(JSON.stringify({ status: "incomplete", error: "CONFIG_READ_FAILED", note: "检查参数、配置语法、文件所有者及 0600 权限；未输出文件内容或原始错误" })); process.exitCode = 1; });
