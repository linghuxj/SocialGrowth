import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeStore } from "./store.ts";
import { HumanAssistance } from "./human-assistance.ts";
import { WebVerification } from "./web-verification.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function fixture(result: unknown, mode: "preflight" | "observe" | "client_test" = "preflight") {
  const directory = mkdtempSync(join(tmpdir(), "sg-web-verify-")),
    mediaPath = join(directory, "test.mp4");
  const bytes = Buffer.from("0000ftyp0000");
  writeFileSync(mediaPath, bytes);
  const store = new RuntimeStore(":memory:"),
    assistance = new HumanAssistance(store);
  let starts = 0;
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
            if (mode === "client_test") {
              assert.equal(Object.hasOwn(args, "locked_app_package"), false);
              assert.ok(String(args.task_desc).includes("撤回本机参与 ONCE"));
              assert.ok(String(args.task_desc).includes("Never click 确认当前参与"));
            } else if (mode === "observe") {
              assert.equal(Object.hasOwn(args, "locked_app_package"), false);
              assert.ok(String(args.task_desc).includes("Observe current device screen only"));
            } else {
              assert.equal(args.locked_app_package, "com.facebook.katana");
              assert.ok(String(args.task_desc).includes("Share now visible and UNTOUCHED"));
            }
            return { trace_id: randomUUID() };
          }
          return { status: "completed", result: mode === "client_test" ? {
            test_summary: { task_status: "completed", passed: 5, failed: 0, inconclusive: 0 },
            ...(result as object),
          } : result };
        },
      }),
    },
  );
  const input = {
    requestId: randomUUID(),
    expectedName: "Test",
    expectedProfileId: mode === "client_test" ? "com.socialgrowth.product" : "123456789",
    platform: mode === "client_test" ? "socialgrowth" : "facebook",
    caption: "DO NOT PUBLISH",
    acknowledgeNoPublication: true,
    mode,
  };
  return {
    store,
    assistance,
    verification,
    input,
    starts: () => starts,
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
