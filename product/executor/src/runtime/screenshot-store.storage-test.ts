import test from "node:test";
import assert from "node:assert/strict";
import { ScreenshotStore } from "./storage/screenshot-store.js";

test("ScreenshotStore roundtrips WebP in configured cloud S3 storage with an encoded wireless ADB object key", async () => {
  const store = new ScreenshotStore();

  // Create a minimal 1x1 8-bit PNG buffer in memory
  // 1x1 RGBA red pixel PNG
  const minimalPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  // Test WebP conversion
  const webpBuffer = await store.convertPngToWebp(minimalPng);
  assert.ok(webpBuffer.length > 0, "WebP buffer should not be empty");

  // Test upload to configured cloud storage
  const result = await store.uploadScreenshot(minimalPng, {
    workerId: "worker01",
    deviceId: "127.0.0.1:34322",
    sessionId: "test-session",
    step: 1,
  });

  assert.equal(result.imageKey, "screenshots/worker01/127.0.0.1:34322/test-session/step_1.webp");
  assert.equal(result.contentType, "image/webp");
  assert.ok(result.size > 0);

  // Test retrieval from configured cloud storage
  const retrieved = await store.getScreenshot(result.imageKey);
  assert.ok(retrieved !== null, "Object should exist in configured cloud S3 storage");
  assert.equal(retrieved?.contentType, "image/webp");
  assert.equal(retrieved?.buffer.length, result.size);
});
