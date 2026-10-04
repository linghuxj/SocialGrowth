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

## cb66bef 修复复核 — changes_requested

完整 Web base 仍为 `603ace4a9fd03007f23424366c839885f144ae80`，新 head `cb66bef68bc2cc104239051d679f45659c7b7e0d`。与 b025 相比只有 API、panel、verifier 三文件修改；完整范围 diff-check 通过。源码修复已允许 currentCycle=null 与旧配置共存，原命令 send 不再强制要求当前周期；确定 stale 结果在刷新后保留；原 body 比较改为有限布尔和 abort，不再构造含正文的断言。CYCLE-UI-STALE-02 和 CYCLE-UI-LOG-03 的原发现闭合。

CYCLE-UI-EXPIRED-01 仍有未修部分：持久 pending 的记录与 lookup/retry 按钮仍被包在 view 成功渲染分支中。重载时当前周期 GET 失败，哪怕 command lookup 可用且原 actor 有权限，页面仍没有恢复入口。请将 pending 恢复区移到当前事实成功分支之外，保留新写要求有效活动周期的限制。

另新增脚本局部类型错误：`route.fetch()` 返回 Playwright `APIResponse`，此次标注成了 `Response`。Web check 不包含该 .mts 脚本，不能覆盖此错误。请使用准确类型/推断并检查该脚本；本 reviewer 未运行编译或浏览器，也不需要用真实模型暴露静态错误。作者应修正后给新的精确 head，此候选尚未批准。

## 最终完整 Web 候选 40b3dfb — approved

- Reviewer: `/root/adversary`
- Base: `603ace4a9fd03007f23424366c839885f144ae80`
- Head: `40b3dfb6591688dfbd58b19c694440ee767c38ea`
- Verdict: **approved**，完整七文件 Web/验证器/runner 增量。
- Findings: 无未关闭问题。CYCLE-UI-EXPIRED-01、CYCLE-UI-STALE-02、CYCLE-UI-LOG-03、CYCLE-UI-VERIFIER-TYPE-04 均关闭；旧 head 的 changes_requested 记录保留。

独立确认完整七文件中五个与上轮复核完全一致，两处最终修改已逐行检查：pending 冻结记录及 lookup/显式 retry 控件移到 view 成功分支之外；原命令 send 不要求当前活动周期，但仍要求同 operator、有效持久原 body/key、当前会话、没有冲突/存储故障以及非只读写入口。新配置仍要求 view/currentCycle 和明确确认。周期已结束时合法旧配置可显示，cycle GET 失败不再遮住原命令恢复入口。另一处改为准确的 Playwright APIResponse 类型，没有改变真实 route.fetch/有限失败逻辑。

本完整候选继续包含前述 operator 非秘密上下文、reload 原请求恢复/不同 actor 禁止接续、会话变化检查、固定项目作用域和两项 false 许可。确定 stale 结果不会被刷新清掉；原请求比较仅产生布尔/固定错误，不把原正文或键拼入断言。模型环境仅由显式绝对 root 开启；无 root 时明确 draft-only，不把它写成 cycle acceptance。

Reviewer 完整 diff-check 通过，未运行测试/编译/浏览器/模型/设备。作者报告本 head Web typecheck、独立 verifier strict TypeScript check、diff-check 通过；先前 API11/11/build/lint 是其原版本补充，不能当作新完整候选 UI 验收。实际首轮 dirty82d50 来源仍为模型/方向完成后配置步骤超时；b025 后续尝试在模型前按审查中止，没有第二次模型成功结果。本精确 head 的真实页面与一次模型流程仍未执行，获本源码批准后由主会话授权窗口继续。

SEC-CYCLE-CONFIG 的 backend 与 UX 精确源码审查均已有记录，审查任务可完成；功能开发/实际验收任务不随之完成。后续根组合必须重新按完整 base→head 独立复核，此 Web 增量批准不覆盖未来整合结果、下一周期真正生效或真实设备执行。

## 有限定位候选 2918374 — approved

- Base: `603ace4a9fd03007f23424366c839885f144ae80`
- Head: `29183749cf6827d63b0e7802a4bce72f3b4418a1`
- Reviewer: `/root/adversary`
- Verdict: **approved**，同一完整七文件范围，无新 findings。

