# Material current-candidate independent review — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`.
- Base: `f583f184891bd3d0406c43821cb3d36e2eb1233a`.
- Head: `2bef1b42deed8db3d429190c84cd7c684c2a3113`.
- Verdict: **approved** for the exact engineering candidate; findings: none in scope.

## Scope and contracts

The complete base/head delta has 13 files. Three are the previously approved H2 backend scan/runtime/controller-test files; independently compared each Git blob with approved `fc28ad0691f2250a8880c1c6c42a3e9efe0ca2bf` and all match. The other ten files implement material declaration compatibility, current eligibility projection, shared/generated DTOs and regression checks. Canonical material-candidate-read revision 8 is accepted by /root/backend and /root/web.

## Independent review

Operator authentication and CSRF stay server-side. Object verification remains outside database locks followed by fresh authentication and database revalidation. Registry guard/project locks serialize the relevant current material/direction facts. Submitted scope fields are declarations to compare with current server facts, not authorization inputs.

Old declarations normalize to null/null/false and cannot auto-promote. Only an exact current approval ID, post-confirm project version, matching draft inputs/version, language and media form, plus an affirmative rule review yield candidate status. Existing immutable object manifests remain pinned to verified bytes. Exact SHA reuse by another content unit includes historical bound revisions; a bare upload does not count as reuse. Source-record conflicts remain closed. History remains pending_validation; only the current read is projected as candidate. Legacy idempotency equivalence is accepted only when all added confirmation fields are defaults.

Response schemas bind status, candidateAllowed and finite eligibilityReason consistently, reject caller-supplied authority/config extras, and always require publicationAllowed false. Evidence IDs remain opaque references and are not interpreted as external rights verification. Candidate status supplies no dispatch or publication permission.

## Validation and limitations

Extracted exact candidate contract sources into `.runtime/review-material-2bef1b/src` and independently ran `pnpm exec tsx --test <adversary>/.runtime/review-material-2bef1b/src/material-registry.test.ts` from canonical repository: **5/5 passed**. Full delta `git diff --check` passed. Producer reports contract TS69/Python38, generation/check, backend379, isolated PostgreSQL store16 and HTTP+MinIO API9 passed; those broader runs were not independently rerun here.

No business Playwright, external source/rights verification, actual first-use/publication, real phone, task dispatch or live production operation was performed by this reviewer. Approval of this bounded candidate does not clear old WP10/SEC-WP14 findings or constitute full product acceptance.
