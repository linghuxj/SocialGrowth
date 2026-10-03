import assert from "node:assert/strict";
import { mkdir, lstat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openTailnetReadOnlySession, readTailnetInspectionConfiguration, TailnetInspectionError } from "../product/backend/src/tailnet-readonly-inspection.js";
import { buildRestrictedProposal, TailnetProposalError } from "../product/backend/src/tailnet-restricted-proposal.js";
import { TailscaleCliWhoIs, tailnetAddress, readTailnetNode, readTailnetNodeIdentity, type TailnetObservedNode } from "../product/backend/src/tailscale-source-verifier.js";

assert.equal(process.env.SG_PRODUCT_TAILNET_PROPOSAL, "authorized");
const pendingIp = tailnetAddress(process.env.SG_PRODUCT_TAILNET_SOURCE_IP ?? "");
const verifierIp = tailnetAddress(process.env.SG_PRODUCT_TAILNET_VERIFIER_IP ?? "");
assert.ok(pendingIp && verifierIp && pendingIp !== verifierIp);
const verifierPort = Number(process.env.SG_PRODUCT_TAILNET_VERIFIER_PORT ?? "9443");
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/tailnet-proposal-20261003");
await mkdir(output, { recursive: true, mode: 0o700 });
let stage = "configuration", result: object;
try {
  const root = resolve(".runtime/tailnet-control"), stat = await lstat(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.());
  const config = await readTailnetInspectionConfiguration(resolve(root, "read-only-oauth.json"));
  stage = "readonly_source";
  const session = await openTailnetReadOnlySession(config);
  const original = await session.readPolicy(); assert.ok(original.etag);
  stage = "backup_version";
  const backup = await session.readPolicy(true); assert.equal(backup.etag, original.etag);
  stage = "inventory_scope";
  const devices = await session.readDevices(); assert.equal(devices.length, 2);
  const addresses = devices.map(d => {
    assert.ok(Array.isArray(d.addresses) && d.addresses.length > 0);
    const normalized = (d.addresses as unknown[]).map(v => typeof v === "string" ? tailnetAddress(v) : null);
    assert.ok(normalized.every(v => v !== null)); return normalized as string[];
  });
  const pending = addresses.filter(v => v.includes(pendingIp)), verifier = addresses.filter(v => v.includes(verifierIp));
  assert.equal(pending.length, 1); assert.equal(verifier.length, 1); assert.notDeepEqual(pending, verifier);
  const cli = new TailscaleCliWhoIs("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  const nodes = [];
  for (const ips of [pending[0]!, verifier[0]!]) {
    stage = nodes.length ? "verifier_local_identity" : "pending_local_identity";
    let node: ReturnType<typeof readTailnetNode> = null;
    for (const ip of ips) {
      const raw = await cli.lookup(ip, AbortSignal.timeout(3000));
      const current: TailnetObservedNode | null = nodes.length ? readTailnetNodeIdentity(raw, ip) : readTailnetNode(raw, ip); assert.ok(current);
      if (node) assert.deepEqual(current, node); node = current;
    }
    nodes.push(node!);
  }
  assert.notEqual(nodes[0]!.nodeId, nodes[1]!.nodeId);
  stage = "proposal";
  const proposal = buildRestrictedProposal(original.text, { pendingAddresses: pending[0]!, verifierAddresses: verifier[0]!,
    preservedAddresses: verifier[0]!, verifierPort });
  const directory = resolve(root, `proposal-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  for (const [name, contents] of [["original.json", original.text], ["original.hujson", backup.text], ["candidate.hujson", proposal.text]])
    await writeFile(resolve(directory, name!), contents!, { mode: 0o600, flag: "wx" });
  stage = "official_policy_validation";
  const validation = await session.validatePolicy(proposal.text,
    body => writeFile(resolve(directory, "validation-private.json"), body, { mode: 0o600, flag: "wx" }));
  stage = "concurrent_policy_check";
  const after = await session.readPolicy();
  const livePolicyUnchanged = after.sha256 === original.sha256 && after.etag === original.etag;
  result = { checkedAt: new Date().toISOString(), ...proposal.summary, originalEtag: original.etag,
    officialValidation: validation, livePolicyUnchanged, privateReviewDirectory: directory,
    sourceNodesObserved: nodes.map(v => v.nodeId), deploymentReady: false,
    pendingRequirements: ["trusted_verifier_listener_acceptance", "controlled_policy_write_and_approval", "actual_restricted_path_checks", "server_owned_network_revision"],
    evidenceScope: "actual_readonly_control_plane_validation_not_live_network_acceptance" };
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
  if (!validation.passed || validation.warningCount > 0 || !livePolicyUnchanged) process.exitCode = 2;
} catch (error) {
  result = { checkedAt: new Date().toISOString(), stage,
    code: error instanceof TailnetInspectionError ? error.code : error instanceof TailnetProposalError ? error.message : "PROPOSAL_UNAVAILABLE",
    proposalValidationPassed: false, externalMutationPerformed: false, isolationVerified: false,
    networkAdmissionGranted: false, actionPermissionGranted: false };
  process.exitCode = 2;
}
await writeFile(resolve(output, "restricted-policy-proposal.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
