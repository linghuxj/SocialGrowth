# 团队第二批开发与验收接手记录 — 2026-10-04

本记录是固定批次的交接证据，整体开发和验收仍在推进。动态认领、契约接受和工作状态只在共享 `tasks.json` 维护；不建立另一套滚动台账。全范围原始缺口及 WP-00～29、AC-00～60 映射见 [重新扫描](team-rescan-20261004.md)。用户未提交需求、Android 对齐、设计及受保护发布脚本不进入本批提交。

## 当前判断

已完成的是明确切片的工程开发、独立源码复核及部分真实页面验证。系统仍缺正式执行消费者、逐动作物理事实核验、完整项目/素材生命周期、真实效果来源与反馈再执行闭环；首期整体验收没有通过。当前已批准源码也不能替代最终整合集成 head 的独立批准。

| 内容 | 当前已交付边界 | 仍需开发或验收 |
| --- | --- | --- |
| 控制与本人范围 | provider/installation 真实接口、当前事实/暂停/退出意图和未知持有者规则，源码已复核 | 实际停止、恢复及全动作执行许可；已退出 Samsung 不恢复参与 |
| Android 管理页面 | 本人设备/分佣空页真实观察，备注成功与未知结果恢复实际 Artemis 验证 | 旧事实版本冲突、会话失效、完整 11 类页面和双真机验收 |
| 素材与计划 | 人工声明/候选核验接口、批准范围与 Plan/Task/名额/outbox 原子事务，真实 Web 素材候选已观察 | 真实模型非空计划成功、原请求接续成功、真实来源与手机文件准备 |
| Task 当前核对 | 原计划不可变清单 SHA 与当前素材/归属/安装/控制/网络事实 GET、项目/素材变更影响引用已接线 | 正在协商/实现单一持久 logical attempt，状态仅 pending；Artemis 消费者及真实动作尚未交付 |
| 项目/素材生命周期 | 最小变更影响 writer 与历史引用工程已复核 | 暂停/结束/撤回/交接的完整命令与页面、未提交取消和已提交未知核对；不实测公开撤下 |
| 效果与反馈 | 可信内部快照 append-only history、本人项目范围 GET、缺失/延迟/null 与真实零值契约、未知归因边界 | 默认 trusted resolver 未配置；真实来源/已核验内容/点击和周期输入未验，反馈导航及真实空态正在接入（UX-FEEDBACK-WEB） |
| 分佣 | 既有账本/本人 GET 与真实 Android 无可信预估/无本人历史页证据可复用 | 真实到账、承接期间、比例和舍入口径；未配置 producer 不伪造收入，不加支付/提现体系 |
| 运维与发布 | 隔离联合备份工程、当前工作分支历史 CI、Android release 输入/签名/单调版本门禁 | 最新整合 hosted CI、正式签名升级身份、回滚/旧客户端、生产恢复及正式部署 |
| 规模与完整验收 | 单 Samsung 与独立管理模拟器的限定证据 | 第二真机/异主及 20～50 实体设备和冻结阈值，全 WP/AC 固定候选矩阵 |

## 固定源码与审查

基线 `f583f184891bd3d0406c43821cb3d36e2eb1233a`。本报告建立时源码候选为 `f6fda372ab78e4edab4ae732f9a3121b6f0c684f`，后续验证必须记录各自实际 source，不能把旧运行套用到新提交。

- 当前事实与影响 writer 完整源：`3c552564f8b45796cf685baa94f6813f6557a344` → `a6d4b96024a807e2f5dfc3a42ae8adceda864805`，十二文件完整批准见 [current-checks review](team-review-current-checks-full-a6d4b96.md)。保留此前 generation 遗漏/提交前过期问题的失败记录。
- 效果与计划描述预算完整源：`04058855e2eed435f32be84316e175ef71ef1711` → `2f8ce8d07db71134be48ded78677decc38cff76b`，见 [metrics review](team-review-metrics-2f8ce8d.md)。原 `39a1b61` 的独立源测试失败仍见 [失败报告](team-review-metrics-39a1b61.md)。Root 合并唯一冲突为描述 timer，采用已批准 `MODEL_DESCRIBE_DEADLINE_MS`，保留 a6 的影响 writer/current-checks 组合代码。
- 正式 Android release 门禁源：`d39f9ca70e24d5adf5b1ab8ba31f5c5e70542a8d` → `74d1b1c5a19ca5cdc68a484d2d207b42db037b28`，见 [release review](team-review-release-74d1b1c.md)。门禁在实际 release artifact task/provider 上，不以命令字符串匹配；缺正式输入无 debug 签名回退。声明的 previousVersionCode 仍需与真实历史核对。
- Web 有限诊断和清理前只读结果捕获已集成 `b501b2381c8c8404a094590ddb35707fbf2762ec`，见 [Web review](team-review-web-http-c6324cf.md)。没有记录原请求 body/key 或模型输出。
- Android 备注固定源 `821f3156552fa85363cc7317d46378ba5f76c03f`，实际 APK 和服务版本详见 [native label](team-native-label-821f315.md)。管理元数据经真实页面可逆修改并已恢复；不能说其数据库元数据完全未动。

