# Provider assistance/device label review — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`.
- Base: `b56429aa824f1d40709921d9ca5ed2a84cc067a1`.
- Head: `8e57b7b3af98147a1ab4b7195fee8db39f723ae0`.
- Verdict: **changes_requested**.
- Contract: canonical provider-assistance-device-label revision 1 accepted by /root/provider and /root/ux.

## Findings

### PROVIDER-LABEL-01 — P2 — target and current ownership must also bound cached rename responses

`product/backend/src/identity-transactions.ts`, new `renameProviderDevice`: the request digest contains the body but not normalized URL deviceId, and the existing cached response returns before current association ownership is checked. A provider can rename A, then reuse identical metadata/version/label at B and receive A's cached success instead of an idempotency conflict; no rename of B occurs. The same early return also serves a stored device response after the original association has ended.

Bind the target to the digest and enforce current ownership before returning cached results. Preserve same-target replay without requiring the old expected version to still equal the version the original rename already advanced. Add cross-device key reuse and ended-association replay regressions. Evidence is exact source/control-flow inspection; no independent database reproduction was performed.

### PROVIDER-LABEL-02 — P2 — session authentication is separated from the rename transaction

`product/backend/src/provider-device-label.controller.ts:26-27` authenticates the Bearer token and passes only providerId into the new transaction. The transaction rechecks provider active status, but never the session. If logout/revocation commits after that preflight while the rename waits to enter its transaction, rename still succeeds using the stale context.

Use the existing transactional provider session authentication with the current token, before association/device changes and cache disclosure; hold the relevant current-authority protection through commit. Add a deterministic revoked-session/wait regression. This is a new endpoint's current-authority defect, not a request to redesign all identity services.

## Reviewed properties and verification

The assistance impact query requires both the recorded provider and the current association provider to match the authenticated principal. It returns only device ID/label/recorded version, preserving aggregate todo facts separately and exposing no operator identity, notes or internal diagnostic facts. The recorded device version remains historical context rather than live health. The optional association label is bounded and preserves the old default when omitted. Rename uses parameterized SQL, optimistic device fact version and an audit without credentials.

Independently extracted the exact candidate's contract sources and ran association-provider-device-label plus device-assistance tests: **8/8 passed**. Full delta `git diff --check` passed. Producer reports broader contracts71/Python39, backend check, controller4, isolated PG rename1 and feed1 passed. Those broader runs were not independently rerun. Producer oxlint hung and remains **unverified**.

The new controller is not yet registered in AppModule; runtime endpoint integration and true UI acceptance remain outstanding. No live phone, live database, provider message, publication, or production operation was performed by this review. No PR approval is granted for this SHA until the findings are fixed and re-reviewed.
