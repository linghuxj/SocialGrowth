# 正式工程开发与验收

更新：2026-10-07。需求至 R-164；只维护 product 正式工程。默认单负责人按实际问题作最小改动。需要协作时遵循 [AGENTS.md](../../../AGENTS.md)及 main／dev 规范；不沿用旧阶段分支和窗口指令。

## 使用顺序

| 文档 | 用途 |
| --- | --- |
| [当前实现](../../current-implementation.md) | 实际接线、默认关闭条件和现有业务边界 |
| [工程覆盖与阻断](delivery-tracker.md) | 工作包与当前工程、证据及未完成范围对应 |
| [当前风险](engineering-review.md) | 沿用风险编号，核对当前条件与关闭判据 |
| [工作包](work-packages.md) | 责任范围和依赖定义，不代表全部未开始或已完成 |
| [契约核对](contract-checklist.md) | 状态、事务、幂等及消费端交接 |
| [需求追踪](requirement-coverage.md) | R-001～R-164 的 WP／AC 归属，不是通过表 |
| [质量门禁](quality-gates.md) | 检查、审查、真实验收与发布分别判断 |
| [验收矩阵](acceptance-matrix.md) | 目标场景和证据判据；未实现需求不删除 |
| [记录模板](record-templates.md) | 需要时使用，不为小改动增加多套流程 |
| [固定证据索引](records/README.md) | 原候选、失败、审查及实测的有限范围 |

需求以[基线](../../current-requirements-summary.md)和[确认来源](../../requirements-alignment.md)为准。业务流程与验收目标不从当前代码反向删减。工作包、风险、证据和已有任务账本各承担原职责，不另建滚动进度系统。

## 当前文档维护

日常操作先读取当前实现及对应组件 README。固定记录中的“当前”和通过只对应原候选；未知提交、设备占用、撤权和失败证据不能因整理文档被清零。过去的阶段命令不能直接用在现有环境。

工程清理见[执行器迁移](records/demo-removal-migration-20261006.md)。文档旧内容的删除、保留和备份见[本次清理](records/documentation-cleanup-20261006.md)。

## 文档一致性检查

```sh
python3 docs/engineering/delivery/check_consistency.py
```

该命令只读检查需求覆盖、WP／AC／CT／ER 定义与依赖、保留文档的本地链接及锚点。通过只代表文档结构，不证明业务语义完整、Web 或真机验收、外部链接有效或已发布。
