import assert from "node:assert/strict";
import { isIP } from "node:net";

/** Call only after verifying the stream is owned by the pinned Serve daemon. */
export function diagnosticProxySource(line: string, sources: string[], destinations: string[]): string {
  assert.ok(Buffer.byteLength(line, "ascii") <= 106 && /^[\x20-\x7e]+$/.test(line));
  const parts = line.split(" ");
  assert.ok(parts.length === 6 && parts[0] === "PROXY" && ["TCP4", "TCP6"].includes(parts[1]!));
  const source = parts[2]!;
  assert.ok(isIP(source) === (parts[1] === "TCP4" ? 4 : 6) && sources.includes(source));
  assert.ok(isIP(parts[3]!) === isIP(source) && destinations.includes(parts[3]!));
  assert.match(parts[4]!, /^\d{1,5}$/);
  assert.ok(Number(parts[4]) >= 1 && Number(parts[4]) <= 65535);
  // Serve retains the Tailnet destination address but uses its target port.
  assert.equal(parts[5], "4343");
  return source;
}
