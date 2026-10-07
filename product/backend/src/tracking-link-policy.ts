import { isIP } from "node:net";
import { z } from "zod";
import { uuidSchema } from "@socialgrowth/product-contracts";

export class TrackingLinkError extends Error {
  constructor(readonly code: "CONFIGURATION_REQUIRED" | "INPUT_INVALID" | "NOT_FOUND" | "RECORD_ID_REUSED" | "UNAVAILABLE", readonly retryable = false) { super(code); }
}
const policySchema = z.strictObject({ revision: uuidSchema, allowedOrigins: z.array(z.string().min(1).max(2048)).min(1).max(100) });
const forbiddenQuery = /^(?:access_token|refresh_token|token|password|secret|api_key|authorization|credential|signature|x-amz-.+|x-goog-.+)$/i;
// Explicit server-owned HTTPS origin allowlist. No URL fetch/DNS probe, client
// override, external auth or inferred platform clickability. Empty means closed.
export class TrackingLinkPolicy {
  #revision: string;
  #origins: ReadonlySet<string>;
  constructor(input: unknown) {
    const parsed = policySchema.safeParse(input);
    if (!parsed.success) throw new TrackingLinkError("CONFIGURATION_REQUIRED");
    const origins = parsed.data.allowedOrigins.map(raw => {
      const u = this.parse(raw, "CONFIGURATION_REQUIRED");
      if (u.href !== `${u.origin}/`) throw new TrackingLinkError("CONFIGURATION_REQUIRED");
      return u.origin;
    });
    if (new Set(origins).size !== origins.length) throw new TrackingLinkError("CONFIGURATION_REQUIRED");
    this.#revision = parsed.data.revision.toLowerCase(); this.#origins = new Set(origins);
  }
  get revision(): string { return this.#revision; }
  private parse(raw: unknown, code: "INPUT_INVALID" | "CONFIGURATION_REQUIRED"): URL {
    if (typeof raw !== "string" || raw.length > 2048 || !/^https:\/\//i.test(raw) || /[\s\\]/u.test(raw)) throw new TrackingLinkError(code);
    let u: URL;
    try { u = new URL(raw); } catch { throw new TrackingLinkError(code); }
    const host = u.hostname;
    if (u.protocol !== "https:" || u.username || u.password || isIP(host) || host.startsWith("[")
      || !host.includes(".") || host.endsWith(".") || /(?:^|\.)(?:localhost|local|internal|test)$/i.test(host)
      || [...u.searchParams.keys()].some(k => forbiddenQuery.test(k))) throw new TrackingLinkError(code);
    return u;
  }
  target(input: unknown): string {
    const u = this.parse(input, "INPUT_INVALID");
    if (!this.#origins.has(u.origin)) throw new TrackingLinkError("INPUT_INVALID");
    return u.href;
  }
}

export const trackingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
// Conservative known prefetch signal only; absence is NOT evidence of a human.
// Do not retain raw headers/UA/IP/referrer or trust query attribution claims.
export function recognizedTrackingPrefetch(secPurpose: unknown): boolean {
  return typeof secPurpose === "string" && /^prefetch(?:;[\t ]*prerender)?$/i.test(secPurpose.trim());
}
