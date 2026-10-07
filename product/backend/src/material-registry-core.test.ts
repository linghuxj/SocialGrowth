import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { canonicalMaterial, materialIdentitySchema, materialSaveSchema, materialObjectReferenceSchema } from "./material-registry-core.js";
import { MaterialRegistryStore, MaterialRegistryError } from "./material-registry-store.js";
import { OperatorAuthService } from "./operator-auth-service.js";
const id = randomUUID();
const request = () => ({ metadata: { contractVersion, requestId: "material-unit-request", idempotencyKey: "material-unit-request-key" }, projectId: id, contentUnitId: id,
  sourceId: id, sourceRecordId: id, identity: { mediaKind: "video", businessKind: "product", businessEntityId: id, seriesId: null, episodeNumber: null },
  variantId: id, languageTag: "EN-us", expectedCurrentRevision: 0, declaration: { name: "Synthetic", description: "Synthetic description", businessFacts: "Synthetic facts",
    sourceStatement: "Synthetic declaration, not proof", sourceEvidenceIds: [id], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [id] });
test("human material identity is explicit; language normalization and copy never infer identity or publication", () => {
  const input = request(), parsed = materialSaveSchema.parse(input); assert.equal(parsed.languageTag, "en-us"); assert.equal(input.languageTag, "EN-us");
  for (const patch of [{ candidateAllowed: true }, { identity: { ...input.identity, approved: true } }, { objectIds: [id, id] }, { declaration: { ...input.declaration, firstUseDeclaration: "verified" } }, { objectIds: [id, randomUUID()] }]) assert.equal(materialSaveSchema.safeParse({ ...input, ...patch }).success, false);
});
test("explicit drama episode is video only and must have complete series/episode pair", () => {
  const identity = request().identity;
  assert.equal(materialIdentitySchema.safeParse({ ...identity, businessKind: "drama", seriesId: id, episodeNumber: 2 }).success, true);
  for (const patch of [{ seriesId: id }, { episodeNumber: 1 }, { businessKind: "product", seriesId: id, episodeNumber: 1 }, { mediaKind: "image_text", businessKind: "drama", seriesId: id, episodeNumber: 1 }]) assert.equal(materialIdentitySchema.safeParse({ ...identity, ...patch }).success, false);
});
test("manifest contains pinned opaque object reference, no public URL or dynamic storage configuration", () => {
  const ref = { storageLocationId: id, storageBindingDigest: "a".repeat(64), projectId: id, objectId: id, key: `projects/${id}/objects/${id}`, sha256: "b".repeat(64), bytes: 1, contentType: "video/mp4" };
  assert.equal(materialObjectReferenceSchema.safeParse(ref).success, true);
  for (const patch of [{ key: "elsewhere" }, { endpoint: "https://example.com" }, { signedUrl: "https://example.com" }, { bytes: 0 }, { accessKeyId: "private" }]) assert.equal(materialObjectReferenceSchema.safeParse({ ...ref, ...patch }).success, false);
  assert.equal(canonicalMaterial({ b: 2, a: [1, 3] }), canonicalMaterial({ a: [1, 3], b: 2 })); assert.notEqual(canonicalMaterial([1, 3]), canonicalMaterial([3, 1]));
});
test("unconfigured object verifier closes before database, caller-ready flags reject strictly", async () => {
  let connections = 0; const pool = { connect: async () => { connections++; throw new Error("not-called"); } } as unknown as Pool;
  const store = new MaterialRegistryStore(pool, new OperatorAuthService(pool, "synthetic-material-unit-pepper-000001"));
  await assert.rejects(store.save("", "", request()), (e: unknown) => e instanceof MaterialRegistryError && e.code === "VERIFIER_UNAVAILABLE");
  await assert.rejects(store.save("", "", { ...request(), published: true })); assert.equal(connections, 0);
});
test("explicit bounded batch reports per-item failures without echoing source text or claiming whole-batch success", async () => {
  const pool = { connect: async () => { throw new Error("should-not-connect"); } } as unknown as Pool;
  const store = new MaterialRegistryStore(pool, new OperatorAuthService(pool, "synthetic-material-unit-pepper-000001"));
  const result = await store.saveBatch("", "", { items: [request(), { privateMarker: "not-for-errors" }] });
  assert.deepEqual(result.results.map(v => [v.index, v.outcome, v.outcome === "rejected" ? v.error.code : null]), [[0, "rejected", "VERIFIER_UNAVAILABLE"], [1, "rejected", "INPUT_INVALID"]]);
  assert.equal(JSON.stringify(result).includes("not-for-errors"), false);
  await assert.rejects(store.saveBatch("", "", { items: Array.from({ length: 51 }, request) }));
});
