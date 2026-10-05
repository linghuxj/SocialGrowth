import assert from "node:assert/strict";
import test from "node:test";
import { accountPreparationInputSchema, executionLibraryVersion, preparationExecutionLibrary, type AccountPreparationInput } from "@socialgrowth/product-contracts";
import { planAccountPreparation, preparationInstructions } from "./account-preparation-plan.js";

function input(): AccountPreparationInput {
  return accountPreparationInputSchema.parse({ protocolVersion: executionLibraryVersion,
    projectId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "33333333-3333-4333-8333-333333333333",
    mode: "prepare_if_missing",
    target: { platform: "facebook", name: "Authorized Page", expectedId: null, category: "Entertainment", description: "Authorized business" },
    requestedScope: { scopeRef: "initialization-scope", allowTrustedInstall: true, allowIdentityCreation: true },
    facts: { version: 1, currentScopeMatches: true, unresolvedDeviceTask: false, boundIdentityId: null, priorCreation: "none",
      app: { state: "ready", evidenceRef: "app-observation" }, login: { state: "verified", evidenceRef: "parent-observation" },
      identity: { state: "missing", evidenceRef: "absence-observation", observedId: null, observedName: null, kind: null, managementVerified: false } },
  });
}
test("preparation checks app then parent then publishing identity; registration alone is not readiness", () => {
  const v = input();
  v.facts.app = { state: "unknown", evidenceRef: null };
  v.facts.login = { state: "unknown", evidenceRef: null };
  v.facts.identity.state = "unknown"; v.facts.identity.evidenceRef = null;
  assert.equal(planAccountPreparation(v).operationId, "inspect_app");
  v.facts.app = { state: "missing", evidenceRef: "app-absence" };
  assert.equal(planAccountPreparation(v).operationId, "ensure_trusted_app");
  v.facts.app = { state: "ready", evidenceRef: "app-observation" };
  assert.equal(planAccountPreparation(v).operationId, "verify_parent_login");
  v.facts.login = { state: "logged_out", evidenceRef: "login-observation" };
  assert.equal(planAccountPreparation(v).operationId, "assist_existing_login");
  v.facts.login = { state: "verified", evidenceRef: "parent-observation" };
  assert.equal(planAccountPreparation(v).operationId, "inspect_publishing_identity");
});
test("missing Page/channel selects creation only with exact prerequisite inputs", () => {
  const v = input(); assert.equal(planAccountPreparation(v).operationId, "create_facebook_page");
  if (v.target.platform === "facebook") v.target.category = null;
  assert.equal(planAccountPreparation(v).reason, "PAGE_CATEGORY_REQUIRED");
  v.target = { platform: "youtube", name: "Authorized Channel", expectedId: null, handle: null };
  assert.equal(planAccountPreparation(v).reason, "CHANNEL_HANDLE_REQUIRED");
  v.target.handle = "@authorized-channel";
  assert.equal(planAccountPreparation(v).operationId, "create_youtube_channel");
});
test("check-only and separate install/creation scopes cannot become creation authority", () => {
  const v = input(); v.mode = "check_only";
  assert.equal(planAccountPreparation(v).operationId, null);
  v.mode = "prepare_if_missing"; v.requestedScope.allowIdentityCreation = false;
  assert.equal(planAccountPreparation(v).reason, "IDENTITY_CREATION_SCOPE_REQUIRED");
  v.facts.app.state = "missing"; v.requestedScope.allowTrustedInstall = false;
  assert.equal(planAccountPreparation(v).reason, "APP_INSTALLATION_SCOPE_REQUIRED");
});
test("unknown device task, unknown or prior creation never lead to another creation", () => {
  const v = input(); v.facts.unresolvedDeviceTask = true;
  assert.equal(planAccountPreparation(v).state, "requires_reconciliation");
  v.facts.unresolvedDeviceTask = false;
  for (const state of ["unresolved", "reported", "verified"] as const) {
    v.facts.priorCreation = state;
    const p = planAccountPreparation(v);
    assert.equal(p.state, "requires_reconciliation"); assert.equal(p.operationId, null);
  }
});
test("existing binding and missing expected identity require review, not replacement", () => {
  const v = input(); v.facts.boundIdentityId = "123456789";
  assert.equal(planAccountPreparation(v).reason, "BOUND_IDENTITY_MUST_BE_PRESERVED");
  v.target.expectedId = "123456789";
  assert.equal(planAccountPreparation(v).reason, "EXPECTED_IDENTITY_MISSING");
  v.facts.boundIdentityId = null;
  assert.equal(planAccountPreparation(v).reason, "EXPECTED_IDENTITY_MISSING");
});
test("account mismatch, ambiguity or changed allocation stop before creation", () => {
  const v = input(); v.facts.currentScopeMatches = false;
  assert.equal(planAccountPreparation(v).reason, "CURRENT_SCOPE_MISMATCH");
  v.facts.currentScopeMatches = true; v.facts.login.state = "mismatch";
  assert.equal(planAccountPreparation(v).reason, "PARENT_LOGIN_MISMATCH");
  v.facts.login.state = "verified"; v.facts.identity.state = "ambiguous";
  assert.equal(planAccountPreparation(v).reason, "IDENTITY_REQUIRES_CLARIFICATION");
});
test("creation report requires separate readback; valid existing identity is reused", () => {
  const v = input(); v.facts.identity.state = "reported";
  assert.equal(planAccountPreparation(v).operationId, "verify_publishing_identity");
  v.facts.identity = { state: "verified", observedId: "123456789", observedName: v.target.name,
    kind: "facebook_page", managementVerified: true, evidenceRef: "management-observation" };
  const p = planAccountPreparation(v);
  assert.equal(p.state, "reported_ready"); assert.equal(p.operationId, null);
  assert.equal(p.executionAllowed, false); assert.equal(p.publicationAllowed, false);
  v.facts.identity.kind = "youtube_channel";
  assert.equal(planAccountPreparation(v).state, "needs_human");
  v.facts.identity.kind = "facebook_page"; v.facts.identity.observedName = "Other Page";
  assert.equal(planAccountPreparation(v).state, "needs_human");
  v.facts.identity.observedName = v.target.name; v.target.expectedId = "987654321";
  assert.equal(planAccountPreparation(v).state, "needs_human");
});
test("unsubstantiated readiness and extra action/secret fields are rejected", () => {
  const v = input(); v.facts.identity.evidenceRef = null;
  assert.throws(() => planAccountPreparation(v));
  v.facts.identity.evidenceRef = "absence-observation"; v.facts.identity.state = "verified";
  assert.throws(() => planAccountPreparation(v));
  assert.throws(() => planAccountPreparation({ ...input(), executionAllowed: true }));
  assert.throws(() => planAccountPreparation({ ...input(), password: "not-a-real-password" }));
  const contradictory = input(); contradictory.facts.identity.observedId = "123456789";
  assert.throws(() => planAccountPreparation(contradictory));
});
test("all library operations are bounded Artemis instructions; browsing is optional", () => {
  assert.equal(new Set(preparationExecutionLibrary.map(o => o.id)).size, preparationExecutionLibrary.length);
  for (const o of preparationExecutionLibrary) assert.match(preparationInstructions(o.id), /current server permission/);
  assert.match(preparationInstructions("browse_feed"), /time\/content bounds/);
  assert.notEqual(planAccountPreparation(input()).operationId, "browse_feed");
});
