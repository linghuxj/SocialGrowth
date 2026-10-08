import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AppProvisioner, type AppCatalog } from "./app-readiness.js";

async function fixture(options: { cloud?: boolean; commitLost?: boolean; deviceHashMismatch?: boolean; downloadFail?: boolean; stopBeforeInstall?: boolean; installed?: boolean; tamper?: boolean; signer?: string; requiredSplit?: boolean; withSplit?: boolean; installFail?: boolean; wrongVersion?: boolean; sdk?: number; abi?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "sg-apk-test-"));
  const bytes = Buffer.from("APK fixture, never installed on hardware");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const signer = "a".repeat(64);
  const catalog: AppCatalog = { schemaVersion: 1, apps: [{
    packageName: "com.google.android.youtube", versionName: "1.0", versionCode: "123",
    source: "https://example.com/fixture", retainedInstalledVersions: [], signerSha256: [signer],
    files: [{ path: "base.apk", sha256: sha, ...(options.cloud ? { objectKey: `phone-apps/${sha}/base.apk` } : {}) }, ...(options.withSplit ? [{ path: "split.apk", sha256: sha, split: "config.xxhdpi", ...(options.cloud ? { objectKey: `phone-apps/${sha}/split.apk` } : {}) }] : [])],
  }] };
  await writeFile(join(dir, "base.apk"), options.tamper ? "bad" : bytes);
  await writeFile(join(dir, "split.apk"), bytes);
  await writeFile(join(dir, "catalog.json"), JSON.stringify(catalog));
  const calls: string[][] = [];
  let installed = options.installed ?? false;
  let downloaded = false;
  const provisioner = new AppProvisioner({
    ...(options.cloud ? { downloads: { async download() { return { url: "https://cloud.invalid/base.apk?private-fixture-capability", headers: {} }; } } } : {}), catalogPath: join(dir, "catalog.json"), buildTools: "/sdk", command: async (file, args) => {
    calls.push([file, ...args]);
    if (file === "adb") {
      const command = args.slice(2).join(" ");
      if (command === "get-state") return "device";
      if (command === "shell getprop ro.kernel.qemu") return "0";
      if (command === "shell getprop ro.build.version.sdk") return String(options.sdk ?? 36);
      if (command === "shell getprop ro.product.cpu.abilist") return options.abi ?? "arm64-v8a,armeabi-v7a";
      if (command.startsWith("shell pm path")) {
        if (installed) return "package:/data/app/base.apk";
        throw Object.assign(new Error("absent package"), { code: 1, stdout: "", stderr: "" });
      }
      if (command.startsWith("shell mkdir") || command.startsWith("shell rm")) return "";
      if (command.startsWith("shell curl --fail ")) {
        if (options.downloadFail) throw new Error("must not leak private-fixture-capability");
        downloaded = true; return "";
      }
      if (command.startsWith("shell stat")) return String(bytes.length);
      if (command.startsWith("shell sha256sum")) return `${options.deviceHashMismatch ? "f".repeat(64) : sha}  phone.apk`;
      if (command.startsWith("shell pm install-create")) return "Success: created install session [123]";
      if (command.startsWith("shell pm install-write")) return options.installFail ? "Failure [STAGE_FAILED]" : "Success";
      if (command.startsWith("shell pm install-abandon")) return "Success";
      if (command.startsWith("shell pm install-commit")) {
        if (options.commitLost) throw new Error("transport lost with private-fixture-capability");
        installed = true; return "Success";
      }
      if (command.startsWith("shell pm install ")) { installed = true; return "Success"; }
      if (command.startsWith("shell dumpsys")) return `versionName=${options.wrongVersion ? "2.0" : "1.0"}\nversionCode=123`;
      if (["install", "install-multiple"].includes(args[2])) {
        if (options.installFail) return "Failure [INSTALL_FAILED_TEST]";
        installed = true; return "Success";
      }
    }
    if (file.endsWith("apksigner")) return `Signer #1 certificate SHA-256 digest: ${options.signer ?? signer}`;
    const split = args.at(-1)?.endsWith("split.apk") || args.at(-2)?.endsWith("split.apk");
    if (args[1] === "badging") return `package: name='com.google.android.youtube' versionCode='123' versionName='${split ? "" : "1.0"}'${split ? " split='config.xxhdpi'" : ""}\nsdkVersion:'29'\nnative-code: 'arm64-v8a'`;
    if (args[1] === "xmltree") return split ? 'android:splitTypes="base__density"' : options.requiredSplit ? 'android:requiredSplitTypes="base__density"' : "";
    throw new Error(`Unexpected fixture command ${file}`);
  } });
  return { provisioner, calls, authorize: () => { if (downloaded && options.stopBeforeInstall) throw new Error("STOPPED_BY_OWNER"); }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("missing app installs verified single APK once and rechecks; existing app untouched", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.provisioner.ensure("PHONE", "com.google.android.youtube")).status, "installed_missing_app");
    assert.equal((await f.provisioner.ensure("PHONE", "com.google.android.youtube")).status, "installed");
    const installs = f.calls.filter(c => c.includes("install"));
    assert.equal(installs.length, 1);
    assert.ok(!installs[0].some(c => ["-r", "-d", "uninstall"].includes(c)));
  } finally { await f.cleanup(); }
});
test("complete signed split set uses a single install-multiple transaction", async () => {
  const f = await fixture({ requiredSplit: true, withSplit: true });
  try {
    await f.provisioner.ensure("PHONE", "com.google.android.youtube");
    assert.equal(f.calls.filter(c => c.includes("install-multiple")).length, 1);
  } finally { await f.cleanup(); }
});
for (const [reason, options] of [
  ["APK_HASH_MISMATCH", { tamper: true }],
  ["APK_SIGNATURE_MISMATCH", { signer: "b".repeat(64) }],
  ["APK_REQUIRED_SPLIT_MISSING", { requiredSplit: true }],
  ["APK_SDK_INCOMPATIBLE", { sdk: 28 }],
  ["APK_ABI_INCOMPATIBLE", { abi: "x86" }],
  ["APP_VERSION_UNSUPPORTED", { installed: true, wrongVersion: true }],
] as const) test(`${reason} prevents installation`, async () => {
  const f = await fixture(options);
  try {
    await assert.rejects(f.provisioner.ensure("PHONE", "com.google.android.youtube"), new RegExp(reason));
    assert.ok(!f.calls.some(c => c.includes("install") || c.includes("install-multiple")));
  } finally { await f.cleanup(); }
});
test("installation failure is not retried and never triggers uninstall", async () => {
  const f = await fixture({ installFail: true });
  try {
    await assert.rejects(f.provisioner.ensure("PHONE", "com.google.android.youtube"), /APP_INSTALL_FAILED/);
    assert.equal(f.calls.filter(c => c.includes("install")).length, 1);
    assert.ok(!f.calls.some(c => c.includes("uninstall")));
  } finally { await f.cleanup(); }
});
test("read-only check and emulators never install", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.provisioner.ensure("PHONE", "com.google.android.youtube", false)).status, "missing");
    await assert.rejects(f.provisioner.ensure("emulator-5554", "com.google.android.youtube"), /PHYSICAL_DEVICE_REQUIRED/);
    assert.ok(!f.calls.some(c => c.includes("install")));
  } finally { await f.cleanup(); }
});

