# Independent review: first review-cycle persistence

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`.
Base: `259bdb62243b936d938c1229bdcbffc47d805dff`.
Head: `f74b6142348dc738a1a083028a4a746595b2bdc8`.
Verdict: **changes_requested**.

Scope is the exact six-file delta: cycle store and unit tests, migration 0036, direction service hook and PostgreSQL tests, and the bounded delivery report. No public contract changes were claimed.

## Finding

**CYCLE-CLOCK-TEST-01 — P2:** The new PostgreSQL “refuses a retroactive next-cycle boundary” test obtains `now` in one SQL request and obtains `clock_timestamp() - interval '1 microsecond'` in a later request. With ordinary round-trip latency, the latter value is later than the first captured approval time. `nextCycleBoundary(elapsed, now)` correctly returns the boundary, contradicting the test's expected null. Derive the past/future instants from the same captured database instant and run the isolated PostgreSQL suite. The author explicitly had not run this test; source inspection is not a passing PostgreSQL result.

## Independent checks and boundaries

- Scoped diff whitespace check passed.
- Extracted exact candidate cycle store/core/tests into reviewer-owned scratch and ran the five cycle unit tests with the project runtime: 5 passed. Shared contract source was the already reviewed exact-source scratch dependency; no application runtime was started.
- Reviewed immutable insert-only migration, parameterized queries, approval hook, database project-version check, fixed lock ordering, and final database-clock session revalidation. The hook uses the approved proposal; it does not accept new caller scheduling values or mint action permissions. DST ambiguity/offset transitions return unresolved. No further material source issue found in this delta.
- PostgreSQL migration/atomic rollback/session expiry/concurrency are unverified in this review. Author reported backend typecheck, 400 unit tests and lint passing; these do not prove migration or browser acceptance.
- The reported prior actual Web outcome remains maintain/unchanged with zero Task/outbox rows. This implementation does not prove repeated cycle advancement, a real metric source, nonempty Task scheduling, execution, publication, or production recovery.

## Exact re-review

Base: `259bdb62243b936d938c1229bdcbffc47d805dff`.
Head: `6cdebccea36adca8e04f975a61f3ea3ef01ec05a`.
Verdict: **approved** for this complete six-file source delta; no remaining material finding.

CYCLE-CLOCK-TEST-01 is fixed: a single volatile-clock CTE supplies one captured instant, and elapsed/future derive from that instant. The rest of the production implementation is byte-identical to the reviewed candidate. Independent full-delta whitespace check passed; previously run exact cycle unit tests remain applicable (5/5). The delivery report now records author-run isolated PostgreSQL 17.11 direction suite 21/21 and removal of its owned loopback-only, no-volume container. Reviewer did not rerun PostgreSQL or inspect private raw logs. Author additionally reports full backend units 400/400, typecheck and lint passing with three pre-existing warnings.

The initial unrun-test defect remains in the record above. Approval covers source integrity and the stated engineering boundary, not a second configuration approval flow, repeated review cycles, actual metrics, nonempty Task scheduling, browser acceptance of this new source, execution or publication.