## 通过、失败与未验证

Root 在 `681e34f590711e882d07df2a356f1938856765e6` 上 `pnpm check:product` 四包通过，Web 构建通过并保留 >500KB bundle 警告。完整 backend 单元回归为 **393/394，失败**：`observation-window-core.test.ts:46` 的旧 delayed 样例触发 `METRIC_INVALID`。backend 已以 `35d7ac2804feb6e71dfc432a6d08435313ad96e9` 修复有效样例，并新增 numeric delayed 拒绝断言，未放宽契约；新完整候选再次获独立批准。Root 在 `361a650` 重跑完整回归 **394/394通过**，见 [新固定结果](../../../../artifacts/acceptance/team-lead-20261004/integration2/engineering-checks-361a650.json)，原失败不覆盖。有限结果见 [engineering checks](../../../../artifacts/acceptance/team-lead-20261004/integration2/engineering-checks-681e34f.json)，原始 TAP 未独立保存，不能声称存在原始日志归档。

此前 root `8678c84` 上 backend 394/394、构建/类型检查通过只证明当时 source，见已提交旧固定 metadata。文档结构核验 158 需求/30WP/61AC/10契约/13风险/290链接通过，不证明业务完成。

Android 真实备注结果及有限 checker/只读证据已固定提交；同 key 重试保留 **2 inconclusive**，原 key 仅一条 succeeded 回执另作补充。两次误传目标路径的 Artemis 调用无效、首次目标预算超限均保留，修正文本目标及拆短步骤后重建/核对/恢复成功；不提高模型预算，不把无效调用改写为业务通过。过期会话 UI 和旧事实版本冲突尚未现场验收。

Web 规划此前两轮失败均保留。第一轮窄流 flag 未透传，实际运行旧并发编辑流程，不能称窄流通过；清理前未保存回执/计数，因此原 outcome 不推断。第二轮实际窄流在 `b501b23`：方向建议 12.55 秒、页面确认和素材 POST201/candidate=true；计划原请求 HTTP500/INTERNAL_ERROR/retryable=true，5114ms，有限诊断 model_describe/describe_timeout。真实页面 GET 后原未知请求仍冻结；清理前只读 command/revision/task/outbox 均0，仅证明所见不存在，不能推广为所有故障的回滚。45秒描述预算获审后的 retry3 使用批准 `2f8ce8d` 的完整源，方向模型阶段即失败：unavailable、11915ms、direction_output_invalid bytes1209/BUSINESS_MODEL_SCHEMA_INVALID，尚未进入确认/素材/Plan，不能评价新 Plan 描述预算的实际效果。清理前只读 command/revision/task/outbox 仍均0，自有资源清理完成。原模型输出未保存，未知具体字段原因，团队先补有限安全分类，避免盲重跑。

## 服务、阻断和临时方案

自有正式本地 Web3100/backend4320 已按授权重启，运行 source `7b71e84a96c11fe17bdb2988e8068d0b97de91a1`，与构建 `8678c84` backend 等同，不是本报告的新整合源码。health/Web 200、Task/outbox/控制/holder均0，只证明运行及只读计数；数据库未重置、executor关闭。第一次终止 tsx wrapper 留下自有监听子进程，核对 PID/pgrp/cwd 后精确停止再启动，未停止外来实例。见 [restart proof](../../../../artifacts/acceptance/team-lead-20261004/integration2/runtime-restart-7b71e84.json)。Demo 的原 unknown1、completed6、cancelled1 保留，不运行设备 worker。

共享阻断沿用五条，临时工具/样例失败只在对应记录留痕，不复制到资源清单：

| 唯一阻断 | 临时推进办法 | 后续必要事项 |
| --- | --- | --- |
| H4-H5 受限网络 | 当前手机协议11/11已复用；策略只读 OAuth、现有宽 grant 不允许宣称隔离，正式准入默认关闭 | 实际策略写权限、当前 ETag/CAS、产品 networkRevision 和受限路径共存实证；无 routes:read 不越权重试 |
| RES-03 真短信 | 受保护回环开发码用于当前管理页面 | 真实供应商和送达验证 |
| RES-04/11 第二真机及规模 | 单手机/管理模拟器局部推进 | 真实异主/多机和20～50台阈值矩阵 |
| RES-06/08/10 平台/来源/到账 | 可信接口工程及诚实未知/未配置显示 | 真实Page/YT身份、素材/效果证据、比例和到账；不造数据 |
| SEC-WP14-01/WP10原13 | 独立增量继续，旧固定门禁保留 | 原责任方凭据核查/原窗口独立反例复验；作者不自签关闭 |

正式签名、生产灾备参数及旧客户端属于对应运维验收的未验证输入，复用原工作包资源条目；不能因新增门禁或隔离恢复通过就称已上线。全部可开发切片继续推进，最终 fixed head 的安全批准、适当检查、真实页面结果及 hosted CI 齐备后才提交本批 PR；当前工作分支集成不代表默认 main 或生产发布。
