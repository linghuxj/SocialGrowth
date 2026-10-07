# Closed-loop implementation security preflight

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/ops_fix_adversary`. Baseline: `05f8cf587a9c8f482da92263d194c06250f088ed`. This is a source-boundary preflight, not approval of a new candidate or evidence of real execution. No tests, services, devices, models, private configuration or protected script contents were accessed for this preflight.

## Existing reusable boundary

- `product/executor/src/artemis-read-screen-bridge.ts` is a private, scoped Unix socket bridge. Only the exact active read-screen grant can reach `PhoneActionFence`; original request ID is the durable action ID, and reconnect does not reissue an old physical read.
- `product/executor/src/artemis-read-session-process.ts:35-48` restricts its child to the original Unix socket, private scratch writes and pinned Python execution. It is an observer bootstrap, not a business dispatcher. `integrations/artemis/socialgrowth_read_session.py:45-55` constructs the bound SDK context/operator without `Agent.init/run_task`.
- `integrations/artemis/socialgrowth_read_only_driver.py:27-40` rejects known raw SDK ADB/process paths; lines 97-99 reject all write/navigation methods. These guards alone are not a host-wide fence.
- `product/backend/src/preparation-action-broker.ts:135-158` obtains fresh scoped physical evidence outside SQL locks, reloads the authoritative scope under lock, persists the central begin-call intent, and returns a ticket only for a new command. Replays return `ticket: null`. Its task/assignment/installation/session/local-participation/network/holder checks are not replaceable by request booleans or USB availability.
- `product/executor/src/phone-action-fence.ts:203-239` persists original intent before transport, rechecks authorization after awaited authority, and synchronously hands transport off under the same SQLite write lock as stop requests. The transport result must mean the underlying operation actually ended.

## Minimal integration constraints

Reuse private IPC → durable local fence → current central broker → fixed transport. First establish real read-screen wiring and original receipts. A later writable slice needs a strict action parameter schema and immutable parameter digest bound to the original action ID and ticket. The baseline `PhoneActionRequest` binds scope and kind; it does not by itself bind a tap coordinate or text payload. A generic tap cannot safely stand in for a classified publication/login action merely because its label says navigation.

Do not enable a general `mobile_run_task` via the read-only bootstrap: the existing sandbox denies IP networking, and business model access plus all driver/observer/human screenshot paths require a deliberately constrained integration. Prompt instructions cannot implement physical fencing. Initial stopped/all-paths-fenced/target-quiescent evidence must come from a real trusted source, never a seeded true flag. Existing preparation broker is not yet a business-task broker, and its submit-login path remains explicitly closed at lines 81-83 pending the trusted receipt integration.

## Original-result rules

| Uncertainty | Required behavior and baseline evidence |
| --- | --- |
| SDK launch acknowledgement lost | Read the same immutable intent/trace; never create another attempt to launch again. `artemis-preparation-session.ts:29-42`. |
| Existing SDK trace or guard loss | Poll only the bound trace and serial; attempted stop remains `stop_unconfirmed`. SDK completed/success is only a report, not identity or publication proof. `artemis-preparation-session.ts:52-71`. |
| Physical call timeout or receipt ACK loss | Preserve unresolved occupancy. Replay only the durable original outcome; never obtain a replacement ticket. Reconciliation requires the original action plus current stop-scope trusted ended evidence. `phone-action-fence.ts:164-194,235-243`. |
| Child/socket closes | This is not phone-stop evidence; original fenced work is drained and durable uncertainty remains. `artemis-read-session-process.ts:173-191`. |
| Publication may already have submitted | First verify the original result; no ordinary retry or quota release based on a timeout. `task-recovery-budget.ts:119-123`; `action-permission-core.ts:79-82`. |
| Recovery call is unknown | Keep its active slot; a later real end updates history but does not undo an accepted human/verification gate. `task-recovery-budget.ts:136-157`. |

Recovery-budget decisions are not phone-action permission (`task-recovery-budget.ts:108-109`). A fresh physical query during recovery still requires current permission. The existing two-attempt/five-minute technical recovery budget is not an expiration period after which unknown publication can be resubmitted. Human “processed” is a request for trusted rechecking, not proof of resolution. These constraints do not add individual approvals to routine actions within an already approved project scope.

## Protected historical path

The only exact protected publication-script path located in the existing documentation is `scripts/execute-real-slice-publication.mts`, named by `SEC-WP14-01.md:3`. Its contents, diff and hash were not read. That record requires the actual credential owner to assess the candidate credential and any necessary rotation/log-access response before reuse. General implementation authorization does not close this record or authorize reusing the protected script. Existing remote-execution evidence remains valid within its original documented scope.

New core, UX, recovery and lead implementation candidates require independent review of their exact base/head SHAs. This preflight approves none of those candidates.
