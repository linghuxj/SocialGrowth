import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RuntimeStore } from "./store.ts";
import { HumanAssistance } from "./human-assistance.ts";
import { artemisStructuredResult } from "./device-executor.ts";
import { createRuntimeServer } from "./server.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
function fixture() {
  const store = new RuntimeStore(":memory:");
  let now = Date.now();
  const service = new HumanAssistance(store, () => now);
  const scope = {
    taskId: "test",
    deviceId: "phone",
    serial: "RFC_TEST",
    packageName: "com.facebook.katana",
    expectedIdentity: "https://facebook.com/page",
    expiresAt: new Date(now + 600000).toISOString(),
    mode: "diagnostic",
  };
  const session = service.open(scope);
  const challenge = service.create(session.token, { traceId: randomUUID(), screenshot: png });
  return {
    service,
    store,
    session,
    challenge,
    scope,
    advance: (ms: number) => (now += ms),
    close() {
      service.close();
      store.close();
    },
  };
}
test("human password is one-time, bound to account/session; never in metadata or SQLite", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.service.submit(f.challenge.id, {
          password: "test-only",
          expectedIdentity: "wrong",
          confirmed: true,
        }),
      /ACCOUNT_MISMATCH/,
    );
    assert.throws(
      () => f.service.finish(f.session.token, f.challenge.id, { resultCode: "INPUT_COMPLETED" }),
      /NOT_CLAIMED/,
    );
    f.service.submit(f.challenge.id, {
      password: "test-only",
      expectedIdentity: f.scope.expectedIdentity,
      confirmed: true,
    });
    assert.ok(!JSON.stringify(f.service.list()).includes("test-only"));
    assert.ok(
      !JSON.stringify(f.store.db.prepare("SELECT body FROM human_assistance").all()).includes(
        "test-only",
      ),
    );
    assert.throws(() => f.service.claim("invalid", f.challenge.id), /SESSION_INVALID/);
    assert.deepEqual(f.service.claim(f.session.token, f.challenge.id), {
      status: "claimed",
      password: "test-only",
    });
    assert.deepEqual(f.service.claim(f.session.token, f.challenge.id), { status: "claimed" });
    assert.throws(
      () =>
        f.service.submit(f.challenge.id, {
          password: "again",
          expectedIdentity: f.scope.expectedIdentity,
          confirmed: true,
        }),
      /NOT_WAITING/,
    );
    f.service.finish(f.session.token, f.challenge.id, { resultCode: "INPUT_COMPLETED" });
    assert.equal(f.service.list()[0].workflowResult, undefined);
    f.service.report(f.session.token, { resultCode: "LOGIN_REJECTED", screenshot: png });
    assert.equal(f.service.list()[0].workflowResult, "LOGIN_REJECTED");
    assert.throws(
      () => f.service.create(f.session.token, { traceId: randomUUID(), screenshot: png }),
      /SINGLE_ATTEMPT/,
    );
  } finally {
    f.close();
  }
});
test("cancel, timeout and restart discard credentials; input is never replayed", () => {
  for (const action of ["cancel", "expire", "restart"] as const) {
    const f = fixture();
    try {
      f.service.submit(f.challenge.id, {
        password: "test-only",
        expectedIdentity: f.scope.expectedIdentity,
        confirmed: true,
      });
      if (action === "cancel") {
        f.service.cancel(f.challenge.id);
        assert.equal(f.service.claim(f.session.token, f.challenge.id).status, "cancelled");
      }
      if (action === "expire") {
        f.advance(301000);
        assert.equal(f.service.claim(f.session.token, f.challenge.id).status, "expired");
      }
      if (action === "restart") {
        f.service.close();
        const next = new HumanAssistance(f.store);
        assert.throws(() => next.claim(f.session.token, f.challenge.id), /SESSION_INVALID/);
        assert.equal(next.list()[0].status, "interrupted");
        next.close();
      }
    } finally {
      f.close();
    }
  }
});
test("another device session cannot consume a challenge", () => {
  const f = fixture();
  try {
    assert.throws(() => f.service.open(f.scope), /DEVICE_BUSY/);
    const other = f.service.open({ ...f.scope, deviceId: "phone2", serial: "RFC_OTHER" });
    assert.throws(() => f.service.claim(other.token, f.challenge.id), /SCOPE_MISMATCH/);
  } finally {
    f.close();
  }
});
test("Artemis nested final JSON unwraps but natural language is not fabricated into a pass", () => {
  assert.deepEqual(
    artemisStructuredResult({ result: { result: '```json\n{"status":"login_required"}\n```' } }),
    { status: "login_required" },
  );
  assert.throws(() => artemisStructuredResult({ result: "Everything worked!" }));
});
test("real HTTP handoff enforces operator/device/capability boundaries without secret echo or persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-human-http-"));
  const operator = "o".repeat(32),
    device = "d".repeat(32);
  const server = createRuntimeServer({
    dataDir: dir,
    token: operator,
    signingKey: "s".repeat(32),
    deviceTokens: { phone: device },
  });
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  const base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}/api/runtime`;
  const call = async (path: string, token: string, data?: unknown) => {
    const r = await fetch(base + path, {
      method: data ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { ok: r.ok, value: await r.json() };
  };
  try {
    const scope = {
      taskId: "diagnostic",
      deviceId: "phone",
      serial: "RFC_TEST",
      packageName: "com.facebook.katana",
      expectedIdentity: "test account",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      mode: "diagnostic",
    };
    assert.equal((await call("/assistance/sessions", device, scope)).ok, false);
    assert.equal((await call("/assistance/sessions", operator, scope)).ok, false);
    server.runtime.holdDevice("phone", true, "tester");
    const { value: session } = await call("/assistance/sessions", operator, scope);
    assert.equal(
      (await call("/device-control", operator, { deviceId: "phone", held: false })).ok,
      false,
    );
    const { value: c } = await call("/assistance/agent/challenge", session.token, {
      traceId: randomUUID(),
      screenshot: png,
    });
    const input = {
      id: c.id,
      password: "test-only-http",
      expectedIdentity: scope.expectedIdentity,
      confirmed: true,
    };
    assert.equal((await call("/assistance/submit", device, input)).ok, false);
    assert.equal((await call("/assistance/submit", session.token, input)).ok, false);
    const submitted = await call("/assistance/submit", operator, input);
    assert.equal(submitted.ok, true);
    assert.ok(!JSON.stringify(submitted.value).includes(input.password));
    assert.equal((await call("/assistance/agent/claim", device, { id: c.id })).ok, false);
    const claimed = await call("/assistance/agent/claim", session.token, { id: c.id });
    assert.equal(claimed.value.password, input.password);
    assert.equal(
      (await call("/assistance/agent/claim", session.token, { id: c.id })).value.password,
      undefined,
    );
    assert.equal(server.store.db.prepare("SELECT count(*) AS n FROM messages").get()!.n, 0);
    assert.ok(!JSON.stringify(server.assistance.list()).includes(input.password));
    assert.equal(
      (
        await call("/assistance/agent/finish", session.token, {
          id: c.id,
          resultCode: "INPUT_COMPLETED",
        })
      ).ok,
      true,
    );
    const { value: request } = await call("/assistance/agent/request", session.token, {
      traceId: randomUUID(),
      kind: "clarification",
      reason: "OTHER",
      message: "Test scoped Web response",
      screenshot: png,
    });
    assert.equal(
      (
        await call("/assistance/agent/gate", session.token, {
          action: "click",
          category: "navigate",
        })
      ).ok,
      false,
    );
    const response = {
      id: request.id,
      expectedIdentity: scope.expectedIdentity,
      confirmed: true,
      decision: "provided",
      text: "Test response without credentials",
    };
    assert.equal((await call("/supervision/respond", device, response)).ok, false);
    assert.equal((await call("/supervision/respond", session.token, response)).ok, false);
    assert.equal((await call("/supervision/respond", operator, response)).ok, true);
    assert.equal(
      (await call("/assistance/agent/claim-response", session.token, { id: request.id })).value
        .status,
      "claimed",
    );
    assert.equal(
      (
        await call("/assistance/agent/gate", session.token, {
          action: "click",
          category: "navigate",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await call("/assistance/agent/revalidate", session.token, {
          requestId: request.id,
          expectedIdentity: scope.expectedIdentity,
          screenshot: png,
          continueTask: true,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await call("/assistance/agent/gate", session.token, {
          action: "click",
          category: "navigate",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await call("/assistance/agent/gate", session.token, {
          action: "click",
          category: "publish",
        })
      ).ok,
      false,
    );
    await call("/assistance/agent/close", session.token, {});
    assert.equal((await call("/assistance/agent/session", session.token)).ok, false);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
