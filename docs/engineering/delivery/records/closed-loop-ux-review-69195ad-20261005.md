# Closed-loop UX independent review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer `/root/ops_fix_adversary`; base `05f8cf587a9c8f482da92263d194c06250f088ed`; head `69195ad7baf0f4c12970fe8f7e92905b8fa3fa6e`. Verdict: **changes_requested**.

Initially reviewed four requested paths: project-workflow-panel.tsx/.css, workflow-api.ts, operator-todos-panel.tsx. Correction during re-review: the fifth changed path is `operator-todos.css`, not the request's `operator-todos-panel.css`; that small style delta was subsequently read in full and has no findings. Contracts CLOSED-LOOP-WORKFLOW-READ-V1 rev2 and CLOSED-LOOP-ASSISTANCE-DETAIL-V1 rev2 were checked against the shared accepted records. Scoped diff-check passed. No build, browser, service or device validation was run by the reviewer; peer schema/route dependencies are not included in this isolated candidate.

- **UX-LOOP-SEC-01 / P2:** `workflow-api.ts:43-59` guards session changes only after successful reads. A 401 from the previous session is rethrown unchanged. The new detail deep-link callback at `operator-todos-panel.tsx:190-198` calls `onExpired` for it, while the effect has no unmount cleanup invalidating `detailSequence`. If the old panel's request completes after logout/relogin, its callback can clear the new authenticated UI through `App.handleFailure`. Apply current-session versus stale-session handling on rejected requests, and invalidate asynchronous reads on unmount. Cover all introduced detail call paths.
- **UX-LOOP-SEC-02 / P2:** `project-workflow-panel.tsx:35-36` and `operator-todos-panel.tsx:25` describe `pending` as an active system recheck. The recovery owner confirmed directly that this status includes merely persisted, unclaimed requests; it does not establish a running consumer. Use pending/waiting wording. Likewise an unknown submission does not itself prove that original-result verification is running.

The read-only panel otherwise preserves the distinction between logical reservations and real operations; absent operation is explicitly stated. It obtains assistance IDs from the exact server workflow association and does not infer project ownership from the global/device feed. No new phone dispatch, publication permission or operator-written verified fact is introduced. These observations do not approve the pending candidate or establish runtime acceptance.

## Re-review of 0c4e059

Same base; head `0c4e059a06dcd31355979455b112e59843e5cba6`. Reviewed the complete follow-up delta and actual fifth CSS file. Accepted workflow rev3 and assistance-detail rev4 checked; all five scoped paths pass diff-check. The original GET-session/unmount and pending-wording findings are fixed. Verdict remains **changes_requested** for the write-session variant of UX-LOOP-SEC-01: `continueNote` reads a mutable `pendingSession.current` in its rejection handler, but another concurrent success clears it. While submission waits, the continuation button remains enabled because `loading` only covers reads. Two same-key submissions can therefore interleave first success, logout/relogin, then second old 401; the absent guard silently succeeds and `expiredRef` clears the new session. Capture an immutable guard per invocation and refuse a missing guard; guard callbacks after unmount. This is a source/control-flow finding, not a claimed runtime reproduction.

## Final exact re-review

Base `05f8cf587a9c8f482da92263d194c06250f088ed`; head `257da3764004bea4ffd467ab16b550a1fc4385d9`. Verdict: **approved** for this five-file source candidate only. Reviewer `/root/ops_fix_adversary`.

Intermediate head `964c8b0fe52647b2206ab9f3ccbc2f637fae2890` fixed the immutable per-invocation session guard and mounted/active callback protection. It was not approved because overlapping continuation successes could still clear a later command's pending state. Final head adds synchronous single-flight occupancy before any await, released in finally; duplicate continuation calls return without issuing another request. Thus the old-session and pending-command replacement variants of UX-LOOP-SEC-01 are closed. UX-LOOP-SEC-02 wording remains corrected and agrees with accepted workflow rev3 / assistance-detail rev4 semantics.

Reviewed every incremental code change and all five actual candidate files; final scoped diff-check passed. No reviewer build, browser, service, device or model execution was performed. Peer schema/route integration, real Web interaction and lead's eventual combined candidate remain separate review/validation obligations. Any subsequent code change invalidates this exact approval.
