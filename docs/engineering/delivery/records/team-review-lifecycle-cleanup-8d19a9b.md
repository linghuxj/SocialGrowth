# Independent review: lifecycle read cleanup

Reviewer: `/root/adversary`.
Base: `1bdfb351d62f81880ce056eb95059b3870632daa`.
Head: `8d19a9bf88d779aa7cf1163babdd0f7e9565d57e`.
Verdict: **approved**. Findings: none.

The complete delta is one effect cleanup in `product/web/src/project-lifecycle-panel.tsx`. In addition to liveness/read-sequence invalidation, cleanup advances refreshGeneration and clears loadingRef/loadingProjectRef. A subsequent effect setup can therefore start a replacement read instead of being suppressed by the old same-project loading guard. The old read's sequence checks prevent data application and the old refresh generation prevents its finally block from clearing the replacement read's loading state.

Pending command refs, prepared request body/key, write guards, project/active-epoch checks, contracts and permissions are unchanged. No cancellation, retry, mutation or execution capability is added. Independent exact diff review and scoped whitespace check passed.

Typecheck, unit tests and actual StrictMode/browser behavior were not run for this candidate under the serialized reduced-load constraint. The forthcoming real Playwright result must establish the runtime correction. This is a single-file source approval, not an approval of inherited parent production source, whole-root integration or lifecycle business acceptance.
