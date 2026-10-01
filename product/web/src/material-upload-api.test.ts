import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import { PreparedMaterialUploadTicket, readProjectMaterialUpload, MaterialUploadClientError, materialUploadHTTPMaxBytes } from "./material-upload-api.js";
import { OperatorWriteSessionChangedError, ProductApiError } from "./operator-api.js";
const originalFetch = globalThis.fetch, storage = new Map<string, string>(), csrfKey = "socialgrowth.operator.csrf";
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value) } });
beforeEach(() => { storage.clear(); storage.set(csrfKey, "C".repeat(43)); }); afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", object = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const input = () => ({ metadata: { contractVersion, requestId: "synthetic-upload-prepare", idempotencyKey: "synthetic-original-prepare-key" }, projectId: project, objectId: object, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" });
const ticket = () => ({ projectId: project, objectId: object, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4", status: "pending_bytes", preparedAt: "2026-10-01T00:00:00Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false });
const result = () => ({ ...ticket(), changed: true, replayed: false });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fixed = (e: unknown): e is MaterialUploadClientError => e instanceof MaterialUploadClientError && e.code === e.message && !("cause" in e) && !("input" in e);
test("ticket preparation preserves deep original descriptor/key across explicit unknown retry and uses only operator POST", async () => {
  const raw = input(), body = JSON.stringify(raw), prepared = new PreparedMaterialUploadTicket(raw), bodies: unknown[] = [];
  raw.objectId = other; raw.metadata.idempotencyKey = "synthetic-other-key"; raw.sha256 = "b".repeat(64);
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/material-uploads`); assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "same-origin"); assert.equal(new Headers(init?.headers).get("x-csrf-token"), "C".repeat(43)); bodies.push(init?.body); if (bodies.length === 1) throw new Error("synthetic-unknown"); return response(result(), 201); };
  await assert.rejects(prepared.send(), fixed); assert.equal(bodies.length, 1); assert.equal((await prepared.send()).status, "pending_bytes"); assert.deepEqual(bodies, [body, body]); assert.equal(JSON.stringify(prepared), "{}");
});
test("invalid input and the existing 16MiB HTTP boundary close before fetch, without claiming the shared 128MiB object limit", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return response(result()); };
  for (const raw of [null, { ...input(), bytes: 0 }, { ...input(), bytes: materialUploadHTTPMaxBytes + 1 }, { ...input(), sha256: "invalid" }, { ...input(), endpoint: "synthetic-secret-locator" }]) assert.throws(() => new PreparedMaterialUploadTicket(raw), fixed);
  for (const pair of [["../../private", object], [project, "bad"]]) await assert.rejects(readProjectMaterialUpload(pair[0]!, pair[1]!), fixed);
  assert.equal(calls, 0); globalThis.fetch = async () => response({ ...result(), bytes: materialUploadHTTPMaxBytes }); assert.equal((await new PreparedMaterialUploadTicket({ ...input(), bytes: materialUploadHTTPMaxBytes }).send()).bytes, materialUploadHTTPMaxBytes);
});
test("preparation cannot replace any pinned descriptor, forge permissions, or label a newly-created ticket verified", async () => {
  const row = result();
  for (const value of [{ ...row, projectId: other }, { ...row, objectId: other }, { ...row, sha256: "b".repeat(64) }, { ...row, bytes: 13 }, { ...row, contentType: "application/octet-stream" },
    { ...row, publicationAllowed: true }, { ...row, changed: true, replayed: true }, { ...row, status: "verified_bytes", verifiedAt: "2026-10-01T00:00:01Z" }, { ...row, storageLocationId: other }]) {
    globalThis.fetch = async () => response(value); await assert.rejects(new PreparedMaterialUploadTicket(input()).send(), e => fixed(e) && e.code === "MATERIAL_UPLOAD_CLIENT_PROTOCOL_INVALID");
  }
});
test("read and original-key prepare replay may return a later verified ticket, still not media eligibility or evidence of current physical bytes", async () => {
  const row = { ...ticket(), status: "verified_bytes", verifiedAt: "2026-10-01T00:00:01Z" };
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/material-uploads/${object}`); assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.body, undefined); assert.equal(new Headers(init?.headers).has("x-csrf-token"), false); return response(row); };
  assert.equal((await readProjectMaterialUpload(project.toUpperCase(), object.toUpperCase())).candidateAllowed, false);
  globalThis.fetch = async () => response({ ...row, changed: false, replayed: true }); const replay = await new PreparedMaterialUploadTicket(input()).send(); assert.equal(replay.status, "verified_bytes"); assert.equal(replay.publicationAllowed, false);
  for (const value of [{ ...row, objectId: other }, { ...row, projectId: other }, { ...row, verifiedAt: null }, { ...row, verifiedAt: "2026-09-30T00:00:00Z" }]) { globalThis.fetch = async () => response(value); await assert.rejects(readProjectMaterialUpload(project, object), fixed); }
});
test("session binding refuses a new-login retry, and a late prepare success cannot reach that new session", async () => {
  let calls = 0, release!: (value: Response) => void; globalThis.fetch = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const prepared = new PreparedMaterialUploadTicket(input()), pending = prepared.send(); storage.set(csrfKey, "D".repeat(43)); release(response(result())); await assert.rejects(pending, OperatorWriteSessionChangedError); await assert.rejects(prepared.send(), OperatorWriteSessionChangedError); assert.equal(calls, 1);
});
test("HTTP and raw transport failures remain unresolved, safe and non-retrying for both prepare and read", async () => {
  const prepared = new PreparedMaterialUploadTicket(input()); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("synthetic-sensitive-gateway", { status: 503 }); }; await assert.rejects(prepared.send(), e => e instanceof ProductApiError && e.response.error.code === "INTERNAL_ERROR" && !e.message.includes("synthetic-sensitive")); assert.equal(calls, 1);
  globalThis.fetch = async () => { throw new Error("synthetic-secret-network"); }; await assert.rejects(readProjectMaterialUpload(project, object), e => fixed(e) && e.code === "MATERIAL_UPLOAD_CLIENT_UNAVAILABLE");
  globalThis.fetch = async () => new Response("synthetic-sensitive-not-json", { status: 201 }); await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_UPLOAD_CLIENT_UNAVAILABLE");
});
