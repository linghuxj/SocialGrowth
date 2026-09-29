import { spawn } from "node:child_process";

const targets = {
  demo: ["tsx", "scripts/verify-web-publication-readiness.mts"],
  product: ["tsx", "scripts/verify-product-web-readiness.mts"],
};

const target = process.env.SG_WEB_TARGET ?? "demo";
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
