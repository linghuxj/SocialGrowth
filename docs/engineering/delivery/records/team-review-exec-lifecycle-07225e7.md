# Independent full-source review: logical attempts and lifecycle

Reviewer: `/root/adversary`.
Base: `2c7910eee3d6e597c8310b692b7631e067734e60`.
Head: `07225e7ddb8dbdd7f95bd477330a1bffae945f94`.
Verdict: **changes_requested**.

## Scope

Reviewed the complete 25-file delta, including migrations 0034/0035, BusinessPlanService current-check and logical-attempt producer, lifecycle/withdrawal service and controller, material store/projection hooks, impact writer, AppModule registration, all shared/generated contract changes, and affected tests. This includes the provider source dependencies, not just the final fixture correction. No protected publication script, secret configuration, raw model output, device or live service was accessed.

## Finding

**LIFECYCLE-ZERO-VERSION-01 — P2:** `withdrawMaterial` rejects the current project's `fact_version` when it is below 1. A project created through ProjectService legitimately starts at version 0; MaterialRegistryStore can save an unapproved pending material declaration without advancing that version (its existing fixture and pending-material test exercise this source state). An otherwise authorized withdrawal of that exact current variant/revision therefore always rolls back with FACT_VERSION_STALE. The new withdrawal regression only uses an approved direction and advances the project to 1 first, missing the valid zero-version case. Accept the nonnegative safe-integer project-version domain while continuing to reject absent/invalid facts; add a zero-version material save/withdraw/replay/history/candidate regression.

## Reviewed boundaries and evidence

- Independently ran exact-source lifecycle/current-check/material contract tests from reviewer-owned scratch: 10/10 passed. Full scoped whitespace check passed.
- Operator cookies/CSRF and current operator/session validation precede writes. Shared material/resource/business-plan guards serialize attempts with cancellation, followed by project/task/source locks; final DB-clock session freshness checks cover late expiry before commit.
- Attempts are immutable server-generated IDs pinned to source project/plan/task/material/manifest and locked identity/account/device reservation. The caller cannot supply device assignment or permission. One task admits one attempt; same actor/key/route/body replay returns that attempt and rereads current blockers. Pending dynamic facts do not grant authority.
- End/withdrawal cancellations require pending task/outbox with false permissions and no authoritative attempt row; unavailable storage fails the transaction. Quota/reservations, task/outbox history and existing attempts are retained. Resume remains a recheck intent. No queue worker, physical inspector, Artemis call or publication permission is introduced.
- Material withdrawal remains visible in history and marks current candidate false; save performs both pre-IO and final transaction checks. All new SQL values are parameterized; interpolated table/column/guard identifiers are fixed internal strings.
- Author reports disposable PostgreSQL17.11 three-suite bundle 31/31, including actual Nest logical-attempt HTTP create/replay, contracts TS84/Python39, typecheck and lint with three existing warnings; container/credentials removed. Reviewer has not rerun PostgreSQL, read raw logs or independently checked that cleanup. These reported passes do not cover the discovered zero-version withdrawal case.
- No actual Web, nonempty real-model Task, phone execution, physical stop, platform removal, resource release or full product acceptance is established. This full-delta review does not approve the root integration candidate or replace any old pending gate.
