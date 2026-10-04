# Independent Plan unknown-response test timeout review

Reviewer: `/root/adversary`

Full base: `1bde61548310d741bddffca15161e2b2cf2e7175`

Head: `dcaf244d59ea83b2820f90284c16799adbdf577d`

Verdict: **changes_requested**. The only delta after approved 80e871a is two runner/test files; production behavior is unchanged.

**WEB-DELAY-BUDGET-01 (P2): the new fetch/response budgets still truncate the legitimate backend path.** route.fetch is set to 60 seconds, while the reviewed Plan service may spend up to 45 seconds describing the model and then 30 seconds coordinating it, followed by the final database transaction. The existing 120-second browser response wait includes up to 60 seconds of injected transport delay, leaving the same insufficient backend budget. Choose a bounded fetch budget covering the complete server path with margin, and a response budget including that fetch budget plus the selected delay and margin. Keep the actual UI's 45-second unknown threshold unchanged. The comment claiming the response should arrive before that UI threshold is inconsistent with the test's purpose.

Suppressing direction Playwright raw stdout/stderr persistence in favor of a fixed summary is appropriate because transport errors can include request headers/body. Author reports type/syntax checks; the new recovery attempt has not run. The old default-30-second route timeout and absent plan rows remain failed/unknown evidence rather than successful original-request recovery.
