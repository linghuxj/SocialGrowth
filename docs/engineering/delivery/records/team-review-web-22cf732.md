# Independent Web follow-up review — 22cf732

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`
Base: `1bde61548310d741bddffca15161e2b2cf2e7175`
Head: `22cf732df2b7594b756a0222ae9d36d1aa890680`
Verdict: **changes_requested**.

The four coordinator/service/test files exactly match approved backend 04058855e2eed435f32be84316e175ef71ef1711. The sole additional implementation delta from approved Web b2f09ba is the isolated business-plan-postgres runner scope.

**WEB-RUNNER-SCOPE-03 (P2): enforce the new scope's SQL-only boundary.** The allowlist accepts business-plan-postgres with SQL_ONLY unset. In that case the runner executes its PG suite and then starts Web/backend, runs no Playwright flow, and prints passed:true with scope author real UI checks. Mixed scopes also accept the marker without executing its suite unless direction happens to be present. Restrict this scope to an exclusive SQL-only invocation, or explicitly implement and label every accepted combination; the minimal fix is an input guard before startup.

Author reports the corrected isolated PG suite passed 6/6. The latest real browser attempt stopped in direction generation after one proposal and two unavailable responses following a draft edit; it never reached a material/plan POST or the 45-second unknown mechanism. Those limitations and the earlier 90-second unknown remain; this review does not convert them into acceptance. Exact diff-check passed; no services or devices were operated by the reviewer.
