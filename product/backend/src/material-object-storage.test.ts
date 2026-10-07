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

test("OSS S3 requests preserve immutable bytes, verify conflicts and reject versioned buckets", async () => {
  const { createServer } = await import("node:http");
  const { createHash } = await import("node:crypto");
  let status: "Enabled" | "Suspended" | undefined, puts = 0;
  let stored: Buffer | undefined;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers["x-oss-content-sha256"], "UNSIGNED-PAYLOAD");
    assert.match(req.headers.authorization ?? "", /SignedHeaders=.*x-oss-content-sha256/);
    if (req.url?.includes("versioning")) {
      res.setHeader("content-type", "application/xml");
      res.end(`<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${status ? `<Status>${status}</Status>` : ""}</VersioningConfiguration>`);
    } else if (req.method === "PUT") {
      puts++;
      assert.equal(req.headers["x-oss-forbid-overwrite"], "true");
      assert.match(req.headers.authorization ?? "", /SignedHeaders=.*x-oss-forbid-overwrite/);
      assert.equal(req.headers["transfer-encoding"], undefined);
      assert.equal(req.headers["x-amz-checksum-sha256"], undefined);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      assert.equal(Number(req.headers["content-length"]), bytes.length);
      assert.equal(req.headers["content-md5"], createHash("md5").update(bytes).digest("base64"));
      if (stored) {
        res.writeHead(409, { "content-type": "application/xml" });
        res.end("<Error><Code>FileAlreadyExists</Code><Message>Object exists</Message></Error>");
      } else { stored = bytes; res.end(); }
    } else {
      res.writeHead(200, { "content-length": stored?.length ?? 0, "content-type": "video/mp4" });
      res.end(stored);
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = { ...config(), endpoint: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 2000 };
  const s3 = new MaterialObjectStorage(base), explicitS3 = new MaterialObjectStorage({ ...base, provider: "s3" });
  assert.deepEqual(s3.binding(), explicitS3.binding()); s3.close(); explicitS3.close();
  const store = new MaterialObjectStorage({ ...base, provider: "oss_s3" });
  const input = { projectId: randomUUID(), objectId: randomUUID(), contentType: "video/mp4" };
  try {
    const bytes = Buffer.from("isolated protocol fixture");
    const ref = await store.put(input, bytes);
    assert.deepEqual(await store.readVerified(ref), bytes);
    assert.deepEqual(await store.put(input, bytes), ref);
    await assert.rejects(store.put(input, Buffer.from("different object")), fails("OBJECT_CONFLICT"));
    assert.equal(puts, 3);
    for (const value of ["Enabled", "Suspended"] as const) {
      status = value;
      await assert.rejects(store.put(input, bytes), fails("CONFIGURATION_REQUIRED"));
      assert.equal(puts, 3);
    }
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
