# Independent review: lifecycle unknown-write status

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`.
Base: `8d19a9bf88d779aa7cf1163babdd0f7e9565d57e`.
Head: `0ddba591e665c1332b2f7ea592b41600a419a0bd`.
Verdict: **approved**. Findings: none.

The exact single-file delta in project-lifecycle-panel.tsx separates write receipt uncertainty from fact-read errors. The non-definitive write-failure branch retains the matching prepared command/body/key and displays an explicit unknown status; it does not create a new request or mark success. The existing definitive 409 FACT_VERSION_STALE branch still clears only the matching pending object and refreshes, while its explanatory status survives refresh clearing the read-error area. Existing idempotency-conflict and expired-session meanings remain. A new send clears old status. Project/epoch/pending identity guards and permissions are unchanged; new strings render as React text.

Independent source inspection and scoped whitespace check passed. Typecheck, unit tests, services and real browser/Playwright were not run for this delta under the serialized reduced-load constraint. Status visibility and the real unknown/recovery flow still need browser evidence. This approval does not extend to inherited parent source or root integration.
