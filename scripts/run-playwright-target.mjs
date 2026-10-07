import { spawn } from "node:child_process";

const productScripts = { "device-live": "scripts/verify-product-device-live-playwright.mts", "account-preparation": "scripts/verify-product-account-preparation-playwright.mts", "real-material-bytes": "scripts/verify-product-real-material-bytes-playwright.mts", "operator-todos": "scripts/verify-product-operator-todos-playwright.mts", "project-feedback": "scripts/verify-product-project-feedback-playwright.mts", "project-lifecycle": "scripts/verify-product-project-lifecycle-playwright.mts", direction: "scripts/verify-product-direction-playwright.mts", planning: "scripts/verify-product-planning-playwright.mts", materials: "scripts/verify-product-materials-playwright.mts", projects: "scripts/verify-product-projects-playwright.mts", "project-viewports": "scripts/verify-product-project-viewports.mts", identity: "scripts/verify-product-web-readiness.mts" };
productScripts["operations"] = "scripts/verify-web-automation-orchestrator.mts";
productScripts["operations-completion"] = "scripts/verify-product-operations-completion-playwright.mts";
productScripts["core-execution"] = "scripts/verify-product-core-execution-playwright.mts";
productScripts["core-chain-status"] = "scripts/verify-product-core-chain-status-playwright.mts";
productScripts["core-preparation"] = "scripts/verify-product-core-preparation-playwright.mts";
productScripts["core-materials"] = "scripts/verify-product-core-materials-playwright.mts";
productScripts["closed-loop"] = "scripts/verify-product-closed-loop-playwright.mts";
productScripts["media-accounts"] = "scripts/verify-product-media-accounts-playwright.mts";
productScripts["public-phone-access"] = "scripts/verify-public-phone-access-playwright.mts";
const target = process.env.SG_WEB_TARGET ?? "product";
const scope = process.env.SG_PRODUCT_WEB_SCOPE ?? "identity";
productScripts["deployment"] = "scripts/verify-product-deployment-playwright.mts";
productScripts["executor-console"] = "scripts/verify-product-executor-console-playwright.mts";
productScripts["network-coexistence"] = "scripts/verify-product-network-coexistence-playwright.mts";
if (target !== "product" || !(scope in productScripts)) {
  console.error("[playwright] Only product is supported; choose an existing product scope.");
  process.exit(2);
}
const command = ["tsx", productScripts[scope]];

console.log(`[playwright] target=${target}`);
const child = spawn("pnpm", command, {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`[playwright] Failed to start target ${target}:`, error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[playwright] Target ${target} stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
