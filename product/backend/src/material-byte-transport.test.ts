import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { readMaterialByteStream, MaterialByteTransportError, materialHttpMaxBytes } from "./material-byte-transport.js";
const code = (expected: string) => (e: unknown) => e instanceof MaterialByteTransportError && e.code === expected && !e.cause;
test("raw byte stream copies offset buffers and preserves explicit chunk order", async () => {
  const backing = Buffer.from("_first_"), first = backing.subarray(1, 6);
  const source = Readable.from((async function* () { yield first; await new Promise<void>(resolve => setImmediate(resolve)); first.fill(0); yield Buffer.from("second"); })());
  assert.deepEqual(await readMaterialByteStream(source, 11), Buffer.from("firstsecond"));
});
test("invalid bounds, incomplete body, excess body and string chunks never return successful bytes", async () => {
  for (const size of [0, -1, 1.5, materialHttpMaxBytes + 1]) await assert.rejects(readMaterialByteStream(Readable.from([]), size), code("INVALID_BYTES"));
  await assert.rejects(readMaterialByteStream(Readable.from([Buffer.from("a")]), 2), code("INCOMPLETE_BYTES"));
  await assert.rejects(readMaterialByteStream(Readable.from([Buffer.from("ab")]), 1), code("INVALID_BYTES"));
  await assert.rejects(readMaterialByteStream(Readable.from(["a"]), 1), code("INVALID_BYTES"));
});
test("stalled stream has bounded total read time and closes transport without successful body", async () => {
  const source = new Readable({ read() {} });
  await assert.rejects(readMaterialByteStream(source, 1, 16, 20), code("BODY_TIMEOUT")); assert.equal(source.destroyed, true);
});
test("raw source abort is a safe incomplete result without source exception details", async () => {
  const source = new Readable({ read() { this.destroy(new Error("synthetic-private-body-detail")); } });
  await assert.rejects(readMaterialByteStream(source, 1), code("INCOMPLETE_BYTES"));
});
test("monotonic deadline also refuses bytes after event-loop delay rather than trusting timer callback ordering", async () => {
  const source = new Readable({ read() { this.push(Buffer.from("a")); const until = performance.now() + 25; while (performance.now() < until) { /* Deliberate bounded CPU fixture. */ } this.push(null); } });
  await assert.rejects(readMaterialByteStream(source, 1, 16, 10), code("BODY_TIMEOUT"));
});
