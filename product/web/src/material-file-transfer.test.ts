import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { MaterialFileTransfer } from "./material-file-transfer.js";
import { captureOperatorWriteSession, OperatorWriteSessionChangedError } from "./operator-api.js";

// Supplemental client tests ONLY: synthetic fetch is not Web acceptance.
const originalFetch = globalThis.fetch, storage = new Map<string, string>();
const csrfKey = "socialgrowth.operator.csrf", projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null } });
beforeEach(() => { storage.set(csrfKey, "C".repeat(43)); });
afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const file = () => new File([new Uint8Array([1, 2, 3])], "not-a-business-claim.png", { type: "image/png" });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
test("file digest pins the descriptor and byte retry reuses original body/key without preparing twice", async () => {
  const transfer = new MaterialFileTransfer(projectId, file()); let ticketCalls = 0, byteCalls = 0;
  let ticket: Record<string, unknown>, key: string | null = null;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") {
      ticketCalls++; const r = JSON.parse(String(init.body));
      assert.equal(r.projectId, projectId); assert.equal(r.objectId, transfer.objectId); assert.equal(r.bytes, 3); assert.equal(r.contentType, "image/png");
      assert.equal(r.sha256, "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
      ticket = { projectId, objectId: transfer.objectId, bytes: r.bytes, contentType: r.contentType, sha256: r.sha256,
        preparedAt: "2026-10-02T00:00:00Z", status: "pending_bytes", verifiedAt: null, candidateAllowed: false, publicationAllowed: false };
      return json({ ...ticket, changed: true, replayed: false }, 201);
    }
    byteCalls++; assert.equal(String(url), `/api/operator/projects/${projectId}/material-uploads/${transfer.objectId}/bytes`);
    assert.equal(init?.method, "PUT"); assert.ok(init.body instanceof Blob); assert.deepEqual(Array.from(new Uint8Array(await init.body.arrayBuffer())), [1, 2, 3]);
    const current = new Headers(init.headers).get("x-idempotency-key"); if (key) assert.equal(current, key); key = current;
    if (byteCalls === 1) throw new Error("synthetic-unknown-ack");
    return json({ ...ticket, status: "verified_bytes", verifiedAt: "2026-10-02T00:00:01Z", changed: false, replayed: true });
  };
  await assert.rejects(transfer.send()); assert.equal((await transfer.send()).publicationAllowed, false);
  assert.equal(ticketCalls, 1); assert.equal(byteCalls, 2); assert.deepEqual(Object.keys(transfer), ["objectId"]);
});
test("failed ticket retry keeps the same descriptor, object and original request", async () => {
  const transfer = new MaterialFileTransfer(projectId, file()); const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(String(init?.body)); throw new Error("synthetic-unknown-ticket"); };
  await assert.rejects(transfer.send()); await assert.rejects(transfer.send()); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
});
test("session changes while File.arrayBuffer awaits never start ticket preparation", async () => {
  const f = file(); let finish!: (bytes: ArrayBuffer) => void;
  Object.defineProperty(f, "arrayBuffer", { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("must-not-send"); };
  const transfer = new MaterialFileTransfer(projectId, f), pending = transfer.send(); storage.set(csrfKey, "D".repeat(43));
  finish(new Uint8Array([1, 2, 3]).buffer); await assert.rejects(pending, OperatorWriteSessionChangedError);
  await assert.rejects(transfer.send(), OperatorWriteSessionChangedError); assert.equal(calls, 0);
});
test("invalid file and absent session close before any transport", () => {
  for (const f of [new File([], "empty.png", { type: "image/png" }), new File(["x"], "bad.txt", { type: "text/plain" })]) assert.throws(() => new MaterialFileTransfer(projectId, f));
  storage.clear(); assert.throws(() => new MaterialFileTransfer(projectId, file()), OperatorWriteSessionChangedError);
});
test("opaque session guard never adopts a later login or exposes tokens", () => {
  const guard = captureOperatorWriteSession(); assert.equal(guard(), undefined); storage.set(csrfKey, "D".repeat(43)); assert.throws(guard, OperatorWriteSessionChangedError);
  storage.clear(); const absent = captureOperatorWriteSession(); storage.set(csrfKey, "C".repeat(43)); assert.throws(absent, OperatorWriteSessionChangedError);
});
test("concurrent file send is refused rather than issuing a second ticket", async () => {
  const f = file(); let finish!: (bytes: ArrayBuffer) => void;
  Object.defineProperty(f, "arrayBuffer", { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("synthetic-ticket-offline"); };
  const transfer = new MaterialFileTransfer(projectId, f), pending = transfer.send(); await assert.rejects(transfer.send(), /正在上传/);
  finish(new Uint8Array([1, 2, 3]).buffer); await assert.rejects(pending); assert.equal(calls, 1);
});
