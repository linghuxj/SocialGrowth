import test from "node:test";
import assert from "node:assert/strict";
import { DiagnosticSourceUnavailable, requireLiveDiagnosticNode } from "./remote-adb-source-observation.mts";

test("temporary node availability is retryable without accepting changed identity or keys", () => {
  const pinned = { ID: 1234, Key: "synthetic-node-key", Online: true };
  requireLiveDiagnosticNode(pinned, pinned);
  for (const Online of [false, undefined])
    assert.throws(() => requireLiveDiagnosticNode({ ...pinned, Online }, pinned), DiagnosticSourceUnavailable);
  for (const changed of [{ ...pinned, ID: 9876, Online: false }, { ...pinned, Key: "replaced-key", Online: false }])
    assert.throws(() => requireLiveDiagnosticNode(changed, pinned), error => !(error instanceof DiagnosticSourceUnavailable));
  // A later live observation is usable; no cached offline observation is upgraded.
  requireLiveDiagnosticNode({ ...pinned, Online: true }, pinned);
});
