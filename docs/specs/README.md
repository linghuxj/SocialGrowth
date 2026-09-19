# 首批开发规格与任务管理

用户已确认对 PG-01～PG-10 进行规格化，并授权在个人公开仓库 `linghuxj/SocialGrowth` 管理。业务规则沿用现有决定；规格化不代表代码实现或真实运营许可。

- [首批总规格](2026-09-19-first-loop.md)：完整范围、完成标准、用户故事、实施与测试决定。
- [FL-01 客户授权与内容准入](first-loop/FL-01-context-assets.md)
- [FL-02 导流入口与维护](first-loop/FL-02-destinations.md)
- [FL-03 规则、策略与批准排期](first-loop/FL-03-strategy-approval.md)
- [FL-04 执行与异常核对](first-loop/FL-04-execution.md)
- [FL-05 观察与基础复盘](first-loop/FL-05-observation-review.md)
- [FL-06 首批集成与变更退出验收](first-loop/FL-06-integration.md)

## 任务跟踪约定

GitHub Issues 为任务跟踪入口，规格发布使用 `ready-for-agent` 标签。该标签表示规格可领取，集成依赖、未接入事实与额外授权边界仍按正文执行；不触发本轮代码实现，也不表示某项已通过验收。

同一 FL 编号优先更新已有 Issue，避免重复任务。每项完成时记录实现提交、实际测试命令/结果及受控/真实接入状态；保留 PG、旧 TASK 与 C/T/F 的映射。规格变更同步本地正文与 Issue，不让历史审计意见重新覆盖已确认规则。

## 发布记录

本节在首次发布并读回核对后记录仓库、Issue 和源版本。当前应用实现状态：未开始本轮功能开发。
