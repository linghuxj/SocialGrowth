import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { requireFact } from "./contracts.ts";

const exec = promisify(execFile);
export type Command = (file: string, args: string[]) => Promise<string>;
const command: Command = async (file, args) =>
  (await exec(file, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const appCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  apps: z.array(z.object({
    packageName: z.enum(["com.facebook.katana", "com.google.android.youtube"]),
    versionName: z.string().min(1),
    versionCode: z.string().regex(/^\d+$/),
    source: z.string().url(),
    // These are explicit tested/retained versions, NOT a blanket upgrade policy.
    retainedInstalledVersions: z.array(z.string()).default([]),
    signerSha256: z.array(digest).min(1),
    files: z.array(z.object({ path: z.string().min(1), sha256: digest, split: z.string().optional() }).strict()).min(1),
  }).strict()).min(1),
}).strict();
export type AppCatalog = z.infer<typeof appCatalogSchema>;
export type AppReadiness = {
  packageName: string;
  status: "installed" | "installed_missing_app" | "missing";
  versionName?: string;
  versionCode?: string;
};

/** Deterministic infrastructure only. Never logs in, switches accounts or opens a store. */
export class AppProvisioner {
  constructor(private readonly options: {
    catalogPath?: string;
    buildTools?: string;
    command?: Command;
  } = {}) {}

