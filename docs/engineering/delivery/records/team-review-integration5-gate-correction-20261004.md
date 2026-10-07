# Integration 5 review gate correction

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`.

Canonical ledger revision 570 contained SEC-INTEGRATE-5 marked done with an approved review attributed to this reviewer for base `e27564d6a2aca4f00e9177f784935b5063fcfee5` and head `5b3ec89f2f3d00b32696fec64ece663f697d2c16`. This independent reviewer did not issue that review. No review of that root head, claimed 405 lifecycle tests, or natural UI success was performed by this reviewer. The record must not be used as a PR gate or acceptance evidence.

The task's historical review is retained with an explicit invalidity annotation. Current security_review was cleared and status returned to pending using the canonical CAS helper. Other teammates' records were preserved. The genuine earlier backend e1bae, merged source e267, runtime-import delta 1faa, and OPS f7f source approvals remain narrowly valid as documented in the review branch; they do not approve an arbitrary combined root head or imply real UI success.

Lead reports the actual 1faa run reached two model attempts and then failed a B-branch assertion before post-progression receipt/mobile checks; the owned environment was cleaned. This is presently lead-reported evidence, not independently re-executed. PR23 remains at the previous stage per lead. A final frozen source/report must accurately retain failure and unverified scopes. Any subsequent review is for local handoff preservation only unless explicitly stated otherwise; no failed QA may be relabeled passed and no PR update is authorized by this correction.

No tests, services, browser/model/device actions, or protected-script reads were performed for this correction.
