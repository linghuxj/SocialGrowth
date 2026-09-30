import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MaterialObjectStorage, MaterialStorageError } from "./material-object-storage.js";
const config = () => ({ storageLocationId: randomUUID(), endpoint: "http://127.0.0.1:32900", region: "us-east-1", bucket: "isolated-fixture", forcePathStyle: true,
  accessKeyId: "fixture-access-key", secretAccessKey: "fixture-secret-key-not-real", maxObjectBytes: 1024, requestTimeoutMs: 100 });
const fails = (code: string) => (e: unknown) => e instanceof MaterialStorageError && e.code === code && !e.cause && !JSON.stringify(e).includes("fixture-secret");
test("storage config never uses ambient credentials, accepts only trusted HTTPS or loopback HTTP and masks invalid endpoints", () => {
  const c = config();
  for (const patch of [{ secretAccessKey: undefined }, { accessKeyId: "" }, { endpoint: "http://remote.invalid" }, { endpoint: "file:///tmp/test" },
    { endpoint: "http://name:fixture-secret@127.0.0.1" }, { endpoint: "not-a-url-fixture-secret" }, { endpoint: "https://example.invalid/path" },
    { endpoint: "https://example.invalid/?token=fixture-secret" }, { forcePathStyle: "true" }, { maxObjectBytes: 0 }, { requestTimeoutMs: 0 }, { actorId: randomUUID() }]) assert.throws(() => new MaterialObjectStorage({ ...c, ...patch }), fails("CONFIGURATION_REQUIRED"));
  const store = new MaterialObjectStorage(c); assert.equal(JSON.stringify(store), "{}"); store.close();
});
test("storage rejects oversized and empty bytes, unknown authority and arbitrary object paths before network", async () => {
  const store = new MaterialObjectStorage(config()), input = { projectId: randomUUID(), objectId: randomUUID(), contentType: "video/mp4" };
  try {
    for (const [i, b] of [[input, Buffer.alloc(0)], [input, Buffer.alloc(1025)], [{ ...input, key: "../escape" }, Buffer.from("x")],
      [{ ...input, contentType: "text/html" }, Buffer.from("x")], [{ ...input, permissionGranted: true }, Buffer.from("x")]] as const) await assert.rejects(store.put(i, b), fails("INPUT_INVALID"));
    await assert.rejects(store.readVerified({ projectId: input.projectId, key: "../secret", credentials: "fixture-secret" }), fails("INPUT_INVALID"));
  } finally { store.close(); }
});
test("real connection failure returns safe retryable storage failure, not SDK request headers or cause", async () => {
  const store = new MaterialObjectStorage({ ...config(), endpoint: "http://127.0.0.1:1" });
  try { await assert.rejects(store.put({ projectId: randomUUID(), objectId: randomUUID(), contentType: "application/octet-stream" }, Buffer.from("fixture")),
    (e: unknown) => fails("STORAGE_UNAVAILABLE")(e) && e instanceof MaterialStorageError && e.retryable && e.stack?.includes("fixture-secret") !== true); }
  finally { store.close(); }
});
