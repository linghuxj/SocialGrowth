# 团队第三批固定验证记录 — 2026-10-04

本记录固定本批已经发生的结果。全范围需求/WP/AC映射沿用[重新扫描](team-rescan-20261004.md)，认领和契约仅在共享 `tasks.json` 维护；不重复建立阻断台账。系统整体开发与验收仍未完成。

## 已观察到的结果

| 验证 | 固定源码与结果 | 证据边界 |
| --- | --- | --- |
| 反馈页面 | 主窗在 `2c7910eee3d6e597c8310b692b7631e067734e60` 实际隔离 Playwright 通过 | 实际表单创建一个工程测试项目，GET显示未配置/零行；真实传输失败后页面重试恢复，980/700/390宽度无横向溢出。没有合成指标，未验证跨项目切换和真实来源 |
| 实际模型与排期页面 | Web队友在 `80e871a5f1055aba747944869e88619cf8bfdab8` 完成真实模型方向建议、页面确认、素材候选201及 Plan unchanged | 方向建议12968ms；排期revision1、command1、Task/outbox0，执行/发布许可关闭。未验证非空排期、原未知请求恢复或同原body/key重试 |
| 本地服务恢复 | 主窗自有服务启动源 `f7dce190c716e78cd8381a0ae4c3a15a5d81e983`，backend业务源码与2c等同 | health/Web200及实际device-live只读页面通过，accessReady=false。Task/outbox/control/holder均0；Demo原unknown1/completed6/cancelled1及无holder保留，数据库未重置 |
| 停止自有进程 | 固定修复候选 `dba7b344de5d55d304b50ed650abb5c9aefd34e4` 两个真实进程回归通过，并获独立批准 | 原停止循环遇已消失进程组ESRCH，未继续停止配套Web；核对自有PID/pgrp/cwd后临时精确清理。新helper继续处理所有已知自有子进程，不处理外来服务；当前运行launcher早于最后细化，下一次受控重启使用新helper |

有限安全结果：[反馈](../../../../artifacts/acceptance/team-lead-20261004/integration3/feedback-2c7910e.json)、[服务恢复](../../../../artifacts/acceptance/team-lead-20261004/integration3/runtime-restart-f7dce19.json)、[模型排期](../../../../artifacts/acceptance/team-lead-20261004/integration3/model-plan-80e871a.json)。测试输入为隔离工程输入；真实浏览器操作和真实模型响应不等于真实平台业务验收。清理前只读SQL是补充证据，未用于预置业务成功。

## 修复与独立复核

方向输出提示与有限安全诊断候选 `34aea3a0a688a8172128b8dfae4b097fcc43cbca` 已获[独立批准](team-review-direction-diag-34aea3a.md)。保持严格模型契约，不保存原输出或原未知请求敏感内容。此前方向schema失败和Plan描述超时保留于[第二批记录](team-integration2-20261004.md)。

Plan数据库锁等待回归曾失败，按顺序集成 `6ee0939`、`0305994`、`259bdb6` 的完整修正；修改只涉及测试，不放宽生产检查。锁持有、模型调用次数、最终数据库时钟跨界和事务清理均有断言。固定候选独立复核见[锁等待测试审查](team-review-plan-lock-6ee0939.md)；Web作者实际PG7/7通过，主窗未独立重复这次PG运行。包含反馈导航及上述修订的完整Web源已获[80e候选批准](team-review-feedback-web-f5a81e5.md)。自有进程修复见[独立审查](team-review-process-stop-dba7b34.md)。

## 仍在推进与未验证

团队正在各自独立工作树实现项目暂停/恢复/结束、素材内部撤回、任务单一逻辑尝试和批准配置的周期窗口持久化。契约已经按相同revision由参与方签收；尚未完成的源码不能算作已集成或已验收。逻辑尝试只记录pending，不会打开物理执行许可；内部撤回不执行公开平台撤下。

本批后续仍需源码集成、固定候选实际Web验证、整合head独立复核以及对应新head的hosted CI。现有[草稿PR23](https://github.com/linghuxj/SocialGrowth/pull/23)和已通过的CI仍固定在 `7e8f33b57e133db53940400f40997f4d71854c7c`，不能套用到后续源码；获批后更新同一个PR，不新增批次分支或PR。

真实网络受限准入、短信、第二真机/规模、平台素材/效果/到账，以及旧固定安全门禁仍沿用[第二批去重阻断](team-integration2-20261004.md)。正式签名、生产灾备和旧客户端输入沿用WP27原资源项。已退出Samsung不恢复参与，原unknown不清零，设备队列消费者保持关闭；不公开发布或撤下。
