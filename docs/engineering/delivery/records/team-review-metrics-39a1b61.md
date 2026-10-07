# Independent complete metrics re-review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `04058855e2eed435f32be84316e175ef71ef1711`

Head: `39a1b61ebfe5d76d23d224ef94bfc3db2d170cf6`

Verdict: **changes_requested** pending corrected regression evidence.

The full twelve-file source diff includes the shared metric schema/export, internal store/migration, operator GET and the Plan diagnostic/describe-budget changes. METRIC-UUID-01, METRIC-READ-AUTH-02 and METRIC-DELAYED-03 are fixed in source: all metric and content-subject UUIDs canonicalize; authenticated reads check session expiry against fresh database time after history reads; every non-available state requires null value. The account-only resolver remains null in AppModule. The 45-second describe budget preserves the adapter's 40-second cap, separate 30-second coordinator budget and final locked database-clock checks; no material issue found in that increment.

**METRIC-TEST-04 (P2): exact-source core regression still fails.** The `real zero, missing, delayed old data and unknown coverage/cutoff remain distinct` test inherits a non-null value for its delayed fixture (metric-snapshot-core.test.ts:30). With the corrected shared source it now throws INPUT_INVALID. Independent extraction of the exact candidate contracts source and core/test, resolving the contracts package directly to its source through tsconfig paths, yielded 11/12 total: core 8/9 and schema 3/3. Fix the fixture to the signed null semantics, preserve numeric-delayed rejection coverage, rebuild current contracts and rerun core/PG to avoid stale dist masking this case. The author's claimed core 9/9 is not confirmed for the final shared source.

Two initial reviewer test commands failed because the review checkout has no tsx dependencies. The definitive run used the canonical project's pnpm backend tsx binary against the review checkout's extracted exact files and a read-only dependency link. No other checkout's source was edited. Diff --check passed. Author's synthetic PG metrics 5/5 and Plan 7/7 are reported but need confirmation after rebuilding the current shared schema. No live source, Web/model rerun, actual publication attribution or production action was performed.
