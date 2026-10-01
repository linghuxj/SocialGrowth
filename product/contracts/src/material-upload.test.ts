import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "./common.js";
import { prepareMaterialUploadRequestSchema, prepareMaterialUploadResponseSchema, materialUploadTicketViewSchema, uploadMaterialBytesCommandSchema, uploadMaterialBytesResponseSchema, materialUploadInventoryQuerySchema, materialUploadInventoryResponseSchema } from "./material-upload.js";
const id = "a0000000-0000-4000-8000-000000000001";
const request = { metadata: { contractVersion, requestId: "request-material", idempotencyKey: "idempotency-material" }, projectId: id, objectId: id, sha256: "a".repeat(64), bytes: 12, contentType: "video/mp4" };
test("inventory preserves original ticket status, project, stable order and exact cursor without permissions", () => {
  const first = { projectId: id, objectId: id, sha256: request.sha256, bytes: 12, contentType: request.contentType, status: "pending_bytes", preparedAt: "2026-10-01T00:00:00.123456789123Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false };
  const second = { ...first, objectId: "a0000000-0000-4000-8000-000000000002", status: "verified_bytes", verifiedAt: first.preparedAt };
  const page = { projectId: id, tickets: [first, second], nextAfterObjectId: second.objectId };
  materialUploadInventoryQuerySchema.parse({ afterObjectId: null, pageSize: 50 }); materialUploadInventoryResponseSchema.parse(page);
  materialUploadInventoryResponseSchema.parse({ projectId: id, tickets: [], nextAfterObjectId: null });
  for (const patch of [{ tickets: [second, first], nextAfterObjectId: null }, { tickets: [first, first], nextAfterObjectId: null }, { nextAfterObjectId: first.objectId },
    { tickets: [], nextAfterObjectId: first.objectId }, { tickets: [{ ...first, projectId: second.objectId }], nextAfterObjectId: null },
    { tickets: [{ ...first, status: "verified_bytes" }], nextAfterObjectId: null }, { tickets: [{ ...second, verifiedAt: "2026-10-01T00:00:00.123456789122Z" }], nextAfterObjectId: null },
    { tickets: [{ ...first, key: "private" }], nextAfterObjectId: null }, { tickets: [{ ...first, candidateAllowed: true }], nextAfterObjectId: null }]) assert.equal(materialUploadInventoryResponseSchema.safeParse({ ...page, ...patch }).success, false);
  for (const pageSize of [0, 51, true, 1.2]) assert.equal(materialUploadInventoryQuerySchema.safeParse({ afterObjectId: null, pageSize }).success, false);
});
test("upload request describes original bytes without caller storage configuration, privilege or identity claims", () => {
  prepareMaterialUploadRequestSchema.parse(request);
  for (const extra of [{ endpoint: "https://fixture.invalid" }, { storageLocationId: id }, { bucket: "private" }, { key: "custom" }, { actorId: id }, { status: "verified_bytes" }]) assert.equal(prepareMaterialUploadRequestSchema.safeParse({ ...request, ...extra }).success, false);
  for (const bytes of [0, -1, 1.2, 128 * 1024 * 1024 + 1]) assert.equal(prepareMaterialUploadRequestSchema.safeParse({ ...request, bytes }).success, false);
});
test("byte transport command has no URL or caller success, and acknowledgement is verified history only", () => {
  const command = { metadata: request.metadata, projectId: id, objectId: id }; uploadMaterialBytesCommandSchema.parse(command);
  assert.equal(uploadMaterialBytesCommandSchema.safeParse({ ...command, endpoint: "https://fixture.invalid" }).success, false);
  const result = { projectId: id, objectId: id, sha256: request.sha256, bytes: request.bytes, contentType: request.contentType, status: "verified_bytes",
    preparedAt: "2026-10-01T00:00:00Z", verifiedAt: "2026-10-01T00:00:01Z", candidateAllowed: false, publicationAllowed: false, changed: true, replayed: false };
  uploadMaterialBytesResponseSchema.parse(result);
  assert.equal(uploadMaterialBytesResponseSchema.safeParse({ ...result, status: "pending_bytes", verifiedAt: null }).success, false);
  assert.equal(uploadMaterialBytesResponseSchema.safeParse({ ...result, publicationAllowed: true }).success, false);
});
test("minimal ticket cannot claim eligibility, disclose internal locator or contradict exact timestamp status", () => {
  const pending = { projectId: id, objectId: id, sha256: request.sha256, bytes: request.bytes, contentType: request.contentType,
    status: "pending_bytes", preparedAt: "2026-10-01T00:00:00.123456789123Z", verifiedAt: null, candidateAllowed: false, publicationAllowed: false };
  materialUploadTicketViewSchema.parse(pending);
  const verified = { ...pending, status: "verified_bytes", verifiedAt: "2026-10-01T08:00:00.123456789123+08:00" };
  materialUploadTicketViewSchema.parse(verified);
  for (const patch of [{ status: "verified_bytes" }, { candidateAllowed: true }, { descriptor: {} }, { key: "projects/private" }, { preparedAt: "0000-01-01T00:00:00Z" }, { verifiedAt: "2026-10-01T00:00:00Z" }]) assert.equal(materialUploadTicketViewSchema.safeParse({ ...pending, ...patch }).success, false);
  assert.equal(materialUploadTicketViewSchema.safeParse({ ...verified, verifiedAt: "2026-10-01T00:00:00.123456789122Z" }).success, false);
  prepareMaterialUploadResponseSchema.parse({ ...pending, changed: true, replayed: false });
  assert.equal(prepareMaterialUploadResponseSchema.safeParse({ ...pending, changed: true, replayed: true }).success, false);
});
