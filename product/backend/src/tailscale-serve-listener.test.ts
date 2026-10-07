import assert from "node:assert/strict";
import test from "node:test";
import { parseServeProxySource, soleServeSocketOwner } from "./tailscale-serve-listener.js";
const src = "100.70.1.1", dst = "100.70.1.2";
const parse = (line: string) => parseServeProxySource(Buffer.from(line), [dst, "fd7a:115c:a1e0::2"], 4443);
test("trusted proxy framing supports IPv4/IPv6 with exact local destination/target port", () => {
  assert.equal(parse(`PROXY TCP4 ${src} ${dst} 54321 4443`), src);
  assert.equal(parse("PROXY TCP6 fd7a:115c:a1e0::1 fd7a:115c:a1e0::2 54321 4443"), "fd7a:115c:a1e0::1");
});
test("LAN, mixed family, unrelated destination/port, overlong/high-bit/injected lines fail closed", () => {
  for (const line of [`PROXY TCP4 192.168.1.1 ${dst} 54321 4443`, `PROXY TCP6 ${src} ${dst} 54321 4443`,
    `PROXY TCP4 ${src} 100.70.1.3 54321 4443`, `PROXY TCP4 ${src} ${dst} 0 4443`, `PROXY TCP4 ${src} ${dst} 65536 4443`,
    `PROXY TCP4 ${src} ${dst} 54321 4343`, `PROXY TCP4 ${src} ${dst} 54321 4443\r\nspoof`, "PROXY UNKNOWN", "x".repeat(107),
    `PROXY TCP4 ${src} ${dst} 54321 4443é`]) assert.equal(parse(line), null);
});
test("exact reverse socket tuple has one pinned owner; duplicate/foreign/stale socket ownership rejected", () => {
  const line = `n127.0.0.1:54321->127.0.0.1:4443`;
  assert.equal(soleServeSocketOwner(`p123\n${line}\np456\nn127.0.0.1:4443->127.0.0.1:54321`, 54321, 4443, "123"), true);
  for (const listing of [`p456\n${line}`, `p123\n${line}\np456\n${line}`, `p123\nn127.0.0.1:54322->127.0.0.1:4443`, line])
    assert.equal(soleServeSocketOwner(listing, 54321, 4443, "123"), false);
});
