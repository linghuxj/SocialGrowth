import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { mkdir, open, writeFile, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parseAndroidPackageUid } from "./android-package-uid.js";

// Supplemental authenticated HTTPS protocol check, no UI/business acceptance.
// Existing installation session remains in the phone process; no secret output.
// Upgrade the owned main APK preserving UID/data; restore existing test package.
assert.equal(process.env.SG_PRODUCT_ADMISSION_PHONE_CHECK, "authorized");
const serial = "RFCW40MYYCV", deviceId = "0fef3177-636c-4b82-8209-1af38134e00f";
const run = promisify(execFile), output = resolve("artifacts/acceptance/product/B3/admission-api-20261003");
await mkdir(output, { mode: 0o700, recursive: true });
const privateDir = resolve(".runtime", `verifier-phone-probe-${randomUUID()}`);
await mkdir(privateDir, { mode: 0o700 });
const adb = async (args: string[], timeout = 10000) => (await run("adb", ["-s", serial, ...args], { timeout, maxBuffer: 1_048_576, shell: false })).stdout;
const { loadCurrentLocalParticipation } = await import(pathToFileURL(resolve("product/backend/dist/local-participation-service.js")).href) as typeof import("../product/backend/src/local-participation-service.js");
interface ProbePool {
  connect(): Promise<Parameters<typeof loadCurrentLocalParticipation>[0]>;
  end(): Promise<void>;
}
const { Pool } = createRequire(resolve("product/backend/package.json"))("pg") as {
  Pool: new (options: { connectionString: string; max: number }) => ProbePool;
};
async function privateConfig() {
  try {
    const fd = await open(resolve(".runtime/product-local-live/config.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      assert.ok(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0 && stat.size <= 16384);
      const raw: unknown = JSON.parse(await fd.readFile("utf8"));
      assert.ok(raw && typeof raw === "object" && "databasePassword" in raw && typeof raw.databasePassword === "string");
      return { databasePassword: raw.databasePassword };
    } finally { await fd.close(); }
  } catch { throw new Error("LOCAL_PROBE_CONFIGURATION_UNAVAILABLE"); }
}
const config = await privateConfig();
const pool = new Pool({ connectionString: `postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/sg_product_local_live`, max: 1 });
async function participationFresh() {
  const client = await pool.connect();
  try { return !!await loadCurrentLocalParticipation(client, deviceId, new Date()); }
  finally { client.release(); }
}
let mainUpdated = false, mainInstallAttempted = false, mainInstallSucceeded = false, testInstallAttempted = false;
let originalMain: string | null = null, originalUid: string | undefined;
const packageUid = async () => parseAndroidPackageUid(await adb(["shell", "dumpsys", "package", "com.socialgrowth.product"]));
let stage = "actual_device", original: string | null = null, restored = false;
let result: Record<string, unknown> = {};
try {
  assert.equal((await adb(["shell", "getprop", "ro.serialno"])).trim(), serial);
  assert.equal((await adb(["shell", "getprop", "ro.product.model"])).trim(), "SM-S9110");
  assert.equal((await adb(["shell", "getprop", "ro.build.version.sdk"])).trim(), "36");
  stage = "current_participation";
  assert.equal(await participationFresh(), false); // Do not interrupt a fresh active acceptance run.
  const processes = await adb(["shell", "dumpsys", "activity", "processes"]);
  assert.ok(!/Active instrumentation/.test(processes));
  stage = "test_package_backup";
  const path = (await adb(["shell", "pm", "path", "com.socialgrowth.product.test"])).trim();
  if (path) {
    assert.match(path, /^package:\/data\/app\/[^\n]+\/base\.apk$/);
    original = resolve(privateDir, "original-test.apk");
    await adb(["pull", path.slice(8), original]); await chmod(original, 0o600);
  }
  stage = "main_package_upgrade";
  const mainPath = (await adb(["shell", "pm", "path", "com.socialgrowth.product"])).trim();
  assert.match(mainPath, /^package:\/data\/app\/[^\n]+\/base\.apk$/);
  originalMain = resolve(privateDir, "original-main.apk");
  await adb(["pull", mainPath.slice(8), originalMain]); await chmod(originalMain, 0o600);
  originalUid = await packageUid(); assert.ok(originalUid);
  mainInstallAttempted = true;
  assert.match(await adb(["install", "-r", resolve("product/android/app/build/outputs/apk/debug/app-debug.apk")], 30000), /Success/);
  mainInstallSucceeded = true; mainUpdated = true; assert.equal(await packageUid(), originalUid);
  stage = "test_package_install";
  const candidate = resolve("product/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk");
  testInstallAttempted = true;
  assert.match(await adb(["install", "-r", candidate], 30000), /Success/);
  stage = "actual_native_transport";
  const text = await adb(["shell", "am", "instrument", "-w", "-r", "com.socialgrowth.product.test/com.socialgrowth.product.AdmissionApiInstrumentation"], 30000);
  const value = (name: string) => text.match(new RegExp(`^INSTRUMENTATION_RESULT: ${name}=(.*)$`, "m"))?.[1]?.trim();
  assert.equal(value("failed"), "0"); assert.equal(value("passed"), "11");
  assert.equal(value("noParticipationCommandIssued"), "true");
  assert.equal(value("networkAdmissionGranted"), "false"); assert.equal(value("actionPermissionGranted"), "false");
  assert.match(text, /INSTRUMENTATION_CODE: -1/);
  result = { checkedAt: new Date().toISOString(), deviceModel: "SM-S9110", androidApi: 36,
    deliveryTransport: "usb_adb_instrumentation", httpsSourceTransport: "actual_phone_tailnet_to_pinned_serve",
    actualPhoneIncomingSourceVerified: true, nativeChecksPassed: 11, nativeChecksFailed: 0,
    mainApkUpdated: mainUpdated, mainUidPreserved: true, participationFreshBefore: false, participationFreshAfter: await participationFresh(),
    noParticipationCommandIssued: true, networkAdmissionGranted: false, actionPermissionGranted: false,
    evidenceScope: "supplemental_authenticated_protocol_not_usb_free_or_business_acceptance" };
} catch {
  process.exitCode = 2; result = { checkedAt: new Date().toISOString(), stage, code: "PHONE_TRANSPORT_PROBE_FAILED",
    actualPhoneIncomingSourceVerified: false, networkAdmissionGranted: false, actionPermissionGranted: false };
} finally {
  if (process.exitCode === 2 && mainInstallAttempted && originalMain) {
    // A lost adb response can follow a successful install. On every failed
    // attempted upgrade, restore the signed original APK with `install -r`;
    // this preserves the main package data and never clears or uninstalls it.
    try {
      assert.match(await adb(["install", "-r", originalMain], 30000), /Success/);
      mainUpdated = false;
      result.originalMainRestoredAfterFailure = true;
      result.mainRestoreOutcome = "succeeded";
    } catch {
      process.exitCode = 2;
      result.mainRestoreOutcome = "unknown_or_failed";
      result.packageRestoreFailed = true;
    }
  } else {
    result.mainRestoreOutcome = mainInstallAttempted ? "candidate_retained_after_probe" : "not_needed";
  }
  if (testInstallAttempted) {
    try {
      if (original) assert.match(await adb(["install", "-r", original], 30000), /Success/);
      else if ((await adb(["shell", "pm", "path", "com.socialgrowth.product.test"])).trim()) {
        assert.match(await adb(["uninstall", "com.socialgrowth.product.test"]), /Success/);
      }
      restored = true;
      result.testRestoreOutcome = "succeeded";
    } catch {
      process.exitCode = 2;
      result.testRestoreOutcome = "unknown_or_failed";
      result.packageRestoreFailed = true;
    }
  } else {
    result.testRestoreOutcome = "not_needed";
  }
  await pool.end();
}
result.mainPackageInstallAttempted = mainInstallAttempted;
result.mainPackageInstallSucceeded = mainInstallSucceeded;
result.testPackageInstallAttempted = testInstallAttempted;
result.originalTestPackagePresent = !!original;
result.testPackageRestored = restored;
result.restorationComplete = result.mainRestoreOutcome !== "unknown_or_failed" && result.testRestoreOutcome !== "unknown_or_failed";
await writeFile(resolve(output, "admission-phone-probe.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
