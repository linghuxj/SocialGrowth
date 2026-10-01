import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import { PreparedMaterialBatch, MaterialBatchError, materialBatchHttpMaxBytes } from "./material-batch-api.js";
import { ProductApiError, OperatorWriteSessionChangedError } from "./operator-api.js";
const originalFetch = globalThis.fetch, storage = new Map<string, string>(), csrfKey = "socialgrowth.operator.csrf";
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value) } });
beforeEach(() => { storage.clear(); storage.set(csrfKey, "C".repeat(43)); }); afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const item = (n = 0) => ({ metadata: { contractVersion, requestId: `synthetic-request-${n}`, idempotencyKey: `synthetic-original-key-${n}` }, projectId: project, contentUnitId: id(100 + n), sourceId: id(200 + n), sourceRecordId: id(300 + n),
  identity: { mediaKind: "video" as const, businessKind: "product" as const, businessEntityId: id(400 + n), seriesId: null, episodeNumber: null }, variantId: id(500 + n), languageTag: "en", expectedCurrentRevision: 0,
  declaration: { name: "Synthetic material", description: "Unit only", businessFacts: "Declared synthetic facts", sourceStatement: "Synthetic source", sourceEvidenceIds: [id(600 + n)], firstUseDeclaration: "declared_not_previously_published" as const }, objectIds: [id(700 + n)] });
