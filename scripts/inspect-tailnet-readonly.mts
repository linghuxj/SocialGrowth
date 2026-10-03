import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectTailnet, readTailnetInspectionConfiguration, TailnetInspectionError } from "../product/backend/src/tailnet-readonly-inspection.js";

// Operator resource inspection, not UI/phone acceptance. No external mutation.
assert.equal(process.env.SG_PRODUCT_TAILNET_INSPECTION, "authorized");
const output = resolve(process.env.SOCIALGROWTH_VERIFICATION_OUTPUT ?? "artifacts/acceptance/product/B3/tailnet-source-20261003");
await mkdir(output, { recursive: true, mode: 0o700 });
let result: object;
try {
  const config = await readTailnetInspectionConfiguration(resolve(process.env.SG_PRODUCT_TAILNET_CONFIG ?? ".runtime/tailnet-control/read-only-oauth.json"));
  result = await inspectTailnet(config);
} catch (error) {
  result = { checkedAt: new Date().toISOString(), code: error instanceof TailnetInspectionError ? error.code : "INSPECTION_UNAVAILABLE",
    actualApiInspectionPassed: false, externalMutationPerformed: false, isolationVerified: false,
    networkAdmissionGranted: false, actionPermissionGranted: false };
  process.exitCode = 2;
}
await writeFile(resolve(output, "control-plane-inspection.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
