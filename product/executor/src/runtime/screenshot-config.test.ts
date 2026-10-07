import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { ScreenshotStore } from "./storage/screenshot-store.js";
import { readScreenshotStorageConfig, parseScreenshotStorageConfig } from "./storage/screenshot-config.js";

test("cloud screenshot config has no implicit credentials or MinIO fallback", () => {
  assert.equal(readScreenshotStorageConfig({ SG_MINIO_ENDPOINT: "http://localhost:9000", SG_MINIO_SECRET_KEY: "old-secret" }), null);
  assert.throws(() => readScreenshotStorageConfig({ SG_SCREENSHOT_MODE: "configured" }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => readScreenshotStorageConfig({ SG_SCREENSHOT_MODE: "unavailable", SG_SCREENSHOT_SECRET_KEY: "partial-secret" }), /CONFIGURATION_REQUIRED/);
});
for (const provider of ["s3", "oss_s3"] as const) test(`${provider} SDK signs encoded screenshot paths with explicit region/STS and existing bucket only`, async () => {
  const requests: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: Buffer }[] = [];
  const bytes = Buffer.from("screenshot fixture");
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
    res.setHeader("content-type", "image/png"); res.end(req.method === "GET" ? bytes : undefined);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const store = new ScreenshotStore({ storage: { provider, endpoint: `http://127.0.0.1:${address.port}`, region: "cn-hongkong", bucket: "screenshots", forcePathStyle: true, accessKey: "test-key", secretKey: "test-secret", sessionToken: "test-session", requestTimeoutMs: 2000 } });
  try {
    const uploaded = await store.uploadScreenshot(bytes, { workerId: "worker", deviceId: "127.0.0.1:34322", sessionId: "session", step: 1 }, { compressWebp: false });
    const result = await store.getScreenshot(uploaded.imageKey);
    assert.deepEqual(result?.buffer, bytes);
    assert.deepEqual(requests.map(r => r.method), ["HEAD", "PUT", "GET"]);
    const put = requests[1]!;
    assert.match(put.url, /127\.0\.0\.1%3A34322/);
    assert.match(String(put.headers.authorization), /cn-hongkong\/s3\/aws4_request/);
    assert.equal(put.headers["x-amz-security-token"], "test-session");
    if (provider === "oss_s3") {
      assert.equal(put.headers["x-oss-content-sha256"], "UNSIGNED-PAYLOAD");
      assert.equal(put.headers["content-md5"], createHash("md5").update(bytes).digest("base64"));
      assert.deepEqual(put.body, bytes);
      assert.equal(put.headers["content-encoding"], undefined);
    }
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("missing bucket never causes creation or upload, and errors are sanitized", async () => {
  const methods: string[] = [];
  const server = createServer((req, res) => { methods.push(req.method!); res.writeHead(404); res.end(); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const config = { provider: "s3" as const, endpoint: `http://127.0.0.1:${address.port}`, region: "us-east-1", bucket: "screenshots", forcePathStyle: true, accessKey: "secret-id", secretKey: "secret-value", requestTimeoutMs: 2000 };
  assert.throws(() => parseScreenshotStorageConfig({ ...config, endpoint: "http://remote.example.invalid" }), /CONFIGURATION_REQUIRED/);
  const store = new ScreenshotStore({ storage: config });
  try {
    await assert.rejects(store.uploadScreenshot(Buffer.from("x"), { workerId: "w", deviceId: "d", sessionId: "s", step: 1 }), { message: "SCREENSHOT_STORAGE_UNAVAILABLE" });
    assert.deepEqual(methods, ["HEAD"]);
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("upload failure is not retried and storage access is bounded by explicit timeout", async () => {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    methods.push(req.method!);
    if (req.method === "HEAD") res.end();
    else { res.writeHead(503); res.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const storage = { provider: "s3" as const, endpoint: `http://127.0.0.1:${address.port}`, region: "us-east-1", bucket: "screenshots", forcePathStyle: true, accessKey: "test", secretKey: "test", requestTimeoutMs: 100 };
  const store = new ScreenshotStore({ storage });
  try {
    await assert.rejects(store.uploadScreenshot(Buffer.from("x"), { workerId: "w", deviceId: "d", sessionId: "s", step: 1 }, { compressWebp: false }), { message: "SCREENSHOT_STORAGE_UPLOAD_UNCONFIRMED" });
    assert.deepEqual(methods, ["HEAD", "PUT"]);
    server.removeAllListeners("request"); server.on("request", () => { /* no response */ });
    const waiting = new ScreenshotStore({ storage });
    const started = Date.now();
    try { await assert.rejects(waiting.ensureBucket(), { message: "SCREENSHOT_STORAGE_UNAVAILABLE" }); assert.ok(Date.now() - started < 2000); }
    finally { waiting.close(); }
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("download deadline covers a stalled response body, not only response headers", async () => {
  const server = createServer((req, res) => {
    if (req.method === "HEAD") res.end();
    else { res.writeHead(200, { "content-type": "image/png", "content-length": "100" }); res.write("x"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const store = new ScreenshotStore({ storage: { provider: "s3", endpoint: `http://127.0.0.1:${address.port}`, region: "us-east-1", bucket: "screenshots", forcePathStyle: true, accessKey: "test", secretKey: "test", requestTimeoutMs: 100 } });
  try {
    const started = Date.now();
    await assert.rejects(store.getScreenshot("screenshots/fixture.png"), { message: "SCREENSHOT_STORAGE_UNAVAILABLE" });
    assert.ok(Date.now() - started < 2000);
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
