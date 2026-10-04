# 下一周期配置 Web 完整增量复核

- Reviewer: `/root/adversary`
- Base: `603ace4a9fd03007f23424366c839885f144ae80`
- Head: `b025d68644a54a4e52b527f388be380aed173750`
- Verdict: **changes_requested**
- Scope: Git 实际完整七文件（五个 Web 文件及两个 runner/verifier），不是只审最后 checkpoint；不替代后续根组合审查。
- Contract: `project-cycle-next-config` rev3，backend/UX 已双签。

## Findings

1. **CYCLE-UI-EXPIRED-01 — P2，合法历史配置被拒绝，过期周期的原请求恢复被阻断。** `project-cycle-config-api.ts` 的 `validateRead` 要求只要有 nextConfiguration 就必须存在 currentCycle。后端在原周期结束后合法返回 currentCycle=null，同时保留最后确认的 nextConfiguration；客户端会将其视为响应非法。页面重载后 view 无法建立，而 `project-cycle-config-panel.tsx` 的 pending 核对/接续控件又在 view 成功分支中；`save` 本身也以 `!view?.currentCycle` 直接退出。用户已经持久保存的未知原请求，在周期结束后无法正常核对或显式同键回放。应允许合同规定的历史配置与无活动周期共存；禁止新确认与允许核对/接续原命令必须分开，恢复控件不应依赖当前周期读成功。

2. **CYCLE-UI-STALE-02 — P2，确定版本拒绝提示立即被刷新清除。** `save` 的 FACT_VERSION_STALE 分支先 setError，再立即 await refresh；refresh 开头同步 setError("")。React 批处理可能根本不呈现“配置版本已过期”，用户无法区分明确拒绝与普通刷新。当前真实 verifier 正在等待该 alert，也会因此超时。应把确定写入结果与可清除的读状态区分，保留拒绝及输入，成功刷新不能吞掉该结果。

3. **CYCLE-UI-LOG-03 — P2，原命令比较失败时构造含 body/key 的异常。** `verify-product-planning-playwright.mts` 的 route handler 使用 assert.equal(body, firstBody, ...)；不相等会将原正文与 metadata.idempotencyKey 附到 AssertionError。该异步 handler 再抛出错误，不能保证进入主流程有限失败摘要。隔离 runner 丢弃子进程原输出只能保护该启动路径，直接 Playwright 入口仍可能输出原命令。改成布尔比较与静态提示，并将 route 失败以有限安全错误传播主流程；不输出原 body/key/headers。

三个问题已直接发送 UX；待作者修复并提供新固定 head，当前不得用于 PR 批准。

## 已核对的其他边界

读取全部七文件及其实际父组件/后端契约依赖。完整 diff-check 通过。operator 新上下文只保存规范化 operatorId/sessionId；会话清除同时删除上下文，失败退出不假装退出。冻结请求在发送前写 sessionStorage 并回读，包含原 body/key 与非秘密 actor 信息，不保存额外 session token；回放只在同 operator 明确操作后重建当前会话的 Prepared 请求。不同 operator 禁止命令 lookup/POST；服务端 actor/project/key 授权仍独立生效，浏览器本地记录不是服务端授权。

项目父组件按 projectId 保留独立 keyed planning panel，未把 A 的本地待确认对象当作 B 的命令。API 规范化项目，读回/发送检查项目和 requestId；nextCycle=null 与执行/发布 false 保持，页面不声称配置已经物化或生效。

runner 仅在明确提供绝对 Artemis root 且 planning/direction scope 时开启实际模型模式；没有 root 的 planning 仍只验 draft，并将 cycleConfigAcceptanceExecuted 标 false。verifier 从真实页面建工程项目、请求一次真实方向模型及确认，再用真实接口回执丢失构造未知，不注入业务成功。参数和失败计数可作有限定位；它们不证明真实 UI 已通过。已有 runner 对所有 Playwright 子输出采取固定摘要，仍不能替代修复 finding3 的脚本本身。

## 验证和限制

作者报告 Web 类型检查通过，此前对应 API11/11、构建/lint 通过。首轮实际浏览器在提交前源码完成一次模型与方向确认、A/B 周期读取，配置按钮阶段超时，没有配置成功回执；自有资源已清理。当前 b025 仅补有限 checkpoint 后尚未重复真实验证，首失败保留。Reviewer 未读取原始日志/截图/配置，未启动编译、测试、服务、模型、USB 或容器。

后端 603ace4 的独立批准继续有效；本次没有把后端 PG 工程检查推定为 Web 通过。SEC-CYCLE-CONFIG 保持进行中，修复后再按精确 SHA 复核，整体根候选另审。
