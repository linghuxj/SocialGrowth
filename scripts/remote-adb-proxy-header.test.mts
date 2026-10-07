import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticProxySource } from "./remote-adb-proxy-header.mts";

test("pinned Serve source accepts its actual forwarding destination port, rejects external or spoofed tuples", () => {
  const source = "100.118.89.89", destination = "100.75.25.72";
  const parse = (line: string) => diagnosticProxySource(line, [source], [destination]);
  assert.equal(parse(`PROXY TCP4 ${source} ${destination} 34428 4343`), source);
  for (const line of [
    `PROXY TCP4 ${source} ${destination} 34428 8443`,
    `PROXY TCP4 100.118.89.90 ${destination} 34428 4343`,
    `PROXY TCP4 ${source} 127.0.0.1 34428 4343`,
    `PROXY TCP4 ${source} ${destination} 0 4343`,
    `PROXY TCP4 ${source} ${destination} 65536 4343`,
    `PROXY TCP6 ${source} ${destination} 34428 4343`,
    `PROXY TCP4 ${source} ${destination} 34428 4343\r\nspoof`,
  ]) assert.throws(() => parse(line));
});
