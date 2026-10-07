# Device control independent review — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`.
- Base: `6136984de4b325644d35d5850687ec4fa8527ac5`.
- Head: `2017ea2d7102d2c866bac0a13590615910c8664e`.
- Verdict: **changes_requested**.
- Scope: 11-file control service/controller/transaction composition, paused identity heartbeat, shared schema and generated contract delta.

## Findings

### CONTROL-IDEMPOTENCY-01 — P2 — bind a cached command to its actual device target

`product/backend/src/device-control-service.ts:139-143` computes the provider command digest from the body alone, although the target is in the URL. The unique cache scope is operation + provider + key. If a provider successfully pauses device A and then sends the same body/key to another currently owned device B, the digest matches A's cached command. The method returns B's current snapshot with the submitted request ID before reaching the pause update. B stays active, but the control request has returned successfully. Neither the cached result device nor the request digest is compared to B.

Bind the normalized target identity to the digest or validate the cached target before returning. The installation equivalent should also reject an old cached command if the same installation is subsequently associated with a different target. Do not use mutable fact versions that the pause itself advances as the identity of an otherwise valid replay. Add a cross-target key reuse regression while retaining ordinary same-target replay.

Evidence: exact source inspection of `providerCommand`, `findCachedCommand`, and `completeCommand`; the latter already stores result_object_id but the lookup does not load/validate it. Existing producer tests cover same-device replay only. No independent PostgreSQL reproduction was performed in this pass.

### CONTROL-CONTRACT-02 — interface alignment required

The candidate schema and service return intent `paused` after a trusted stopped journal. Both accepted revision-4 ledger contract bodies enumerate active/pause_requested/resume_requested/exit_pending/exited and omit paused. Producer and UX must directly agree on the actual enum and each accept the resulting revision before dependent integration. This does not require a new approval layer or broad redesign.

## Reviewed properties and validation limits

- Provider paths validate UUID targets, current authenticated provider sessions, and current association ownership. Installation pause resolves its own device and revalidates identity under the existing provider -> installation -> association -> device lock order. No caller-supplied authorization fact is used.
- Unknown/running journal calls and their holder remain occupied. Resume requires stopped disposition, no holder and no unresolved action; it records intent and does not enable a run or device.
- Paused challenge/confirmation retains the same installation/association run, only refreshes forward scope, and never supplies `loadCurrentLocalParticipation` action authority for a paused device. New participation runs still reject paused state.
- Journal initialization refactor retains stop_requested first-contact behavior. No physical-stop proof is fabricated.
- Independent full delta inspection and `git diff --check` passed. Producer reports contracts build, focused contract tests 2/2, backend check, lint with two pre-existing warnings, isolated PostgreSQL service tests 4/4. These producer checks were not independently rerun in this pass.
- Web flow, native UI, physical stop, full action broker integration and business acceptance remain unverified. No existing service, real phone or production database was mutated by this review.
