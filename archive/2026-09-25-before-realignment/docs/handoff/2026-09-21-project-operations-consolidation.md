# 运营项目收敛交接

本轮按用户认可的方案实施，业务口径见 [规格](../specs/2026-09-21-project-operations-consolidation.md)。验收结果记录于 [本轮验证](../acceptance/2026-09-21-project-operations-consolidation.md)。历史文档的“同类别覆盖旧规则”和“所有发布必须有导流入口”已被本轮修正，不再作为新策略约束。

## 实现入口

- `apps/web-console/components/operations/`：项目、授权、批次导入、模板与任务视图。
- `apps/web-console/lib/first-loop/catalog.ts`：共享策略／规则选项。
- `apps/web-console/lib/first-loop/engine.ts`：自营、原子批次、独立规则版本、可选导流。
- `services/execution-runtime/src/identity-onboarding.ts`：Web 发起的一次 Artemis 核验／创建任务，持久化结果与截图。
- `services/execution-runtime/src/server.ts`：账号接入、停止、截图与确认绑定接口。
- `scripts/verify-operations-consolidation.mts`：真实 Web 业务验收脚本。

## 操作与恢复

仍使用 `pnpm dev` 启动 Web + runtime，不自动启动发布 worker。运行时重启会中断人工协助和账号接入任务；创建结果未知不重试。既有数据和授权保留；旧规则中已被错误替代的历史记录不会自动重新激活，需要运营核对后分别修订。

批量登记失败时不生成部分内容身份；已上传的内容寻址文件保留供复用。测试项目通过正常退出流程归档，不直接删除数据库记录。

待办以验收报告中的阻断 ID、负责人及退出判据跟进，不将代码构建通过记为 FB/YT 实际运营闭环完成。
