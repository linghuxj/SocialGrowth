# Device control follow-up review — 2026-10-04

- Reviewer: `/root/adversary`.
- Base: `6136984de4b325644d35d5850687ec4fa8527ac5`.
- Head: `f4c0c8c028b4c8eed58a02f9ea476ad95b8bd91c`.
- Verdict: **approved** within this control-intent engineering slice. Open findings in the exact candidate: none.

CONTROL-IDEMPOTENCY-01 is fixed. Provider command identity now includes the actual normalized device ID. Installation command identity includes installation ID/generation and current association/device/provider, so a reassociated target cannot reuse an earlier command result. Device fact version is deliberately absent because pause advances it and ordinary same-target retries must remain possible. The new PostgreSQL regression covers one provider, two devices and the same body/key: the second request rejects with IDEMPOTENCY_KEY_REUSED and its device remains access_ready.

CONTROL-CONTRACT-02 is resolved. Independently read the canonical ledger at revision 119: both provider-device-control and installation-self-control are revision 5, their intent enum contains paused, and both /root/control and /root/ux have accepted that exact revision. This matches the source schema and service response.

Independently reviewed the complete original delta plus follow-up source/test changes and ran `git diff --check` successfully. Producer reports isolated PostgreSQL 5/5, contract tests 2/2, contract build/generation and backend type/lint checks passed (two existing unrelated warnings). Those execution tests were not independently rerun by this reviewer; the approval rests on independent code/contract review plus the explicitly attributed test evidence.

Authorization, lock ordering and unknown-state boundaries retain the original review's conclusions: current provider ownership is required; installation target is resolved server-side; pause preserves unknown/running calls and holder occupancy; resume requires a trusted stopped journal and records intent only. Existing paused identity runs can heartbeat without providing action authority or allowing a new run. Neither an accepted pause command nor a refreshed identity heartbeat proves physical stop. Actual Web/native control flows, physical fence/stop, live broker integration and full business acceptance remain unverified. No live service, database, phone or publication was mutated by this review.
