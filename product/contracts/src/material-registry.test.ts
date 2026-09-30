import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import { saveMaterialDeclarationRequestSchema, materialCurrentViewSchema, saveMaterialDeclarationResponseSchema } from "./material-registry.js";
const id = "a0000000-0000-4000-8000-000000000001";
const input = { metadata: { contractVersion, requestId: "request-material", idempotencyKey: "idempotency-material" }, projectId: id, contentUnitId: id,
  sourceId: id, sourceRecordId: id, variantId: id, languageTag: "en-US", expectedCurrentRevision: 0,
  identity: { mediaKind: "video", businessKind: "product", businessEntityId: id, seriesId: null, episodeNumber: null },
  declaration: { name: "Synthetic", description: "Explicit description", businessFacts: "Explicit facts", sourceStatement: "Explicit source", sourceEvidenceIds: [id], firstUseDeclaration: "declared_not_previously_published" }, objectIds: [id] };
test("human declaration strict request keeps explicit identity, evidence and object order without success/config claims", () => {
  saveMaterialDeclarationRequestSchema.parse(input);
  for (const patch of [{ actorId: id }, { endpoint: "https://fixture.invalid" }, { candidateAllowed: true }, { objectIds: [id, id.toUpperCase()] },
    { identity: { ...input.identity, seriesId: id } }, { identity: { ...input.identity, seriesId: id, episodeNumber: 1 } },
    { declaration: { ...input.declaration, sourceEvidenceIds: [id, id.toUpperCase()] } }, { declaration: { ...input.declaration, name: "\uFEFFSynthetic" } },
    { declaration: { ...input.declaration, businessFacts: "line\nfeed" } }, { declaration: { ...input.declaration, name: "😀".repeat(151) } }])
    assert.equal(saveMaterialDeclarationRequestSchema.safeParse({ ...input, ...patch }).success, false, JSON.stringify(patch));
  saveMaterialDeclarationRequestSchema.parse({ ...input, identity: { ...input.identity, businessKind: "drama", seriesId: id, episodeNumber: 1 } });
  saveMaterialDeclarationRequestSchema.parse({ ...input, declaration: { ...input.declaration, name: "😀".repeat(150) } });
});
test("current material projection is pending-only and excludes storage, actor, invented historical or publication state", () => {
  const { metadata: _metadata, objectIds: _objectIds, expectedCurrentRevision: _expected, ...common } = input;
  const current = { ...common, languageTag: "en-us", currentRevision: 1, objects: [{ objectId: id, sha256: "a".repeat(64), bytes: 10, contentType: "video/mp4" }],
    recordedAt: "2026-10-01T00:00:00.123456789123Z", status: "pending_validation", candidateAllowed: false, publicationAllowed: false };
  materialCurrentViewSchema.parse(current); saveMaterialDeclarationResponseSchema.parse({ ...current, changed: true, replayed: false });
  for (const patch of [{ key: "private" }, { recordedByOperatorId: id }, { revisions: [] }, { status: "approved" }, { publicationAllowed: true },
    { objects: [{ ...current.objects[0], storageLocationId: id }] }, { objects: [{ ...current.objects[0], contentType: "image/png" }] },
    { recordedAt: "0000-01-01T00:00:00Z" }, { currentRevision: 0 }]) assert.equal(materialCurrentViewSchema.safeParse({ ...current, ...patch }).success, false);
  assert.equal(saveMaterialDeclarationResponseSchema.safeParse({ ...current, changed: true, replayed: true }).success, false);
});
