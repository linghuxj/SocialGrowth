# Independent complete Web lifecycle/cycle integration review

Reviewer: `/root/adversary`.
Base: `1bde61548310d741bddffca15161e2b2cf2e7175`.
Head: `73fcd5ffb1836eb3773f39ea6a82d5a19185f607`.
Verdict: **changes_requested**.

## Full source review

The scoped full diff contains 134 files. Of these, 120 exactly match blobs within previously approved candidate diffs, including full Web/Plan/metrics source ae629796, complete root checkpoint7e8f33b, control/lifecycle source e18d52fe, cycle writer6cdebcce, lifecycle UI9f1f588 and its cleanup/status corrections, and material fixture1bdfb351. The remaining 14 files were inspected independently: historical documentation/reviews and fixed CI metadata, the composed BusinessPlan PostgreSQL test, lifecycle CSS import/project navigation, root dispatcher/owned runner and direction/lifecycle Playwright scripts. The composed PG test retains the approved e18 source plus the exact approved259bdb6 guard-lock regression. The changed historical reports retain their original scoped conclusions. Root's7e CI metadata is limited to that older candidate, not the present head.

Lifecycle panels are keyed and retained per project with active flags, so pending commands survive project-tab navigation while remaining isolated. Production AppModule, authority checks, immutability, operator/CSRF/session handling and default-deny permissions match approved source. No automatic executor, device worker or publication permission is introduced. New runner cycle queries are read-only; commands and model confirmation still originate in the actual UI. Browser interception fetches the real backend response and only delays/drops delivery; it does not replace business outcomes. Raw Playwright child output is discarded, finite read/error labels and body/key hashes are persisted.

## Finding

**WEB-LIFECYCLE-WAIT-01 — P2:** The new lifecycle verifier awaits deferred signals such as pauseResponseCaptured and heldARead with neither a deadline nor rejection channel. If the associated route.fetch fails/times out, or the route's successful-receipt assertion fails, the route handler rejects but the main script remains waiting for a signal that will never resolve. It therefore cannot reach catch/finally, and the owned runner, which awaits the child exit, cannot clean its temporary services/containers/credentials. Bound those waits and propagate the route failure (without persisting raw transport details); ensure finally releases held routes. Do not turn a missing receipt into successful evidence.

## Actual designated safe evidence

Read only the explicitly designated run7 result files in ux-web/artifacts/acceptance/product/B3/ux-lifecycle-cycle-20261004-run7; no raw logs/screenshots/traces or secrets were inspected. The lifecycle result records two UI-created isolated projects, a v0 pending material saved/withdrawn through the page, delayed A pause response remaining isolated from B, and a real committed end response lost in browser transport followed by the exact original body/key replay. Original and replay body/key hashes match; both HTTP statuses are201, first changed=true/replayed=false and retry replayed=true. All70 finite read events report200; device/publication flags remainfalse. The cycle result records one real-model proposal and UI confirmation, with separate read-only facts: cycle_rows1/current_approval_bindings1/approved_input_matches1, Asia/Shanghai and captured ICU/tzdata versions. Cleanup reports owned services exited, two owned container IDs removed and temporary credentials removed. These are author-run artifacts, not a second reviewer browser run or live cleanup inspection.

The shared business_plan_commands journal also holds lifecycle commands. Their column default outcome=unknown does not override their actual lifecycle response receipts and is not evidence of four Plan failures, model attempts or rollback. No database correction is warranted by that generic column.

Independent full-range diff-check and provenance comparisons passed. Author reports Web typecheck/verifier TS checks and run7 contracts/backend builds and direction/Plan PostgreSQL checks. The successful run7 does not exercise the failure hang above; the candidate remains unapproved until fixed. This review does not establish real nonempty Tasks, physical execution/stop, repeated cycle advancement, live metrics, platform publication, production recovery or root's later full-head acceptance. Historical failures and original pending security gates remain preserved.
