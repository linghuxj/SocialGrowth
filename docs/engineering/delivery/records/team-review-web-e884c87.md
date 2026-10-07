# Independent Web integration review — e884c87

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`
Base: `1bde61548310d741bddffca15161e2b2cf2e7175`
Head: `e884c8710b3dea99472d508705dcc63f601c5258`
Verdict: **changes_requested**

The complete 38-file candidate was inspected, including backend dependencies, Web material declarations/current state, plan command recovery, TODO routing/history, and browser runner changes. This is not approval of the full base tree or business acceptance.

## Findings

- **WEB-SOURCE-01 (P2): the full candidate includes the superseded BE-PLAN producer.** Its `business-plan-service.ts` lacks the project-bound idempotency, approved-identity filtering, and final locked fresh-time revalidation approved in backend `1f69939229d6f99394d6f00bbd59d4319b422b2e`. These are the previously recorded PLAN-IDEMPOTENCY-01, PLAN-SCOPE-02 and PLAN-TIME-03 findings, not new duplicate blockers. Import the corrected source or establish an actual base containing it, then submit the final complete tree for review. A Web-only description cannot exclude code present in the candidate diff.
- **WEB-REDACTION-02 (P2): successful TODO screenshots regress the approved impact mask.** `scripts/verify-product-operator-todos-playwright.mts` omits `.operator-todos__impacts` in the successful screenshot path, although approved `a3406bd863bcd2288de4b28475dc6060ecca90b6` includes it. A nonempty feed exposes historical device IDs in the screenshot. Restore masking for both success and failure captures.

## Boundaries and evidence

The material save flow re-reads current scope, invalidates an old human confirmation, and preserves a frozen pending command. The plan UI keeps the original prepared body/key after its 45-second wait limit, labels the result unknown, requires a current read before explicit retry, and does not claim cancellation. No additional material finding was identified in those flows. TODO read-generation and target guards remain present; differences in headings/styles are not security findings.

Author reports Web tests 86/86, builds/lint and a real empty-feed TODO browser pass; positive detail/notes/impact requests remain unverified. Earlier real-model plan result was direction_confirmation_required with no tasks, followed by a separate 90-second unknown request. The new timeout UI had not been validated through a real browser when this candidate was submitted. Negative material/stale-scope checks do not prove external source rights or a nonempty real plan. This review did not run services, mutate a phone or issue publication commands.
