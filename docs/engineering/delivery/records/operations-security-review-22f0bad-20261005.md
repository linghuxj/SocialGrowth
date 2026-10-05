# Independent operations candidate review

Reviewer: /root/ops_fix_adversary
Base: eee006bc3b68bc4429d2720d2069e3f78f8f19a7
Head: 22f0bada5d49e75c63c07926fcec0ea743f5d0df
Verdict: changes_requested

## Finding OPS-SEC-01 (P2)

`scripts/verify-product-project-viewports.mts:16` waits for a heading named 打开项目, which only exists as a list button. The replacement overview heading is 项目当前事实与下一步. The same script at line 24 still locates the removed 缺阶段目标及批准边界，不启动发布 cell, so the mobile assertion also cannot complete. Update both selectors and retain a meaningful actual-current-overview viewport assertion. This prevents this supported Playwright scope from running to completion; it is not a runtime permission bypass.

## Evidence and boundaries

Read the full changed production React components, shared fact adapter and its focused tests, operations Playwright script, other Playwright navigation diffs, runtime gates and current AGENTS/CLAUDE changes. `git diff --check eee006b..22f0bad` passed. New adapter fences current session, hides late responses via effect cleanup, distinguishes empty/zero from read failure, and explicitly exposes global unassigned-device assistance with continuation cursor. Fixed AI/publish/recovery timers and fake receipts are absent. New UI mutations reuse existing guarded requests; no new backend execution or publication permission was introduced. Server BusinessPlan execution/publication remain false; account-preparation observations remain unverified.

No independent browser, service, model, USB or publication run. Review worktree has no node_modules; focused unit test was not run here. Producer evidence states 11 Web checks and 89 tests; this review does not turn those into independent execution evidence or full business acceptance. The service/USB policy changes are treated as the lead-reported latest user authorization and do not grant platform action permissions.
