import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RuntimeStore } from "./store.ts";
import { HumanAssistance } from "./human-assistance.ts";
import { IdentityOnboarding } from "./identity-onboarding.ts";
import { FirstLoopEngine } from "../../../apps/web-console/lib/first-loop/engine.ts";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function fixture(facts: unknown, screenshotFails = false) {
  const store = new RuntimeStore(":memory:"),
    human = new HumanAssistance(store),
    e = new FirstLoopEngine();
  const ctx = { actorId: "test", correlationId: "identity" };
  const p = e.saveProjectDraft(
    {
      name: "test",
      operatingMode: "self",
      primaryGoal: "views",
      audience: "test",
      ownerId: "test",
    },
    ctx,
  ).value!;
  e.activateProject(p.id, ctx);
  const account = e.registerAccount(
    {
      name: "Test Page",
      platform: "facebook",
      owner: "test",
      positioning: "test",
      deviceRef: "phone",
    },
    ctx,
  ).value!;
  e.grantAccountServiceRelation(
    {
      accountId: account.id,
      projectId: p.id,
      clientId: p.clientId!,
      ownerPartyId: "test",
      authorizerPartyId: "test",
      authorizationRef: "authorized",
      allowedActions: ["publish"],
      allowedData: [],
      validFrom: "2026-01-01T00:00:00Z",
    },
    ctx,
  );
  store.save(e.snapshot());
  store.db
    .prepare("INSERT INTO device_holds VALUES (?,?,?)")
    .run("phone", "test", new Date().toISOString());
  let starts = 0;
  const service = new IdentityOnboarding(
    store,
    human,
    {
      artemisRoot: "/test",
      deviceId: "phone",
      serial: "RFC_TEST",
      mediaPath: "/unused",
      mediaSha256: "a".repeat(64),
      runtimeUrl: "http://127.0.0.1:4318",
    },
    {
      screenshot: async () => {
        if (screenshotFails) throw new Error("offline");
        return png;
      },
      client: () => ({
        connect: async () => {},
        close: async () => {},
        call: async (name, args) => {
          if (name === "mobile_run_task") {
            starts++;
            assert.ok(String(args.task_desc).includes("ONE Web-authorized"));
            return { trace_id: randomUUID() };
          }
          if (facts && typeof facts === "object" && "error" in facts)
            return { status: "failed", error: facts.error, result: null };
          return { status: "completed", result: facts };
        },
      }),
    },
  );
  const input = {
    requestId: randomUUID(),
    accountId: account.id,
    projectId: p.id,
    action: "verify",
    name: account.name,
    expectedId: "123456789",
    authorizationRef: "test scoped verification",
    confirmed: true,
  };
  return {
    store,
    human,
    service,
    input,
    starts: () => starts,
    async done() {
      for (let i = 0; i < 100 && service.list().some((j) => j.status === "running"); i++)
        await new Promise((r) => setTimeout(r, 5));
      return service.list()[0];
    },
    async close() {
      await service.close();
      human.close();
      store.close();
    },
  };
}
const verified = {
  status: "verified",
  reason: "IDENTITY_VERIFIED",
  observedId: "123456789",
  observedName: "Test Page",
  identityKind: "facebook_page",
  managementVerified: true,
  noPublication: true,
};
test("creation requires an explicit parent login identity before launching", async () => {
  const f = fixture(verified);
  try {
    assert.throws(
      () => f.service.start({ ...f.input, action: "create", category: "Video creator" }),
      /PARENT_LOGIN_IDENTITY_REQUIRED/,
    );
    assert.equal(f.starts(), 0);
  } finally {
    await f.close();
  }
});
for (const loginIdentityVerified of [false, true])
  test(`creation success requires Agent evidence of the parent identity: ${loginIdentityVerified}`, async () => {
    const f = fixture({ ...verified, loginIdentityVerified });
    try {
      f.service.start({
        ...f.input,
        action: "create",
        category: "Video creator",
        loginIdentity: "123456789",
      });
      const result = await f.done();
      assert.equal(result.status, loginIdentityVerified ? "verified" : "unknown");
      if (!loginIdentityVerified) assert.equal(result.reason, "PARENT_LOGIN_IDENTITY_NOT_VERIFIED");
    } finally {
      await f.close();
    }
  });
