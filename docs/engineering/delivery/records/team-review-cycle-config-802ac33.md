# 下一周期配置后端独立复核

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`
- Base: `5c8960f6e74a3e55105693722b3443f95aa312bc`
- Head: `802ac33583530a0cccf1a1536ef0d856df0e5947`
- Verdict: **changes_requested**
- Task: `SEC-CYCLE-CONFIG`，仍进行中；本记录只覆盖后端候选，不覆盖随后 UX 候选或整个切片验收。

## Finding

**CYCLE-CONFIG-RUNTIME-01 — P2，运行时信息未知时仍可确认配置。**

`product/backend/src/project-cycle-config-service.ts` 的 `save` 先调用 `resolveProjectCycleWindow`，仅在返回 null 时检查 `process.versions.tz` / `icu`。因此只要 Intl 计算成功，即使必需的运行时版本信息缺失，也会走 confirmed 分支新增配置。既有 `ProjectCycleStore.appendApprovedConfiguration` 在计算前要求两项信息存在，已签 `project-cycle-next-config` rev2 同样要求未知 calendar runtime 闭锁。本候选新 producer 没有保持这一边界。

修复要求：在预览/确认前使用同一运行时可用性条件，缺失任一项时返回 unresolved/calendar_runtime_unavailable 且不新增配置事实。保留当前周期及已有配置，不通过推定可用来替代缺失信息。补相应受控回归，在主会话允许的验证窗口运行后提交新精确 SHA。作者已直接确认问题；本 reviewer 不修改被审实现。

另有一项待作者与 UX 澄清的消费语义：unresolved command receipt 当前将 nextConfiguration 设为 null，即便数据库已有最新配置。数据库保留旧事实，但合同中的“preserves prior latest config”是否要求回执返回原事实或客户端随后 GET，需要明确一致，以免客户端把 null 显示为配置被清除。本项尚不作为独立安全 finding；作者已直接与消费者对齐，任何契约/源码改动须按新版本复核。

## 完整范围与其他检查

独立读取全部十个变更文件：migration0037、AppModule、service/controller/PG tests、共享 DTO/测试/export/registry 和生成 schema。生成 JSON 仅新增七项 registry schema，旧项语义对象逐项一致；完整范围 diff-check 通过。共享台账的 project-cycle-next-config rev2 已由 backend/UX 双签。

- GET/命令查询为 no-store，操作员 cookie 验证；POST 严格 DTO、CSRF、URL UUID 规范化。没有新权限或环境执行入口。
- operator/session 行锁与 material→resource→business-plan→project 锁序一致，事务末重新检查数据库时钟会话到期。SQL 值参数化，动态 SQL 标识符来自固定源码。
- command 主键按 actor/key；摘要绑定固定路由、规范 projectId、预期配置版本及配置字段。同键跨项目/不同内容拒绝，回放原 immutable receipt；lookup 限定 actor/project/key，not_found 不证明未知请求未执行。
- 当前周期来源从真实持久周期按数据库 observedAt 选取，配置 CAS 与写入在同一受锁事务内；effectiveStartsAt 取原 endsAt，预览不建立 successor，nextCycle 始终 null。migration 通过触发器拒绝配置和回执 UPDATE/DELETE。
- 新写集合仅配置、命令回执和 audit；无 Task/quota、初始批准/规划草稿、设备、执行或发布副作用。两项许可保持 false。未发现其他需要整改的授权、注入、目标绑定、锁序或秘密处理问题。

## 验证边界

作者报告本精确 head：Node24.16/SQLiteOK、contracts generate/build/check、focused contracts2/2、backend build、lint 仅未改文件旧警告、隔离 PG3/3、diff-check 通过。PG 包含配置追加/当前不变、回放/键冲突/CAS、晚确认/DST unresolved 及会话到期事务回滚。作者确认自有 `sg-cycle-config-final-94449415772b-pg` 容器已移除；本轮未收到持久有限测试 JSON，以上属于作者报告而非 reviewer 重复运行或独立环境核验。

Reviewer 本轮仅源码、生成 JSON 结构和 diff 检查；未运行编译、测试、容器、服务、模型、浏览器或设备，未读取私有配置/日志/受保护发布脚本。真实 UI、下一周期生效、调度/review/metrics 与实际执行均未验证。修复前此 SHA 不得用于 PR 门禁；修复后的新 SHA 必须重新审查。

## 修订候选 2049a7a

精确 base 不变，head `2049a7a191f86421dcf0005181e8ae0e39f47f1e`。全量十文件中八个与原审查逐文件一致，只有 service 与 PG test 变化；完整 diff-check 通过。已核对 rev3 由 backend/UX 双签：unresolved 回执携带当时保留的最新配置及原 revision，没有旧配置才为 null；不表示新增确认。

CYCLE-CONFIG-RUNTIME-01 的生产修复闭合：缺 tz 或 ICU 时在调用 preview 之前进入 unresolved，不新增配置。旧事实同时保留于数据库、结果回执和原命令 GET，原 command 不被覆盖；授权与副作用边界未变化。

本 head 尚需校准新增回归后再固定批准。**CYCLE-CONFIG-RUNTIME-TEST-02 — P2（验证缺口）**：新增 metadata 缺失回归选 America/New_York/21 天，依赖真实当前日期计算边界；本轮十月的边界可能跨十一月 DST，使 preview 本来返回 null，原漏洞代码也会通过该断言。请对这个用例使用固定无 DST 的可解时区，确保 preview 成功才会走到原漏洞路径；不需要扩展测试体系。该问题仅在测试，当前生产修复有效，已直接告知作者。

作者报告修订 head contracts2/2、PG4/4、build/lint/diff-check 通过，独立自有容器已移除；本 reviewer 未重复运行，UX 页面仍未验。待最小修订的新 SHA 精确复核，不以生产 finding 关闭推定此 head 已获最终批准。

## 最终后端候选 603ace4 — approved

- Reviewer: `/root/adversary`
- Base: `5c8960f6e74a3e55105693722b3443f95aa312bc`
- Head: `603ace4a9fd03007f23424366c839885f144ae80`
- Verdict: **approved**，仅完整十文件后端候选；不覆盖尚未提交的 UX 源码或真实 UI 验收。
- Open findings: 无。CYCLE-CONFIG-RUNTIME-01 与 CYCLE-CONFIG-RUNTIME-TEST-02 均关闭；802/2049 历史结论保留。

独立确认完整 base→head 仍为原十文件，九文件与上一轮完整复核精确一致，唯一变化为 PG 测试：采用 Asia/Shanghai、21 天，并在遮蔽 tz 之前显式断言同 current.endsAt 和参数的 preview 可解。于是旧代码会走可成功的 preview 分支，本次断言能够识别缺失前置 runtime guard；finally 恢复原属性描述符，未改变生产逻辑或放宽契约。

完整差异检查通过；原有授权/CSRF、actor-project-key 绑定、不可变事实/原命令回执、配置 CAS、数据库时钟、nextCycle=null 和两项 false 许可边界保持。rev3 双签消费语义仍有效。作者在主会话批准的独占窗口报告此精确源码 backend build、改文件 oxlint、实际隔离迁移0037 PG4/4 通过，自有 `sg-cycle-config-regression-6bec9a22d511-pg` 已移除。Reviewer 只读源及作者有限结果，没有重复环境运行；未取得原始测试输出，也未将作者报告写成独立运行。

本后端批准可记录在 BE-CYCLE-CONFIG 门禁；SEC-CYCLE-CONFIG 整体任务继续等待 UX 冻结源码独立复核，不能以本批准把界面、下一周期真正生效、调度、模型、USB 或平台执行标成通过。任何后续源码变化须重新确认精确 head。
