import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateIdentityVerification, type IdentityVerificationTarget } from "./identity-verification-core.js";

const now = new Date("2026-10-09T08:00:00Z");
function fixture() {
  const target: IdentityVerificationTarget = { taskId: randomUUID(), projectId: randomUUID(), accountId: randomUUID(), deviceId: randomUUID(),
    intentDigest: "a".repeat(64), loginIdentifier: "authorized@example.invalid", canonicalAccountRef: null,
    intent: { accountId: null, deviceId: null, mode: "check_only", scopeRef: "authorized_scope", allowTrustedInstall: false, allowIdentityCreation: false,
      target: { platform: "facebook", name: "Existing Page", expectedId: "123456789", category: null, description: "" } } };
  const receipt = { requestId: target.taskId, sourceJobId: randomUUID(), traceId: randomUUID(), intentDigest: target.intentDigest,
    projectId: target.projectId, accountId: target.accountId, deviceId: target.deviceId, platform: "facebook",
    observedLoginIdentifier: "AUTHORIZED@example.invalid", canonicalAccountRef: "987654321", canonicalIdentityRef: "123456789",
    observedName: "Existing Page", scopeRef: "authorized_scope", verifiedAt: "2026-10-09T07:59:00Z", screenshotSha256: "b".repeat(64),
    appReady: true, parentLoginVerified: true, managementVerified: true, identityCreated: false, noPublication: true };
  return { target, receipt };
}
test("trusted existing identity matches original scope, parent and Page independently", () => {
  const { target, receipt } = fixture();
  assert.equal(validateIdentityVerification(receipt, target, now).canonicalIdentityRef, "123456789");
  assert.equal(validateIdentityVerification({ ...receipt, platform: "youtube", canonicalIdentityRef: "UCabcdefghijklmnopqrstuv" },
    { ...target, intent: { ...target.intent, target: { platform: "youtube", name: "Existing Page", expectedId: null, handle: null } } }, now).platform, "youtube");
});
test("foreign, stale, incomplete, creation and asserted publication receipts cannot bind", () => {
  const { target, receipt } = fixture();
  const invalid = [
    { requestId: randomUUID() }, { projectId: randomUUID() }, { accountId: randomUUID() }, { deviceId: randomUUID() },
    { intentDigest: "c".repeat(64) }, { observedName: "Other Page" }, { canonicalIdentityRef: "111111111" },
    { scopeRef: "other_scope" }, { observedLoginIdentifier: "other@example.invalid" },
    { verifiedAt: "2026-10-08T07:00:00Z" }, { verifiedAt: "2026-10-09T09:00:00Z" },
    { managementVerified: false }, { parentLoginVerified: false }, { noPublication: false }, { identityCreated: true },
    { canonicalAccountRef: receipt.canonicalIdentityRef }, { screenshotSha256: "" }, { traceId: null },
  ];
  for (const change of invalid) assert.throws(() => validateIdentityVerification({ ...receipt, ...change }, target, now));
  assert.throws(() => validateIdentityVerification(receipt, { ...target, canonicalAccountRef: "222222222" }, now));
});
