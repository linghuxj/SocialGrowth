# Independent lifecycle UI findings

Reviewer: `/root/adversary`

Base: `259c817bf989d45edf8f8c694a742d709955a77b`

Head: `5256ed1dcf3dd5aff4d3d2593f7e4c5ad0fb2504`

Verdict: **changes_requested** for the three added API/panel/CSS files.

- **LIFECYCLE-RECOVERY-01 (P2): material withdrawal unknown results have no reachable recovery controls.** The only pending-command controls are rendered for kind project inside the project card. A failed material withdrawal freezes new actions, but its same-request retry and read-only verifyPending branch cannot be invoked from the UI. Expose controls bound to the original variant/revision/request identity; do not create a replacement key.
- **LIFECYCLE-RACE-02 (P2): stale reconciliation can clear a newer pending command.** refresh and material verifyPending capture an old pending command and later call setPending(null) without checking the currently pending identity. While its read is in flight, an original-request retry can finish, then the user starts a new command (start actions ignore loading); the old read may clear the new unknown state. Use synchronous command/operation references and require the current pending identity plus project/active/read generation to match before clearing or updating it. Prevent competing mutation entry until the same-command lock is settled; preserve unknown commands across late callbacks.

The prepared API binds normalized project/variant routes, immutable serialized metadata/body and operator session, and verifies matching receipt identity. No platform deletion or actual stop permission is introduced. The current lifecycle rev1 and current-checks rev4 contracts are four-party accepted; the material DTO dependency is still being aligned with its producer/UX participants and must not be inferred as approved from this three-file scope. Author static checks do not establish integrated routes, actual Playwright recovery, real task cancellation or physical behavior. No live service/device action was performed by this review.
