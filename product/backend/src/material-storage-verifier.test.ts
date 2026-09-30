import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MaterialStorageVerifier } from "./material-storage-verifier.js";
import type { MaterialObjectStorage } from "./material-object-storage.js";
import { MaterialRegistryError } from "./material-registry-store.js";
const objectId = randomUUID(), projectId = randomUUID();
const reference = () => ({ storageLocationId: randomUUID(), storageBindingDigest: "a".repeat(64), projectId, objectId, key: `projects/${projectId}/objects/${objectId}`, sha256: "b".repeat(64), bytes: 10, contentType: "video/mp4" });
test("aborted protected lookup cannot start a later byte read after the outer deadline", async () => {
  let reads = 0, resolve!: (v: unknown) => void;
  const storage = { readVerified: async () => { reads++; return Buffer.alloc(10); } } as unknown as MaterialObjectStorage;
  const verifier = new MaterialStorageVerifier(storage, async () => new Promise(r => { resolve = r; })), abort = new AbortController();
  const pending = verifier.verify({ projectId, objectIds: [objectId] }, abort.signal); abort.abort(); resolve(reference());
  await assert.rejects(pending, (e: unknown) => e instanceof MaterialRegistryError && e.code === "VERIFIER_UNAVAILABLE"); assert.equal(reads, 0);
});
test("manifest returned by protected lookup and remembered reference cannot be rewritten by byte-reader callback", async () => {
  const ref = reference(); let reads = 0;
  const storage = { readVerified: async (input: unknown) => { reads++; Object.assign(input as object, { sha256: "c".repeat(64) }); return Buffer.alloc(10); } } as unknown as MaterialObjectStorage;
  const verifier = new MaterialStorageVerifier(storage, async () => ref);
  assert.equal((await verifier.verify({ projectId, objectIds: [objectId] }, new AbortController().signal))[0]!.sha256, "b".repeat(64)); assert.equal(ref.sha256, "b".repeat(64));
  await assert.rejects(verifier.verify({ projectId: randomUUID(), objectIds: [objectId] }, new AbortController().signal), (e: unknown) => e instanceof MaterialRegistryError && e.code === "INVALID_OBJECTS"); assert.equal(reads, 1);
});
