# Independent metrics candidate findings

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Complete requested base: `04058855e2eed435f32be84316e175ef71ef1711`

Head: `2973eda875073bedaba241d25e2ecd9c64836e03`

Verdict: **changes_requested**.

The full review must include the inherited metric-feedback.ts/shared index additions, not just the seven files after 1d754. The separate plan diagnostic review only approves business-plan-service.ts.

- **METRIC-UUID-01 (P2): replacing the core schema drops UUID normalization.** The previous core normalized all UUIDs to lowercase; the shared metric schema accepts uppercase but does not normalize it. readMetricReport still lowercases lookup IDs and then compares strings exactly, so a valid uppercase snapshot becomes unreadable; correction/replay identity comparisons likewise diverge on equivalent mixed-case UUIDs. Restore internal canonical UUID handling including subject identifiers and add mixed-case append/read/replay regressions without changing the public JSON shape unnecessarily.
- **METRIC-READ-AUTH-02 (P2): feedback reads lack a final session-expiry check.** readProjectFeedback authenticates once then executes potentially waiting or lengthy history reads and commits without revalidating against the database clock. The auth helper obtains its time before row-lock waits, so a waiting session can expire before the read is returned. Retain the authenticated context and recheck session validity with fresh clock_timestamp after the reads; test expiry during a controlled wait and ensure no metrics are returned.

Existing account/identity/project reservation checks, null default resolver, account-only ingestion, append-only history and unknown content attribution were inspected. No public metric-write route or source/attribution acceptance is present. Author's PostgreSQL 4/4, schema checks and build evidence do not cover these two cases. No real source, browser, device or production metric action was performed by the reviewer.

Additional complete-contract review:

- **METRIC-DELAYED-03 (P2): delayed reports can carry a numeric value despite the accepted rev2 contract requiring null.** The shared metricSnapshotSchema only rejects non-null values for `missing`, not `delayed`. Consequently delayed + value `0` + a missing reason satisfies the schema and can reach persistence and display. Require null for every non-available state and cover the counterexample. This tolerance existed in the old internal core, but the new public contract explicitly excludes it.
