# Historical impact Playwright increment review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`
- Base: `bf4fee09f6632242a6fc77d76b95ca834d7417fd`
- Head: `f08b205778cb61ef1c52151e1e667ebd836afd5c`
- Verdict: **changes_requested**
- Scope: one root Playwright verification script, source only.

TODO-PROBE-01 (P2): the per-impact version assertion searches the whole panel and demands exactly one matching version. Two legitimate devices with the same recorded version fail. Scope each version assertion to the list item containing its device ID. Also narrow existing `getByText(/影响设备/)` to an exact specific element: the new historical-impact heading and aggregate text now create multiple matches, which makes `waitFor` fail in strict mode on a real positive detail page.

TODO-PROBE-02 (P2): successful screenshots mask the new device-ID impact list, but the catch/failure screenshot does not. Apply the same impact mask on the failure path so precisely the failures under investigation do not expose the IDs the script otherwise intentionally redacts.

The increment correctly waits for a real GET rather than synthesizing business responses, and does not seed or mutate business state. Diff-check passed. Actual positive detail remains untested; the preceding real feed was empty. Findings are source-verifiable; no browser or service operation was performed by the reviewer.
