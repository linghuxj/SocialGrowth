// Explicit, reviewed registry refresh ONLY; never part of install/build/start.
// Freeze exact TZif resource keys rather than delegating casing to OS/Intl.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.argv[2];
if (!root) throw new Error("Provide an explicit zoneinfo directory for a reviewed registry refresh");
const keys: string[] = [];
const shape = /^(?:UTC|[A-Za-z_]+\/(?:[A-Za-z0-9_+-]+\/)*[A-Za-z0-9_+-]+)$/;
async function visit(relative = ""): Promise<void> {
  for (const entry of await readdir(join(root!, relative), { withFileTypes: true })) {
    if (!relative && ["posix", "right"].includes(entry.name)) continue;
    const key = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await visit(key);
    else if (shape.test(key)) {
      const bytes = await readFile(join(root!, key));
      if (bytes.subarray(0, 4).toString() !== "TZif") continue;
      try { new Intl.DateTimeFormat("en", { timeZone: key }).format(0); }
      catch { continue; }
      keys.push(key);
    }
  }
}
await visit();
keys.sort();
if (!keys.includes("UTC") || !keys.includes("Asia/Shanghai") || new Set(keys).size !== keys.length) throw new Error("Invalid source registry");
const tzVersion = (await readFile(join(root, "tzdata.zi"), "utf8")).split("\n")[0];
const source = `// Frozen exact-case keys; aliases retain their declared spelling.\n// Source TZif: ${tzVersion}; Node ${process.versions.node}, ICU ${process.versions.icu}, tz ${process.versions.tz}.\n// Refresh explicitly with update-planning-time-zones.ts and review the diff.\n// Contract vocabulary ONLY; execution must separately verify its TZif data.\nexport const planningTimeZoneKeys = ${JSON.stringify(keys, null, 2)} as const;\n`;
await writeFile(new URL("./planning-time-zone-keys.ts", import.meta.url), source);
console.log(`Frozen ${keys.length} exact-case time zone keys`);
