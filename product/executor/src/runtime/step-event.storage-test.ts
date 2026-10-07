import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeServer } from "./server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

test("Step event streaming, MinIO screenshot proxy and device farm monitoring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sg-step-event-test-"));
  const token = "12345678901234567890123456789012";
  const signingKey = "abcdefabcdefabcdefabcdefabcdefab";
  const deviceTokens = { phone01: "phone01phone01phone01phone01phone01" };

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
    // 1. Test WebSocket connection to /events
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/events`);
    const receivedMessages: any[] = [];
    ws.on("message", (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // 2. Upload binary screenshot via /devices/screenshot-step
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const uploadRes = await fetch(`${baseUrl}/devices/screenshot-step`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
        "x-worker-id": "worker01",
        "x-device-id": "phone01",
        "x-session-id": "session-abc",
        "x-step": "12",
        "x-action": "input_text",
        "x-action-desc": encodeURIComponent("正在输入 Facebook 帖子正文"),
        "x-status": "running",
        "x-type": "post",
      },
      body: minimalPng,
    });

    assert.equal(uploadRes.status, 200);
    const uploadData: any = await uploadRes.json();
    assert.equal(uploadData.ok, true);
    assert.match(uploadData.imageKey, /^screenshots\/worker01\/phone01\/session-abc\/step_12\.webp$/);
    assert.equal(uploadData.event.step, 12);
    assert.equal(uploadData.event.actionDesc, "正在输入 Facebook 帖子正文");

    // 3. Test retrieving the screenshot via proxy route
    const screenshotRes = await fetch(`${baseUrl}/${uploadData.imageKey}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(screenshotRes.status, 200);
    assert.equal(screenshotRes.headers.get("content-type"), "image/webp");
    assert.equal(screenshotRes.headers.get("cache-control"), "public, max-age=31536000, immutable");
    const imgBytes = await screenshotRes.arrayBuffer();
    assert.ok(imgBytes.byteLength > 0);

    // 4. Test GET /devices/states
    const statesRes = await fetch(`${baseUrl}/devices/states`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(statesRes.status, 200);
    const statesData: any = await statesRes.json();
    assert.equal(statesData.ok, true);
    const device01 = statesData.devices.find((d: any) => d.deviceId === "phone01");
    assert.ok(device01);
    assert.equal(device01.step, 12);
    assert.equal(device01.status, "running");

    // 5. Verify WebSocket received the broadcasted event
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(receivedMessages.length >= 2, "Should receive init and step events");
    const stepEvt = receivedMessages.find((m) => m.type === "step");
    assert.ok(stepEvt);
    assert.equal(stepEvt.event.step, 12);
    assert.equal(stepEvt.event.imageKey, uploadData.imageKey);

    ws.close();
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
