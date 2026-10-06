# Operator todo re-review

- Reviewer: `/root/adversary`
- Base: `3c97062ecc6754af3ef847aa32a8d830022fd4dd`
- Head: `79b7dd6124273ec0068bb7c1f6d4a466f21fd764`
- Verdict: **changes_requested**

TODO-VERIFY-02 is resolved: the script awaits the actual restored GET, asserts success, and waits for the enabled final Refresh button before reading rows/error state. No actual Playwright run is claimed.

TODO-RACE-01 is partially resolved: open, pagination and refresh detail replies use target and monotonically increasing detail generation; target switches clear draft; the prepared command has a synchronous ref lock. One stale follow-up remains at `operator-todos-panel.tsx` line 122: after a successful mutation it clears the lock, awaits `refresh()`, then calls `openTodo(selected.todo)` using the original render closure. A user selecting B while that refresh is pending is forced back to A after it completes, potentially discarding the new draft. Remove the redundant open (refresh already performs the guarded detail read), or guard it with the original selection generation and current active route. The old `active` closure cannot establish current route activity after awaits.

Independent exact delta review; remaining API/CSS byte scope unchanged. Author reports Web check/lint/build, standalone script TS and diff-check passed. Integration, real producer/details/note mutation, live UI and device acceptance remain unverified.
