import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { contractVersion } from "@socialgrowth/product-contracts";
import { MaterialReadError, listProjectMaterials, readProjectMaterial, readProjectMaterialHistory, listProjectMaterialUploads } from "./material-api.js";
import { ProductApiError, hasCsrfToken } from "./operator-api.js";
const originalFetch = globalThis.fetch, storage = new Map<string, string>(), csrfKey = "socialgrowth.operator.csrf";
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value) } });
beforeEach(() => storage.clear()); afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const material = (variant = 2) => ({ projectId: project, contentUnitId: id(20), sourceId: id(21), sourceRecordId: id(22),
  identity: { mediaKind: "video", businessKind: "product", businessEntityId: id(23), seriesId: null, episodeNumber: null }, variantId: id(variant), languageTag: "en", currentRevision: 1,
  declaration: { name: "Synthetic unit material", description: "Unit fixture only", businessFacts: "Declared synthetic facts", sourceStatement: "Synthetic source statement", sourceEvidenceIds: [id(24)], firstUseDeclaration: "declared_not_previously_published" },
  objects: [{ objectId: id(30), sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" }], recordedAt: "2026-10-01T00:00:00Z", status: "pending_validation", candidateAllowed: false, publicationAllowed: false });
const upload = (object = 2) => ({ projectId: project, objectId: id(object), sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4", status: "pending_bytes", preparedAt: "2026-10-01T00:00:00Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fixed = (e: unknown): e is MaterialReadError => e instanceof MaterialReadError && e.message === e.code && !("cause" in e) && !("input" in e);
test("four GET resources normalize UUIDs, preserve declared states and use same-origin cookies without mutation or CSRF exposure", async () => {
  storage.set(csrfKey, "C".repeat(43)); const urls: string[] = [], row = material();
  globalThis.fetch = async (url, init) => {
    const path = String(url); urls.push(path); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.body, undefined); assert.equal(new Headers(init?.headers).has("x-csrf-token"), false);
    return response(path.includes("material-uploads") ? { projectId: project, tickets: [upload()], nextAfterObjectId: null }
      : path.includes("/revisions?") ? { current: row, revisions: [{ revision: 1, declaration: row.declaration, objects: row.objects, recordedAt: row.recordedAt, status: row.status }], nextAfterRevision: null }
      : path.includes("/materials?") ? { projectId: project, materials: [row], nextAfterVariantId: null } : row);
  };
  assert.equal((await listProjectMaterials(project.toUpperCase())).materials[0]!.candidateAllowed, false);
  assert.equal((await readProjectMaterial(project.toUpperCase(), id(2))).publicationAllowed, false);
  assert.equal((await readProjectMaterialHistory(project, id(2))).revisions.length, 1);
  assert.equal((await listProjectMaterialUploads(project)).tickets[0]!.status, "pending_bytes");
  assert.deepEqual(urls, [`/api/operator/projects/${project}/materials?pageSize=20`, `/api/operator/projects/${project}/materials/${id(2)}`, `/api/operator/projects/${project}/materials/${id(2)}/revisions?afterRevision=0&pageSize=20`, `/api/operator/projects/${project}/material-uploads?pageSize=20`]); assert.equal(hasCsrfToken(), true);
});
test("invalid path, cursor and page inputs are fixed failures with zero fetch", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("must never fetch"); };
  for (const run of [() => listProjectMaterials("../../private"), () => listProjectMaterials(project, "bad"), () => listProjectMaterials(project, null, 51), () => readProjectMaterial(project, "bad"),
    () => readProjectMaterialHistory(project, id(2), -1), () => readProjectMaterialHistory(project, id(2), 0, 0), () => listProjectMaterialUploads(project, "bad"), () => listProjectMaterialUploads(project, null, 1.5)]) await assert.rejects(run(), e => fixed(e) && e.code === "MATERIAL_READ_INVALID");
  assert.equal(calls, 0);
});
test("library cross-project echo, overscan, cursor regression and forged permission/locator are refused", async () => {
  const row = material();
  for (const payload of [{ projectId: id(90), materials: [], nextAfterVariantId: null }, { projectId: project, materials: [row, material(3)], nextAfterVariantId: null },
    { projectId: project, materials: [row], nextAfterVariantId: null }, { projectId: project, materials: [{ ...row, publicationAllowed: true }], nextAfterVariantId: null },
    { projectId: project, materials: [{ ...row, endpoint: "synthetic-secret-locator" }], nextAfterVariantId: null }]) {
    globalThis.fetch = async () => response(payload); await assert.rejects(listProjectMaterials(project, id(2), 1), e => fixed(e) && e.code === "MATERIAL_READ_PROTOCOL_INVALID");
  }
  globalThis.fetch = async () => response({ projectId: project, materials: [material(3)], nextAfterVariantId: id(3) }); assert.equal((await listProjectMaterials(project, id(2), 1)).nextAfterVariantId, id(3));
});
test("single material requires both requested project and variant, never treats another item's valid shape as the requested fact", async () => {
  for (const row of [{ ...material(), projectId: id(90) }, material(3)]) { globalThis.fetch = async () => response(row); await assert.rejects(readProjectMaterial(project, id(2)), fixed); }
  globalThis.fetch = async () => response(material()); assert.equal((await readProjectMaterial(project, id(2))).currentRevision, 1);
});
test("history enforces requested first revision, upper bound, page size and requested identity as well as shared continuity", async () => {
  const row = { ...material(), currentRevision: 3 }, rev = (revision: number) => ({ revision, declaration: row.declaration, objects: row.objects, recordedAt: row.recordedAt, status: row.status });
  for (const payload of [{ current: row, revisions: [rev(2)], nextAfterRevision: 2 }, { current: row, revisions: [], nextAfterRevision: null },
    { current: { ...row, variantId: id(3) }, revisions: [rev(1)], nextAfterRevision: 1 }, { current: row, revisions: [rev(1), rev(2)], nextAfterRevision: 2 }]) {
    globalThis.fetch = async () => response(payload); await assert.rejects(readProjectMaterialHistory(project, id(2), 0, 1), fixed);
  }
  globalThis.fetch = async () => response({ current: row, revisions: [rev(2)], nextAfterRevision: 2 }); assert.equal((await readProjectMaterialHistory(project, id(2), 1, 1)).revisions[0]!.revision, 2);
  globalThis.fetch = async () => response({ current: row, revisions: [], nextAfterRevision: null }); assert.equal((await readProjectMaterialHistory(project, id(2), 3)).revisions.length, 0); await assert.rejects(readProjectMaterialHistory(project, id(2), 4), fixed);
});
test("upload recovery requires monotonic original IDs and preserves verified bytes as non-eligibility", async () => {
  for (const payload of [{ projectId: id(90), tickets: [], nextAfterObjectId: null }, { projectId: project, tickets: [upload(2)], nextAfterObjectId: null },
    { projectId: project, tickets: [upload(3), upload(4)], nextAfterObjectId: null }, { projectId: project, tickets: [{ ...upload(3), status: "verified_bytes" }], nextAfterObjectId: null }]) {
    globalThis.fetch = async () => response(payload); await assert.rejects(listProjectMaterialUploads(project, id(2), 1), fixed);
  }
  globalThis.fetch = async () => response({ projectId: project, tickets: [{ ...upload(3), status: "verified_bytes", verifiedAt: "2026-10-01T00:00:01Z" }], nextAfterObjectId: id(3) });
  const page = await listProjectMaterialUploads(project, id(2), 1); assert.equal(page.tickets[0]!.candidateAllowed, false); assert.equal(page.tickets[0]!.publicationAllowed, false);
});
test("401 clears only its original CSRF session, and no resource automatically retries or invents an empty result", async () => {
  const authError = { contractVersion, requestId: "material-unit-auth-request", error: { code: "AUTHENTICATION_REQUIRED", message: "Synthetic authentication required", retryable: false } };
  storage.set(csrfKey, "A".repeat(43)); globalThis.fetch = async () => response(authError, 401); await assert.rejects(listProjectMaterials(project), ProductApiError); assert.equal(hasCsrfToken(), false);
  let release!: (value: Response) => void, calls = 0; storage.set(csrfKey, "A".repeat(43)); globalThis.fetch = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const pending = listProjectMaterialUploads(project); storage.set(csrfKey, "B".repeat(43)); release(response(authError, 401)); await assert.rejects(pending, ProductApiError);
  assert.equal(storage.get(csrfKey), "B".repeat(43)); assert.equal(calls, 1);
});
test("network and non-JSON success failures do not expose original response, credentials or transport path", async () => {
  globalThis.fetch = async () => { throw new Error("synthetic-sensitive-http-path-and-secret"); }; await assert.rejects(listProjectMaterials(project), e => fixed(e) && e.code === "MATERIAL_READ_UNAVAILABLE");
  globalThis.fetch = async () => new Response("synthetic-sensitive-not-json", { status: 200 }); await assert.rejects(listProjectMaterialUploads(project), e => fixed(e) && e.code === "MATERIAL_READ_UNAVAILABLE");
});
