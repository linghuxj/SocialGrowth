# 下一周期配置后端独立复核

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
