# 第三批根组合独立复核

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`
- Base: `7e8f33b57e133db53940400f40997f4d71854c7c`
- Head: `5c8960f6e74a3e55105693722b3443f95aa312bc`
- Verdict: **approved**
- Task: `SEC-INTEGRATE-3`
- Findings: 本次精确组合范围内无未关闭的实质安全问题。批准允许该固定提交更新现有 PR；不表示最新 CI、部署或系统整体验收已经通过。

## 范围与独立核对

审查 base→head 的全部 93 个已提交变更文件，明确排除用户未提交修改及受保护的发布脚本。本次未读取、比较、哈希或运行该脚本，未操作主工作树。审查报告保留在独立 adversary 工作树，避免改变被审 head。

逐文件核对提交对象：74 个文件与此前独立批准的完整源码候选或本 reviewer 的审查记录精确一致；其余 19 个是新增有限证据和说明，已逐项读取。全部 55 个 `product/` 与 `scripts/` 变更均有精确匹配来源，无未审的组合解决差异：

- Web 完整源码 `1bde61548310d741bddffca15161e2b2cf2e7175` → `1c84441d764424e6530ef5d8859dada12845a7dc`：包含已复核的完整 lifecycle/attempt 后端、共享契约、周期 writer、Web 页面和验证器，见[完整 Web 审查](team-review-web-lifecycle-73fcd5f.md)。该完整来源已纳入后端 `e18d52fe6dddf441ed65912ea3bbfbf83e24dbfc`、周期 `6cdebccea36adca8e04f975a61f3ea3ef01ec05a` 及其已关闭 findings；本次没有只凭最后一个测试提交推定父链批准。
- 运维增量 `862508b9738b85fe74563fa6fe07ce35a801a83d` → `eaef30124880aeaba2714c83d6e494380783de0e`：恢复测试和记录精确一致，见[36 迁移 inventory 审查](team-review-ops-inventory-eaef301.md)。
- 进程停止 `2c7910eee3d6e597c8310b692b7631e067734e60` → `dba7b344de5d55d304b50ed650abb5c9aefd34e4`：仅登记的自有进程组，ESRCH 后仍继续处理其余组，见[进程停止审查](team-review-process-stop-dba7b34.md)。

另在根候选重新检查 AppModule 路由/依赖接线、operator cookie 与 CSRF 边界、生命周期事务锁顺序/最终会话时效、共享命令 journal、方向批准与周期接线。逻辑 attempt 仍是不可变 pending 记录，内部撤回不执行平台撤下；当前事实与权限检查不因 UI 通过而放宽。主服务的 network admission mutation adapter、可信 metrics resolver、媒体密钥保管及 tracking policy 保持各自原有关闭/缺省边界，没有新增设备消费者或发布接线。

共享台账 revision 484 核对：`project-material-lifecycle-intents` rev2、`material-candidate-read` rev9、`business-plan-current-checks-read` rev4、`business-plan-task-logical-attempt-create` rev4 的参与方均已接受对应版本。

## 有限证据与实际边界

根候选新增/更新的 18 个 artifact JSON 均可解析；对非空原始 password/token/secret/authorization/cookie/CSRF/body/key/model-output 字段及常见凭据模式检查未发现问题，并人工阅读新增安全摘要。没有读取原始日志、截图、模型输出、验证码或私有配置。哈希、Artemis 运行标识、固定状态和计数不被当作凭据或业务正文。

- run7 的实际浏览器证据固定于 `73fcd5ffb1836eb3773f39ea6a82d5a19185f607`：实际 UI 创建项目、v0 素材保存/内部撤回、延迟暂停回执跨项目隔离，以及 End 首次 201 提交后丢回执、显式原 body/key 重试得到 `replayed=true`。真实模型一次 16015ms 提案、页面确认后只读首周期 1 行及批准输入绑定。此来源证据与上次完整 Web 审查读取的有限结果一致；本次没有重新执行浏览器。
- `ae629796955cf56f83550ae3fe0d028e55805e7d` 的 Plan unknown 恢复是独立场景：真实响应延迟后 UI 进入 unknown，再只读 GET 和原请求接续；command/revision 各 1，结果 unchanged，Task/outbox 为 0。不与 lifecycle 的 End 恢复混为同一次执行。
- lifecycle 共用 `business_plan_commands` 的四条记录未写 `outcome`，因此保留默认 unknown；真实生命周期 receipt 存在 response 中。结合精确源码和 UI 回执，这四行不能解释为四次 Plan 失败、未知执行或事务回滚，也不需要清除记录。
- 六轮生命周期失败、旧 Plan 超时/模型失败及 root `14ce760` 完整单元命令退出 1 均保留。该次 contracts TS84/Python39、backend402、executor61 通过，而 Web65/86、21失败。后续四 fixture 对齐由作者 focused33/33 及 Web86/86证明，不能改写旧命令结果。根合并后的 Web check/build 通过为主会话报告；本次未重跑完整套件。
- `1c84441d764424e6530ef5d8859dada12845a7dc` 在 run7 后仅修验证器等待上限与 route 错误传播；源码及单文件编译已核验，异常注入分支尚未实际运行。
- 36 迁移恢复是独立 PG17.11/MinIO 联演 1/1；新增 0034–36 五张表为空，证明 schema/inventory/空行恢复一致，不证明实际业务数据、生产恢复、RPO/RTO 或 consumer/physical fence。所有许可仍 false，未知 fence 不被释放。
- 原生 SESSION 跨登录接续限于禁止模拟器之前的管理模拟器、固定 Android `821f3156552fa85363cc7317d46378ba5f76c03f`；有限阶段记录保留初次失败及两项 inconclusive。最后原 key 成功 receipt 恰 1、版本 6，临时备注尚未恢复。USB online 不替代管理真机验收，也不允许清除安装身份或恢复参与绕过资源缺口。
- 当前状态说明明确 USB-only、模拟器及自有服务已停；原持久实例仍 33 迁移，Demo unknown1 保留。旧 `7e8f33b` hosted CI 不能套用本次 head；本次新精确 CI 仍待主会话更新同一 PR 后取得。

## 本次检查与未完成项

独立执行：固定提交逐文件来源核对、完整增量 `git diff --check`、有限 JSON 解析/敏感字段检查、契约签收读取、源码组合权限与文档限定核对，均通过。未启动服务、容器、模拟器、USB 操作、模型或测试套件，符合本轮减负要求。

持续周期推进、可信非空 Task/真实 Artemis 消费者、逐动作许可与实际停止、真实平台/指标/收入、正式签名及生产灾备仍未完成或未验；原安全门禁与 WP 未因本批准关闭。新代码或证据改变导致 head 变化时须重新固定复核；本批准不覆盖将来的源变更。