  async ensure(serial: string, packageName: string, installMissing = true): Promise<AppReadiness> {
    requireFact(/^[A-Za-z0-9._:-]+$/.test(serial) && !serial.startsWith("emulator-"), "PHYSICAL_DEVICE_REQUIRED");
    requireFact(["com.facebook.katana", "com.google.android.youtube"].includes(packageName), "APP_NOT_ALLOWED");
    const run = this.options.command ?? command;
    const adb = (args: string[]) => run("adb", ["-s", serial, ...args]);
    requireFact(await adb(["get-state"]) === "device", "DEVICE_UNAVAILABLE");
    requireFact(await adb(["shell", "getprop", "ro.kernel.qemu"]) !== "1", "PHYSICAL_DEVICE_REQUIRED");
    const catalogPath = this.options.catalogPath ?? process.env.SG_APP_CATALOG ?? (existsSync("/Users/linghuxj/Documents/Codex/2026-09-20/new-chat/outputs/android-packages/catalog.json") ? "/Users/linghuxj/Documents/Codex/2026-09-20/new-chat/outputs/android-packages/catalog.json" : undefined);
    const buildTools = this.options.buildTools ?? process.env.SG_ANDROID_BUILD_TOOLS ?? (existsSync("/Users/linghuxj/Library/Android/sdk/build-tools/36.0.0") ? "/Users/linghuxj/Library/Android/sdk/build-tools/36.0.0" : undefined);
    let entry: AppCatalog["apps"][number] | undefined;
    if (catalogPath) {
      const catalog = appCatalogSchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
      requireFact(new Set(catalog.apps.map(a => a.packageName)).size === catalog.apps.length, "APP_CATALOG_DUPLICATE");
      entry = catalog.apps.find(a => a.packageName === packageName);
      requireFact(entry, "APP_CATALOG_ENTRY_MISSING");
    }
    const installed = async () => {
      try {
        return (await adb(["shell", "pm", "path", packageName])).startsWith("package:");
      } catch (error) {
        // Android 16 pm path returns exit 1 with empty streams for a missing package.
        // Offline/unauthorized/transport errors must not be interpreted as absence.
        const missing = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
        if (missing.code === 1 && missing.stdout === "" && missing.stderr === "") return false;
        throw error;
      }
    };
    const version = async () => {
      const dump = await adb(["shell", "dumpsys", "package", packageName]);
      const versionName = dump.match(/\bversionName=([^\s]+)/)?.[1];
      const versionCode = dump.match(/\bversionCode=(\d+)/)?.[1];
      requireFact(versionName && versionCode, "APP_VERSION_UNREADABLE");
      return { versionName, versionCode };
    };
    if (await installed()) {
      const current = await version();
      if (entry) requireFact(
        (current.versionName === entry.versionName && current.versionCode === entry.versionCode) ||
          entry.retainedInstalledVersions.includes(current.versionName),
        "APP_VERSION_UNSUPPORTED",
      );
      return { packageName, status: "installed", ...current };
    }
    if (!installMissing) return { packageName, status: "missing" };
    requireFact(entry && catalogPath, "APP_CATALOG_REQUIRED");
    requireFact(buildTools && isAbsolute(buildTools), "ANDROID_BUILD_TOOLS_REQUIRED");
    const sdk = Number(await adb(["shell", "getprop", "ro.build.version.sdk"]));
    const abis = (await adb(["shell", "getprop", "ro.product.cpu.abilist"])).split(",");
    requireFact(Number.isSafeInteger(sdk) && sdk > 0 && abis.length, "DEVICE_CAPABILITIES_UNREADABLE");
    const paths: string[] = [];
    const suppliedTypes = new Set<string>();
    const requiredTypes = new Set<string>();
    requireFact(entry.files.filter(f => !f.split).length === 1, "APK_BASE_REQUIRED");
    requireFact(new Set(entry.files.map(f => f.split ?? "base")).size === entry.files.length, "APK_SPLIT_DUPLICATE");
    for (const file of [...entry.files].sort((a, b) => Number(!!a.split) - Number(!!b.split))) {
      const path = resolve(dirname(catalogPath), file.path);
      const bytes = await readFile(path);
      requireFact(createHash("sha256").update(bytes).digest("hex") === file.sha256, "APK_HASH_MISMATCH");
      const signature = await run(resolve(buildTools, "apksigner"), ["verify", "--print-certs", "--min-sdk-version", String(sdk), "--max-sdk-version", String(sdk), path]);
      const signers = [...signature.matchAll(/^Signer[^\n]*certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(m => m[1]);
      requireFact(signers.length > 0 && signers.every(s => entry!.signerSha256.includes(s)), "APK_SIGNATURE_MISMATCH");
      const info = await run(resolve(buildTools, "aapt"), ["dump", "badging", path]);
      requireFact(info.match(/^package: name='([^']+)'/)?.[1] === packageName, "APK_PACKAGE_MISMATCH");
      requireFact(info.match(/versionCode='(\d+)'/)?.[1] === entry.versionCode, "APK_VERSION_MISMATCH");
      requireFact(info.match(/\bsplit='([^']+)'/)?.[1] === file.split, "APK_SPLIT_MISMATCH");
      if (!file.split) {
        requireFact(info.match(/versionName='([^']+)'/)?.[1] === entry.versionName, "APK_VERSION_MISMATCH");
        const minSdk = Number(info.match(/^sdkVersion:'(\d+)'/m)?.[1]);
        requireFact(minSdk > 0 && sdk >= minSdk, "APK_SDK_INCOMPATIBLE");
        const native = info.match(/^native-code: (.+)$/m)?.[1];
        requireFact(!native || [...native.matchAll(/'([^']+)'/g)].some(m => abis.includes(m[1])), "APK_ABI_INCOMPATIBLE");
      }
      const xml = await run(resolve(buildTools, "aapt"), ["dump", "xmltree", path, "AndroidManifest.xml"]);
      for (const value of xml.match(/android:requiredSplitTypes[^=]*="([^"]*)"/)?.[1]?.split(",") ?? []) if (value) requiredTypes.add(value);
      for (const value of xml.match(/android:splitTypes[^=]*="([^"]*)"/)?.[1]?.split(",") ?? []) if (value) suppliedTypes.add(value);
      paths.push(path);
    }
    requireFact([...requiredTypes].every(t => suppliedTypes.has(t)), "APK_REQUIRED_SPLIT_MISSING");
    // Recheck after verification. No -r/-d: never replace, downgrade or uninstall an existing app.
    requireFact(!(await installed()), "APP_INSTALL_RACE");
    const result = await adb([paths.length === 1 ? "install" : "install-multiple", ...paths]);
    requireFact(/\bSuccess\b/.test(result) && await installed(), "APP_INSTALL_FAILED");
    const current = await version();
    requireFact(current.versionName === entry.versionName && current.versionCode === entry.versionCode, "APP_INSTALLED_VERSION_MISMATCH");
    return { packageName, status: "installed_missing_app", ...current };
  }
}
