# Independent review: first review-cycle persistence

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
