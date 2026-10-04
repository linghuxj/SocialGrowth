# Independent lifecycle UI findings

Reviewer: `/root/adversary`

Base: `259c817bf989d45edf8f8c694a742d709955a77b`

Head: `5256ed1dcf3dd5aff4d3d2593f7e4c5ad0fb2504`

Verdict: **changes_requested** for the three added API/panel/CSS files.

- **LIFECYCLE-RECOVERY-01 (P2): material withdrawal unknown results have no reachable recovery controls.** The only pending-command controls are rendered for kind project inside the project card. A failed material withdrawal freezes new actions, but its same-request retry and read-only verifyPending branch cannot be invoked from the UI. Expose controls bound to the original variant/revision/request identity; do not create a replacement key.
- **LIFECYCLE-RACE-02 (P2): stale reconciliation can clear a newer pending command.** refresh and material verifyPending capture an old pending command and later call setPending(null) without checking the currently pending identity. While its read is in flight, an original-request retry can finish, then the user starts a new command (start actions ignore loading); the old read may clear the new unknown state. Use synchronous command/operation references and require the current pending identity plus project/active/read generation to match before clearing or updating it. Prevent competing mutation entry until the same-command lock is settled; preserve unknown commands across late callbacks.

The prepared API binds normalized project/variant routes, immutable serialized metadata/body and operator session, and verifies matching receipt identity. No platform deletion or actual stop permission is introduced. The current lifecycle rev1 and current-checks rev4 contracts are four-party accepted; the material DTO dependency is still being aligned with its producer/UX participants and must not be inferred as approved from this three-file scope. Author static checks do not establish integrated routes, actual Playwright recovery, real task cancellation or physical behavior. No live service/device action was performed by this review.

## Full follow-up source review

Base: `259c817bf989d45edf8f8c694a742d709955a77b`.
Head: `436fb14a271e09c0dfcc392214fd8f724ba839b1`.
Verdict: **changes_requested**.

The exact delta now contains six files: three lifecycle UI files plus shared lifecycle requestId/material reason schemas and their generated JSON. Bounded requestId strings now agree with metadata, and withdrawn material has an explicit eligibility reason. The original material recovery controls and same-pending readback checks are fixed. Project/active read generations also now permit a replacement read and clear old displayed facts. Scoped whitespace check passed. No browser execution was performed; author reports contracts build/generation and Web typecheck/build/lint passing. Backend lifecycle source/navigation remain outside this candidate.

**LIFECYCLE-RACE-02 follow-up — P2:** `send()` still checks only component liveness after awaiting a mutation. If project A's POST is inflight when the component changes to B, B starts its own read. A's late successful result displays A's success in B and invokes its captured `refresh(A)`. Because the current loading project is B, this old refresh is allowed, increments the shared sequence, invalidates B's read, and later discards its own response for a project mismatch. B is left without facts and without an automatic replacement read. The definitive stale-error branch has the same stale refresh. Bind post-command UI messages and refresh to the originating project/active epoch; a verified receipt may settle its matching pending command, but must not invalidate or overwrite the newly selected project's UI/read.

Intermediate 884e544 had no final verdict because the agreed contract changed; its temporary revision must not be treated as approved. No lifecycle browser, real Task cancellation, physical stop, or platform action acceptance is established.