const batch = (items: unknown[] = [item(), null, item(1)]) => ({ metadata: { contractVersion, requestId: "synthetic-batch-trace" }, projectId: project, items });
const saved = (n = 0) => { const r = item(n); return { projectId: r.projectId, contentUnitId: r.contentUnitId, sourceId: r.sourceId, sourceRecordId: r.sourceRecordId, identity: r.identity, variantId: r.variantId, languageTag: "en", currentRevision: 1,
  declaration: r.declaration, objects: [{ objectId: r.objectIds[0]!, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" }], recordedAt: "2026-10-01T00:00:00Z", status: "pending_validation", candidateAllowed: false, publicationAllowed: false, changed: true, replayed: false }; };
const rejection = { code: "INPUT_INVALID", message: "Synthetic rejected item", retryable: false };
const partial = () => ({ projectId: project, results: [{ index: 0, outcome: "saved", material: saved() }, { index: 1, outcome: "rejected", error: rejection }, { index: 2, outcome: "saved", material: saved(1) }] });
const response = (value: unknown, status = 201) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fixed = (e: unknown): e is MaterialBatchError => e instanceof MaterialBatchError && e.message === e.code && !("cause" in e) && !("input" in e);
test("batch owns original per-item keys and partial results; unknown receipt permits only explicit identical retry", async () => {
  const raw = batch(), body = JSON.stringify(raw), prepared = new PreparedMaterialBatch(raw), bodies: unknown[] = [];
  assert.equal(JSON.stringify(prepared), "{}"); assert.deepEqual(Object.keys(prepared), []);
  (raw.items[0] as ReturnType<typeof item>).metadata.idempotencyKey = "synthetic-different-key";
  (raw.items[2] as ReturnType<typeof item>).declaration.name = "Changed caller"; raw.items.reverse();
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/materials/batch`); assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "same-origin"); assert.equal(new Headers(init?.headers).get("x-csrf-token"), "C".repeat(43)); bodies.push(init?.body); if (bodies.length === 1) throw new Error("synthetic-unknown-prior-writes"); return response(partial()); };
  await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_BATCH_UNAVAILABLE"); assert.equal(bodies.length, 1);
  const result = await prepared.send(); assert.deepEqual(result.results.map(r => r.outcome), ["saved", "rejected", "saved"]); assert.ok(!("allSaved" in result)); assert.deepEqual(bodies, [body, body]);
  if (result.results[1]!.outcome === "rejected") result.results[1]!.error.message = "Changed consumer";
  assert.equal((await prepared.send()).results[1]!.outcome, "rejected"); assert.equal(bodies.length, 3);
});
test("wrapper rejects invalid project/trace, empty or more than50 items before fetch; unknown JSON items remain independent", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(); };
  for (const raw of [null, { ...batch(), projectId: "../private" }, { ...batch(), secret: "synthetic-private" }, { ...batch(), metadata: { ...batch().metadata, idempotencyKey: "not-a-batch-key" } }, batch([]), batch(Array(51).fill(null))]) assert.throws(() => new PreparedMaterialBatch(raw), e => fixed(e) && e.code === "MATERIAL_BATCH_INVALID");
  assert.equal(calls, 0);
  const unknown = { wrong: { nested: [null, true, 3, "Synthetic invalid declaration"] } }, raw = batch([unknown, item()]), body = JSON.stringify(raw), prepared = new PreparedMaterialBatch(raw);
  unknown.wrong.nested[3] = "Changed caller";
  globalThis.fetch = async (_url, init) => { assert.equal(init?.body, body); return response({ projectId: project, results: [{ index: 0, outcome: "rejected", error: rejection }, { index: 1, outcome: "saved", material: saved() }] }); };
  assert.equal((await prepared.send()).results[1]!.outcome, "saved");
});
test("actual UTF8 serialized body exactly100KiB is accepted; one byte or multibyte excess never auto splits", async () => {
  const base = batch([""]), emptyBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength, raw = batch(["x".repeat(materialBatchHttpMaxBytes - emptyBytes)]);
  let calls = 0; globalThis.fetch = async (_url, init) => { calls++; assert.equal(new TextEncoder().encode(String(init?.body)).byteLength, materialBatchHttpMaxBytes); return response({ projectId: project, results: [{ index: 0, outcome: "rejected", error: rejection }] }); };
  await new PreparedMaterialBatch(raw).send(); assert.equal(calls, 1);
  for (const value of [batch(["x".repeat(materialBatchHttpMaxBytes - emptyBytes + 1)]), batch(["汉".repeat(35000)])]) assert.throws(() => new PreparedMaterialBatch(value), fixed);
  assert.equal(calls, 1);
});
test("serialization rejects lossy nonJSON, cycles, getters, custom toJSON, sparse arrays and hidden properties without executing code", () => {
  let called = 0; const cycle: { self?: unknown } = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, "private", { enumerable: true, get() { called++; return "Synthetic"; } });
  const hidden = Object.defineProperty({}, "private", { value: "Synthetic" }); const symbols = { [Symbol("synthetic")]: "Synthetic" };
  const sparse = Array(2); sparse[1] = null;
  for (const value of [undefined, NaN, Infinity, BigInt(1), () => { called++; }, Symbol("synthetic"), cycle, getter, hidden, symbols, sparse, new Date(), { toJSON() { called++; return null; } }]) assert.throws(() => new PreparedMaterialBatch(batch([value])), fixed);
  assert.equal(called, 0);
});
test("strict batch shape/count/index/project and saved-to-original correlation close forged partial success", async () => {
  const row = partial();
  for (const value of [{ ...row, projectId: id(90) }, { ...row, results: row.results.slice(0, 2) }, { ...row, results: [...row.results].reverse() }, { ...row, allSaved: true },
    { ...row, results: [{ index: 0, outcome: "saved", material: saved(1) }, ...row.results.slice(1)] },
    { ...row, results: [row.results[0], { index: 1, outcome: "saved", material: saved() }, row.results[2]] },
    { ...row, results: [{ index: 0, outcome: "saved", material: { ...saved(), currentRevision: 2 } }, ...row.results.slice(1)] },
    { ...row, results: [{ index: 0, outcome: "saved", material: { ...saved(), publicationAllowed: true } }, ...row.results.slice(1)] }]) {
    globalThis.fetch = async () => response(value); await assert.rejects(new PreparedMaterialBatch(batch()).send(), e => fixed(e) && e.code === "MATERIAL_BATCH_PROTOCOL_INVALID");
  }
  const wrongScope = batch([{ ...item(), projectId: id(99) }]); globalThis.fetch = async () => response({ projectId: project, results: [{ index: 0, outcome: "saved", material: saved() }] }); await assert.rejects(new PreparedMaterialBatch(wrongScope).send(), fixed);
});
test("fifty results retain order and per-item replay may return later current but never change human identity", async () => {
  const raw = batch(Array.from({ length: 50 }, (_, n) => item(n))), results = raw.items.map((_r, index) => ({ index, outcome: "saved", material: saved(index) }));
  results[0]!.material = { ...saved(), currentRevision: 5, changed: false, replayed: true, declaration: { ...saved().declaration, name: "Later current" }, objects: [{ ...saved().objects[0]!, objectId: id(909) }] };
  globalThis.fetch = async () => response({ projectId: project, results }); assert.equal((await new PreparedMaterialBatch(raw).send()).results.length, 50);
  results[0]!.material.identity.businessEntityId = id(99); await assert.rejects(new PreparedMaterialBatch(raw).send(), fixed);
});
test("missing session/new login cannot send old batch and delayed positive or401 never changes the newer session", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return response(partial()); };
  storage.clear(); const absent = new PreparedMaterialBatch(batch()); storage.set(csrfKey, "C".repeat(43)); await assert.rejects(absent.send(), OperatorWriteSessionChangedError);
  const old = new PreparedMaterialBatch(batch()); storage.set(csrfKey, "D".repeat(43)); await assert.rejects(old.send(), OperatorWriteSessionChangedError); assert.equal(calls, 0);
  storage.set(csrfKey, "C".repeat(43)); let release!: (response: Response) => void; globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const positive = new PreparedMaterialBatch(batch()).send(); storage.set(csrfKey, "D".repeat(43)); release(response(partial())); await assert.rejects(positive, OperatorWriteSessionChangedError);
  storage.set(csrfKey, "C".repeat(43)); const negative = new PreparedMaterialBatch(batch()).send(); storage.set(csrfKey, "D".repeat(43)); release(response({ contractVersion, requestId: "synthetic-late-auth", error: { code: "AUTHENTICATION_REQUIRED", message: "Synthetic required", retryable: false } }, 401)); await assert.rejects(negative, ProductApiError); assert.equal(storage.get(csrfKey), "D".repeat(43));
});
test("whole response HTTP/JSON/protocol failures preserve all original items even with retryable=false", async () => {
  const raw = batch(), original = JSON.stringify(raw), prepared = new PreparedMaterialBatch(raw), bodies: unknown[] = [];
  for (const status of [400, 409, 413, 500, 503]) {
    globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return response({ contractVersion, requestId: "synthetic-whole-error", error: { code: "INTERNAL_ERROR", message: "Synthetic uncertain", retryable: false } }, status); };
    await assert.rejects(prepared.send(), ProductApiError);
  }
  globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return new Response("synthetic-not-JSON", { status: 201 }); }; await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_BATCH_UNAVAILABLE");
  globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return response({ ...partial(), results: [] }); }; await assert.rejects(prepared.send(), fixed);
  globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return response(partial()); }; await prepared.send(); assert.equal(bodies.length, 8); assert.ok(bodies.every(body => body === original));
});
test("duplicate original item references retain both indices and keys; original-key replay is not a new content write", async () => {
  const original = item(), raw = batch([original, original]), body = JSON.stringify(raw), prepared = new PreparedMaterialBatch(raw);
  original.metadata.idempotencyKey = "synthetic-new-caller-key"; original.declaration.name = "Changed caller";
  globalThis.fetch = async (_url, init) => { assert.equal(init?.body, body); return response({ projectId: project, results: [
    { index: 0, outcome: "saved", material: saved() }, { index: 1, outcome: "saved", material: { ...saved(), changed: false, replayed: true } }] }); };
  const result = await prepared.send(); assert.equal(result.results.length, 2);
  assert.equal(result.results[1]!.outcome === "saved" && result.results[1]!.material.replayed, true);
});
