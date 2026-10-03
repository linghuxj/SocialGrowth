import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { TailscaleCliWhoIs, tailnetAddress, readTailnetNode } from "../product/backend/src/tailscale-source-verifier.js";

assert.equal(process.env.SG_PRODUCT_TAILNET_SOURCE_INSPECTION, "authorized");
const address = tailnetAddress(process.env.SG_PRODUCT_TAILNET_SOURCE_IP ?? "");
assert.ok(address);
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/tailnet-source-20261003");
await mkdir(output, { recursive: true, mode: 0o700 });
let result: object;
try {
  const cli = new TailscaleCliWhoIs(process.env.SG_PRODUCT_TAILSCALE_CLI ?? "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  const raw = await cli.lookup(address, AbortSignal.timeout(3000));
  const observed = readTailnetNode(raw, address); assert.ok(observed);
  result = { checkedAt: new Date().toISOString(), actualLocalApiLookupPassed: true,
    stableNodeId: observed.nodeId, publicNodeKeyDigest: createHash("sha256").update(observed.nodeKey).digest("hex"),
    actualIncomingSocketObserved: false, formalNetworkRevisionAvailable: false,
    networkAdmissionGranted: false, actionPermissionGranted: false, evidenceScope: "read_only_platform_observation" };
} catch {
  process.exitCode = 2;
  result = { checkedAt: new Date().toISOString(), actualLocalApiLookupPassed: false,
    networkAdmissionGranted: false, actionPermissionGranted: false, code: "SOURCE_INSPECTION_UNAVAILABLE" };
}
await writeFile(resolve(output, "local-api-source-inspection.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
