import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import { PreparedMaterialBytes, MaterialBytesClientError } from "./material-bytes-api.js";
import { OperatorWriteSessionChangedError, OperatorWriteRequestInvalidError, ProductApiError, prepareOperatorMaterialBytes } from "./operator-api.js";
import { materialUploadHTTPMaxBytes } from "./material-upload-api.js";
const originalFetch = globalThis.fetch, storage = new Map<string, string>(), csrfKey = "socialgrowth.operator.csrf";
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value) } });
beforeEach(() => { storage.clear(); storage.set(csrfKey, "C".repeat(43)); }); afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", object = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const command = () => ({ metadata: { contractVersion, requestId: "synthetic-original-byte-request", idempotencyKey: "synthetic-original-byte-key" }, projectId: project, objectId: object });
async function fixture() {
  const bytes = new Uint8Array([1, 2, 3]), digest = await crypto.subtle.digest("SHA-256", bytes), sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const ticket = { projectId: project, objectId: object, sha256, bytes: 3, contentType: "video/mp4", status: "pending_bytes", preparedAt: "2026-10-01T00:00:00Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false };
  return { bytes, ticket, result: { ...ticket, status: "verified_bytes", verifiedAt: "2026-10-01T00:00:01Z", changed: true, replayed: false } };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fixed = (e: unknown): e is MaterialBytesClientError => e instanceof MaterialBytesClientError && e.code === e.message && !("cause" in e) && !("input" in e);
test("real SHA256 of a copied byte view and immutable Blob preserve the original body/metadata/key for explicit unknown retry", async () => {
  const f = await fixture(), backing = new Uint8Array([9, 1, 2, 3, 9]), raw = command(), prepared = new PreparedMaterialBytes(f.ticket, raw, backing.subarray(1, 4)), bodies: number[][] = [], headers: string[] = [];
  backing.fill(7); raw.metadata.idempotencyKey = "synthetic-replacement-key"; raw.objectId = other; f.ticket.sha256 = "b".repeat(64);
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/material-uploads/${object}/bytes`); assert.equal(init?.method, "PUT"); assert.equal(init?.credentials, "same-origin"); const h = new Headers(init?.headers); assert.equal(h.get("content-type"), "application/octet-stream"); assert.equal(h.get("x-sg-contract-version"), contractVersion); assert.equal(h.get("x-request-id"), "synthetic-original-byte-request"); assert.equal(h.get("x-csrf-token"), "C".repeat(43)); assert.equal(h.has("content-encoding"), false); assert.equal(h.has("content-length"), false); headers.push(h.get("x-idempotency-key")!); assert.ok(init?.body instanceof Blob); bodies.push(Array.from(new Uint8Array(await init.body.arrayBuffer()))); if (bodies.length === 1) throw new Error("synthetic-unknown-response"); return response(f.result); };
  await assert.rejects(prepared.send(), fixed); assert.equal(bodies.length, 1); assert.equal((await prepared.send()).publicationAllowed, false); assert.deepEqual(bodies, [[1, 2, 3], [1, 2, 3]]); assert.deepEqual(headers, ["synthetic-original-byte-key", "synthetic-original-byte-key"]); assert.equal(JSON.stringify(prepared), "{}");
});
test("wrong actual hash, byte length, object scope, permissions and transport overflow all close with zero fetch", async () => {
  const f = await fixture(); let calls = 0; globalThis.fetch = async () => { calls++; return response(f.result); };
  for (const run of [() => new PreparedMaterialBytes({ ...f.ticket, bytes: 4 }, command(), f.bytes), () => new PreparedMaterialBytes(f.ticket, { ...command(), objectId: other }, f.bytes),
    () => new PreparedMaterialBytes({ ...f.ticket, candidateAllowed: true }, command(), f.bytes), () => new PreparedMaterialBytes(f.ticket, command(), new Uint8Array()),
    () => new PreparedMaterialBytes({ ...f.ticket, bytes: materialUploadHTTPMaxBytes + 1 }, command(), new Uint8Array(materialUploadHTTPMaxBytes + 1))]) assert.throws(run, fixed);
  await assert.rejects(new PreparedMaterialBytes({ ...f.ticket, sha256: "b".repeat(64) }, command(), f.bytes).send(), e => fixed(e) && e.code === "MATERIAL_BYTES_CLIENT_INVALID"); assert.equal(calls, 0);
});
test("binary seam only constructs its internal UUID route and refuses HTTP trace normalization/injection without token exposure", async () => {
  const f = await fixture(); let calls = 0; globalThis.fetch = async () => { calls++; return response(f.result); };
  for (const raw of [{ ...command(), projectId: "//invalid.example" }, { ...command(), endpoint: "https://invalid.example" }, { ...command(), metadata: { ...command().metadata, requestId: "synthetic\r\ninjection" } },
    { ...command(), metadata: { ...command().metadata, idempotencyKey: " synthetic-original-byte-key" } }, { ...command(), metadata: { ...command().metadata, requestId: "synthetic-非ASCII" } }]) {
    assert.throws(() => prepareOperatorMaterialBytes(raw, f.bytes, { parse: (v: unknown) => v }), e => e instanceof OperatorWriteRequestInvalidError && e.message === "OPERATOR_WRITE_REQUEST_INVALID" && !("cause" in e));
    assert.throws(() => new PreparedMaterialBytes(f.ticket, raw, f.bytes), fixed);
  }
  assert.equal(calls, 0);
});
test("PUT success must be verified with the full original descriptor, strict permissions and no private locator", async () => {
  const f = await fixture(), row = f.result;
  for (const value of [{ ...row, projectId: other }, { ...row, objectId: other }, { ...row, sha256: "b".repeat(64) }, { ...row, bytes: 4 }, { ...row, contentType: "application/octet-stream" },
    { ...row, status: "pending_bytes", verifiedAt: null }, { ...row, publicationAllowed: true }, { ...row, changed: true, replayed: true }, { ...row, key: "synthetic-private-locator" }]) {
    globalThis.fetch = async () => response(value); await assert.rejects(new PreparedMaterialBytes(f.ticket, command(), f.bytes).send(), e => fixed(e) && e.code === "MATERIAL_BYTES_CLIENT_PROTOCOL_INVALID");
  }
});
test("session is fixed before real async hash; changing login during that await never sends bytes", async () => {
  const f = await fixture(); let calls = 0; globalThis.fetch = async () => { calls++; return response(f.result); };
  const prepared = new PreparedMaterialBytes(f.ticket, command(), f.bytes), pending = prepared.send(); storage.set(csrfKey, "D".repeat(43)); await assert.rejects(pending, OperatorWriteSessionChangedError); assert.equal(calls, 0);
  storage.clear(); const absent = new PreparedMaterialBytes(f.ticket, command(), f.bytes); storage.set(csrfKey, "C".repeat(43)); await assert.rejects(absent.send(), OperatorWriteSessionChangedError); assert.equal(calls, 0);
});
test("late byte success closes on a newer session and original-key verified replay remains non-eligibility", async () => {
  const f = await fixture(); let release!: (v: Response) => void, started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = () => { started(); return new Promise(resolve => { release = resolve; }); }; const old = new PreparedMaterialBytes(f.ticket, command(), f.bytes), pending = old.send(); await entered; storage.set(csrfKey, "D".repeat(43)); release(response(f.result)); await assert.rejects(pending, OperatorWriteSessionChangedError); await assert.rejects(old.send(), OperatorWriteSessionChangedError);
  globalThis.fetch = async () => response({ ...f.result, changed: false, replayed: true }); const replay = await new PreparedMaterialBytes({ ...f.ticket, status: "verified_bytes", verifiedAt: f.result.verifiedAt }, command(), f.bytes).send(); assert.equal(replay.replayed, true); assert.equal(replay.candidateAllowed, false); assert.equal(replay.publicationAllowed, false);
});
test("raw errors, malformed success and HTTP errors stay unresolved without rotating byte key or automatic retry", async () => {
  const f = await fixture(), prepared = new PreparedMaterialBytes(f.ticket, command(), f.bytes); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("synthetic-secret-network-path"); }; await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_BYTES_CLIENT_UNAVAILABLE"); assert.equal(calls, 1);
  globalThis.fetch = async () => new Response("synthetic-sensitive-not-json", { status: 200 }); await assert.rejects(prepared.send(), fixed);
  globalThis.fetch = async () => response({ contractVersion, requestId: "synthetic-byte-http-error", error: { code: "INTERNAL_ERROR", message: "Synthetic safe failure", retryable: false } }, 500); await assert.rejects(prepared.send(), ProductApiError);
});
