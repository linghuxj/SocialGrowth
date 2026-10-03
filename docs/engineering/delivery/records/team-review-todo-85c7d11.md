# Operator assistance todo candidate security review

- Reviewer: `/root/adversary`
- Base: `3c97062ecc6754af3ef847aa32a8d830022fd4dd`
- Head: `85c7d1133e1d2ec3e6beb472feea34aa24cc96b2`
- Verdict: **changes_requested**
- Scope: four new files: device assistance API helper, operator todo component/CSS, root Playwright script. No App navigation/runner integration in this candidate.

## Findings

### TODO-RACE-01 — P2: stale detail responses can change the note target

`operator-todos-panel.tsx` lines 65–89 allow multiple detail operations without a selection generation or expected todo check. Start older-note pagination for A, select B, let B resolve, then resolve A: the functional update retains B notes, appends A notes and replaces its todo with A. `openTodo` and the detail read inside `refresh` can also overwrite a newer selection. The draft/kind remain unchanged across selection. A note written for B can consequently be prepared against A after the stale response arrives. The backend can correctly authorize this write while still receiving the wrong user-intended target.

Bind every detail/pagination refresh to a captured selected todo and read generation, discard superseded replies, and reset or target-bind the draft on selection. Preserve the exact prepared command and target for an unknown write. Do not mix histories from different todo IDs.

### TODO-VERIFY-02 — P2: recovery result is recorded before recovery finishes

`verify-product-operator-todos-playwright.mts` lines 39–45 waits only for the alert to become hidden after Refresh. The component clears the alert synchronously at refresh start, so this is not evidence of a successful reread. The script can count the previous rows and later report `transportFailureRecovery: true` even if the restored request fails. Await the actual restored GET success and completed page loading, then assert final visible state and absence of the error.

## Evidence and boundaries

Independent review read all four candidate files, existing operator request/CSRF/session-bound prepared-write helper, and exact source diff. React escapes displayed text; mutations retain strict DTO parsing, same-origin operator route and captured session guard; no automatic retry or device grant is introduced. The component correctly describes notes and reported processing as pending recheck, not restored authority. These positive boundaries do not clear the findings above.

Author reports Web check/lint/build, standalone script TS compilation and diff check passed. Actual Playwright has not run; navigation integration and a real positive producer/detail sample remain unverified. No UI, phone, service, credential, database or publication mutation was performed by the reviewer.