test("secure keyguard failure becomes an actionable blocked task with screenshot, never a verified identity", async () => {
  const f = fixture({
    error: "AgentError: Android secure keyguard is locked. Unlock the device manually.",
  });
  try {
    f.service.start(f.input);
    const result = await f.done();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "DEVICE_LOCKED");
    assert.equal(result.screenshotAvailable, true);
    assert.equal(result.observedId, undefined);
  } finally {
    await f.close();
  }
});
test("identity onboarding requires scoped authorization and archives real-port evidence; duplicate click starts once", async () => {
  const f = fixture(verified);
  try {
    assert.throws(() => f.service.start({ ...f.input, confirmed: false }));
    assert.throws(() => f.service.start({ ...f.input, projectId: "wrong" }), /PROJECT_NOT_ACTIVE/);
    const job = f.service.start(f.input);
    assert.equal(f.service.start(f.input).id, job.id);
    assert.throws(() => f.service.start({ ...f.input, name: "changed" }), /ID_CONFLICT/);
    assert.equal((await f.done()).status, "verified");
    assert.equal(f.starts(), 1);
    assert.ok(f.service.screenshot(job.id).length > 0);
    assert.equal(f.store.snapshot().state.publicationAttempts.length, 0);
  } finally {
    await f.close();
  }
});
for (const override of [
  { observedId: "999999999" },
  { identityKind: "youtube_channel" },
  { managementVerified: false },
  { noPublication: false },
])
  test(`identity claims do not pass without exact type, ID, management and no-publication: ${Object.keys(override)[0]}`, async () => {
    const f = fixture({ ...verified, ...override });
    try {
      f.service.start(f.input);
      assert.equal((await f.done()).status, "unknown");
    } finally {
      await f.close();
    }
  });
test("offline device blocks before launching Artemis or creating identity", async () => {
  const f = fixture(verified, true);
  try {
    f.service.start({
      ...f.input,
      action: "create",
      category: "Video creator",
      loginIdentity: "123456789",
    });
    assert.equal((await f.done()).status, "blocked");
    assert.equal(f.starts(), 0);
  } finally {
    await f.close();
  }
});
test("unknown creation cannot be retried and generic human approval cannot expand creation rights", async () => {
  const f = fixture({ ...verified, managementVerified: false });
  try {
    const create = {
      ...f.input,
      action: "create",
      category: "Video creator",
      loginIdentity: "123456789",
    };
    f.service.start(create);
    assert.equal((await f.done()).status, "unknown");
    assert.throws(
      () => f.service.start({ ...create, requestId: randomUUID() }),
      /PRIOR_CREATION_REQUIRES_VERIFICATION/,
    );
    const scope = {
      taskId: randomUUID(),
      deviceId: "phone",
      serial: "RFC_TEST",
      packageName: "com.facebook.katana",
      expectedIdentity: "Test Page",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      mode: "diagnostic",
    };
    const normal = f.human.open(scope);
    assert.throws(
      () =>
        f.human.supervision.gate(normal.sessionId, {
          action: "click",
          category: "create_identity",
        }),
      /IDENTITY_CREATION_NOT_AUTHORIZED/,
    );
    f.human.closeSession(normal.token);
    const allowed = f.human.open({
      ...scope,
      taskId: randomUUID(),
      policy: { mode: "onboarding", allowIdentityCreation: true },
    });
    assert.equal(
      f.human.supervision.gate(allowed.sessionId, { action: "click", category: "create_identity" })
        .allowed,
      true,
    );
    assert.throws(
      () =>
        f.human.supervision.gate(allowed.sessionId, {
          action: "click",
          category: "create_identity",
        }),
      /IDENTITY_CREATION_NOT_AUTHORIZED/,
    );
    assert.throws(
      () => f.human.supervision.gate(allowed.sessionId, { action: "click", category: "publish" }),
      /ACTION_REQUIRES/,
    );
  } finally {
    await f.close();
  }
});
