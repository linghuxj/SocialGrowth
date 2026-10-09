import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeStore } from "./store.js";
import { HumanAssistance } from "./human-assistance.js";
import { WebVerification, clientDiagnosticResult, connectivityDiagnosticResult, nativeDiagnosticEnvelope, verificationInput } from "./web-verification.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
test("empty successful SDK result reads only its bound native note; failed or conflicting results and redirected paths cannot pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "sg-native-note-")), trace = randomUUID(), notes = join(root, "traces", trace, "notes");
  mkdirSync(notes, { recursive: true });
  const payload = { resultCode: "CLIENT_TEST_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false, backgroundObserved: true, withdrawalObserved: false, participationRetained: true };
  const file = join(notes, "client-test-result.md"), raw = { result: "", test_summary: { task_status: "completed", passed: 7, failed: 0, inconclusive: 0 } };
  writeFileSync(file, JSON.stringify(payload));
  try {
    const result = await nativeDiagnosticEnvelope(raw, root, trace, "client_test"); assert.deepEqual(result.value, payload); assert.match(result.noteDigest!, /^[a-f0-9]{64}$/);
    for (const blocked of [{ ...raw, result: "UNCONFIRMED" }, { ...raw, test_summary: { ...raw.test_summary, failed: 1 } }, { result: "" }])
      assert.deepEqual((await nativeDiagnosticEnvelope(blocked, root, trace, "client_test")).value, blocked);
    await assert.rejects(nativeDiagnosticEnvelope(raw, root, "../other", "client_test"));
    await assert.rejects(nativeDiagnosticEnvelope(raw, root, randomUUID(), "client_test"));
    writeFileSync(file, JSON.stringify({ ...payload, permissionGranted: true })); await assert.rejects(nativeDiagnosticEnvelope(raw, root, trace, "client_test"));
    writeFileSync(file, "x".repeat(16385)); await assert.rejects(nativeDiagnosticEnvelope(raw, root, trace, "client_test"));
    rmSync(file); symlinkSync(join(root, "outside"), file); await assert.rejects(nativeDiagnosticEnvelope(raw, root, trace, "client_test"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("native report adapter accepts only one bounded final diagnostic JSON, never conflicting or business results", () => {
  const result = { resultCode: "CLIENT_TEST_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false,
    backgroundObserved: true, withdrawalObserved: true };
  const report = `Native UI observations\n${JSON.stringify(result)}`;
  assert.deepEqual(clientDiagnosticResult({ result: report }), result);
  assert.deepEqual(clientDiagnosticResult({ result: `Native UI observations\n\x60\x60\x60json\n${JSON.stringify(result)}\n\x60\x60\x60` }), result);
  for (const value of [
    `${JSON.stringify(result)}\n${report}`,
    `UNCONFIRMED\n${JSON.stringify(result)}`,
    `Native UI\n${JSON.stringify({ ...result, resultCode: "PREFLIGHT_READY" })}`,
    `Native UI\n${JSON.stringify({ ...result, finalSubmitClicked: true })}`,
    `Native UI\n${JSON.stringify({ ...result, permissionGranted: true })}`,
    `Native UI\n${JSON.stringify(result)}\nTrailing text`,
    `${"x".repeat(16_384)}\n${JSON.stringify(result)}`,
  ]) assert.throws(() => clientDiagnosticResult({ result: value }));
});
test("connectivity adapter accepts a single terminal JSON fence while rejecting conflicting or malformed reports", () => {
  const result = { resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false };
  const report = `Connectivity preparation observed\n\x60\x60\x60json\n${JSON.stringify(result)}\n\x60\x60\x60`;
  assert.deepEqual(connectivityDiagnosticResult({ result: report }), result);
  for (const raw of [
    `UNCONFIRMED\n${report}`, `${JSON.stringify(result)}\n${report}`, `${report}\nTrailing text`,
    report.slice(0, -3), report.replace('false', 'true'), report.replace('loginSubmitCount":0', 'loginSubmitCount":1'),
  ]) assert.throws(() => connectivityDiagnosticResult({ result: raw }));
});
test("SDK prose containing native JSON still requires successful independent checker counts", async () => {
  const result = `Native observations\n${JSON.stringify({ resultCode: "CLIENT_TEST_COMPLETED", loginSubmitCount: 0,
    finalSubmitClicked: false, backgroundObserved: true, withdrawalObserved: true })}`;
  for (const failed of [0, 1]) {
    const f = fixture({ result, test_summary: { task_status: "completed", passed: 1, failed, inconclusive: 0 } }, "client_test");
    try { f.hold(); f.verification.start(f.input);
      assert.equal((await f.finish()).resultCode, failed ? "UNCONFIRMED" : "CLIENT_TEST_COMPLETED");
    } finally { await f.close(); }
  }
});
function fixture(result: unknown, mode: "preflight" | "observe" | "client_test" | "connectivity_test" = "preflight") {
  const directory = mkdtempSync(join(tmpdir(), "sg-web-verify-")),
    mediaPath = join(directory, "test.mp4");
  const bytes = Buffer.from("0000ftyp0000");
  writeFileSync(mediaPath, bytes);
  const store = new RuntimeStore(":memory:"),
    assistance = new HumanAssistance(store);
  let starts = 0;
  let taskDescription = "";
  const verification = new WebVerification(
    store,
    assistance,
    {
      artemisRoot: directory,
      deviceId: "device",
      serial: "RFC_TEST",
      mediaPath,
      mediaSha256: createHash("sha256").update(bytes).digest("hex"),
      runtimeUrl: "http://127.0.0.1:4318",
    },
    {
      device: { prepare: async () => "/sdcard/test.mp4", screenshot: async () => png },
      client: () => ({
        connect: async () => {},
        close: async () => {},
        call: async (name, args) => {
          if (name === "mobile_run_task") {
            starts++;
            taskDescription = String(args.task_desc);
            if (mode === "client_test") {
              assert.equal(Object.hasOwn(args, "locked_app_package"), false);
              assert.ok(String(args.task_desc).includes("撤回本机参与 ONCE") || String(args.task_desc).includes("KEEP current participation active"));

              assert.ok(String(args.task_desc).includes("Never use manage_app"));
            } else if (mode === "connectivity_test") {
              assert.equal(Object.hasOwn(args, "locked_app_package"), false);
              if (String(args.task_desc).includes("offline setup-guide check")) {
                assert.ok(String(args.task_desc).includes("disabled 开始连接检查"));
                assert.ok(String(args.task_desc).includes("Do not retry requests, authenticate, associate"));
              } else if (String(args.task_desc).includes("io.nekohasekai.sfa")) {
                assert.equal(args.verification_level, "checkpoints");
                assert.match(String(args.task_desc), /no USB fallback/);
                assert.match(String(args.task_desc), /No shell\/ADB/);
                assert.match(String(args.task_desc), /No.*(?:publication|publishing)/);
              } else if (String(args.task_desc).includes("automatic-connection UI test")) {
                assert.equal(args.verification_level, "checkpoints");
                assert.match(String(args.task_desc), /Only SocialGrowth and launcher/);
                assert.match(String(args.task_desc), /No shell\/ADB/);
                assert.match(String(args.task_desc), /Do not change business state/);
              } else {
              assert.ok(String(args.task_desc).includes("Never open any pairing-code"));
              assert.ok(String(args.task_desc).includes("Do not change account"));
              assert.ok(String(args.task_desc).includes("do not register, associate or confirm participation"));
              }
            } else if (mode === "observe") {
              assert.equal(Object.hasOwn(args, "locked_app_package"), false);
              assert.ok(String(args.task_desc).includes("Observe current device screen only"));
            } else {
              assert.equal(args.locked_app_package, "com.facebook.katana");
              assert.ok(String(args.task_desc).includes("Share now visible and UNTOUCHED"));
            }
            return { trace_id: randomUUID() };
          }
          return { status: "completed", result: ["client_test", "connectivity_test"].includes(mode) ? {
            test_summary: { task_status: "completed", passed: 5, failed: 0, inconclusive: 0, unchecked: 0 },
            ...(result as object),
          } : result };
        },
      }),
    },
  );
  const input = {
    requestId: randomUUID(),
    expectedName: "Test",
    expectedProfileId: ["client_test", "connectivity_test"].includes(mode) ? "com.socialgrowth.product" : "123456789",
    platform: ["client_test", "connectivity_test"].includes(mode) ? "socialgrowth" : "facebook",
    caption: "DO NOT PUBLISH",
    acknowledgeNoPublication: true,
    mode,
    allowParticipationWithdrawal: mode === "client_test",
  };
  return {
    store,
    assistance,
    verification,
    input,
    starts: () => starts,
    description: () => taskDescription,
    hold: () =>
      store.db
        .prepare("INSERT INTO device_holds VALUES (?,?,?)")
        .run("device", "tester", new Date().toISOString()),
    async finish() {
      for (let i = 0; i < 100 && verification.list().some((j) => j.status === "running"); i++)
        await new Promise((r) => setTimeout(r, 5));
      return verification.list()[0];
    },
    async close() {
      await verification.close();
      assistance.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
};
}
test("native client diagnostic has its own package and result boundary, never composer or credential readiness", async () => {
  for (const result of [
    { resultCode: "CLIENT_TEST_COMPLETED", backgroundObserved: true, withdrawalObserved: true },
    { resultCode: "CLIENT_TEST_COMPLETED", backgroundObserved: true },
    { resultCode: "PREFLIGHT_READY" },
    { resultCode: "CLIENT_TEST_COMPLETED", backgroundObserved: true, withdrawalObserved: true, loginSubmitCount: 1 },
  ]) {
    const f = fixture({ loginSubmitCount: 0, finalSubmitClicked: false, ...result }, "client_test");
    try {
      f.hold();
      assert.throws(() => f.verification.start({ ...f.input, platform: "facebook", expectedProfileId: "123456789" }), /PLATFORM_IDENTITY_FORMAT_INVALID/);
      f.verification.start(f.input);
      const expected = "withdrawalObserved" in result && !("loginSubmitCount" in result) ? "CLIENT_TEST_COMPLETED" : "UNCONFIRMED";
      assert.equal((await f.finish()).resultCode, expected);
      const scope = f.assistance.supervision.controls()[0];
      assert.equal(scope.passwordAttempts, 0);
      assert.equal(scope.loginSubmits, 0);
      assert.equal(f.store.db.prepare("SELECT count(*) n FROM tasks").get()!.n, 0);
    } finally { await f.close(); }
  }
});
test("withdrawal is off by default; retained participation requires actual retention proof and cannot silently authorize withdrawal", async () => {
  assert.equal(verificationInput.parse(fixtureInput()).allowParticipationWithdrawal, false);
  for (const withdrawalObserved of [false, true]) {
    const f = fixture({ resultCode: "CLIENT_TEST_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false,
      backgroundObserved: true, withdrawalObserved, participationRetained: !withdrawalObserved }, "client_test");
    try {
      f.hold(); const input = { ...f.input, allowParticipationWithdrawal: false };
      f.verification.start(input);
      assert.throws(() => f.verification.start({ ...input, allowParticipationWithdrawal: true }), /ID_CONFLICT/);
      assert.equal((await f.finish()).resultCode, withdrawalObserved ? "UNCONFIRMED" : "CLIENT_TEST_COMPLETED");
      assert.ok(f.description().includes("KEEP current participation active"));
    } finally { await f.close(); }
  }
});
test("native success payload cannot override failed, inconclusive or absent checker evidence", async () => {
  for (const test_summary of [
    { task_status: "completed", passed: 3, failed: 2, inconclusive: 0 },
    { task_status: "completed", passed: 3, failed: 0, inconclusive: 1 },
    { task_status: "completed", passed: 0, failed: 0, inconclusive: 0 },
    { task_status: "failed", passed: 5, failed: 0, inconclusive: 0 },
    undefined,
  ]) {
    const f = fixture({ resultCode: "CLIENT_TEST_COMPLETED", loginSubmitCount: 0,
      finalSubmitClicked: false, backgroundObserved: true, withdrawalObserved: true, test_summary }, "client_test");
    try {
      f.hold(); f.verification.start(f.input);
      assert.equal((await f.finish()).resultCode, "UNCONFIRMED");
      assert.equal(f.store.db.prepare("SELECT count(*) n FROM tasks").get()!.n, 0);
    } finally { await f.close(); }
  }
});
test("observe mode never asks the SDK to implicitly launch the target App or accepts identity readiness", async () => {
  const f = fixture(
    { resultCode: "PREFLIGHT_READY", loginSubmitCount: 0, finalSubmitClicked: false },
    "observe",
  );
  try {
    f.hold();
    f.verification.start(f.input);
    const done = await f.finish();
    assert.equal(f.starts(), 1);
    assert.equal(done.resultCode, "UNCONFIRMED");
  } finally {
    await f.close();
  }
});
test("Web initiated task requires held device and explicit no-publication acknowledgement; duplicate click launches once", async () => {
  const f = fixture({
    resultCode: "LOGIN_BLOCKED",
    loginSubmitCount: 0,
    finalSubmitClicked: false,
  });
  try {
    assert.throws(() => f.verification.start(f.input), /DEVICE_HOLD_REQUIRED/);
    f.hold();
    assert.throws(() => f.verification.start({ ...f.input, acknowledgeNoPublication: false }));
    const job = f.verification.start(f.input);
    assert.equal(f.verification.start(f.input).id, job.id);
    assert.throws(
      () => f.verification.start({ ...f.input, requestId: randomUUID() }),
      /DEVICE_BUSY/,
    );
    assert.throws(() => f.verification.start({ ...f.input, caption: "changed" }), /ID_CONFLICT/);
    const done = await f.finish();
    assert.equal(done.status, "finished");
    assert.equal(done.resultCode, "LOGIN_BLOCKED");
    assert.equal(f.starts(), 1);
    assert.deepEqual(Buffer.from(f.verification.screenshot(done.id)), png);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tasks").get()!.n, 0);
  } finally {
    await f.close();
  }
});
test("claimed composer readiness without exact identity and all option proofs is not a pass", async () => {
  const f = fixture({
    resultCode: "PREFLIGHT_READY",
    loginSubmitCount: 1,
    finalSubmitClicked: false,
  });
  try {
    f.hold();
    f.verification.start(f.input);
    assert.equal((await f.finish()).resultCode, "UNCONFIRMED");
  } finally {
    await f.close();
  }
});
test("operator cancellation freezes scope and ends job without launching a queued MCP task", async () => {
  const f = fixture({ resultCode: "UNCONFIRMED", loginSubmitCount: 0, finalSubmitClicked: false });
  try {
    f.hold();
    const job = f.verification.start(f.input);
    assert.equal(f.verification.stop(job.id).status, "stopping");
    const done = await f.finish();
    assert.equal(done.status, "cancelled");
    assert.equal(done.errorCode, "OPERATOR_CANCELLED");
    assert.equal(f.starts(), 0);
    assert.equal(f.assistance.supervision.controls()[0].state, "stopped");
  } finally {
    await f.close();
  }
});
test("completed task with contradictory publication or repeated login is not accepted", async () => {
  for (const values of [
    { loginSubmitCount: 2, finalSubmitClicked: false },
    { loginSubmitCount: 1, finalSubmitClicked: true },
  ]) {
    const f = fixture({ resultCode: "LOGIN_REJECTED", ...values });
    try {
      f.hold();
      f.verification.start(f.input);
      assert.equal((await f.finish()).resultCode, "UNCONFIRMED");
    } finally {
      await f.close();
    }
  }
});

test("initial participation delegation is off by default, client-only and part of request identity", async () => {
  assert.equal(verificationInput.parse(fixtureInput()).allowLocalParticipationStart, false);
  const result = { resultCode: "UNCONFIRMED", loginSubmitCount: 0, finalSubmitClicked: false };
  for (const allowed of [false, true]) {
    const f = fixture(result, "client_test");
    try {
      f.hold(); const job = f.verification.start({ ...f.input, allowLocalParticipationStart: allowed });
      assert.throws(() => f.verification.start({ ...f.input, allowLocalParticipationStart: !allowed }), /ID_CONFLICT/);
      assert.equal(f.verification.start({ ...f.input, allowLocalParticipationStart: allowed }).id, job.id);
      await f.finish();
      assert.ok(f.description().includes(allowed ? "ONE initial tap" : "Never click 确认当前参与"));
      assert.ok(f.description().includes("never retry or restore participation") === allowed);
    } finally { await f.close(); }
  }
  const f = fixture(result, "observe");
  try { f.hold(); assert.throws(() => f.verification.start({ ...f.input, allowLocalParticipationStart: true }), /CLIENT_INITIAL_START_SCOPE_INVALID/); }
  finally { await f.close(); }
});
function fixtureInput() {
  return { requestId: randomUUID(), expectedName: "Test", expectedProfileId: "123456789", caption: "NO PUBLICATION", acknowledgeNoPublication: true };
}

test("connectivity preparation is native-only, excludes codes, and requires checker evidence", async () => {
  for (const failed of [0, 1]) {
    const f = fixture({ resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false,
      test_summary: { task_status: "completed", passed: 1, failed, inconclusive: 0 } }, "connectivity_test");
    try {
      f.hold();
      assert.throws(() => f.verification.start({ ...f.input, allowLocalParticipationStart: true }), /CLIENT_INITIAL_START_SCOPE_INVALID/);
      f.verification.start({ ...f.input, allowEndpointReportingStart: true });
      assert.equal((await f.finish()).resultCode, failed ? "UNCONFIRMED" : "CONNECTIVITY_SETUP_COMPLETED");
      assert.ok(f.description().includes("start connection checks automatically"));
    } finally { await f.close(); }
  }
});

test("offline setup checks reject reporting authority and retain failed checker results", async () => {
  for (const failed of [0, 1]) {
    const f = fixture({ resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false,
      test_summary: { task_status: "completed", passed: 1, failed, inconclusive: 0 } }, "connectivity_test");
    try {
      f.hold();
      const input = { ...f.input, goal: "VERIFY_OFFLINE_GUIDE_ONLY" };
      assert.throws(() => f.verification.start({ ...input, allowEndpointReportingStart: true }), /OFFLINE_GUIDE_SCOPE_INVALID/);
      assert.equal(f.starts(), 0);
      f.verification.start(input);
      assert.equal((await f.finish()).resultCode, failed ? "UNCONFIRMED" : "CONNECTIVITY_SETUP_COMPLETED");
    } finally { await f.close(); }
  }
});

test("automatic connection checks require connection scope and never expand business participation", async () => {
  const f = fixture({ resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false,
    test_summary: { task_status: "completed", passed: 3, failed: 0, inconclusive: 0 } }, "connectivity_test");
  try {
    f.hold();
    const input = { ...f.input, goal: "VERIFY_AUTOMATIC_CONNECTION" };
    assert.throws(() => f.verification.start(input), /AUTOMATIC_CONNECTION_SCOPE_INVALID/);
    assert.equal(f.starts(), 0);
    f.verification.start({ ...input, allowEndpointReportingStart: true });
    assert.equal((await f.finish()).resultCode, "CONNECTIVITY_SETUP_COMPLETED");
    assert.match(f.description(), /ONE pause and ONE resume of CONNECTION AUTOMATION ONLY/);
    assert.match(f.description(), /No shell\/ADB/);
    assert.match(f.description(), /Do not change business state/);
  } finally { await f.close(); }
});

test("network coexistence check grants only explicit connectivity scope and preserves the original hold", async () => {
  const f = fixture({ result: { resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false } }, "connectivity_test");
  try {
    f.hold();
    for (const extra of [{ mode: "client_test" }, { platform: "facebook", expectedProfileId: "123456789" },
      { allowEndpointReportingStart: true }, { allowLocalParticipationStart: true }, { allowParticipationWithdrawal: true }]) {
      assert.throws(() => f.verification.start({ ...f.input, goal: "VERIFY_PHONE_NETWORK_COEXISTENCE", ...extra }));
    }
    assert.equal(f.starts(), 0);
    f.verification.start({ ...f.input, goal: "VERIFY_PHONE_NETWORK_COEXISTENCE" });
    const job = await f.finish();
    assert.equal(job.resultCode, "CONNECTIVITY_SETUP_COMPLETED");
    const control = f.assistance.supervision.controls().find(c => c.taskId === job.id)!;
    assert.equal(control.policy.allowNetworkCoexistenceCheck, true);
    assert.equal(control.policy.allowTrustedInstall, false);
    assert.equal(control.policy.allowPublication, false);
    assert.equal(f.store.db.prepare("SELECT actor FROM device_holds WHERE device='device'").get()!.actor, "tester");
  } finally { await f.close(); }
});

test("network observations cannot pass when every independent UI check is inconclusive", async () => {
  const f = fixture({ result: { resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false },
    test_summary: { task_status: "completed", passed: 0, failed: 0, inconclusive: 4 } }, "connectivity_test");
  try {
    f.hold();
    f.verification.start({ ...f.input, goal: "VERIFY_PHONE_NETWORK_COEXISTENCE" });
    assert.equal((await f.finish()).resultCode, "UNCONFIRMED");
    assert.equal(f.store.db.prepare("SELECT actor FROM device_holds WHERE device='device'").get()!.actor, "tester");
  } finally { await f.close(); }
});

test("one successful check cannot replace all four network coexistence checks", async () => {
  for (const counts of [{ passed: 1, unchecked: 3 }, { passed: 4, unchecked: 1 }, { passed: 4 }]) {
    const f = fixture({ result: { resultCode: "CONNECTIVITY_SETUP_COMPLETED", loginSubmitCount: 0, finalSubmitClicked: false },
      test_summary: { task_status: "completed", failed: 0, inconclusive: 0, ...counts } }, "connectivity_test");
    try {
      f.hold();
      f.verification.start({ ...f.input, goal: "VERIFY_PHONE_NETWORK_COEXISTENCE" });
      assert.equal((await f.finish()).resultCode, "UNCONFIRMED");
    } finally { await f.close(); }
  }
});

test("bootstrap launch rejects arbitrary targets and cannot bypass a device hold", async () => {
  const f = fixture({}, "connectivity_test");
  const target = { deviceId: randomUUID(), requestId: randomUUID(), sessionId: randomUUID(), hardwareSerial: "RFC_TEST", serial: "127.0.0.1:41234" };
  try {
    assert.throws(() => f.verification.start({ ...f.input, goal: "BOOTSTRAP_PHONE_PREPARATION" }), /BOOTSTRAP_AUTHORITY_REQUIRED/);
    for (const serial of ["example.com:22", "10.0.0.1:5555", "127.0.0.1:70000", "100.128.0.1:5555", "RFC_USB"]) {
      assert.throws(() => f.verification.startBootstrap({ ...target, serial }, "/opt/artemis", "http://127.0.0.1:4318"));
    }
    assert.throws(() => f.verification.startBootstrap(target, "/opt/artemis", "http://127.0.0.1:4318"), /DEVICE_HOLD_REQUIRED/);
    assert.equal(f.verification.list().length, 0);
  } finally { await f.close(); }
});

test("automatic initialization never overrides an existing hold or an unresolved task; interrupted scope is not replayed", async () => {
  const f = fixture({}, "connectivity_test");
  const deviceId = randomUUID(), target = { deviceId, wirelessPort: 37111, requestId: randomUUID(), sessionId: randomUUID(), hardwareSerial: "TEST_PHONE",
    serial: "127.0.0.1:12345" };
  try {
    f.store.db.prepare("INSERT INTO device_holds VALUES (?,?,?)").run(deviceId, "original-operator", new Date().toISOString());
    assert.throws(() => f.verification.startPhoneInitialization(target, "/sdk", "http://127.0.0.1:4318", "/private/init.json"), /DEVICE_ALREADY_HELD/);
    assert.equal(f.store.db.prepare("SELECT actor FROM device_holds WHERE device=?").get(deviceId)?.actor, "original-operator");
    f.store.db.prepare("DELETE FROM device_holds WHERE device=?").run(deviceId);
    for (const status of ["queued", "running", "unknown", "blocked"]) {
      f.store.db.prepare("INSERT OR REPLACE INTO tasks(id,schedule,attempt,identity,device,status,body) VALUES (?,?,?,?,?,?,?)").run("original", "schedule", "attempt", "identity", deviceId, status, "{}");
      assert.throws(() => f.verification.startPhoneInitialization(target, "/sdk", "http://127.0.0.1:4318", "/private/init.json"), /DEVICE_UNRESOLVED_TASK/);
    }
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM device_holds").get()?.n, 0);
    f.store.db.prepare("DELETE FROM tasks").run();
    const job = { requestId: target.requestId, expectedName: "手机环境初始化", expectedProfileId: "com.socialgrowth.product", platform: "socialgrowth",
      mode: "connectivity_test", goal: "2026-10-08.phone-environment-v1", caption: "可信应用、管理连接与 FB/YT 网络初始化，不执行业务",
      acknowledgeNoPublication: true, allowLocalParticipationStart: false, allowEndpointReportingStart: false, allowParticipationWithdrawal: false,
      id: randomUUID(), deviceId, status: "interrupted", resultCode: "UNCONFIRMED", startedAt: new Date().toISOString() };
    f.store.db.prepare("INSERT INTO web_verifications(id,request_id,body) VALUES (?,?,?)").run(job.id, job.requestId, JSON.stringify(job));
    const original = f.verification.startPhoneInitialization({ ...target, serial: "127.0.0.1:54321", sessionId: randomUUID() }, "/sdk", "http://127.0.0.1:4318", "/private/init.json");
    assert.equal(original.id, job.id); assert.equal(original.status, "interrupted"); assert.equal(f.starts(), 0);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM device_holds").get()?.n, 0);
    assert.throws(() => f.verification.start({ ...f.input, goal: "2026-10-08.phone-environment-v1" }), /PHONE_INITIALIZATION_AUTHORITY_REQUIRED/);
  } finally { await f.close(); }
});


test("phone preparation rejects a valid but unbound native capability and every ordinary diagnostic", async () => {
  for (const initialization of [false, true]) {
    const f = fixture({}, "connectivity_test");
    try {
      const s = f.assistance.open({ taskId: randomUUID(), deviceId: "device", serial: "RFC_TEST", packageName: "com.socialgrowth.product",
        expectedIdentity: "unbound native diagnostic", mode: "diagnostic", expiresAt: new Date(Date.now() + 60000).toISOString(),
        policy: { mode: "connectivity_test", allowPhoneInitialization: initialization, allowLogin: false } });
      await assert.rejects(f.verification.preparePhoneEnvironment(s.token), new RegExp(initialization
        ? "PHONE_INITIALIZATION_NOT_ACTIVE" : "PHONE_INITIALIZATION_NOT_AUTHORIZED"));
      assert.equal(f.assistance.supervision.get(s.sessionId).installAttempts, undefined);
      assert.equal(f.starts(), 0);
    } finally { await f.close(); }
  }
});


test("prepared flag requires completed trusted preparation; failed preparation keeps original unknown receipt", async () => {
  for (const succeeded of [false, true]) {
    const f = fixture({}, "connectivity_test"), taskId = randomUUID(), sessionId = randomUUID();
    try {
      const job = { ...f.input, id: taskId, deviceId: "device", goal: "2026-10-08.phone-environment-v1", status: "finished", resultCode: "UNCONFIRMED", startedAt: new Date().toISOString() };
      f.store.db.prepare("INSERT INTO web_verifications(id,request_id,body) VALUES (?,?,?)").run(taskId, job.requestId, JSON.stringify(job));
      f.assistance.supervision.open({ sessionId, taskId, deviceId: "device", expectedIdentity: "phone", expiresAt: new Date(Date.now() + 60000).toISOString() }, { mode: "connectivity_test", allowPhoneInitialization: true, allowLogin: false });
      assert.equal(f.verification.list()[0].initializationPrepared, undefined);
      const preparation = f.assistance.supervision.preparePhone(sessionId, async () => { if (!succeeded) throw new Error("fixture failure"); });
      if (succeeded) await preparation; else await assert.rejects(preparation, /fixture failure/);
      assert.equal(f.verification.list()[0].initializationPrepared, succeeded ? true : undefined);
      assert.equal(f.verification.list()[0].resultCode, "UNCONFIRMED");
    } finally { await f.close(); }
  }
});
