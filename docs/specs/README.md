# 首批开发规格与任务管理

用户已确认对 PG-01～PG-10 进行规格化和首批受控开发，并授权在个人公开仓库 `linghuxj/SocialGrowth` 管理。FL-01～06 的受控实现和自动化验收已完成；生产迁移、真实外部接入、部署与运营许可仍分别判断。

- [首批总规格](2026-09-19-first-loop.md)：完整范围、完成标准、用户故事、实施与测试决定。
- [FL-01 客户授权与内容准入](first-loop/FL-01-context-assets.md)
- [FL-02 导流入口与维护](first-loop/FL-02-destinations.md)
- [FL-03 规则、策略与批准排期](first-loop/FL-03-strategy-approval.md)
- [FL-04 执行与异常核对](first-loop/FL-04-execution.md)
- [FL-05 观察与基础复盘](first-loop/FL-05-observation-review.md)
- [FL-06 首批集成与变更退出验收](first-loop/FL-06-integration.md)

## 任务跟踪约定

GitHub Issues 为任务跟踪入口。首批完成后将移除 `ready-for-agent` 并关闭对应 Issue；关闭只表示受控实现满足任务内完成标准，真实接入门仍按正文保留。

同一 FL 编号优先更新已有 Issue，避免重复任务。每项完成时记录实现提交、实际测试命令/结果及受控/真实接入状态；保留 PG、旧 TASK 与 C/T/F 的映射。规格变更同步本地正文与 Issue，不让历史审计意见重新覆盖已确认规则。

## 发布记录

- 发布日期：2026-09-19。
- 仓库：[linghuxj/SocialGrowth](https://github.com/linghuxj/SocialGrowth)，已核实为个人账号所有、PUBLIC，默认分支 main。
- 总规格：[#1 首批开发：PG-01～PG-10 完整业务闭环](https://github.com/linghuxj/SocialGrowth/issues/1)。
- 规格源版本：[`3acd88a`](https://github.com/linghuxj/SocialGrowth/commit/3acd88ab6f8a1630c07b5070754506b770910c95)。Issue 引用该固定提交的源文件，避免后续 main 变化覆盖当时依据。

| 任务 | GitHub Issue | 集成依赖 |
| --- | --- | --- |
| [FL-01] 客户授权与内容准入 | [#2](https://github.com/linghuxj/SocialGrowth/issues/2) | 无前置开发 Issue |
| [FL-02] 导流入口与维护 | [#3](https://github.com/linghuxj/SocialGrowth/issues/3) | FL-01 |
| [FL-03] 规则、策略与批准排期 | [#4](https://github.com/linghuxj/SocialGrowth/issues/4) | FL-01、FL-02 |
| [FL-04] 执行与异常核对 | [#5](https://github.com/linghuxj/SocialGrowth/issues/5) | FL-01、FL-03 |
| [FL-05] 观察与基础复盘 | [#6](https://github.com/linghuxj/SocialGrowth/issues/6) | FL-02、FL-03、FL-04 |
| [FL-06] 首批集成与变更退出验收 | [#7](https://github.com/linghuxj/SocialGrowth/issues/7) | FL-01、FL-02、FL-03、FL-04、FL-05 |

初次发布后已从 GitHub 读回核对：7 个 Issue 正文与本地发布文本一致，均曾带 `ready-for-agent` 标签，28 个不同的固定版本源链接均指向已推送文件；总规格与子任务已互链。完成处置见各 Issue 的最终验收评论。

最终本地检查：`python3 scripts/analytics/verify_handoff_audit.py` 通过，覆盖 46 份 Markdown、442 个本地链接及原编号/预算/容量一致性；Web 领域测试 17/17、Controller 测试 5/5、跨模块集成 3/3，并完成两模块构建和相关 lint。

当前应用实现状态：首批受控开发已完成、未部署。浏览器存储和 DDL 不等于生产数据库迁移；真实 Provider、入口、WebSocket Agent、物理真机、原生 App 发布和供应商指标仍待实际接入证据。
