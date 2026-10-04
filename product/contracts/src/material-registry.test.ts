import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import { saveMaterialDeclarationRequestSchema, materialCurrentViewSchema, saveMaterialDeclarationResponseSchema, batchMaterialDeclarationsRequestSchema, batchMaterialDeclarationsResponseSchema, materialHistoryResponseSchema, materialHistoryQuerySchema, materialLibraryQuerySchema, materialLibraryResponseSchema } from "./material-registry.js";
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
test("current material projection exposes only the finite candidate decision without storage, actor or publication authority", () => {
  const { metadata: _metadata, objectIds: _objectIds, expectedCurrentRevision: _expected, ...common } = input;
  const current = { ...common, declaration: { ...common.declaration, expectedApprovedDirectionId: null, expectedApprovedProjectVersion: null, contentRulesReviewed: false },
    languageTag: "en-us", currentRevision: 1, objects: [{ objectId: id, sha256: "a".repeat(64), bytes: 10, contentType: "video/mp4" }],
    recordedAt: "2026-10-01T00:00:00.123456789123Z", status: "pending_validation", candidateAllowed: false, eligibilityReason: "direction_not_approved", publicationAllowed: false,
    withdrawal: { state: "not_withdrawn", materialRevision: null, requestId: null, recordedAt: null } };
  materialCurrentViewSchema.parse(current); saveMaterialDeclarationResponseSchema.parse({ ...current, changed: true, replayed: false });
  materialCurrentViewSchema.parse({ ...current, status: "candidate", candidateAllowed: true, eligibilityReason: null });
  for (const patch of [{ key: "private" }, { recordedByOperatorId: id }, { revisions: [] }, { status: "approved" }, { publicationAllowed: true },
    { status: "candidate" }, { candidateAllowed: true },
    { objects: [{ ...current.objects[0], storageLocationId: id }] }, { objects: [{ ...current.objects[0], contentType: "image/png" }] },
    { recordedAt: "0000-01-01T00:00:00Z" }, { currentRevision: 0 }]) assert.equal(materialCurrentViewSchema.safeParse({ ...current, ...patch }).success, false);
  assert.equal(saveMaterialDeclarationResponseSchema.safeParse({ ...current, changed: true, replayed: true }).success, false);
});
function current() {
  const { metadata: _metadata, objectIds: _objectIds, expectedCurrentRevision: _expected, ...common } = input;
  return { ...common, declaration: { ...common.declaration, expectedApprovedDirectionId: null, expectedApprovedProjectVersion: null, contentRulesReviewed: false },
    languageTag: "en-us", currentRevision: 2, objects: [{ objectId: id, sha256: "a".repeat(64), bytes: 10, contentType: "video/mp4" }],
    recordedAt: "2026-10-01T00:00:01.123456789123Z", status: "pending_validation" as const, candidateAllowed: false as const,
    eligibilityReason: "direction_not_approved" as const, publicationAllowed: false as const,
    withdrawal: { state: "not_withdrawn" as const, materialRevision: null, requestId: null, recordedAt: null } };
}
test("batch envelope is trace-only and each item result stays indexed, scoped and pending without whole-batch success", () => {
  const metadata = { contractVersion, requestId: input.metadata.requestId };
  batchMaterialDeclarationsRequestSchema.parse({ metadata, projectId: id, items: [null, { malformed: true }, input] });
  assert.equal(batchMaterialDeclarationsRequestSchema.safeParse({ metadata: input.metadata, projectId: id, items: [input] }).success, false);
  assert.equal(batchMaterialDeclarationsRequestSchema.safeParse({ metadata, projectId: id, items: Array(51).fill(input) }).success, false);
  const saved = { ...current(), changed: true, replayed: false }, rejected = { index: 0, outcome: "rejected", error: { code: "INPUT_INVALID", message: "Fixed safe error", retryable: false } };
  const response = { projectId: id, results: [rejected, { index: 1, outcome: "saved", material: saved }] }; batchMaterialDeclarationsResponseSchema.parse(response);
  for (const patch of [{ allSaved: true }, { results: [{ ...rejected, index: 1 }] }, { results: [{ index: 0, outcome: "saved", material: { ...saved, projectId: "b0000000-0000-4000-8000-000000000001" } }] }])
    assert.equal(batchMaterialDeclarationsResponseSchema.safeParse({ ...response, ...patch }).success, false);
});
test("revision history has exact continuous numeric page/cursor/time and current snapshot semantics", () => {
  materialHistoryQuerySchema.parse({ afterRevision: 0, pageSize: 50 }); assert.equal(materialHistoryQuerySchema.safeParse({ afterRevision: 1001, pageSize: 51 }).success, false);
  const row = current(), revision = { revision: 1, declaration: row.declaration, objects: row.objects, recordedAt: "2026-10-01T00:00:00.123456789123Z", status: row.status };
  const page = { current: row, revisions: [revision], nextAfterRevision: 1 }; materialHistoryResponseSchema.parse(page);
  materialHistoryResponseSchema.parse({ current: { ...row, currentRevision: 1, status: "candidate", candidateAllowed: true, eligibilityReason: null }, revisions: [{ ...revision, recordedAt: row.recordedAt, status: "pending_validation" }], nextAfterRevision: null });
  materialHistoryResponseSchema.parse({ current: row, revisions: [{ ...revision, revision: 2, recordedAt: row.recordedAt }], nextAfterRevision: null });
  for (const patch of [{ nextAfterRevision: null }, { revisions: [{ ...revision, recordedAt: "2026-10-01T00:00:01.123456789124Z" }] },
    { revisions: [{ ...revision, objects: [{ ...revision.objects[0], contentType: "image/png" }] }] },
    { revisions: [revision, { ...revision, revision: 3 }], nextAfterRevision: null }, { revisions: [{ ...revision, revision: 2 }], nextAfterRevision: null }])
    assert.equal(materialHistoryResponseSchema.safeParse({ ...page, ...patch }).success, false);
});
test("material library is scoped, stable ordered variant pagination rather than new quotas or overall eligibility", () => {
  materialLibraryQuerySchema.parse({ afterVariantId: null, pageSize: 50 }); assert.equal(materialLibraryQuerySchema.safeParse({ afterVariantId: id, pageSize: 51 }).success, false);
  const first = current(), second = { ...first, variantId: "a0000000-0000-4000-8000-000000000002", languageTag: "zh-cn" };
  const page = { projectId: id, materials: [first, second], nextAfterVariantId: second.variantId }; materialLibraryResponseSchema.parse(page);
  materialLibraryResponseSchema.parse({ projectId: id, materials: [], nextAfterVariantId: null });
  for (const patch of [{ nextAfterVariantId: id }, { materials: [second, first], nextAfterVariantId: null }, { materials: [first, first], nextAfterVariantId: null },
    { materials: [{ ...first, projectId: "b0000000-0000-4000-8000-000000000001" }], nextAfterVariantId: null }, { materials: [], nextAfterVariantId: id }])
    assert.equal(materialLibraryResponseSchema.safeParse({ ...page, ...patch }).success, false);
});
