import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});

const {
  ProductApiError,
  createInvitation,
  createOperator,
  hasCsrfToken,
  listInvitations,
  login,
  logout,
  newIdempotencyKey,
  revokeInvitation,
} = await import("./operator-api.js");

const operator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  loginName: "operator.one",
  displayName: "Operator One",
  factVersion: 0,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  status: "active" as const,
  disabledAt: null,
};

const invitation = {
  invitationId: "00000000-0000-4000-8000-000000000010",
  maxUses: 3,
  consumedUses: 0,
  expiresAt: "2026-10-29T00:00:00.000Z",
  createdAt: "2026-09-29T00:00:00.000Z",
  evaluatedAt: "2026-09-29T00:00:00.000Z",
  createdByOperatorId: operator.operatorId,
  factVersion: 0,
  registrations: [],
  status: "active" as const,
  revokedAt: null,
  revokedByOperatorId: null,
};

test.beforeEach(() => storage.clear());

test("login stores CSRF locally and a failed logout preserves it", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    operator,
    session: {
      sessionId: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-09-29T00:00:00.000Z",
      expiresAt: "2099-09-29T00:00:00.000Z",
    },
    csrfToken: "C".repeat(43),
  }), { status: 200, headers: { "content-type": "application/json" } });
  await login("operator.one", "a-secure-password");
  assert.equal(hasCsrfToken(), true);

  globalThis.fetch = async () => new Response("upstream unavailable", { status: 503 });
  await assert.rejects(logout(), ProductApiError);
  assert.equal(hasCsrfToken(), true);
});

test("401 clears local CSRF and malformed errors receive a safe fallback", async () => {
  storage.set("socialgrowth.operator.csrf", "C".repeat(43));
  globalThis.fetch = async () => new Response("not-json", { status: 401 });

  await assert.rejects(
    logout(),
    (error: unknown) => error instanceof ProductApiError
      && error.status === 401
      && error.response.error.code === "INTERNAL_ERROR",
  );
  assert.equal(hasCsrfToken(), false);
});

test("a network retry reuses the pending mutation idempotency key", async () => {
  storage.set("socialgrowth.operator.csrf", "C".repeat(43));
  const bodies: Array<{ metadata: { idempotencyKey: string } }> = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    calls += 1;
    if (calls === 1) throw new TypeError("network response lost");
    return new Response(JSON.stringify({ operator }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const input = {
    loginName: "operator.one",
    displayName: "Operator One",
    initialPassword: "a-secure-password",
  };
  const key = newIdempotencyKey();
  await assert.rejects(createOperator(input, key), TypeError);
  await createOperator(input, key);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]?.metadata.idempotencyKey, bodies[1]?.metadata.idempotencyKey);
});

test("the caller explicitly changes the key after a confirmed mutation", async () => {
  storage.set("socialgrowth.operator.csrf", "C".repeat(43));
  const keys: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { metadata: { idempotencyKey: string } };
    keys.push(body.metadata.idempotencyKey);
    return new Response(JSON.stringify({ operator }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const input = {
    loginName: "operator.one",
    displayName: "Operator One",
    initialPassword: "a-secure-password",
  };
  await createOperator(input, newIdempotencyKey());
  await createOperator(input, newIdempotencyKey());
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(contractVersion.length > 0, true);
});

test("invitation creation sends csrf metadata and accepts one-time access", async () => {
  storage.set("socialgrowth.operator.csrf", "C".repeat(43));
  let observed: { input: string; body: Record<string, unknown>; csrf: string | null } | undefined;
  globalThis.fetch = async (input, init) => {
    observed = {
      input: String(input),
      body: JSON.parse(String(init?.body)),
      csrf: new Headers(init?.headers).get("x-csrf-token"),
    };
    return new Response(JSON.stringify({ invitation, access: { code: "A".repeat(43) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createInvitation(
    { maxUses: 3, expiresAt: invitation.expiresAt },
    "create-invitation-api-0001",
  );
  assert.equal(result.access.code, "A".repeat(43));
  assert.ok(observed);
  const requestMetadata = observed.body.metadata as { requestId: string };
  assert.equal(observed.input, "/api/operator/invitations");
  assert.equal(observed.csrf, "C".repeat(43));
  assert.deepEqual(observed.body, {
    metadata: {
      contractVersion,
      idempotencyKey: "create-invitation-api-0001",
      requestId: requestMetadata.requestId,
    },
    maxUses: 3,
    expiresAt: invitation.expiresAt,
  });
});

test("invitation list rejects accidental bearer access fields", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    invitations: [{ ...invitation, access: { code: "A".repeat(43) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  await assert.rejects(listInvitations());
});

test("invitation revocation uses path identity and the current fact version", async () => {
  storage.set("socialgrowth.operator.csrf", "C".repeat(43));
  let observedUrl = "";
  let observedBody: { expectedFactVersion: number } | undefined;
  globalThis.fetch = async (input, init) => {
    observedUrl = String(input);
    observedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      invitation: {
        ...invitation,
        status: "revoked",
        factVersion: 1,
        revokedAt: "2026-09-29T01:00:00.000Z",
        evaluatedAt: "2026-09-29T01:00:00.000Z",
        revokedByOperatorId: operator.operatorId,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await revokeInvitation(invitation, "revoke-invitation-api-0001");
  assert.equal(observedUrl, `/api/operator/invitations/${invitation.invitationId}/revoke`);
  assert.equal(observedBody?.expectedFactVersion, 0);
  assert.equal(result.status, "revoked");
});
