import test from "node:test";
import assert from "node:assert/strict";
import { listAdbDevices, captureDeviceScreen } from "./device-detector.ts";
import { ScreenshotStore } from "./storage/screenshot-store.ts";
import { createRuntimeServer } from "./server.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Real physical device discovery, ADB screenshot capture, MinIO WebP upload and state aggregation", async () => {
  // 1. Verify ADB physical device discovery
  const devices = await listAdbDevices();
  assert.ok(devices.length > 0, "At least one ADB physical device should be attached");
  const s23 = devices.find((d) => d.serial === "RFCW40MYYCV" || d.state === "device");
  assert.ok(s23, "Real physical device should be detected");
  assert.equal(s23.state, "device");
  assert.ok(s23.serial.length > 0);

  // 2. Capture real physical screen
  const pngBytes = await captureDeviceScreen(s23.serial);
  assert.ok(pngBytes !== null, "Should capture raw screen PNG bytes from physical phone");
  assert.ok(pngBytes.length > 10000, "PNG bytes should be a real screen capture");
  assert.equal(pngBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Should start with PNG header");

  // 3. Upload real screenshot to MinIO with WebP conversion
  const store = new ScreenshotStore();
  const uploadResult = await store.uploadScreenshot(pngBytes, {
    workerId: "worker01",
    deviceId: s23.serial,
    sessionId: "real-phone-verify",
    step: 0,
  });

  assert.match(uploadResult.imageKey, /\.webp$/);
  assert.equal(uploadResult.contentType, "image/webp");
  assert.ok(uploadResult.size > 0);
  assert.ok(uploadResult.size < pngBytes.length, "WebP size should be significantly smaller than raw PNG");

  // 4. Test real device state aggregation via Runtime Server
  const dir = await mkdtemp(join(tmpdir(), "sg-real-device-test-"));
  const token = "12345678901234567890123456789012";
  const signingKey = "abcdefabcdefabcdefabcdefabcdefab";
  const deviceTokens = { [s23.serial]: "3b5c45d38817dac075a3d873f4d591512dd1ac8f39eaf6b9e94d6dc8d0beebdd" };

  const server = createRuntimeServer({
    dataDir: dir,
    token,
    signingKey,
    deviceTokens,
  });

  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  const address = server.http.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api/runtime`;

  try {
    // Query /devices/states
    const res = await fetch(`${baseUrl}/devices/states?capture=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.devices));
    const matched = data.devices.find((d: any) => d.serial === s23.serial);
    assert.ok(matched, "Connected real phone should be present in devices response");
    assert.equal(matched.isPhysical, true);
    assert.equal(matched.adbStatus, "device");
    assert.ok(matched.imageKey, "Real phone should have an imageKey generated from actual screenshot");

    // Fetch the real screenshot via the runtime proxy
    const imgRes = await fetch(`${baseUrl}/${matched.imageKey}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(imgRes.status, 200);
    assert.equal(imgRes.headers.get("content-type"), "image/webp");
    const retrievedBytes = await imgRes.arrayBuffer();
    assert.ok(retrievedBytes.byteLength > 0);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
