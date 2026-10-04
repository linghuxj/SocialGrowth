import { spawn } from "node:child_process";

const productScripts = { "device-live": "scripts/verify-product-device-live-playwright.mts", "account-preparation": "scripts/verify-product-account-preparation-playwright.mts", "real-material-bytes": "scripts/verify-product-real-material-bytes-playwright.mts", "operator-todos": "scripts/verify-product-operator-todos-playwright.mts", "project-feedback": "scripts/verify-product-project-feedback-playwright.mts", direction: "scripts/verify-product-direction-playwright.mts", planning: "scripts/verify-product-planning-playwright.mts", materials: "scripts/verify-product-materials-playwright.mts", projects: "scripts/verify-product-projects-playwright.mts", "project-viewports": "scripts/verify-product-project-viewports.mts", identity: "scripts/verify-product-web-readiness.mts" };
const target = process.env.SG_WEB_TARGET ?? "demo";
const scope = process.env.SG_PRODUCT_WEB_SCOPE ?? "identity";
const demoScope = process.env.SG_DEMO_WEB_SCOPE ?? "readiness";
if (target === "demo" && !["readiness", "observation", "client"].includes(demoScope)) { console.error("[playwright] Unknown demo scope"); process.exit(2); }
if (target === "product" && !(scope in productScripts)) { console.error("[playwright] Unknown product scope"); process.exit(2); }
const targets = {
  demo: ["tsx", demoScope === "client" ? "scripts/verify-demo-client-playwright.mts" : demoScope === "observation" ? "scripts/verify-demo-observation-playwright.mts" : "scripts/verify-web-publication-readiness.mts"],
  product: ["tsx", productScripts[scope]],
};

const command = targets[target];

if (!command) {
  console.error(
    `[playwright] Unknown SG_WEB_TARGET=${JSON.stringify(target)}. Expected demo or product.`,
  );
  process.exit(2);
}

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