test("cloud bytes are downloaded and verified on phone, then locally installed; no ADB APK transfer", async () => {
  const f = await fixture({ cloud: true });
  try {
    assert.equal((await f.provisioner.ensure("PHONE", "com.google.android.youtube")).status, "installed_missing_app");
    assert.equal(f.calls.filter(c => c[4]?.startsWith("curl --fail ")).length, 1);
    assert.equal(f.calls.filter(c => c.join(" ").includes("shell pm install ")).length, 1);
    assert.ok(!f.calls.some(c => ["push", "install", "install-multiple"].includes(c[3]) || c[2] === "install"));
    assert.ok(f.calls.some(c => c.includes("sha256sum")));
  } finally { await f.cleanup(); }
});
for (const [options, code] of [
  [{ deviceHashMismatch: true }, "APK_DEVICE_HASH_MISMATCH"],
  [{ downloadFail: true }, "APK_DEVICE_DOWNLOAD_FAILED"],
  [{ stopBeforeInstall: true }, "APP_PREPARATION_FAILED"],
] as const) test(`cloud ${code} stops before install and removes only owned temporary files`, async () => {
  const f = await fixture({ cloud: true, ...options });
  try {
    await assert.rejects(f.provisioner.ensure("PHONE", "com.google.android.youtube", true, f.authorize), new RegExp(code));
    assert.ok(!f.calls.some(c => c.join(" ").includes("shell pm install ")));
    assert.ok(f.calls.some(c => c.includes("rm") && c.at(-1)?.startsWith("/data/local/tmp/sg-app-")));
  } finally { await f.cleanup(); }
});


test("cloud splits use one verified transaction; uncertain commit never repeats or abandons", async () => {
  for (const commitLost of [false, true]) {
    const f = await fixture({ cloud: true, requiredSplit: true, withSplit: true, commitLost });
    try {
      const result = f.provisioner.ensure("PHONE", "com.google.android.youtube");
      if (commitLost) await assert.rejects(result, /^Error: APP_INSTALL_UNCONFIRMED$/);
      else assert.equal((await result).status, "installed_missing_app");
      assert.equal(f.calls.filter(c => c.includes("install-create")).length, 1);
      assert.equal(f.calls.filter(c => c.includes("install-write")).length, 2);
      assert.equal(f.calls.filter(c => c.includes("install-commit")).length, 1);
      assert.ok(!f.calls.some(c => c.includes("install-abandon") || c.includes("install-multiple")));
    } finally { await f.cleanup(); }
  }
});
test("cloud staging failure abandons its session without committing", async () => {
  const f = await fixture({ cloud: true, requiredSplit: true, withSplit: true, installFail: true });
  try {
    await assert.rejects(f.provisioner.ensure("PHONE", "com.google.android.youtube"), /APK_SPLIT_STAGE_FAILED/);
    assert.equal(f.calls.filter(c => c.includes("install-abandon")).length, 1);
    assert.ok(!f.calls.some(c => c.includes("install-commit")));
  } finally { await f.cleanup(); }
});
