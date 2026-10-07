import { accountPreparationInputSchema, executionLibraryVersion, type PreparationOperationId } from "./execution-library.js";

export interface AccountPreparationPlan {
  protocolVersion: typeof executionLibraryVersion;
  factVersion: number;
  state: "next_step" | "needs_human" | "requires_reconciliation" | "reported_ready";
  operationId: PreparationOperationId | null;
  reason: string;
  executionAllowed: false;
  publicationAllowed: false;
  pendingChecks: readonly string[];
}

// INTERNAL pure selector, not an HTTP command, scheduler or action permit.
// Input facts MUST be resolved centrally from authenticated evidence/current
// allocation. Operator/model-provided flags alone are never authority.
export function planAccountPreparation(raw: unknown): AccountPreparationPlan {
  const v = accountPreparationInputSchema.parse(raw), f = v.facts;
  const result = (state: AccountPreparationPlan["state"], reason: string, operationId: PreparationOperationId | null = null): AccountPreparationPlan => ({
    protocolVersion: executionLibraryVersion, factVersion: f.version, state, reason, operationId,
    executionAllowed: false, publicationAllowed: false,
    pendingChecks: ["current_authorization_and_allocation", "authenticated_current_evidence", "device_participation_and_exclusive_control", "every_action_physical_fence", "durable_original_attempt_journal"],
  });
  const next = (id: PreparationOperationId) => result("next_step", "CHECK_NEXT_PREREQUISITE", id);
  if (!f.currentScopeMatches) return result("needs_human", "CURRENT_SCOPE_MISMATCH");
  if (f.unresolvedDeviceTask || f.priorCreation === "unresolved") return result("requires_reconciliation", "VERIFY_ORIGINAL_ATTEMPT");
  if (f.boundIdentityId !== null && f.boundIdentityId !== v.target.expectedId) return result("needs_human", "BOUND_IDENTITY_MUST_BE_PRESERVED");
  if (f.app.state === "unknown") return next("inspect_app");
  if (f.app.state === "unusable") return result("needs_human", "APP_NOT_USABLE");
  if (f.app.state === "missing") return v.mode === "prepare_if_missing" && v.requestedScope.allowTrustedInstall
    ? next("ensure_trusted_app") : result("needs_human", "APP_INSTALLATION_SCOPE_REQUIRED");
  if (f.login.state === "unknown") return next("verify_parent_login");
  if (f.login.state === "mismatch") return result("needs_human", "PARENT_LOGIN_MISMATCH");
  if (f.login.state === "logged_out") return v.mode === "prepare_if_missing"
    ? next("assist_existing_login") : result("needs_human", "EXISTING_ACCOUNT_LOGIN_REQUIRED");
  if (f.identity.state === "mismatch" || f.identity.state === "ambiguous") return result("needs_human", "IDENTITY_REQUIRES_CLARIFICATION");
  if (f.identity.state === "unknown") return next("inspect_publishing_identity");
  if (f.identity.state === "reported") return next("verify_publishing_identity");
  if (f.identity.state === "missing") {
    if (f.priorCreation !== "none") return result("requires_reconciliation", "VERIFY_PRIOR_CREATION_NOT_RECREATE");
    if (f.boundIdentityId !== null || v.target.expectedId !== null) return result("needs_human", "EXPECTED_IDENTITY_MISSING");
    if (v.mode !== "prepare_if_missing" || !v.requestedScope.allowIdentityCreation) return result("needs_human", "IDENTITY_CREATION_SCOPE_REQUIRED");
    if (v.target.platform === "facebook") return v.target.category === null
      ? result("needs_human", "PAGE_CATEGORY_REQUIRED") : next("create_facebook_page");
    return v.target.handle === null ? result("needs_human", "CHANNEL_HANDLE_REQUIRED") : next("create_youtube_channel");
  }
  const i = f.identity;
  const validId = v.target.platform === "facebook" ? /^\d{5,30}$/.test(i.observedId ?? "") : /^UC[A-Za-z0-9_-]{22}$/.test(i.observedId ?? "");
  const kind = v.target.platform === "facebook" ? "facebook_page" : "youtube_channel";
  if (!validId || i.kind !== kind || i.observedName !== v.target.name || (v.target.expectedId !== null && i.observedId !== v.target.expectedId))
    return result("needs_human", "IDENTITY_REQUIRES_CLARIFICATION");
  // Central evidence resolution and activation remain necessary; reported
  // readiness does not start the commission period or release publishing.
  return result("reported_ready", "VERIFY_EVIDENCE_AND_ACTIVATE_BINDING");
}
