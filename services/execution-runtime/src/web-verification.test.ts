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
function fixture(result: unknown) {
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
            assert.ok(String(args.task_desc).includes("Share now visible and UNTOUCHED"));
            return { trace_id: randomUUID() };
          }
          return { status: "completed", result };
        },
      }),
    },
  );
  const input = {
    requestId: randomUUID(),
    expectedName: "Test",
    expectedProfileId: "123456789",
    caption: "DO NOT PUBLISH",
    acknowledgeNoPublication: true,
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
