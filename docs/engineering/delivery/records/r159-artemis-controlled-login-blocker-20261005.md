# R159 Artemis controlled-login integration boundary

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Checked against the tracked `integrations/google-artemis` HEAD `371aa6df56880643da57b30da936e9812fb0ec66` on 2026-10-05. The external checkout contains user changes; it was inspected read-only and was not edited, patched, or started.

The SocialGrowth candidate implements action-field scoping, exact account-to-device assignment rechecks, and a one-shot secure-input adapter. It does not register that adapter with Artemis or provide an authenticated host-to-device consumer. No credentials were sent and no assisted login was run.

The current nested `mobile_run_task` path has no supported custom-tool injection point. In the tracked SDK, `artemis/sdk/agent.py` imports and calls `get_graph(context)` directly; `artemis/graph/graph.py` defines `get_graph(ctx)` and constructs the `OperatorNode` tool list internally. `OperatorNode` accepts a `tools` list, but neither `AgentConfig` nor `mcp_server/background/task_runner.py` exposes a way for SocialGrowth to supply one. The existing MCP client in SocialGrowth calls the upstream MCP server; it cannot inject a LangChain tool into the server's nested `Agent` run.

The observation quarantine also has no complete choke point today. The tracked upstream obtains screen data through the graph perception path; the operator consumes screenshot/XML state; MCP exposes `observe_screen`, `take_screenshot`, and `get_ui_hierarchy`; validator and planner code also read screen state through controller/action-session APIs. A safe extension must install one task-scoped close-and-drain gate across those paths before any sealed input is issued. Android v1 has no signed CLEAR phase, so even a complete input adapter cannot resume model observation or verify login automatically; the session remains quarantined for human handling.

The current SocialGrowth Python adapter uses a separate JSON IPC shape. There is no corresponding trusted host server, no connected-peer authentication on this platform's Python socket API, and no SGHP/SGME/SGMS framing integration in the host. It therefore remains unavailable and must not be injected into an Artemis task.

The next source change requires an owner-maintained Artemis extension point for scoped operator-tool construction plus a session-wide observation gate at the actual perception/controller/MCP observation boundaries, followed by a trusted host server that forwards the frozen rev15 protocol. If any observation entry point cannot be drained and denied during quarantine, `assist_existing_login` must stay disabled. Do not claim an end-to-end login until the extension, gate, authenticated channel, Android installation/key enrollment, and real authorized device verification are all present.
