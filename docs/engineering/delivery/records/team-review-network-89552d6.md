# Tailnet CAS follow-up independent review — 2026-10-04

- Reviewer: `/root/adversary`.
- Base: `2a43976e23caa1010d31caadd97a0b6e964f72d1`.
- Head: `89552d6303973adeabd2e87d15413060ea1b026e`.
- Verdict: **approved** within the engineering adapter scope. Open findings in this exact candidate: none.

## Resolved findings

- NET-CAS-01: `applyReviewedProposal` now snapshots every caller input scalar, all three scope arrays and the resolved recovery path before its first await. All subsequent proposal/review comparisons, file writes and receipt construction use that private snapshot. The added mutation fixture applies the original approved bytes and reports the original saved path.
- NET-CAS-02: recovery save opens a private directory handle, checks its ownership/mode/inode identity, exclusively writes and synchronizes the file, checks the path identity again, and synchronizes the held directory before returning. A failure throws before the external policy POST. This is code and isolated filesystem evidence; it is not an actual power-loss recovery experiment.

The additional inventory read computes a deterministic device-ID/address digest and requires the reviewed digest to match. Scope address sets must cover the current inventory with pending/preserved separation, and the inventory is read again before saving recovery and issuing the policy CAS. This is a bounded pre-write check; device inventory is not atomically locked with a policy ETag and it does not prove live isolation. The source diagnostic is now correctly named liveSourceVerified.

## Independent validation

Extracted the exact head's CAS source/test and its proposal/source-verifier dependencies into the reviewer's ignored `.runtime/review-net-89552d` directory. Ran from canonical repository:

`pnpm exec tsx --test <adversary>/.runtime/review-net-89552d/tailnet-policy-cas.test.ts`

**10/10 passed**, covering private configuration, refused read-only credentials, strong ETags, proposal/recovery/If-Match/readback, input mutation, stale policy/inventory, unsupported policy, validation rejection, unknown write acknowledgement without retry, and exact-state rollback. Full three-file diff inspected. Producer backend type/lint and source-verifier 16/16 evidence was not independently rerun here.

## Remaining boundaries

No Nest runtime/provider wiring or admission revision production is added. Apply success still returns isolationVerified/networkAdmissionGranted/actionPermissionGranted false. This review does not approve a particular live policy proposal, load a real write configuration, call Tailnet APIs, touch the phone, or remove H4-H5. Live API response compatibility, restricted data-plane reachability, native online readiness, power-loss recovery, Web/native acceptance and full-product delivery remain unverified. Lost write acknowledgments require inspection of the original operation/current state; no retry or inferred permission is approved.
