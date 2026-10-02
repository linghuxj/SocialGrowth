import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { chmod, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ArtemisReadScreenBridge, ReadScreenBridgeError, readScreenBridgeVersion } from "./artemis-read-screen-bridge.js";
import { bridgeFixture } from "./read-screen-bridge-fixture.js";

function read(path: string, raw: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => { const socket = connect(path), parts: Buffer[] = []; socket.on("error", reject); socket.on("data", p => parts.push(p)); socket.on("end", () => resolve(Buffer.concat(parts))); socket.on("connect", () => socket.write(JSON.stringify(raw) + "\n")); });
}
function message(access: Awaited<ReturnType<typeof bridgeFixture>>["access"], requestId = randomUUID()) {
  return { version: readScreenBridgeVersion, requestId, token: access.token, scopeDigest: access.scopeDigest };
}
function header(data: Buffer): Record<string, unknown> { return JSON.parse(data.subarray(0, data.indexOf(10)).toString()); }
async function until(ready: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + 5000;
  while (!await ready()) { if (Date.now() >= end) throw Error("component marker unavailable"); await new Promise(r => setTimeout(r, 20)); }
}

test("private socket 0600 returns actual fenced capture; reusing original request never repeats transport", async () => {
  const f = await bridgeFixture();
  try {
    assert.equal((await lstat(f.access.socketPath)).mode & 0o777, 0o600);
    const request = message(f.access), first = await read(f.access.socketPath, request);
    assert.equal(header(first).status, "captured"); assert.deepEqual(first.subarray(first.indexOf(10) + 1), f.png);
    assert.equal(header(first).requestId, request.requestId); assert.equal(header(first).scopeDigest, f.access.scopeDigest);
    const replay = await read(f.access.socketPath, request); assert.equal(header(replay).status, "unavailable");
    assert.equal(await f.count(), 1); assert.deepEqual(f.outcomes, ["ended"]);
  } finally { await f.cleanup(); }
});

test("wrong token/scope/protocol, injected command/kind/device, malformed identity and oversized frame issue no call", async () => {
  const f = await bridgeFixture();
  try {
    for (const patch of [{ token: "0".repeat(64) }, { scopeDigest: "0".repeat(64) }, { version: "old" }, { command: "shell" }, { kind: "navigate" }, { deviceId: randomUUID() }, { requestId: "bad" }, { extra: "x".repeat(1100) }]) {
      assert.equal((await read(f.access.socketPath, { ...message(f.access), ...patch })).length, 0);
    }
    assert.equal(await f.count(), 0);
  } finally { await f.cleanup(); }
});

test("current stop refuses new IPC reads and does not turn unavailability into pixels", async () => {
  const f = await bridgeFixture();
  try { f.fence.requestStop(randomUUID()); const result = await read(f.access.socketPath, message(f.access)); assert.equal(header(result).status, "unavailable"); assert.equal(header(result).bytes, 0); assert.equal(await f.count(), 0); }
  finally { await f.cleanup(); }
});

test("loss of IPC response retains the original action; reconnect never causes another read", async () => {
  const f = await bridgeFixture("setTimeout(()=>process.stdout.write(Buffer.from('" + "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=" + "','base64')),250);"), request = message(f.access);
  try {
    await new Promise<void>((resolve, reject) => { const socket = connect(f.access.socketPath); socket.on("error", reject); socket.on("connect", () => {
      socket.write(JSON.stringify(request) + "\n"); void until(async () => await f.count() === 1).then(() => { socket.destroy(); resolve(); }, reject);
    }); });
    await until(() => f.outcomes.length === 1);
    const result = await read(f.access.socketPath, request); assert.equal(header(result).status, "unavailable"); assert.equal(await f.count(), 1); assert.deepEqual(f.outcomes, ["ended"]);
  } finally { await f.cleanup(); }
});

test("transport timeout returns no pixels, preserves unknown and does not grant stop confirmation", async () => {
  const f = await bridgeFixture("setInterval(()=>{},1000);");
  try {
    const response = await read(f.access.socketPath, message(f.access)); assert.equal(header(response).status, "unavailable"); assert.equal(header(response).bytes, 0);
    assert.deepEqual(f.outcomes, ["unknown"]); f.fence.requestStop(randomUUID()); await assert.rejects(f.fence.confirmStopped()); assert.equal(await f.count(), 1);
  } finally { await f.cleanup(); }
});

test("public parent or occupied socket path is refused without replacing files", async () => {
  const f = await bridgeFixture(), occupied = join(f.dir, "occupied");
  try {
    await writeFile(occupied, "synthetic-owner-file");
    assert.throws(() => new ArtemisReadScreenBridge(join(f.dir, "other.sock"), { ...f.scope, serial: "other" }, f.fence), ReadScreenBridgeError);
    assert.throws(() => new ArtemisReadScreenBridge(occupied, f.scope, f.fence), ReadScreenBridgeError);
    await chmod(f.dir, 0o755); assert.throws(() => new ArtemisReadScreenBridge(join(f.dir, "other.sock"), f.scope, f.fence), ReadScreenBridgeError); await chmod(f.dir, 0o700);
    assert.equal(await f.count(), 0);
  } finally { await chmod(f.dir, 0o700); await f.cleanup(); }
});

test("stop during in-flight capture preserves original outcome but does not deliver pixels to a stale scope", async () => {
  const f = await bridgeFixture("setTimeout(()=>process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=','base64')),250);");
  try {
    const pending = read(f.access.socketPath, message(f.access));
    await until(async () => await f.count() === 1); f.fence.requestStop(randomUUID());
    assert.equal(header(await pending).status, "unavailable"); assert.deepEqual(f.outcomes, ["ended"]); assert.equal(await f.count(), 1);
  } finally { await f.cleanup(); }
});
