import { spawn } from "node:child_process";

const productScripts = { materials: "scripts/verify-product-materials-playwright.mts", projects: "scripts/verify-product-projects-playwright.mts", "project-viewports": "scripts/verify-product-project-viewports.mts", identity: "scripts/verify-product-web-readiness.mts" };
const target = process.env.SG_WEB_TARGET ?? "demo";
const scope = process.env.SG_PRODUCT_WEB_SCOPE ?? "identity";
if (target === "product" && !(scope in productScripts)) { console.error("[playwright] Unknown product scope"); process.exit(2); }
const targets = {
  demo: ["tsx", "scripts/verify-web-publication-readiness.mts"],
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
