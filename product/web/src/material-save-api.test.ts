import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import { PreparedMaterialDeclaration, MaterialWriteError } from "./material-save-api.js";
import { ProductApiError, OperatorWriteSessionChangedError, OperatorWriteRequestInvalidError, prepareOperatorPost } from "./operator-api.js";
const originalFetch = globalThis.fetch, storage = new Map<string, string>(), csrfKey = "socialgrowth.operator.csrf";
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value) } });
beforeEach(() => { storage.clear(); storage.set(csrfKey, "C".repeat(43)); }); afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = () => ({ metadata: { contractVersion, requestId: "synthetic-save-request", idempotencyKey: "synthetic-original-save-key" }, projectId: project, contentUnitId: id(20), sourceId: id(21), sourceRecordId: id(22),
  identity: { mediaKind: "video" as const, businessKind: "product" as const, businessEntityId: id(23), seriesId: null, episodeNumber: null }, variantId: id(2), languageTag: "en", expectedCurrentRevision: 0,
  declaration: { name: "Synthetic material", description: "Unit only", businessFacts: "Declared synthetic facts", sourceStatement: "Synthetic source", sourceEvidenceIds: [id(24)], firstUseDeclaration: "declared_not_previously_published" as const }, objectIds: [id(30)] });
const saved = () => { const r = input(); return { projectId: r.projectId, contentUnitId: r.contentUnitId, sourceId: r.sourceId, sourceRecordId: r.sourceRecordId, identity: r.identity, variantId: r.variantId, languageTag: "en", currentRevision: 1,
  declaration: { ...r.declaration, expectedApprovedDirectionId: null, expectedApprovedProjectVersion: null, contentRulesReviewed: false }, objects: [{ objectId: id(30), sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" }], recordedAt: "2026-10-01T00:00:00Z", status: "pending_validation", candidateAllowed: false, eligibilityReason: "direction_not_approved", publicationAllowed: false,
  withdrawal: { state: "not_withdrawn", materialRevision: null, requestId: null, recordedAt: null }, changed: true, replayed: false }; };
const response = (value: unknown, status = 201) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fixed = (e: unknown): e is MaterialWriteError => e instanceof MaterialWriteError && e.message === e.code && !("cause" in e) && !("input" in e);
test("prepared POST owns a deep original body/key and explicit retry does not follow caller mutation or auto retry", async () => {
  const raw = input(), body = JSON.stringify(raw), prepared = new PreparedMaterialDeclaration(raw), bodies: string[] = [];
  raw.metadata.idempotencyKey = "synthetic-different-key"; raw.declaration.name = "Changed caller"; raw.objectIds[0] = id(99); raw.identity.businessEntityId = id(98);
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/materials`); assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "same-origin"); assert.equal(new Headers(init?.headers).get("x-csrf-token"), "C".repeat(43)); bodies.push(String(init?.body)); if (bodies.length === 1) throw new Error("synthetic-unknown-commit"); return response(saved()); };
  await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_WRITE_UNAVAILABLE"); assert.equal(bodies.length, 1);
  const result = await prepared.send(); assert.equal(result.changed, true); assert.equal(result.publicationAllowed, false); assert.deepEqual(bodies, [body, body]);
});
test("invalid declarations and unknown secret fields are fixed failures before any fetch", () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(); };
  for (const raw of [null, { ...input(), projectId: "../../private" }, { ...input(), token: "synthetic-sensitive" }, { ...input(), expectedCurrentRevision: -1 }, { ...input(), objectIds: [id(30), id(30)] }, { ...input(), declaration: { ...input().declaration, name: "" } }]) assert.throws(() => new PreparedMaterialDeclaration(raw), e => fixed(e) && e.code === "MATERIAL_WRITE_INVALID");
  assert.equal(calls, 0);
});
test("missing initial session or a new login cannot send the previous prepared intent", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return response(saved()); };
  storage.clear(); const absent = new PreparedMaterialDeclaration(input()); storage.set(csrfKey, "C".repeat(43)); await assert.rejects(absent.send(), OperatorWriteSessionChangedError);
  const old = new PreparedMaterialDeclaration(input()); storage.set(csrfKey, "D".repeat(43)); await assert.rejects(old.send(), OperatorWriteSessionChangedError); assert.equal(calls, 0);
});
test("strict response cannot rebind human identity/project/source/variant/language or forge eligibility", async () => {
  const row = saved();
  for (const value of [{ ...row, projectId: id(91) }, { ...row, contentUnitId: id(92) }, { ...row, sourceId: id(93) }, { ...row, sourceRecordId: id(94) }, { ...row, variantId: id(95) },
    { ...row, languageTag: "fr" }, { ...row, identity: { ...row.identity, businessEntityId: id(96) } }, { ...row, candidateAllowed: true }, { ...row, changed: true, replayed: true }, { ...row, key: "synthetic-storage-locator" }]) {
    globalThis.fetch = async () => response(value); await assert.rejects(new PreparedMaterialDeclaration(input()).send(), e => fixed(e) && e.code === "MATERIAL_WRITE_PROTOCOL_INVALID");
  }
});
test("fresh changed and no-op replies must match expected revision, declaration and ordered original object IDs", async () => {
  const row = saved();
  for (const value of [{ ...row, currentRevision: 2 }, { ...row, changed: false }, { ...row, declaration: { ...row.declaration, name: "Other declaration" } }, { ...row, objects: [{ ...row.objects[0]!, objectId: id(31) }] }]) {
    globalThis.fetch = async () => response(value); await assert.rejects(new PreparedMaterialDeclaration(input()).send(), fixed);
  }
  const raw = { ...input(), expectedCurrentRevision: 1 }; globalThis.fetch = async () => response({ ...row, changed: false }); assert.equal((await new PreparedMaterialDeclaration(raw).send()).changed, false);
});
test("UUID/evidence normalization accepts actual server semantics without changing image order or original request bytes", async () => {
  const raw = { ...input(), projectId: project.toUpperCase(), languageTag: "EN", identity: { ...input().identity, mediaKind: "image_text" as const }, objectIds: [id(32), id(31)], declaration: { ...input().declaration, sourceEvidenceIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".toUpperCase(), id(24)] } };
  const row = { ...saved(), identity: raw.identity, declaration: { ...raw.declaration, expectedApprovedDirectionId: null, expectedApprovedProjectVersion: null, contentRulesReviewed: false, sourceEvidenceIds: [id(24), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] }, objects: raw.objectIds.map(objectId => ({ objectId, sha256: "a".repeat(64), bytes: 12, contentType: "image/png" })) };
  globalThis.fetch = async (url, init) => { assert.equal(String(url), `/api/operator/projects/${project}/materials`); assert.equal(init?.body, JSON.stringify(raw)); return response(row); };
  assert.equal((await new PreparedMaterialDeclaration(raw).send()).objects[0]!.objectId, id(32));
  globalThis.fetch = async () => response({ ...row, objects: [...row.objects].reverse() }); await assert.rejects(new PreparedMaterialDeclaration(raw).send(), fixed);
});
test("original-key replay may return later current content but cannot rebind identity or return older current", async () => {
  const raw = { ...input(), expectedCurrentRevision: 3 }, row = { ...saved(), changed: false, replayed: true, currentRevision: 5, declaration: { ...saved().declaration, name: "Later current" }, objects: [{ ...saved().objects[0]!, objectId: id(40) }] };
  globalThis.fetch = async () => response(row); const result = await new PreparedMaterialDeclaration(raw).send(); assert.equal(result.currentRevision, 5); assert.equal(result.declaration.name, "Later current");
  for (const value of [{ ...row, currentRevision: 2 }, { ...row, sourceId: id(88) }]) { globalThis.fetch = async () => response(value); await assert.rejects(new PreparedMaterialDeclaration(raw).send(), fixed); }
});
test("HTTP errors and malformed success leave the original request for explicit retry, without rotating keys or treating status as no-write proof", async () => {
  const prepared = new PreparedMaterialDeclaration(input()), bodies: unknown[] = [];
  for (const [status, code] of [[400, "INPUT_INVALID"], [409, "FACT_VERSION_STALE"], [409, "IDEMPOTENCY_KEY_REUSED"], [500, "INTERNAL_ERROR"]] as const) {
    globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return response({ contractVersion, requestId: "synthetic-error-request", error: { code, message: "Synthetic safe error", retryable: false } }, status); };
    await assert.rejects(prepared.send(), ProductApiError);
  }
  globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return response({ ...saved(), publicationAllowed: true }); }; await assert.rejects(prepared.send(), fixed);
  globalThis.fetch = async (_url, init) => { bodies.push(init?.body); return response(saved()); }; assert.equal((await prepared.send()).candidateAllowed, false); assert.equal(bodies.length, 6); assert.ok(bodies.every(b => b === JSON.stringify(input())));
});
test("a late successful save is not surfaced in a new session, and an old 401 never clears the new CSRF", async () => {
  let release!: (value: Response) => void; globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const old = new PreparedMaterialDeclaration(input()), pending = old.send(); storage.set(csrfKey, "D".repeat(43)); release(response(saved())); await assert.rejects(pending, OperatorWriteSessionChangedError); await assert.rejects(old.send(), OperatorWriteSessionChangedError);
  storage.set(csrfKey, "C".repeat(43)); const late = new PreparedMaterialDeclaration(input()).send(); storage.set(csrfKey, "D".repeat(43)); release(response({ contractVersion, requestId: "synthetic-late-auth", error: { code: "AUTHENTICATION_REQUIRED", message: "Synthetic required", retryable: false } }, 401)); await assert.rejects(late, ProductApiError); assert.equal(storage.get(csrfKey), "D".repeat(43));
});
test("runtime private snapshot never serializes secrets/declared input; raw transport and parse failures have only fixed codes", async () => {
  const prepared = new PreparedMaterialDeclaration(input()); assert.equal(JSON.stringify(prepared), "{}"); assert.deepEqual(Object.keys(prepared), []);
  globalThis.fetch = async () => { throw new Error("synthetic-sensitive-network-cause"); }; await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_WRITE_UNAVAILABLE");
  globalThis.fetch = async () => new Response("synthetic-sensitive-not-json", { status: 201 }); await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_WRITE_UNAVAILABLE");
  globalThis.fetch = async () => response({ ...saved(), declaration: { secret: "synthetic-sensitive-response" } }); await assert.rejects(prepared.send(), e => fixed(e) && e.code === "MATERIAL_WRITE_PROTOCOL_INVALID");
});
test("CSRF POST seam closes external origins and ambiguous/non-operator paths before fetch without echoing input", () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(); };
  for (const url of ["https://invalid.example/api/operator/projects", "//invalid.example/api/operator/projects", "/api/public/projects", "/api/operator/../private", "/api/operator/%2e%2e/private", "/api/operator/projects?token=synthetic-sensitive", "/api/operator/projects#fragment", "/api/operator/projects\\private", "/api/operator/", "/api/operator/projects/"]) {
    assert.throws(() => prepareOperatorPost(url, "{}", { parse: (raw: unknown) => raw }), e => e instanceof OperatorWriteRequestInvalidError && e.message === "OPERATOR_WRITE_REQUEST_INVALID" && !("cause" in e) && !("input" in e));
  }
  assert.equal(calls, 0);
});
