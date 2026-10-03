import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { tailnetAddress } from "./tailscale-source-verifier.js";

export interface RestrictedProposalScope {
  pendingAddresses: readonly string[];
  verifierAddresses: readonly string[];
  preservedAddresses: readonly string[];
  verifierPort: number;
}
export class TailnetProposalError extends Error {
  constructor() { super("POLICY_PROPOSAL_SCOPE_REJECTED"); }
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Review-only transformation of the known single default allow-all grant.
 * Freeze the current inventory; unknown/custom ACLs and overlapping addresses
 * require a separate review. Existing non-network sections/tests are preserved.
 * This does not issue credentials, apply policy, prove isolation, or manufacture
 * a product networkRevision from the control-plane ETag.
 */
export function buildRestrictedProposal(original: string, scope: RestrictedProposalScope) {
  try {
    if (!Number.isInteger(scope.verifierPort) || scope.verifierPort < 2 || scope.verifierPort > 65534) throw new Error();
    const normalize = (values: readonly string[]) => {
      if (!values.length || values.length > 256) throw new Error();
      const out = values.map(v => tailnetAddress(v));
      if (out.includes(null) || new Set(out).size !== out.length) throw new Error();
      return out as string[];
    };
    const pending = normalize(scope.pendingAddresses), verifier = normalize(scope.verifierAddresses), preserved = normalize(scope.preservedAddresses);
    if (pending.some(v => preserved.includes(v) || verifier.includes(v)) || verifier.some(v => !preserved.includes(v))) throw new Error();
    const raw: unknown = JSON.parse(original);
    if (!record(raw) || !Array.isArray(raw.grants) || raw.grants.length !== 1 || (raw.acls !== undefined && (!Array.isArray(raw.acls) || raw.acls.length))) throw new Error();
    const wide: unknown = raw.grants[0];
    if (!record(wide) || Object.keys(wide).sort().join(",") !== "dst,ip,src"
      || [wide.src, wide.dst, wide.ip].some(v => !Array.isArray(v) || v.length !== 1 || v[0] !== "*")) throw new Error();
    if (raw.tests !== undefined && !Array.isArray(raw.tests)) throw new Error();
    const selectors = (addresses: string[]) => addresses.map(v => `${v}/${isIP(v) === 4 ? 32 : 128}`);
    const dest = (address: string, port: string) => `${isIP(address) === 6 ? `[${address}]` : address}:${port}`;
    const otherNodes = preserved.filter(v => !verifier.includes(v));
    // Tailscale test destinations accept individual ports, not wildcard/ranges.
    // Match address families and protocol explicitly. These samples are policy
    // preflight, never exhaustive live denied-path evidence.
    const blockedPorts = [22, 53, 80, 443, 3000, 3100, 4318, 4320, 8443, 38299, 40925, 65535].filter(v => v !== scope.verifierPort);
    const sameFamily = (source: string, addresses: string[]) => addresses.filter(v => isIP(source) === isIP(v));
    const generatedTests = [
      ...pending.flatMap(src => [
        { src, proto: "tcp", accept: sameFamily(src, verifier).map(v => dest(v, String(scope.verifierPort))),
          deny: [...sameFamily(src, verifier).flatMap(v => blockedPorts.map(p => dest(v, String(p)))),
            ...sameFamily(src, otherNodes).flatMap(v => [22, 443, scope.verifierPort].map(p => dest(v, String(p)))),
            dest(isIP(src) === 4 ? "1.1.1.1" : "2606:4700:4700::1111", "443")] },
        { src, proto: "udp", deny: sameFamily(src, preserved).flatMap(v => [53, scope.verifierPort].map(p => dest(v, String(p)))) },
      ]),
      ...preserved.flatMap(src => ["tcp", "udp"].map(proto => ({ src, proto,
        accept: sameFamily(src, preserved).flatMap(v => [22, 443, scope.verifierPort].map(p => dest(v, String(p)))),
        deny: sameFamily(src, pending).flatMap(v => [...blockedPorts, scope.verifierPort].map(p => dest(v, String(p)))) }))),
    ];
    const candidate = { ...raw, grants: [
      { src: selectors(pending), dst: selectors(verifier), ip: [`tcp:${scope.verifierPort}`] },
      { src: selectors(preserved), dst: selectors(preserved), ip: ["*"] },
    ], tests: [...(raw.tests as unknown[] | undefined ?? []), ...generatedTests] };
    const text = JSON.stringify(candidate, null, 2) + "\n";
    return { text, summary: { originalSha256: hash(original), candidateSha256: hash(text),
      replacedUnconditionalBroadGrants: 1, candidateGrantCount: 2, existingTestsPreserved: (raw.tests as unknown[] | undefined)?.length ?? 0,
      generatedTestCount: generatedTests.length, pendingAddresses: pending, verifierAddresses: verifier, preservedAddresses: preserved,
      verifierPort: scope.verifierPort, inventoryFrozen: true, futureNodesRequireExplicitPolicy: true,
      policyTestScope: "sampled_ports_and_protocols_not_exhaustive_live_paths",
      externalMutationPerformed: false, isolationVerified: false, networkAdmissionGranted: false, actionPermissionGranted: false } };
  } catch { throw new TailnetProposalError(); }
}
