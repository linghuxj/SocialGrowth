import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MaterialObjectStorage, MaterialStorageError, type MaterialObjectReference } from "./material-object-storage.js";
const endpoint = process.env.SG_PRODUCT_TEST_STORAGE_ENDPOINT;
if (endpoint !== "http://127.0.0.1:32900" || process.env.SG_PRODUCT_TEST_STORAGE_ISOLATED !== "1") throw new Error("Storage checks require the exact isolated loopback test server");
const accessKeyId = process.env.SG_PRODUCT_TEST_STORAGE_ACCESS_KEY, secretAccessKey = process.env.SG_PRODUCT_TEST_STORAGE_SECRET_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error("Explicit isolated storage fixture credentials required");
const c = { storageLocationId: randomUUID(), endpoint, region: "us-east-1", bucket: `sg-wp15-fixture-${randomUUID()}`, forcePathStyle: true,
  accessKeyId, secretAccessKey, maxObjectBytes: 4096, requestTimeoutMs: 3000 };
const admin = new S3Client({ endpoint, region: c.region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
const store = new MaterialObjectStorage(c);
const input = () => ({ projectId: randomUUID(), objectId: randomUUID(), contentType: "application/octet-stream" });
const code = (v: string) => (e: unknown) => e instanceof MaterialStorageError && e.code === v && !e.cause;
before(async () => { await admin.send(new CreateBucketCommand({ Bucket: c.bucket })); });
after(() => { store.close(); admin.destroy(); }); // Entire owned --rm server removed by runner; no delete API in product adapter.
test("real private object round-trip verifies full SHA-256 and size, not merely PUT status or ETag", async () => {
  const body = Buffer.from("isolated byte fixture; not real media, approval or publication"), i = input();
  const reference = await store.put(i, body); assert.deepEqual(await store.readVerified(reference), body);
  assert.equal(reference.bytes, body.length); assert.equal(reference.projectId, i.projectId); assert.equal(reference.objectId, i.objectId);
  assert.equal(JSON.stringify(reference).includes("http"), false); assert.equal(JSON.stringify(reference).includes(secretAccessKey!), false);
  assert.equal(Object.keys(reference).includes("approved"), false);
});
test("same object ID cannot overwrite different bytes; exact retry verifies existing object without changing it", async () => {
  const i = input(), original = Buffer.from("original immutable bytes"), reference = await store.put(i, original);
  assert.deepEqual(await store.put(i, original), reference);
  await assert.rejects(store.put(i, Buffer.from("different same-key bytes")), code("OBJECT_CONFLICT"));
  assert.deepEqual(await store.readVerified(reference), original);
});
test("two genuine concurrent writes with one ID converge on one verified immutable reference", async () => {
  const i = input(), body = Buffer.from("concurrent fixture"), b = new MaterialObjectStorage(c);
  try { const results = await Promise.all([store.put(i, body), b.put(i, body)]); assert.deepEqual(results[0], results[1]); }
  finally { b.close(); }
});
test("upper-case UUIDs normalize; caller mutation after invoking put cannot alter bytes already pinned", async () => {
  const i = input(), body = Buffer.from("stable fixture"), copy = Buffer.from(body);
  const pending = store.put({ ...i, projectId: i.projectId.toUpperCase(), objectId: i.objectId.toUpperCase() }, body); body.fill(0);
  const ref = await pending; assert.equal(ref.projectId, i.projectId); assert.deepEqual(await store.readVerified(ref), copy);
});
test("corrupt length, project/key relation, foreign storage binding and real object mutation fail closed", async () => {
  const reference = await store.put(input(), Buffer.from("original protected byte fixture"));
  await assert.rejects(store.readVerified({ ...reference, bytes: reference.bytes - 1 }), code("OBJECT_INTEGRITY_FAILED"));
  for (const patch of [{ key: "../escape" }, { projectId: randomUUID() }, { storageLocationId: randomUUID() }, { storageBindingDigest: "0".repeat(64) }]) await assert.rejects(store.readVerified({ ...reference, ...patch }), code("INPUT_INVALID"));
  // Administrative fixture mutation tests detection; not an adapter operation or UI success.
  await admin.send(new PutObjectCommand({ Bucket: c.bucket, Key: reference.key, Body: Buffer.alloc(reference.bytes, 120), ContentType: reference.contentType }));
  await assert.rejects(store.readVerified(reference), code("OBJECT_INTEGRITY_FAILED"));
});
test("configuration change cannot reinterpret an old location manifest; credentials stay out of ordinary serialization", async () => {
  const ref = await store.put(input(), Buffer.from("bound storage fixture"));
  const changed = new MaterialObjectStorage({ ...c, bucket: `${c.bucket}-other` });
  try { await assert.rejects(changed.readVerified(ref), code("INPUT_INVALID")); assert.equal(JSON.stringify(changed), "{}"); }
  finally { changed.close(); }
});
test("anonymous and incorrect credentials cannot read a private object; safe facade masks original service error", async () => {
  const ref: MaterialObjectReference = await store.put(input(), Buffer.from("private fixture"));
  const anonymous = await fetch(`${endpoint}/${c.bucket}/${ref.key}`); assert.equal(anonymous.status, 403);
  const wrong = new MaterialObjectStorage({ ...c, secretAccessKey: "wrong-isolated-fixture-key" });
  try { await assert.rejects(wrong.readVerified(ref), (e: unknown) => code("STORAGE_UNAVAILABLE")(e) && e instanceof MaterialStorageError && e.retryable); }
  finally { wrong.close(); }
  // Supplemental real source reading, not a business/material approval workflow.
  const actual = await admin.send(new GetObjectCommand({ Bucket: c.bucket, Key: ref.key }));
  if (actual.Body) await actual.Body.transformToByteArray();
});
