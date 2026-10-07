import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RuntimeStore } from "./store.js";
import { HumanAssistance } from "./human-assistance.js";
test("client test scope denies credentials, installation, identity and publication while allowing native navigation", () => {
  const store = new RuntimeStore(":memory:"), human = new HumanAssistance(store);
  const scope = { taskId: randomUUID(), deviceId: "phone", serial: "RFC_TEST", packageName: "com.socialgrowth.product",
    expectedIdentity: "own native client", mode: "diagnostic", expiresAt: new Date(Date.now() + 60000).toISOString(), policy: { mode: "client_test" } };
  try {
    for (const invalid of [{ ...scope, packageName: "com.facebook.katana" }, { ...scope, mode: "execution" }, { ...scope, policy: { mode: "preflight" } }])
      assert.throws(() => human.open(invalid));
    const session = human.open(scope);
    assert.throws(() => human.beginCredential(session.token, "password"), /CONTROL_NOT_ACTIVE/);
    assert.throws(() => human.beginCredential(session.token, "otp"), /CONTROL_NOT_ACTIVE/);
    for (const category of ["publish", "install", "create_identity", "login_submit", "correct_account", "unmanaged"])
      assert.throws(() => human.supervision.gate(session.sessionId, { action: "test", category }), /CLIENT_TEST_ACTION_NOT_AUTHORIZED/);
    assert.equal(human.supervision.gate(session.sessionId, { action: "click", category: "navigate" }).allowed, true);
    assert.throws(() => human.supervision.gate(session.sessionId, { action: "manage_app", category: "recovery" }), /CLIENT_TEST_ACTION_NOT_AUTHORIZED/);
  } finally { human.close(); store.close(); }
});
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
test("reviewed stopped preflight can reopen only the same identity; normal task restarts remain blocked", () => {
  const store = new RuntimeStore(":memory:"), human = new HumanAssistance(store);
  const scope = { taskId: randomUUID(), deviceId: "phone", serial: "RFC_TEST", packageName: "com.facebook.katana",
    expectedIdentity: "bound-parent", mode: "execution", expiresAt: new Date(Date.now() + 60000).toISOString(), policy: { mode: "preflight" } };
  try {
    const original = human.open(scope);
    assert.throws(() => human.open(scope, true), /ASSISTANCE_DEVICE_BUSY/);
    human.closeSession(original.token);
    assert.throws(() => human.open(scope), /TASK_RESTART_REQUIRES_REVIEW/);
    assert.throws(() => human.open({ ...scope, expectedIdentity: "another-parent" }, true), /TASK_RESTART_REQUIRES_REVIEW/);
    assert.throws(() => human.open({ ...scope, policy: { mode: "onboarding" } }, true), /TASK_RESTART_REQUIRES_REVIEW/);
    const resumed = human.open(scope, true);
    assert.equal(resumed.taskId, original.taskId);
    assert.throws(() => human.supervision.gate(resumed.sessionId, { action: "click", category: "publish" }));
  } finally { human.close(); store.close(); }
});
function fixture(mode: "observe" | "preflight" = "preflight", allowTrustedInstall = false) {
  const store = new RuntimeStore(":memory:");
  let now = Date.now();
  const human = new HumanAssistance(store, () => now),
    service = human.supervision;
  const scope = {
    taskId: randomUUID(),
    deviceId: "phone",
    serial: "RFC_TEST",
    packageName: "com.facebook.katana",
    expectedIdentity: "target-account",
    mode: "diagnostic",
    expiresAt: new Date(now + 600000).toISOString(),
    policy: { mode, allowTrustedInstall },
  };
  const session = human.open(scope),
    sid = session.sessionId;
  const create = (kind = "clarification", reason = "OTHER") =>
    service.create(sid, {
      traceId: randomUUID(),
      kind,
      reason,
      message: "Explain current state; no secrets",
      screenshot: png,
    });
  const reply = (id: string, decision = "provided") =>
    service.respond(id, {
      expectedIdentity: scope.expectedIdentity,
      confirmed: true,
      decision,
      text: "Reviewed; only continue within original authorization",
    });
  const verify = (id: string, continueTask = true) =>
    service.revalidate(sid, {
      requestId: id,
      expectedIdentity: scope.expectedIdentity,
      screenshot: png,
      continueTask,
    });
  return {
    store,
    human,
    service,
    session,
    sid,
    scope,
    create,
    reply,
    verify,
    advance: (ms: number) => (now += ms),
    close: () => {
      human.close();
      store.close();
    },
  };
}
test("failed credential before challenge freezes future taps, text, shell and retries", () => {
  const f = fixture();
  try {
    f.human.beginCredential(f.session.token, "password");
    f.service.stop(f.sid, "PROTECTED_FIELD_CLEAR_FAILED");
    f.service.stop(f.sid, "LATER_MODEL_INTERPRETATION");
    assert.equal(f.service.get(f.sid).reason, "PROTECTED_FIELD_CLEAR_FAILED");
    for (const category of ["navigate", "login_submit", "unmanaged", "recovery"])
      assert.throws(() => f.service.gate(f.sid, { action: "test", category }), /FROZEN/);
    assert.throws(() => f.human.beginCredential(f.session.token, "password"));
    assert.equal(
      f.service.gate(f.sid, { action: "observe_screen", category: "read" }).allowed,
      true,
    );
    assert.equal(f.service.get(f.sid).passwordAttempts, 1);
  } finally {
    f.close();
  }
});
test("trusted install requires explicit policy, is serialized once, and cannot unfreeze cancelled task", async () => {
  for (const mode of ["observe", "preflight"] as const) {
    const f = fixture(mode);
    try {
      await assert.rejects(
        f.service.ensureApp(f.sid, async () => {
          throw new Error("must not execute");
        }),
        /NOT_AUTHORIZED/,
      );
    } finally {
      f.close();
    }
  }
  const f = fixture("preflight", true);
  try {
    const result = await f.service.ensureApp(f.sid, async () => {
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "navigate" }),
        /FROZEN/,
      );
      return { status: "installed_missing_app" };
    });
    assert.equal(result.status, "installed_missing_app");
    assert.equal(f.service.get(f.sid).state, "active");
    await assert.rejects(
      f.service.ensureApp(f.sid, async () => null),
      /BUDGET/,
    );
  } finally {
    f.close();
  }
  const stopped = fixture("preflight", true);
  try {
    await assert.rejects(
      stopped.service.ensureApp(stopped.sid, async () => {
        stopped.service.stop(stopped.sid, "OPERATOR_CANCELLED");
        return "installed";
      }),
      /AFTER_STOP/,
    );
    assert.equal(stopped.service.get(stopped.sid).reason, "OPERATOR_CANCELLED");
  } finally {
    stopped.close();
  }
});
test("password then OTP share one task, each input/submit is single-use and secrets are not journalled", () => {
  const f = fixture();
  try {
    for (const kind of ["password", "otp"] as const) {
      f.human.beginCredential(f.session.token, kind);
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "navigate" }),
        /FROZEN/,
      );
      const c = f.human.create(f.session.token, { traceId: randomUUID(), screenshot: png, kind });
      const secret = kind === "password" ? "test-password-not-real" : "654321";
      f.human.submit(c.id, {
        password: secret,
        expectedIdentity: f.scope.expectedIdentity,
        confirmed: true,
      });
      assert.equal(f.human.claim(f.session.token, c.id).password, secret);
      assert.equal(f.human.claim(f.session.token, c.id).password, undefined);
      f.human.finish(f.session.token, c.id, { resultCode: "INPUT_COMPLETED" });
      assert.equal(
        f.service.gate(f.sid, { action: "click", category: "login_submit" }).allowed,
        true,
      );
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "login_submit" }),
        /NOT_AUTHORIZED/,
      );
      assert.throws(
        () => f.human.create(f.session.token, { traceId: randomUUID(), screenshot: png, kind }),
        /SINGLE_ATTEMPT/,
      );
      assert.ok(
        !JSON.stringify([f.service.controls(), f.service.events(), f.human.list()]).includes(
          secret,
        ),
      );
    }
    assert.equal(f.service.get(f.sid).loginSubmits, 2);
  } finally {
    f.close();
  }
});
for (const [kind, decision] of [
  ["content", "provided"],
  ["approval", "approved"],
  ["manual", "completed"],
  ["clarification", "provided"],
]) {
  test(`${kind}: Web reply freezes actions until fresh scoped revalidation; no authority expansion`, () => {
    const f = fixture();
    try {
      const r = f.create(kind);
      assert.throws(() => f.create(), /NOT_ACTIVE/);
      assert.throws(
        () =>
          f.service.respond(r.id, {
            expectedIdentity: "wrong",
            confirmed: true,
            decision,
            text: "test",
          }),
        /MISMATCH/,
      );
      f.reply(r.id, decision);
      assert.throws(() => f.reply(r.id, decision), /NOT_WAITING/);
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "navigate" }),
        /FROZEN/,
      );
      assert.equal(f.service.claim(f.sid, r.id).status, "claimed");
      assert.equal(f.service.claim(f.sid, r.id).response, undefined);
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "navigate" }),
        /FROZEN/,
      );
      assert.equal(f.verify(r.id).state, "active");
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "publish" }),
        /SEPARATE/,
      );
      assert.equal(f.create().status, "waiting");
    } finally {
      f.close();
    }
  });
}
for (const reason of ["ACCOUNT_MISMATCH", "CREATE_IDENTITY", "ACCOUNT_RESTRICTED"]) {
  test(`${reason}: approval does not silently switch/create accounts or bypass restriction`, () => {
    const f = fixture();
    try {
      const r = f.create("approval", reason);
      f.reply(r.id, "approved");
      f.service.claim(f.sid, r.id);
      assert.equal(f.verify(r.id).state, "stopped");
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "navigate" }),
        /FROZEN/,
      );
    } finally {
      f.close();
    }
  });
}
test("observation can roundtrip assistance but cannot mutate, login, install or publish", () => {
  const f = fixture("observe");
  try {
    for (const category of [
      "navigate",
      "login_submit",
      "recovery",
      "install",
      "publish",
      "unmanaged",
    ])
      assert.throws(() => f.service.gate(f.sid, { action: "anything", category }), /OBSERVE_ONLY/);
    assert.throws(() => f.human.beginCredential(f.session.token, "password"), /NOT_ACTIVE/);
    const r = f.create();
    f.reply(r.id);
    f.service.claim(f.sid, r.id);
    f.verify(r.id);
    assert.equal(f.service.get(f.sid).policy.mode, "observe");
    assert.equal(
      f.service.gate(f.sid, { action: "observe_screen", category: "read" }).allowed,
      true,
    );
  } finally {
    f.close();
  }
});
test("cancel, expiry, close and restart reject late replies and freeze device writes", () => {
  for (const action of ["cancel", "expire", "close", "restart"]) {
    const f = fixture();
    try {
      const r = f.create();
      if (action === "cancel")
        f.service.respond(r.id, {
          expectedIdentity: f.scope.expectedIdentity,
          confirmed: true,
          decision: "cancel",
        });
      if (action === "expire") f.advance(301000);
      if (action === "close") f.human.closeSession(f.session.token);
      if (action === "restart") {
        const next = new HumanAssistance(f.store);
        next.close();
      }
      assert.throws(() => f.reply(r.id), /NOT_WAITING/);
      assert.throws(
        () => f.service.gate(f.sid, { action: "click", category: "navigate" }),
        /FROZEN/,
      );
    } finally {
      f.close();
    }
  }
});
test("recovery budget bounded, publishing uncertainty freezes all writes, task identity cannot reset budget", () => {
  const f = fixture();
  try {
    f.service.gate(f.sid, { action: "manage_app", category: "recovery" });
    f.service.gate(f.sid, { action: "manage_app", category: "recovery" });
    assert.throws(
      () => f.service.gate(f.sid, { action: "manage_app", category: "recovery" }),
      /BUDGET/,
    );
    f.service.stop(f.sid, "PUBLISH_RESULT_UNKNOWN");
    f.human.closeSession(f.session.token);
    assert.throws(() => f.human.open(f.scope), /RESTART_REQUIRES_REVIEW/);
    assert.throws(() => f.service.gate(f.sid, { action: "click", category: "publish" }), /FROZEN/);
  } finally {
    f.close();
  }
});

test("connectivity test permits navigation only and never unmanaged recovery or credential operations", () => {
  const store = new RuntimeStore(":memory:"), human = new HumanAssistance(store);
  try {
    const session = human.open({ taskId: randomUUID(), deviceId: "phone", serial: "RFC_TEST", packageName: "com.socialgrowth.product",
      expectedIdentity: "authorized connectivity diagnostic", mode: "diagnostic", expiresAt: new Date(Date.now() + 60000).toISOString(), policy: { mode: "connectivity_test" } });
    assert.equal(human.supervision.gate(session.sessionId, { action: "click", category: "navigate" }).allowed, true);
    for (const category of ["recovery", "login_submit", "install", "publish", "create_identity", "unmanaged"])
      assert.throws(() => human.supervision.gate(session.sessionId, { action: "click", category }), /CLIENT_TEST_ACTION_NOT_AUTHORIZED/);
  } finally { human.close(); store.close(); }
});
