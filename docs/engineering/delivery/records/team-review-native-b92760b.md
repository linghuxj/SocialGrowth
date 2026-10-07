# Android native candidate review — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`.
- Base: `d8f169785c6adf3db7294158cbe7ed4925df2a1f`.
- Head: `b92760be42483441ee6dd2eef95064e0f281d032`.
- Verdict: **changes_requested**.
- Scope: Android-only 12-file UI/client/notification/manifest and test delta; no native runtime acceptance inferred.

## Findings

### NATIVE-CONTROL-01 — P2 — parse the real control contract and reject contradictory stop facts

`DeviceControlApiClient.parse` demands an exact key set that omits contractVersion. The approved backend control snapshot includes contractVersion on every GET and POST. Every real successful response is therefore rejected; a submitted pause may have committed, yet its response and reconciliation GET are both unreadable.

The parser additionally accepts confirmed stop with unresolvedActionCount greater than zero, and a non-not_requested stop with null control version/generation. Its test explicitly treats unknown stop with null control identifiers as valid although the backend shared schema rejects it. The UI uses confirmed directly to display that the phone has stopped.

Accept and validate the actual contractVersion, match the shared stop invariants and positive decimal generation format, and use complete backend-shaped response fixtures. Unknown versions, missing required control identity and contradictory confirmed facts must remain unreadable/unknown.

### NATIVE-CONTROL-02 — P2 — bind all displayed control responses to their expected device

Provider GET and pause/resume methods parse the response without checking its deviceId against the requested target. Installation pause and its error-reconciliation read also do not compare the returned device against the device passed to submitInstallationPause (that parameter is currently unused). POST requestId comparison alone does not bind the target. A mismatched response can be displayed as the current phone's stop state.

Check expected device identity for provider reads/writes and local writes/reconciliation before constructing an accepted ControlAttempt or displaying a stop state. Reuse existing call-site/client equality checks; add mismatched-target response regressions.

## Remaining reviewed scope and limits

Management and installation tokens remain separate; client requests disable redirects and bound response sizes. The network guide only opens the official Tailscale package/page or own system settings and does not claim that opening them establishes readiness. Assistance impact versions are labeled historical; commission records require paymentAllowed false and remain internal calculation references. Unknown control responses use same-request reconciliation and do not become execution permission.

Independent source and full delta inspection plus diff-check passed. Producer Gradle unit/build evidence is attributed to the author; this reviewer did not run Gradle, emulator, USB or real pages. Provider rename/backend runtime integration has separate pending review and must not be assumed passed here.

MainActivity no longer contains a ParticipationService start/withdraw entry, and the notification now opens the app. Asked the author to confirm this follows the latest user page boundary and identify the actual participation-entry gap; no reversal of user instructions is requested and no completed user participation-start flow is asserted by this review.
