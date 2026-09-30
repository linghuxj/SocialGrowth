import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { contractVersion } from "@socialgrowth/product-contracts";
import { MaterialUploadError, materialUploadPrepareSchema, materialUploadCommandSchema } from "./material-upload-core.js";
import { MaterialUploadStore } from "./material-upload-store.js";
import { OperatorAuthService } from "./operator-auth-service.js";
const input = () => ({ metadata: { contractVersion, requestId: "synthetic-upload-request", idempotencyKey: "synthetic-upload-request-key" }, projectId: randomUUID(), objectId: randomUUID(), sha256: "a".repeat(64), bytes: 10, contentType: "video/mp4" });
test("upload descriptor is pinned exact bytes/opaque IDs, never arbitrary storage or approval", () => {
  const r = input(); assert.equal(materialUploadPrepareSchema.safeParse(r).success, true);
  for (const patch of [{ key: "escape" }, { endpoint: "https://example.com" }, { verified: true }, { sha256: "not-a-hash" }, { bytes: 0 }, { bytes: 128 * 1024 * 1024 + 1 }]) assert.equal(materialUploadPrepareSchema.safeParse({ ...r, ...patch }).success, false);
  assert.equal(materialUploadCommandSchema.safeParse({ metadata: r.metadata, objectId: r.objectId, projectId: r.projectId }).success, true);
  assert.equal(materialUploadCommandSchema.safeParse({ ...r, status: "verified_bytes" }).success, false);
});
test("missing configured storage refuses uploads/prepare before database or accidental ambient credentials", async () => {
  let connections = 0; const pool = { connect: async () => { connections++; throw new Error("should-not-connect"); } } as unknown as Pool;
  const service = new MaterialUploadStore(pool, new OperatorAuthService(pool, "synthetic-upload-unit-pepper-00001")), r = input();
  for (const call of [() => service.prepare("", "", r), () => service.upload("", "", { metadata: r.metadata, projectId: r.projectId, objectId: r.objectId }, Buffer.from("bytes"))]) await assert.rejects(call(), (e: unknown) => e instanceof MaterialUploadError && e.code === "CONFIGURATION_REQUIRED" && !e.cause);
  assert.throws(() => service.objectVerifier(), MaterialUploadError); assert.equal(connections, 0); assert.equal(JSON.stringify(service), "{}");
});
