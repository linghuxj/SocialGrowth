import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";

export const tailnetReadOnlyScopes = ["policy_file:read", "devices:core:read", "devices:posture_attributes:read"] as const;
const safeCredential = (v: string) => !/\s/.test(v) && [...v].every(c => c.charCodeAt(0) >= 32);
const configurationSchema = z.strictObject({
  tailnet: z.string().regex(/^(?:-|[A-Za-z0-9_.@-]{1,200})$/),
  clientId: z.string().min(1).max(256).refine(safeCredential),
  clientSecret: z.string().min(20).max(512).refine(safeCredential),
});
type Configuration = z.infer<typeof configurationSchema>;
export class TailnetInspectionError extends Error {
  constructor(readonly code: "CONFIGURATION_UNAVAILABLE" | "OAUTH_UNAVAILABLE" | "POLICY_UNAVAILABLE" | "DEVICES_UNAVAILABLE") { super(code); }
}

/** Same descriptor for stat/read. Private owner-only regular file, no symlink,
 * no environment/CLI secrets and no raw configuration errors in outputs.
 */
export async function readTailnetInspectionConfiguration(path: string): Promise<Configuration> {
  try {
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096 || stat.uid !== process.getuid?.()) throw new Error();
      return configurationSchema.parse(JSON.parse(await fd.readFile("utf8")));
    } finally { await fd.close(); }
  } catch { throw new TailnetInspectionError("CONFIGURATION_UNAVAILABLE"); }
}

type FetchPort = typeof fetch;
/** Static hints only. No selector expansion, actual path tests or permission
 * evidence; absence of a recognizable broad rule never proves isolation.
 */
export function inspectPolicyBreadth(text: string) {
  const unknown = { assessment: "unparsed_or_unsupported" as const, aclRuleCount: null, grantRuleCount: null,
    broadNetworkRuleCount: null, unconditionalBroadNetworkRuleCount: null, additiveRestrictionMayBeBlocked: true, isolationVerified: false };
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return unknown;
    const p = value as Record<string, unknown>;
    const acls = p.acls ?? [], grants = p.grants ?? [];
    if (!Array.isArray(acls) || !Array.isArray(grants)) return unknown;
    const includes = (v: unknown, entry: string) => Array.isArray(v) && v.includes(entry);
    const validRule = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    if (!acls.every(validRule) || !grants.every(validRule)) return unknown;
    const broadAcl = acls.filter(r => r.action === "accept" && includes(r.src, "*") && includes(r.dst, "*:*") && r.proto === undefined);
    const broadGrant = grants.filter(r => includes(r.src, "*") && includes(r.dst, "*") && includes(r.ip, "*"));
    const broad = broadAcl.length + broadGrant.length;
    const unconditional = broadAcl.filter(r => Object.keys(r).every(k => ["action", "src", "dst"].includes(k))).length
      + broadGrant.filter(r => Object.keys(r).every(k => ["src", "dst", "ip", "app"].includes(k))).length;
    return { assessment: broad ? "broad_network_rule_present" as const : "no_broad_rule_detected" as const,
      aclRuleCount: acls.length, grantRuleCount: grants.length, broadNetworkRuleCount: broad, unconditionalBroadNetworkRuleCount: unconditional,
      additiveRestrictionMayBeBlocked: broad > 0, isolationVerified: false };
  } catch { return unknown; }
}
async function limitedBody(response: Response, maximumBytes: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > maximumBytes) throw new Error();
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Read-only control-plane inventory. OAuth POST only exchanges credentials;
 * fixed subsequent paths are GET. No keys/devices/tags/policy modifications.
 * Policy hash/ETag is an inventory fact, not the product's networkRevision or
 * evidence that any required/forbidden path is actually enforced.
 */
export async function inspectTailnet(configuration: Configuration, request: FetchPort = fetch) {
  const parsed = configurationSchema.safeParse(configuration);
  if (!parsed.success) throw new TailnetInspectionError("CONFIGURATION_UNAVAILABLE");
  const config = parsed.data;
  const signal = AbortSignal.timeout(10_000);
  let token: string;
  try {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId,
      client_secret: config.clientSecret, scope: tailnetReadOnlyScopes.join(" ") });
    const response = await request("https://api.tailscale.com/api/v2/oauth/token", {
      method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", signal,
    });
    const raw = JSON.parse(await limitedBody(response, 16384)) as Record<string, unknown>;
    if (typeof raw.access_token !== "string" || !/^[A-Za-z0-9_.-]{20,4096}$/.test(raw.access_token)
      || raw.token_type !== "Bearer" || !Number.isSafeInteger(raw.expires_in) || Number(raw.expires_in) < 30) throw new Error();
    // The requested token must be demonstrably read-only. Do not silently accept
    // a broader/unknown token scope or infer it from a successful policy GET.
    if (typeof raw.scope !== "string") throw new Error();
    const granted = new Set(raw.scope.split(" ").filter(Boolean));
    if (granted.size !== tailnetReadOnlyScopes.length || tailnetReadOnlyScopes.some(s => !granted.has(s))) throw new Error();
    token = raw.access_token;
  } catch { throw new TailnetInspectionError("OAUTH_UNAVAILABLE"); }
  const prefix = `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(config.tailnet)}`;
  const options = { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error" as const, signal };
  let policy: string, policyEtag: string | null;
  try {
    const response = await request(`${prefix}/acl`, options);
    policy = await limitedBody(response, 1_048_576);
    if (!policy.trim()) throw new Error();
    const etag = response.headers.get("etag");
    policyEtag = etag && etag.length <= 256 && /^[\x20-\x7e]+$/.test(etag) ? etag : null;
  } catch { throw new TailnetInspectionError("POLICY_UNAVAILABLE"); }
  let deviceCount: number, registeredExitNodeCandidates: number | null, enabledExitNodes: number | null;
  try {
    const response = await request(`${prefix}/devices`, options);
    const raw = JSON.parse(await limitedBody(response, 2_097_152)) as Record<string, unknown>;
    if (!Array.isArray(raw.devices) || raw.devices.some(v => !v || typeof v !== "object" || Array.isArray(v))) throw new Error();
    deviceCount = raw.devices.length;
    const hasDefaultRoute = (routes: unknown) => Array.isArray(routes) && (routes.includes("0.0.0.0/0") || routes.includes("::/0"));
    // Core inventory can omit route fields. Missing data is unknown, never zero.
    registeredExitNodeCandidates = raw.devices.every(v => Array.isArray((v as Record<string, unknown>).advertisedRoutes))
      ? raw.devices.filter(v => hasDefaultRoute((v as Record<string, unknown>).advertisedRoutes)).length : null;
    enabledExitNodes = raw.devices.every(v => Array.isArray((v as Record<string, unknown>).enabledRoutes))
      ? raw.devices.filter(v => hasDefaultRoute((v as Record<string, unknown>).enabledRoutes)).length : null;
  } catch { throw new TailnetInspectionError("DEVICES_UNAVAILABLE"); }
  return {
    checkedAt: new Date().toISOString(), requestedScopes: [...tailnetReadOnlyScopes],
    policySha256: createHash("sha256").update(policy).digest("hex"), policyEtag, deviceCount,
    registeredExitNodeCandidates, enabledExitNodes,
    policyBreadth: inspectPolicyBreadth(policy),
    policyRead: true, devicesRead: true, externalMutationPerformed: false,
    isolationVerified: false, networkAdmissionGranted: false, actionPermissionGranted: false,
  };
}
