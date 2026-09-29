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

const { ProductApiError, createOperator, hasCsrfToken, login, logout, newIdempotencyKey } = await import("./operator-api.js");

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
