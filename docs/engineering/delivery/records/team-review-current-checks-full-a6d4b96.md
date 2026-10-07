# Independent complete current-check/impact producer re-review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `3c552564f8b45796cf685baa94f6813f6557a344`

Head: `a6d4b96024a807e2f5dfc3a42ae8adceda864805`

Verdict: **approved**, findings: none remaining.

This approval covers the complete 12-file delta: original currentChecks producer and controller, task-impact append writer, migration 0032, ProjectService and MaterialRegistryStore hooks, manifest revision 2, generated/shared contracts and focused regression source. It supersedes the full-scope changes_requested verdict on a18450b; the earlier five-file manifest review remains a distinct narrower record. The read/writer contracts at ledger revision 2 remain accepted by control, provider and backend.

CURRENT-ASSOCIATION-02 is fixed by explicitly selecting a.association_generation in the outer SQL query. The fixture first establishes an active matching generation and asserts associationCurrent=true with no missing-association blocker, then increments installation generation and asserts false/blocking. CURRENT-IMPACT-AUTH-03 is fixed by rechecking freshSession after project impact appends and before command/audit persistence. The added delayed-impact fixture advances beyond session expiry and asserts rollback of project name/version, outbox head, impact rows, command and audit. The earlier empty-current manifest schema inconsistency also remains fixed.

The complete writer uses parameterized project/variant selection and deterministic task ordering, holds and CAS-advances the existing outbox head, verifies repeated source-version bindings, and inserts immutable impact rows in the same source transaction. Existing create/unchanged/replay paths add no references. Material and project hooks acquire no business-plan guard after the project row. Migration constraints retain pending_current_checks/current_check_reference and false execution/publication flags; immutable impact history and restricted outbox updates prevent this producer from becoming a dispatch mechanism. GET authenticates the current operator, rechecks expiry after the read transaction, uses no-store, and returns historical task/material references plus explicit missing/unknown blockers. The mandatory action-inspector blocker and literal false permissions remain.

Independent evidence: complete exact-source review, final fix inspection and base/head diff-check passed; the earlier focused exact-source schema test passed and its schema is unchanged. Generated JSON additions were checked against shared schema properties and permissions. Author evidence at this final tree: isolated PostgreSQL 17.11 suite 8/8 with actual Nest HTTP authenticated/unauthenticated reads, positive/stale association generation, source-impact readback, idempotency/rollback and delayed-session expiry; contracts77/Python39, generated/build/type checks and lint with three existing warnings. No reviewer-operated database, actual Web page, Artemis/physical stop, Task execution, resource release or publication acceptance is asserted. This is approval of this exact source delta, not every ancestor or the final root integration.
