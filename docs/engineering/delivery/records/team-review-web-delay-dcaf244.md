# Independent Plan unknown-response test timeout review

Reviewer: `/root/adversary`

Full base: `1bde61548310d741bddffca15161e2b2cf2e7175`

Head: `dcaf244d59ea83b2820f90284c16799adbdf577d`

Verdict: **changes_requested**. The only delta after approved 80e871a is two runner/test files; production behavior is unchanged.

**WEB-DELAY-BUDGET-01 (P2): the new fetch/response budgets still truncate the legitimate backend path.** route.fetch is set to 60 seconds, while the reviewed Plan service may spend up to 45 seconds describing the model and then 30 seconds coordinating it, followed by the final database transaction. The existing 120-second browser response wait includes up to 60 seconds of injected transport delay, leaving the same insufficient backend budget. Choose a bounded fetch budget covering the complete server path with margin, and a response budget including that fetch budget plus the selected delay and margin. Keep the actual UI's 45-second unknown threshold unchanged. The comment claiming the response should arrive before that UI threshold is inconsistent with the test's purpose.

Suppressing direction Playwright raw stdout/stderr persistence in favor of a fixed summary is appropriate because transport errors can include request headers/body. Author reports type/syntax checks; the new recovery attempt has not run. The old default-30-second route timeout and absent plan rows remain failed/unknown evidence rather than successful original-request recovery.

## Fixed complete candidate

Full base `1bde61548310d741bddffca15161e2b2cf2e7175` → head **`ae629796955cf56f83550ae3fe0d028e55805e7d`**: **approved**. WEB-DELAY-BUDGET-01 is resolved with bounded 120-second route fetch and 190-second response wait, including the maximum 60-second genuine-response delay plus margin. UI's 45-second unknown timer is unchanged. The revised comment describes the complete backend path correctly. The only delta after previously approved 80e871a is still the two test/runner files. Direction raw process output is discarded rather than persisted; fixed process summaries and separately scoped safe facts remain. Independent full scoped diff --check and exact runner Node syntax checks passed; author reports script TypeScript check passed. No new actual unknown-response/replay run has occurred yet, so this approves source, not recovery acceptance.
