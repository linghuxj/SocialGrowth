import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { TrackingLinkError, TrackingLinkPolicy, recognizedTrackingPrefetch, trackingTokenSchema } from "./tracking-link-policy.js";
const code = (c: string) => (e: unknown) => e instanceof TrackingLinkError && e.code === c && !e.cause;
const config = () => ({ revision: randomUUID(), allowedOrigins: ["https://example.org", "https://shop.example.org:8443"] });
test("server-owned exact HTTPS origin policy normalizes URLs without deriving trust from a hostname suffix", () => {
  const p = new TrackingLinkPolicy(config());
  assert.equal(p.target("HTTPS://EXAMPLE.ORG/item?campaign=approved#product"), "https://example.org/item?campaign=approved#product");
  assert.equal(p.target("https://shop.example.org:8443/已有入口"), "https://shop.example.org:8443/%E5%B7%B2%E6%9C%89%E5%85%A5%E5%8F%A3");
  for (const u of ["https://example.org.evil.com/", "https://sub.example.org", "https://example.org:8443", "//example.org", "http://example.org", "javascript:alert(1)", "https://example.com"])
    assert.throws(() => p.target(u), code("INPUT_INVALID"));
});
test("credentials, signed URL keys, whitespace, backslash, local/IP hosts and malformed targets fail without echo", () => {
  const p = new TrackingLinkPolicy(config());
  for (const u of ["https://fixture-user:fixture-password@example.org", "https://example.org/?Access_Token=fixture-secret", "https://example.org/?X-Amz-Signature=fixture-secret",
    "https://example.org/?x-goog-credential=fixture-secret", "https://example.org/?password=fixture-secret", " https://example.org/", "https://example.org/\n", "https://example.org\\@evil.com/",
    "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://localhost", "https://api.local", "https://host.internal", "https://fixture.test", "https://example.org.", "https://", "https://example.org/" + "a".repeat(2048)])
    assert.throws(() => p.target(u), (e: unknown) => code("INPUT_INVALID")(e) && !String(e).includes("fixture-secret"));
});
test("configuration must be explicit, origin-only, canonical unique and defensively copied", () => {
  for (const v of [null, {}, { ...config(), allowedOrigins: [] }, { ...config(), revision: "not-uuid" }, { ...config(), grant: true },
    { ...config(), allowedOrigins: ["https://example.org/path"] }, { ...config(), allowedOrigins: ["https://example.org/#x"] },
    { ...config(), allowedOrigins: ["https://example.org", "https://EXAMPLE.ORG:443"] }, { ...config(), allowedOrigins: ["http://example.org"] }])
    assert.throws(() => new TrackingLinkPolicy(v), code("CONFIGURATION_REQUIRED"));
  const c = config(), p = new TrackingLinkPolicy({ ...c, revision: c.revision.toUpperCase() }); c.allowedOrigins[0] = "https://evil.com";
  assert.equal(p.revision, c.revision); assert.equal(p.target("https://example.org"), "https://example.org/");
  assert.ok(!JSON.stringify(p).includes("allowedOrigins"));
});
test("recognized prefetch only filters conservative whitelisted signals and never asserts a human or a source", () => {
  for (const v of ["prefetch", " prefetch ", "PREFETCH", "prefetch;prerender", "prefetch; prerender"]) assert.equal(recognizedTrackingPrefetch(v), true);
  for (const v of [null, undefined, {}, ["prefetch"], "", "prerender", "not-prefetch", "prefetching", "navigate", "prefetch; unknown", "prefetch, navigate"])
    assert.equal(recognizedTrackingPrefetch(v), false);
  assert.equal(trackingTokenSchema.safeParse("A".repeat(32)).success, true);
  for (const v of ["A".repeat(31), "A".repeat(33), "../escape", "a?target=evil", "A".repeat(31) + "/"]) assert.equal(trackingTokenSchema.safeParse(v).success, false);
});
