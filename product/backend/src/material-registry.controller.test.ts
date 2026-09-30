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
