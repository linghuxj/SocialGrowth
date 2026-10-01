import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { contractVersion, materialCurrentViewSchema, productErrorResponseSchema } from "@socialgrowth/product-contracts";
import { MaterialRegistryController } from "./material-registry.controller.js";
import type { MaterialRuntime } from "./material-runtime.js";
import { ProductTransactionError } from "./product-transaction-error.js";
const id = "a0000000-0000-4000-8000-000000000001", token = "A".repeat(43);
const input = { metadata: { contractVersion, requestId: "request-material", idempotencyKey: "idempotency-material" }, projectId: id, contentUnitId: id,
  sourceId: id, sourceRecordId: id, variantId: id, languageTag: "en", expectedCurrentRevision: 0, objectIds: [id],
  identity: { mediaKind: "video", businessKind: "product", businessEntityId: id, seriesId: null, episodeNumber: null },
  declaration: { name: "Synthetic", description: "Explicit", businessFacts: "Explicit", sourceStatement: "Explicit", sourceEvidenceIds: [id], firstUseDeclaration: "declared_not_previously_published" } };
const request = { headers: { cookie: `unrelated=a=b; __Host-sg_operator_session=${token}` } };
const saved = { ...input, currentRevision: 1, revisions: [{ revision: 1, declaration: input.declaration,
  objects: [{ objectId: id, sha256: "a".repeat(64), bytes: 10, contentType: "video/mp4", key: "internal-never-emit", storageLocationId: id }],
  recordedAt: "2026-10-01T00:00:00Z", recordedByOperatorId: id, status: "pending_validation" }], candidateAllowed: false, publicationAllowed: false, changed: true, replayed: false };
test("material controller preauthenticates current Cookie/CSRF and projects only current declaration and byte facts", async () => {
  const calls: string[] = [];
  const registry = { authorizeWrite: async (session: string, csrf: string, project: string) => { calls.push("auth"); assert.equal(session, token); assert.equal(csrf, "csrf"); assert.equal(project, id); },
    save: async (session: string, csrf: string, value: unknown) => { calls.push("save"); assert.equal(session, token); assert.equal(csrf, "csrf"); assert.deepEqual(value, input); return saved; }, read: async () => saved };
  const controller = new MaterialRegistryController({ registry: () => registry } as unknown as MaterialRuntime);
  const result = await controller.save(id, input, request, "csrf"); assert.deepEqual(calls, ["auth", "save"]); assert.equal(result.changed, true);
  const current = await controller.read(id, id, request); materialCurrentViewSchema.parse(current);
  assert.ok(!JSON.stringify(current).includes("internal-never-emit")); assert.ok(!("recordedByOperatorId" in current)); assert.ok(!("revisions" in current));
  await assert.rejects(controller.save(id, { ...input, actorId: id }, request, "csrf"), e => e instanceof HttpException && e.getStatus() === 400);
});
test("material controller auth/preflight and malformed server result fail safely without succeeding on bad provenance", async () => {
  let saves = 0, seen = "not-called";
  const controller = new MaterialRegistryController({ registry: () => ({ authorizeWrite: async (session: string) => { seen = session; throw new ProductTransactionError("AUTHENTICATION_REQUIRED", "Operator is required"); },
    save: async () => { saves++; return saved; }, read: async () => ({ ...saved, currentRevision: 2 }) }) } as unknown as MaterialRuntime);
  for (const cookie of [`__Host-sg_operator_session=${token}=`, `__Host-sg_operator_session=${token}; __Host-sg_operator_session=${token}`]) {
    await assert.rejects(controller.save(id, input, { headers: { cookie } }, "csrf"), e => e instanceof HttpException && e.getStatus() === 401);
    assert.equal(seen, "");
  }
  assert.equal(saves, 0);
  await assert.rejects(controller.read(id, id, request), e => e instanceof HttpException && e.getStatus() === 500 && productErrorResponseSchema.parse(e.getResponse()).error.code === "INTERNAL_ERROR");
});
test("material batch validates each item independently and retains explicit input order without auto grouping", async () => {
  let calls = 0;
  const controller = new MaterialRegistryController({ registry: () => ({ authorizeWrite: async () => {}, save: async () => { calls++; return saved; } }) } as unknown as MaterialRuntime);
  const body = { metadata: { contractVersion, requestId: "request-material-batch" }, projectId: id, items: [null, input, { ...input, projectId: "b0000000-0000-4000-8000-000000000001" }, input] };
  const result = await controller.batch(id, body, request, "csrf"); assert.equal(calls, 2);
  assert.deepEqual(result.results.map(r => [r.index, r.outcome]), [[0, "rejected"], [1, "saved"], [2, "rejected"], [3, "saved"]]);
  assert.ok(!("allSaved" in result));
});
test("material history defaults, numeric query bounds and terminal cursor preserve minimal ordered revision facts", async () => {
  const controller = new MaterialRegistryController({ registry: () => ({ read: async () => saved }) } as unknown as MaterialRuntime);
  const result = await controller.history(id, id, {}, request); assert.equal(result.revisions.length, 1); assert.equal(result.nextAfterRevision, null);
  assert.ok(!JSON.stringify(result).includes("internal-never-emit"));
  assert.equal((await controller.history(id, id, { afterRevision: "1", pageSize: "1" }, request)).revisions.length, 0);
  for (const query of [{ afterRevision: "01" }, { pageSize: "51" }, { pageSize: ["1", "2"] }, { injected: "extra" }])
    await assert.rejects(controller.history(id, id, query, request), e => e instanceof HttpException && e.getStatus() === 400);
  await assert.rejects(controller.history(id, id, { afterRevision: "2" }, request), e => e instanceof HttpException && e.getStatus() === 409);
});
test("material library forwards exact current Cookie and query but omits actor/storage/history and masks bad output", async () => {
  let seen: unknown;
  const registry = { list: async (session: string, project: string, query: unknown) => { seen = { session, project, query }; return { projectId: id, materials: [saved], nextAfterVariantId: null }; } };
  const controller = new MaterialRegistryController({ registry: () => registry } as unknown as MaterialRuntime);
  const result = await controller.list(id, {}, request); assert.deepEqual(seen, { session: token, project: id, query: { afterVariantId: null, pageSize: 20 } });
  assert.equal(result.materials.length, 1); assert.ok(!JSON.stringify(result).includes("internal-never-emit"));
  await assert.rejects(controller.list(id, { pageSize: "51" }, request), e => e instanceof HttpException && e.getStatus() === 400);
  registry.list = async () => ({ projectId: id, materials: [{ ...saved, currentRevision: 2 }], nextAfterVariantId: null });
  await assert.rejects(controller.list(id, {}, request), e => e instanceof HttpException && e.getStatus() === 500);
});
