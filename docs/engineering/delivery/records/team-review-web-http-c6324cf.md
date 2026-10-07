# Independent narrow runner forwarding and HTTP diagnostic review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `36b6b7acc2594288d33e657dd81a4a8efc973c68`

Head: `c6324cf8394d798828b8189c196db3580c0f470f`

Verdict: **approved**, findings: none remaining.

The complete two-file increment includes runner forwarding of the opt-in narrow-flow flag and sanitized real POST/reconciliation observations. It stores only response status, allowlisted error code, boolean retryability, elapsed time and SHA-256 digests of the original body/key. It does not log the body, key, model output, response message or credential. A non-success original POST is followed only by an actual read-only GET; the script retains unknown/frozen semantics, never clicks replay in this branch and exits failed. A successful first response remains required before the explicit identical-body/key replay path.

Two issues identified in intermediate b69f696 were fixed: the non-2xx branch awaited an error message that cannot appear after the existing Promise.race timeout and intervening refresh; it now checks the actual still-pending status. Also, strict string equality assertion could print the raw original and replay bodies on mismatch; it now uses a boolean assertion with static text. These fixes preserve the UI's existing behavior and prevent a failing diagnostic from disclosing the very data it intended to omit. Exact diff-check passed and source was inspected against the plan UI's timeout/refresh control flow.

Author reports script type/syntax checks passed. No actual narrow rerun has occurred at this head. The earlier HTTP 500 is a failed unknown operation; neither this script nor this review assumes it rolled back, succeeded or is safe to replay. Backend diagnosis and real UI recovery remain pending. No product permission, model output validation, device or publication behavior changes are included.

## Cumulative final diagnostic follow-up

Final cumulative exact base `36b6b7acc2594288d33e657dd81a4a8efc973c68` → head **`b501b2381c8c8404a094590ddb35707fbf2762ec`**: **approved**, findings none. The additional business-plan-service source is byte-identical to independently approved 1d7542981505ac18f3c3c5265d7ca2bb4097ee9b. The runner now filters saved backend logs to finite event/stage/category fields and reads only counts, command-key hashes, persisted payload digests, allowlisted outcomes and numeric plan revisions from its owned disposable database after owned services stop. Read failure produces an explicit unavailable result, not zero counts or inferred rollback. Original raw command keys are not saved; arbitrary backend log text is omitted. Existing container ownership checks and cleanup remain. Independent source/provenance/diff-check passed; the new controlled real browser run is still pending, so this is not a successful HTTP 500 diagnosis or plan acceptance.
