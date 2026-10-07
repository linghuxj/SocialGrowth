# Business plan producer final security re-review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`
- Base: `f583f184891bd3d0406c43821cb3d36e2eb1233a`
- Head: `1f69939229d6f99394d6f00bbd59d4319b422b2e`
- Verdict: **approved** for the full stated cumulative backend/contracts/test candidate; no remaining material finding.
- Contracts: business-plan-task-read-and-arrange rev1 and material-candidate-read rev8 remain accepted by backend/Web.

## Resolved findings

PLAN-IDEMPOTENCY-01: normalized route project ID is in the digest, and persisted project ID is checked in all three replay paths. The added same-actor/body/key cross-project regression expects IDEMPOTENCY_KEY_REUSED before returning the original receipt.

PLAN-SCOPE-02: identity candidates are restricted by exact approved platform plus canonical reference, so later same-project reservations cannot enlarge the confirmed identity scope. The added fixture attempts an out-of-scope reserved identity and expects no plan/revision/task/outbox/command/audit writes.

PLAN-TIME-03: the final locked current snapshot is checked again with fresh database clock before any write, and persistence uses this final quota result. The added final-transaction delay regression crosses scheduled time and expects zero writes. This proves an explicit fixture delay boundary, not a separate live load/lock-contention acceptance run.

## Independent evidence

The full initial source scope was reviewed in the preceding report; this exact follow-up changes only service and PostgreSQL tests. Both files and cumulative diff-check were independently inspected. Extracted exact candidate checker/coordinator/quota source and independently ran their three test files: **46/46 passed**, using installed candidate-workspace runtime/contracts dependency. No live database or model call was made by reviewer. Author reports isolated PostgreSQL 6/6 plus backend check/lint, contracts build/generation and focused tests passed; two existing lint warnings remain.

Server-owned model configuration, strict model output/data checks, transaction/session/CSRF and current scope checks, immutable plan/task history, exact quota uniqueness and atomic pending-current-check outbox remain. Execution/publication flags are constrained false. Existing approved H2/material ancestors remain in this full candidate and are not treated as new business acceptance.

## Unverified boundaries

Synthetic PostgreSQL positive/rollback/race fixtures are engineering evidence. Real configured Artemis nonempty planning from actual material/source/resources, positive plan UI, copy factuality, source rights, current device readiness and real execution/publication remain unverified. Actual Web `direction_confirmation_required` with zero tasks is a bounded result; the later 90-second unresolved request is not success. An exact final integration and client timeout/reconciliation implementation still require separate review.
