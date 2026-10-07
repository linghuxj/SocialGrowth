# Independent complete current-check/impact producer review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `3c552564f8b45796cf685baa94f6813f6557a344`

Head: `a18450b0c80f22f214b6d4856865f7c41cfd7f90`

Verdict: **changes_requested**. This full 12-file review is separate from the approved five-file manifest increment at the same head; the narrow approval never approved these parent producers.

- **CURRENT-ASSOCIATION-02 (P2): currentChecks omits the association generation from the outer SELECT.** The lateral association query calculates association_generation and the TypeScript row declares it, but the outer SELECT never returns it. Consequently the comparison to installation_generation is always false for valid associations, and every associated task incorrectly receives device_association_missing. Select the value explicitly and test both a matching active generation and a later installation generation. The existing fixture creates an already-stale generation and asserts false, so it does not detect this failure.
- **CURRENT-IMPACT-AUTH-03 (P2): the new project impact loop can outlive authenticated session validity.** ProjectService.save checks freshSession before updating the project, then calls the newly added per-task lock/query/CAS/INSERT loop, writes command/audit and commits without a final session-expiry check. A delayed or sufficiently long impact append can therefore persist the source mutation and impact rows after expires_at. The material path already checks freshness after its callback. Revalidate the project session after this new asynchronous work and before commit; add an isolated delayed-impact regression proving complete rollback after expiry.

Other inspected boundaries: hooks occur only for actual source changes, existing idempotent replays return before them, and source mutations/outbox head/append-only impact rows share one transaction. Parameterized SQL scopes project and variant, uses deterministic task ordering and CAS on the held outbox row, and preserves purpose/state/false permission columns through migration triggers. The writer does not acquire business_plan_guard after a project lock. GET remains authenticated/no-store and exposes a bounded projection with action_inspector_unavailable and literal false permissions. These observations are not a substitute for fixing the two findings.

Author evidence was PG7/7 with Nest HTTP and contracts77/Python39; it did not cover matching association generation or session expiry during the newly appended loop. The reviewer did not execute production, device, model or browser operations. The earlier manifest-empty contract finding is fixed in this head and remains separately recorded.
