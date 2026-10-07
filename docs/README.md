# 文档索引

更新：2026-10-07。操作和实现说明以当前 `dev` 正式源码为依据。当前工作目录含未提交修改，正式工程不等于已发布版本。需求已确认至 R-164；未实现要求仍保留，不从已有页面反推删减需求。

## 当前阅读顺序

| 文档 | 用途 |
| --- | --- |
| [当前正式实现](current-implementation.md) | 当前代码、入口、已有接线、条件配置与未完成范围 |
| [技术说明](technical-design.md) | 实际模块、数据、执行与配置边界 |
| [Android 接入操作](android-pilot-onboarding.md) | 现有客户端和内测连接步骤，不外推为零准备远端验收 |
| [有效需求基线](current-requirements-summary.md) | 当前要求及首期边界；不是通过清单 |
| [需求确认来源](requirements-alignment.md) | 用户确认、修订和被替代事项的依据 |
| [业务流程](business-workflow.md) | 目标流程及硬性约束；实施状态另看当前实现 |
| [首批已实现接口流程](first-delivery-flow.md) | 运营邀请、提供者身份、安装与关联的实际接口交接 |
| [开发与验收入口](engineering/delivery/README.md) | 工作包、契约、追踪、风险、质量与验收 |
| [固定候选证据索引](engineering/delivery/records/README.md) | 原审查、失败、阻断及实测；不能替代当前验证 |
| [业务术语](../CONTEXT.md) | 名词及身份边界 |

## 有效输入与验收目标

以下文档仍有作用，但描述要求或设计输入。它们不证明当前页面全部已实现。

- [验收与证据](acceptance-plan.md)。
- [Web 页面规格](workbench-page-spec.md)、[跨页规则](workbench-flow-consistency.md)及[已确认界面方向](workbench-ui-alignment.md)。
- [Android 页面规格](android-app-page-spec.md)、[界面确认](android-app-alignment.md)及[设计规范](design/android/DESIGN.md)。
- [Web 设计规则](../DESIGN.md)、[保留的 Web 方向依据](design/workbench/README.md)及[Android 方向依据](design/android/README.md)。
- [账号准备与执行库职责](specs/2026-10-02-account-preparation-execution-library.md)。
- [手机网络准备、人工切换与恢复](specs/2026-10-07-phone-network-preparation.md)。

## 当前架构决定

保留 ADR-0002～0010、0012 和[单一产品 ADR-0013](adr/0013-single-product-remove-demo.md)。已取消的并列维护决定不再作为独立文档保留。业务后端、数据库、队列、存储、客户端和 Web 的具体实现与默认可用性须再核对[技术说明](technical-design.md)及代码；已接受选型不等于组件已经接通。

旧规划、旧研究、未采用设计原型、过期图片和生成提示词已删除。有效需求、原失败及未知结果没有删除。逐文件处置、备份和检查见[文档清理记录](engineering/delivery/records/documentation-cleanup-20261006.md)。工程操作遵循 [AGENTS.md](../AGENTS.md) 与 [CLAUDE.md](../CLAUDE.md)。
