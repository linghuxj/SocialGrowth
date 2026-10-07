# Independent direction output diagnostic review

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

Reviewer: `/root/adversary`

Base: `04058855e2eed435f32be84316e175ef71ef1711`

Head: `34aea3a0a688a8172128b8dfae4b097fcc43cbca`

Verdict: **approved** for the complete candidate source, retaining the previously reviewed metrics/Plan boundary in head 35d7ac2. The new delta is exactly three files: Artemis adapter diagnostic helper/test and the existing Python initial-direction system prompt.

The prompt clarifies the existing strict three-field output schema without stripping unsupported fields, fabricating an outcome, weakening validation or adding actions. The diagnostic helper outputs only a finite allowlist of paths/categories and an extra-key count capped at 100; unexpected keys, values, model output and Zod messages are omitted. Output byte length remains bounded by the existing response parser. The adapter's process/time/output limits and initial-direction authority are unchanged.

Independent exact-source diagnostic test passed 1/1, Python compile-only syntax check passed without executing the model/configuration, and full scoped diff --check passed. Author reports contracts build/generation, backend typecheck and full backend 395/395 passed. No actual model/browser rerun is part of this evidence; prior model schema failures remain unresolved as live outcomes until a controlled actual run verifies them. No publication/device permission is created.
