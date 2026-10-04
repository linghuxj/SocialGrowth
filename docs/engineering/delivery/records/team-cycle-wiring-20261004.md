# BE-CYCLE-WIRING — bounded engineering result

This slice adds an immutable first review-window record from the current
approved direction configuration. It reuses `project-cycle-core` and writes in
the existing direction-confirm transaction after current approval/project
version validation. It does not add a scheduler, review recommendation,
feedback source, Task, quota mutation, execution permission, or publication
permission.

## Window boundary

The first window uses the explicitly approved `businessTimeZone`,
`firstCycleStartsAt`, `reviewIntervalDays`, and `trafficMinimumPerCycle`.
UTC and fixed-offset windows can be recorded when every boundary is clear.
Unsupported calendar runtime/range and DST gap, fold, or offset transition
preserve the direction approval but leave the cycle unresolved; no guessed
local-time interpretation is persisted. The ICU and tzdata versions are stored
with each immutable window.

`nextCycleBoundary` permits a later configuration to align to the prior
window's `endsAt` only when the database approval time is no later than that
instant. If approval is later, the cycle result is unresolved with
`previous_window_elapsed`; the old end is never used to backdate a new
configuration. Exact DB clock precision is retained as ISO UTC text.

The current product source only accepts an initial direction approval. A
subsequent bounded configuration-change/approval flow does not exist, so the
next-window branch is defensive and is not represented as an end-to-end
feature. Repeated cycle advancement and review-loop behavior remain
unimplemented. No DST policy was inferred.

## Evidence and limits

- TypeScript backend check passed.
- Focused cycle unit suite passed (5 tests).
- Backend lint exited 0 with three existing warnings in unrelated tests.
- Diff whitespace check passed.
- The isolated PostgreSQL direction suite passed 21/21 on PostgreSQL 17.11 in
  owner-labeled container `sg-backend-cyclew-20261004-e5d369ca`, bound only to
  loopback port 33068 with no volume; the exact container was stopped and
  removed after the run. It covered same-transaction approval/window write,
  immutable history, unresolved DST approval, rollback, session expiry, and a
  DB-clock-derived elapsed-boundary guard. The latter checks the boundary
  predicate; it cannot substitute for an actual second-approval source flow.
- The latest real Web/model run recorded an actual direction approval and
  current material candidate, then the model chose `maintain`; the persisted
  outcome was `unchanged`, plan revision 1, tasks/outbox 0. This is not a
  non-empty Task acceptance. Its safe artifact did not capture the specific
  reserved identity/device state, which remains unknown.
- External metrics, cycle completion, task assignment, platform publication,
  and human review acceptance remain unverified or unavailable from current
  authoritative sources.
