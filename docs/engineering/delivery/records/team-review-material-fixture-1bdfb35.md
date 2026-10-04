# Independent review: material rev9 test fixtures

Reviewer: `/root/adversary`.
Base: `cabc6f8ac8074b47b79078750a3cddf6407ddcdf`.
Head: `1bdfb351d62f81880ce056eb95059b3870632daa`.
Verdict: **approved**. Findings: none.

The complete delta is limited to `product/web/src/material-api.test.ts`, `material-batch-api.test.ts`, `material-current-read.test.ts`, and `material-save-api.test.ts`. Each adds the required rev9 `withdrawal` object to a normal current/saved unit fixture, with state `not_withdrawn` and materialRevision/requestId/recordedAt null. No assertions, production schemas, parsers, permissions, client logic or business responses change. The fixtures remain explicitly synthetic non-UI unit inputs and do not claim real withdrawal/source facts.

Independent source-diff inspection and full-range whitespace check passed. The author reports the focused four-file unit run passing 33/33. Following the reduced-load instruction, the reviewer did not duplicate that run or start services, browsers, containers or emulators. This approval covers only the four-file delta; it does not approve the parent production tree, root integration or actual Web/material acceptance. Later source changes require a new exact-head review.