与已批准40b3的唯一差异在 planning verifier：对 B 表单实际 enabled 状态增加断言，将 B 编辑及 A 导航/读取/表单填写阶段记录为固定字符串。不包含输入正文、密钥或服务端原错误，也没有改业务代码、路由、模型次数、请求体或状态判定；完整 diff-check 通过。其余完整来源与此前审批一致。

作者报告40b3的一次真实模型完成方向确认和 B 周期 GET，随后超时，cycle POST 尚未观察到，没有配置成功回执；该次失败不作为配置 UI 通过。本 reviewer 尚未读该次有限 artifact，只记录作者报告，并提示保留实际运行 head/旧 checkpoint 原值（40b3为 second-operator-current-cycle-read，新291改为 B-current-cycle-read）。作者报告新候选 Web check、独立脚本 strict TS、diff-check 通过；新候选的实际页面尚未运行，下一次仍需主会话单独分配窗口。本次仅源码审查，无测试或运行环境操作。

随后独立读取作者指定的 `UX-CYCLE-CONFIG-40b3dfb-20261004/planning/cycle-config-failure.json` 与同目录 cleanup.json：实际 checkpoint 确为 second-operator-current-cycle-read，phase 为 cycle-config-lost-response，TimeoutError、actualModelAttempts1、cycleConfigAcceptanceExecuted=false、cyclePostObserved=false、safeCycleFacts空；清理记录为自有服务退出、两容器ID移除、临时凭据删除。没有正文/原key/凭据。该有限证据核对替代前段“尚未读”状态，未读取原始日志/截图，也未复跑浏览器；当前UI仍未通过。

## 2918374 导航补充发现 — 撤回当前批准

同一精确 base603ace4→head29183749cf6827d63b0e7802a4bce72f3b4418a1 的当前 verdict 改为 **changes_requested**。此前源码批准保留为历史，不能再用于 PR 门禁；reviewer 对新增线索重新核查后修正结论。

**CYCLE-UI-NAV-05 — P2，验证器对保留的项目详情误按列表导航。** 主会话提示后，独立读取 app.tsx 与 project-panel.tsx 确认：ProjectPanel 始终挂载，active 仅决定隐藏，selected 和 tab 保留；只有 selected=null 才渲染项目列表 row。verifier 在 A 已选项目设置后切到 accounts 创建 B，再点“项目”仍是 A 详情，却直接等待该项目 row/准备清单，必定没有列表目标。后面 cleanup account→项目→mobile 检查也有同样前提。应通过已有真实“返回项目列表”入口回到列表，再按预期项目重开，或明确处理仍在同一详情的真实 UI；不改业务状态或用后台调用替代。

此前40b3有限证据的 phase=cycle-config-lost-response 是 B 的三个输入编辑后才赋值，因此它已越过 B 编辑，超时发生在返回 A 的路径；旧 checkpoint 较粗不能推断卡在 B 编辑前。291只有新检查点，并未解决这条可由源码定位的导航缺口，不能用又一次模型运行来重复发现。已直接要求 UX 最小修正并新精确 head，暂停当前候选的运行/PR建议，其他已关闭 findings 不重开。

## 22b788b — 导航修复闭合，确认框顺序待修

精确完整 base603ace4→head `22b788b253533d5e411d5d3bb8cbc7f0e6e57e39`，verdict **changes_requested**。唯一新增脚本差异已在两次 accounts→项目切换后检测并点击真实“返回项目列表”，再选项目行，CYCLE-UI-NAV-05 闭合，原四条 finding 保持关闭；完整 diff-check 通过。

**CYCLE-UI-DIALOG-06 — P2，验证器临时账号清理的确认处理注册过晚。** 核对 app.tsx 的 onDisable 先同步 window.confirm；脚本 cleanup-temporary-operator 却先 await 停用按钮 click，之后才 page.once(dialog.accept)。前面的单次 handler 已被配置确认消费，当前没有处理者；确认会被默认拒绝，无法得到“账号已停用，会话已撤销”。请在 click 之前注册该次 dialog handler。仅需调整验证器两行顺序，不涉及产品行为。已直接要求作者在新模型运行前修复，避免到流程末尾再失败；本次未实际运行浏览器。
