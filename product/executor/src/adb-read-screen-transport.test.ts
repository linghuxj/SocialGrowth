import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, realpath, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { controlProtocolVersion, type PhoneActionRequest } from "@socialgrowth/product-contracts";
import { AdbReadScreenError, AdbReadScreenTransport, type AdbReadScreenBinding } from "./adb-read-screen-transport.js";
import { PhoneActionFence, PhoneFenceError, type PhoneFenceAuthority, type PhoneTransportTicket } from "./phone-action-fence.js";

// Real OS subprocesses with explicitly synthetic executable/pixels/authority.
// These component checks never invoke adb, SDK, a phone or platform operation.
function crc(v: Buffer): number {
  let c = 0xffffffff;
  for (const b of v) { c ^= b; for (let n = 0; n < 8; n++) c = (c & 1) ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function image(width = 2, height = 2): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk("IEND", Buffer.alloc(0))]);
}
async function fixture(body?: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "sg-adb-read-component-"))), binaryPath = join(dir, "synthetic-adb"), calls = join(dir, "calls.json");
  const png = image();
  const script = `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(calls)},JSON.stringify({argv:process.argv.slice(2),env:process.env}));\n${body ?? `process.stdout.write(Buffer.from('${png.toString("base64")}','base64'));`}\n`;
  await writeFile(binaryPath, script, { mode: 0o700 });
  const request: PhoneActionRequest = { protocolVersion: controlProtocolVersion, deviceId: randomUUID(), holderId: randomUUID(),
    authorizationId: randomUUID(), taskAttemptId: randomUUID(), controlGeneration: "1", purpose: "business", kind: "read_screen", actionId: randomUUID() };
  const { actionId: _a, kind: _k, ...identity } = request;
  const binding: AdbReadScreenBinding = { ...identity, serial: "SYNTHETIC_NOT_A_DEVICE", host: "127.0.0.1", port: 49199, binaryPath,
    binarySha256: createHash("sha256").update(script).digest("hex") };
  let now = Date.now();
  const ticket: PhoneTransportTicket = { ...request, serial: binding.serial, checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 2000).toISOString(), replayed: false };
  const transport = new AdbReadScreenTransport(binding, () => now);
  return { dir, png, binaryPath, calls, request, binding, ticket, transport, advance(n: number) { now += n; },
    async called() { try { return JSON.parse(await readFile(calls, "utf8")) as { argv: string[]; env: Record<string, string> }; } catch { return null; } },
    async cleanup() { await rm(dir, { recursive: true, force: true }); } };
}
const error = (code: AdbReadScreenError["code"]) => (e: unknown) => e instanceof AdbReadScreenError && e.code === code && e.cause === undefined;

test("read transport passes only fixed endpoint/serial/screencap argv, excludes ambient secrets, and returns validated bytes", async () => {
  const f = await fixture(), old = process.env.SG_COMPONENT_PRIVATE;
  try {
    process.env.SG_COMPONENT_PRIVATE = "synthetic-secret-must-not-reach-child";
    const result = await f.transport.start(f.request, f.binding.serial, f.ticket), call = await f.called();
    assert.deepEqual(result.png, f.png); assert.equal(result.width, 2); assert.equal(result.height, 2);
    assert.equal(result.sha256, createHash("sha256").update(f.png).digest("hex"));
    assert.deepEqual(call?.argv, ["-H", "127.0.0.1", "-P", "49199", "-s", f.binding.serial, "exec-out", "screencap", "-p"]);
    assert.equal(call?.env.SG_COMPONENT_PRIVATE, undefined); assert.equal(call?.env.ADB_SERVER_SOCKET, "tcp:127.0.0.1:49199");
  } finally { if (old === undefined) delete process.env.SG_COMPONENT_PRIVATE; else process.env.SG_COMPONENT_PRIVATE = old; await f.cleanup(); }
});

test("wrong holder/attempt/generation/device/action/serial, non-read, injected fields, and replay tickets issue no subprocess", async () => {
  const f = await fixture();
  try {
    for (const patch of [{ holderId: randomUUID() }, { taskAttemptId: randomUUID() }, { deviceId: randomUUID() },
      { authorizationId: randomUUID() }, { controlGeneration: "2" }, { purpose: "operator_takeover" }, { kind: "navigate" }, { shell: "private" }]) {
      assert.throws(() => f.transport.start({ ...f.request, ...patch } as PhoneActionRequest, f.binding.serial, f.ticket), error("DENIED"));
    }
    for (const patch of [{ actionId: randomUUID() }, { serial: "other" }, { replayed: true }, { shell: "private" }]) {
      assert.throws(() => f.transport.start(f.request, f.binding.serial, { ...f.ticket, ...patch } as PhoneTransportTicket), error("DENIED"));
    }
    assert.throws(() => f.transport.start(f.request, "other", f.ticket), error("DENIED")); assert.equal(await f.called(), null);
  } finally { await f.cleanup(); }
});

