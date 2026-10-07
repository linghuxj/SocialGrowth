import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative, extname } from "node:path";

const root = process.cwd();
const retired = ["apps/web-console", "apps/artemis-controller", "services/execution-runtime", "services/ai-engine", "services/shortlink-service", "prototypes/android-endpoint-probe"];
const errors = retired.filter(path => existsSync(resolve(root, path))).map(path => `Retired source exists: ${path}`);
const forbidden = /apps\/web-console|apps\/artemis-controller|services\/(?:execution-runtime|ai-engine|shortlink-service)|@socialgrowth\/(?:web-console|artemis-controller|execution-runtime|ai-engine|shortlink-service)|https?:\/\/[^\s"']*:3000(?:\/|["'])|\/#\/(?:connections|receipts)/;
function visit(path) {
  for (const item of readdirSync(path, { withFileTypes: true })) {
    if (["node_modules", "dist", "build", ".gradle", ".kotlin", "__pycache__"].includes(item.name) || item.name.startsWith(".env")) continue;
    const file = resolve(path, item.name);
    if (item.isDirectory()) visit(file);
    else if ([".ts", ".tsx", ".mts", ".mjs", ".kt", ".kts", ".yaml", ".yml"].includes(extname(file)) && file !== new URL(import.meta.url).pathname && forbidden.test(readFileSync(file, "utf8"))) errors.push(`Retired reference: ${relative(root, file)}`);
  }
}
for (const directory of ["product", "scripts", "tests", "integrations/artemis", ".github"]) visit(resolve(root, directory));
const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
if (/apps\/|services\//.test(workspace)) errors.push("Workspace contains retired package roots");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;
if (Object.keys(scripts).some(key => key.includes("demo") || key.startsWith("runtime:"))) errors.push("Retired root command exists");
if (Object.values(scripts).some(value => forbidden.test(value))) errors.push("Root command targets retired code");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("[product-layout] Only product workspaces and Web entry; no retired source paths or UI references.");
