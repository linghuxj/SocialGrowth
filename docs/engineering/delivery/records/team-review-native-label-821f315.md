# Independent Android device-label recovery review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`
Base: `a3406bd863bcd2288de4b28475dc6060ecca90b6`
Head: `821f3156552fa85363cc7317d46378ba5f76c03f`
Verdict: **approved**, findings: none.

Scope is exactly MainActivity, AssociationApiClient and new ProviderDeviceLabelCommandStore. Contract provider-assistance-device-label revision 1 remains accepted by provider and UX. The withdrawn 3182810 candidate was not approved.

The command is persisted synchronously before sending, keyed by provider and device and containing the original immutable display name, expected fact version, contract version, request ID and idempotency key. No session credential is stored. Subsequent attempts use these original values, even after a dialog or Activity recreation. The POST response is strictly parsed and checked against the original device and next version; only its receipt can display success. Authentication failures retain the pending command and use the existing session-expiry handler. Missing, malformed or conflicting local records fail closed.

Read-only reconciliation accepts only the same currently owned device from the authenticated list. A strictly newer fact archives the exact original command with the observed version/name and explicit unknown outcome. It does not infer that the request succeeded, and a new edit requires a separate user action from fresh facts. Because the original expected version is now stale, any still-pending old request cannot apply a fresh mutation through the server CAS. Archive insertion and pending removal use one synchronous preferences commit, reject an existing archive, and preserve unresolved state on failure. A missing record during clear is not treated as success. The existing Activity destroy handler invalidates callbacks and the current-token/generation guards remain in place.

Independent evidence: exact three-file source review and diff whitespace check passed. Author reports Android unit task and debug assembly passed. No independent device, emulator or browser interaction was run for this review; process-death recovery, logout/relogin recovery, actual rename/unknown-response UI and accessibility acceptance remain unverified until the lead performs the real page flow. This approval grants no participation, network readiness or publication authority.
