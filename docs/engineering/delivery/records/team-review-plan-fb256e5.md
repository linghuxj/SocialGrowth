# Business plan producer security review

- Reviewer: `/root/adversary`
- Base: `f583f184891bd3d0406c43821cb3d36e2eb1233a`
- Head: `fb256e5b4fc7b927262408ffddbd268e340b38ae`
- Verdict: **changes_requested**
- Contracts: business-plan-task-read-and-arrange rev1 and material-candidate-read rev8 accepted by backend/Web. Earlier H2/material work is included; new increment was compared with approved material head `2bef1b42deed8db3d429190c84cd7c684c2a3113`.

## Findings

### PLAN-IDEMPOTENCY-01 — P2: command digest omits route project

`business-plan-service.ts` arrange computes the digest from request body/metadata without normalized route `projectId`. Commands are keyed by actor and request key, and all replay reads compare only digest before returning the stored response. Reusing project A's exact body/key at project B's route therefore returns A's receipt instead of rejecting a different target; expected approval in the body does not fix the early replay. Bind the normalized project identity in the digest and/or validate persisted project at every replay. Add same-actor cross-project route reuse coverage.

### PLAN-SCOPE-02 — P2: model can schedule a reserved identity outside approved scope

Snapshot reads all pending-initialization identities reserved for the project, without restricting their `platform/canonical_identity_ref` to `approval.proposal.scope.identities`. These identities enter model quota and pass the existing quota check. Existing ResourceReservationStore advances its resource guard version but not project fact version when adding reservations, so reserving another same-project Page/channel after approval does not invalidate `scope()`. Model selection of that identity can become a plan Task despite not being in the exact confirmed scope. Filter or validate against the approved identity set before exposure and persistence; regression should approve A, reserve B in the same project, and reject model scheduling B with no persisted rows.

### PLAN-TIME-03 — P2: validated schedule may expire before final commit

The pure checker validates scheduled time using coordinator `finishedAt`. The final persistence transaction may then wait for metadata/guard/project locks; it reads database `now` but does not rerun the checker or time/window constraints before inserting the original suggestion and tentative quota. A shortly future schedule can be persisted after its time/window expires. Recheck the current locked context with fresh database time before writing, and persist the rechecked result. Test final-lock delay beyond the proposed time with no plan/task/outbox committed.

## Evidence and retained positives

Independent source review covered the new service/controller/migration/DTOs/generated definitions, model/coordinator and quota boundary, candidate-material reuse, tests, application wiring and existing approval/resource lock semantics. Cumulative diff-check passed. SQL is parameterized; body schemas reject client-authored plans; provider/model configuration remains server-owned; model text is parsed/strictly validated and never executed. Session/CSRF checks and final session expiry guard are present, history is immutable, and task/outbox permissions are constrained false with pending-current-check purpose. These do not clear the three findings.

Author reports unit381/focused42/isolatedPG4/directionPG17 and contract/check/lint/generation passes. Reviewer did not independently execute PostgreSQL or actual model/UI. Positive material schedules use synthetic fixtures; real configured Artemis decision and nonempty resource-backed Web plan flow remain unverified. Current real Playwright direction-confirmation outcome is not successful plan execution/publication. No production/device/external action was performed by reviewer.
