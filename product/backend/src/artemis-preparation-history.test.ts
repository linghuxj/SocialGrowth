import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { artemisPreparationAssignmentSchema, executionLibraryVersion } from "@socialgrowth/product-contracts";
import { legacyArtemisPreparationAssignmentSchema, readArtemisPreparationHistory } from "./artemis-preparation-history.js";

test("immutable legacy assignment is readable only through the history decoder with its original fingerprint", () => {
  const raw = { taskId: randomUUID(), taskVersion: 0, taskAttemptId: randomUUID(), serial: "SYNTHETIC_READ_ONLY",
    input: { protocolVersion: executionLibraryVersion, projectId: randomUUID(), deviceId: randomUUID(), accountId: randomUUID(),
      parentLoginRef: "legacyDeclaredParentRef", mode: "check_only", target: { platform: "facebook", name: "Synthetic Page", expectedId: null,
        category: null, description: "" }, requestedScope: { scopeRef: "synthetic_scope", allowTrustedInstall: false, allowIdentityCreation: false },
      facts: { version: 1, currentScopeMatches: true, unresolvedDeviceTask: false, boundIdentityId: null, priorCreation: "none",
        app: { state: "unknown", evidenceRef: null }, login: { state: "unknown", evidenceRef: null },
        identity: { state: "unknown", observedId: null, observedName: null, kind: null, managementVerified: false, evidenceRef: null } } },
    operationId: "inspect_app" };
  const fingerprint = createHash("sha256").update(JSON.stringify(legacyArtemisPreparationAssignmentSchema.parse(raw))).digest("hex");
  assert.equal(artemisPreparationAssignmentSchema.safeParse(raw).success, false);
  const historical = readArtemisPreparationHistory(raw, fingerprint);
  assert.equal(historical.legacyParentRef, true);
  assert.equal(historical.assignment.taskId, raw.taskId);
  assert.throws(() => readArtemisPreparationHistory({ ...raw, input: { ...raw.input, parentLoginRef: "other" } }, fingerprint));
});