test("future, expired, or over-two-second action permission refuses synchronous handoff", async () => {
  const f = await fixture();
  try {
    for (const patch of [{ checkedAt: new Date(Date.parse(f.ticket.checkedAt) + 1000).toISOString() },
      { validUntil: f.ticket.checkedAt }, { validUntil: new Date(Date.parse(f.ticket.checkedAt) + 2001).toISOString() }]) {
      assert.throws(() => f.transport.start(f.request, f.binding.serial, { ...f.ticket, ...patch }), error("DENIED"));
    }
    f.advance(2000); assert.throws(() => f.transport.start(f.request, f.binding.serial, f.ticket), error("DENIED"));
    assert.equal(await f.called(), null);
  } finally { await f.cleanup(); }
});

test("binary replacement or writable executable fails closed before a subprocess", async () => {
  const f = await fixture();
  try {
    await chmod(f.binaryPath, 0o777);
    assert.throws(() => new AdbReadScreenTransport(f.binding), error("INVALID_BOUNDARY"));
    await chmod(f.binaryPath, 0o700);
    await writeFile(f.binaryPath, "#!/bin/sh\nexit 0\n");
    assert.throws(() => f.transport.start(f.request, f.binding.serial, f.ticket), error("INVALID_BOUNDARY"));
    assert.throws(() => new AdbReadScreenTransport({ ...f.binding, binarySha256: "0".repeat(64) }), error("INVALID_BOUNDARY"));
    assert.equal(await f.called(), null);
  } finally { await f.cleanup(); }
});

test("truncated, wrong CRC, trailing bytes, empty output and headless PNG are never successful captures", async () => {
  const badCrc = image(); badCrc[badCrc.length - 1]! ^= 1;
  for (const png of [image().subarray(0, 30), badCrc, Buffer.concat([image(), Buffer.from("private")]), Buffer.alloc(0), image(1, 1)]) {
    const f = await fixture(`process.stdout.write(Buffer.from('${png.toString("base64")}','base64'));`);
    try { await assert.rejects(f.transport.start(f.request, f.binding.serial, f.ticket), error("READ_UNCONFIRMED")); }
    finally { await f.cleanup(); }
  }
});

test("nonzero exit cannot use valid-looking pixels or expose stderr, and over-limit output refuses", async () => {
  for (const body of [`process.stdout.write(Buffer.from('${image().toString("base64")}','base64'));process.stderr.write('synthetic-private-driver-output');process.exitCode=1;`,
    "process.stdout.write(Buffer.alloc(16*1024*1024+1));"]) {
    const f = await fixture(body);
    try { await assert.rejects(f.transport.start(f.request, f.binding.serial, f.ticket), error("READ_UNCONFIRMED")); }
    finally { await f.cleanup(); }
  }
});

test("timeout waits for child closure and valid-looking early output cannot be acknowledged as ended", async () => {
  const f = await fixture(`process.stdout.write(Buffer.from('${image().toString("base64")}','base64'));setInterval(()=>{},1000);`);
  try { const start = Date.now(); await assert.rejects(f.transport.start(f.request, f.binding.serial, f.ticket), error("READ_UNCONFIRMED")); assert.ok(Date.now() - start >= 2900); }
  finally { await f.cleanup(); }
});

test("real subprocess transport remains behind the durable fence; timeout occupies unknown across restart", async () => {
  const f = await fixture("setInterval(()=>{},1000);"), outcomes: string[] = [];
  const { actionId: _a, kind: _k, ...identity } = f.request;
  const grant = { ...identity, serial: f.binding.serial, leaseUntil: new Date(Date.now() + 30_000).toISOString(), allowedKinds: ["read_screen" as const] };
  const authority: PhoneFenceAuthority = {
    async verifyHolder() {}, async beginAction(r) { return { ...f.ticket, ...r }; },
    async recordActionOutcome(_r, status) { outcomes.push(status); },
    async inspectOriginalAction() { throw Error("No real evidence in component fixture"); },
    async inspectStopped(s) { return { deviceId: s.deviceId, serial: s.serial, stopRequestId: s.stopRequestId, controlGeneration: s.controlGeneration,
      evidenceId: randomUUID(), checkedAt: new Date().toISOString(), allPathsFenced: true, controllerReleased: true, targetQuiescent: true }; },
  };
  const path = join(f.dir, "fence.sqlite"), fence = new PhoneActionFence(path, f.request.deviceId, f.binding.serial, authority, f.transport);
  try {
    await assert.rejects(fence.execute(f.request), (e: unknown) => e instanceof PhoneFenceError && e.code === "DENIED");
    assert.equal(await f.called(), null);
    await fence.confirmStopped(); await fence.installHolder(grant);
    await assert.rejects(fence.execute(f.request), (e: unknown) => e instanceof PhoneFenceError && e.code === "UNKNOWN");
    assert.deepEqual(outcomes, ["unknown"]);
    const other = new PhoneActionFence(path, f.request.deviceId, f.binding.serial, authority, f.transport);
    try { other.requestStop(randomUUID()); await assert.rejects(other.confirmStopped()); assert.equal(other.snapshot().disposition, "stop_requested"); }
    finally { other.close(); }
  } finally { fence.close(); await f.cleanup(); }
});
