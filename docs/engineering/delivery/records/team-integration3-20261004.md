# 团队第三批固定验证记录 — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本记录固定本批已经发生的结果。全范围需求/WP/AC映射沿用[重新扫描](team-rescan-20261004.md)，认领和契约仅在共享 `tasks.json` 维护；不重复建立阻断台账。系统整体开发与验收仍未完成。

## 已观察到的结果

| 验证 | 固定源码与结果 | 证据边界 |
| --- | --- | --- |
| 反馈页面 | 主窗在 `2c7910eee3d6e597c8310b692b7631e067734e60` 实际隔离 Playwright 通过 | 实际表单创建一个工程测试项目，GET显示未配置/零行；真实传输失败后页面重试恢复，980/700/390宽度无横向溢出。没有合成指标，未验证跨项目切换和真实来源 |
| 实际模型与排期页面 | Web队友在 `80e871a5f1055aba747944869e88619cf8bfdab8` 完成真实模型方向建议、页面确认、素材候选201及 Plan unchanged | 方向建议12968ms；排期revision1、command1、Task/outbox0，执行/发布许可关闭。未验证非空排期、原未知请求恢复或同原body/key重试 |
| 原未知排期请求接续 | Web队友在获审 `ae629796955cf56f83550ae3fe0d028e55805e7d` 实际恢复通过 | 真模型方向提案11935ms，实际Plan响应201仅延迟60秒；UI45秒进入unknown，真实GET200后显式同body/key续接201。原请求与重试SHA一致，所见command仅1/revision1/unchanged，Task/outbox0、两许可false。主窗读取[有限固定结果](../../../../artifacts/acceptance/team-lead-20261004/integration3/model-plan-unknown-ae62979.json)，未独立重复此模型运行；不代表非空安排或物理执行 |
| 本地服务恢复 | 主窗自有服务启动源 `f7dce190c716e78cd8381a0ae4c3a15a5d81e983`，backend业务源码与2c等同 | health/Web200及实际device-live只读页面通过，accessReady=false。Task/outbox/control/holder均0；Demo原unknown1/completed6/cancelled1及无holder保留，数据库未重置 |
| 停止自有进程 | 固定修复候选 `dba7b344de5d55d304b50ed650abb5c9aefd34e4` 两个真实进程回归通过，并获独立批准 | 原停止循环遇已消失进程组ESRCH，未继续停止配套Web；核对自有PID/pgrp/cwd后临时精确清理。新helper继续处理所有已知自有子进程，不处理外来服务；当前运行launcher早于最后细化，下一次受控重启使用新helper |
| 产品单元与类型 | 主窗固定 `3e03cef493126db5eef698119262744caeb6f482` 完整回归通过：contracts TS80/Python39、backend395、executor61、Web86；四包类型检查通过 | 工程检查，不证明实际平台来源、原生/浏览器业务或整体验收；[有限结果](../../../../artifacts/acceptance/team-lead-20261004/integration3/engineering-checks-3e03cef.json) |
| 完整迁移恢复补验 | `5d98831962d53f78a280d343b2911934e74673ed` 已获[精确源码批准](team-review-ops-full-schema-5d98831.md)，已集成 | 作者实际隔离PG/MinIO 1/1覆盖当时全部33迁移，新增9表schema/空行对照；[固定报告](team-ops-full-schema-20261004.md)。未来0034–36需最终组合再跑，不外推业务数据、真实fence或生产灾备 |
| 批准配置首周期窗口 | `6cdebccea36adca8e04f975a61f3ea3ef01ec05a` 已获[精确源码批准](team-review-cycle-f74b614.md)，完整合入 `7ea5ea5` | 作者隔离PG方向套件21/21、backend单元400/400、周期单元5/5；主窗 `e3f485f` 四包类型检查通过。只覆盖首窗口持久接线，真实Web批准触发与持续下周期仍待验 |
| 生命周期合并后工程回归 | 主窗固定 `14ce76077f251ce0b2a87a633be11446696b4b5f` 类型检查通过，完整顺序单元命令退出1 | contracts TS84/Python39、backend402、executor61均通过；Web65通过/21失败，集中在4个既有素材API测试文件。[有限结果](../../../../artifacts/acceptance/team-lead-20261004/integration3/engineering-checks-14ce760.json)。正在核对新增撤回契约与旧fixture差异，不放宽生产schema，不把补充单元当Web验收 |
| 生命周期首次组合浏览器 | Web工作树 `8cb3418` 加当时未提交导航/runner/verifier，操作开始前TimeoutError | pageErrors为空、三个actions为空、pause/end POST均0、方向/模型阶段未执行；[固定失败](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-run1-failure.json)。已清理自有服务/两容器/临时凭据；不是冻结head验收。发现region标签误用标题的选择器缺陷，修正并增加有限阶段后冻结 `fb005de39a4a2b29db09a06ddcf80b4bad2fdcd8`，尚待串行实际复验/精确审查 |
| Web素材测试修正 | `1bdfb351d62f81880ce056eb95059b3870632daa` 四fixture补齐rev9 withdrawal=not_withdrawn，获[精确窄审批](team-review-material-fixture-1bdfb35.md)，root已集成 | 原生产schema/权限和测试断言均未变。UX focused33/33；Web队友在冻结 `e3dd70f7b8c4e9884e3e004c79a794eb0cceb730` 跑完整Web86/86通过，[有限结果](../../../../artifacts/acceptance/team-lead-20261004/integration3/web-unit-e3dd70f.json)。原root14ce全命令退出1保留，没有虚构其重跑通过 |
| 生命周期第二轮组合浏览器 | 冻结 `e3dd70f7b8c4e9884e3e004c79a794eb0cceb730` 在 `open project B lifecycle facts` 超时 | 新[阶段失败记录](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-run2-failure.json)：pageErrors0、actions空、pause/end POST0，方向/模型未执行；自有资源清理完成。正采集有限GET状态定位首次事实读取/页面加载，尚不能确认根因或宣称生命周期/cycle通过 |

| 生命周期第三、四轮定位 | run3冻结 `81b2a59bcfc4d231941572204a733642fb94c2f9`；run4冻结 `a474a6179ae0e647523191fb64fb7a3f665bca6a`，仍未通过 | [run3](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-run3-failure.json)三路GET200；[run4](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-run4-failure.json)进一步确认response与requestfinished均200，导航及panel可见、项目版本0，但heading/事实区/loading/alert均不存在，业务POST0、模型阶段未开始。UX正在核对首次读取effect重播竞态，修复前不确认根因或验收通过；每轮自有服务、两容器及临时凭据均清理 |

| 首次读取修复后的真实浏览器 | run5冻结 `91aafc79255435869afc638cdd55c063ddf79bb0`，已过首次读取/内部撤回/延迟暂停跨项目隔离/恢复意图，完整场景仍失败 | [固定失败摘要](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-run5-failure.json)：End真实2xx提交后按设计丢弃客户端回执，写unknown被共用错误文案标作读取不可用；verifier又在内层事实区等待外层alert。原pending保留，同键重放尚未到达、模型未启动。诊断panelVisible使用多实例locator，false不能作为页面隐藏结论；正在由各自owner作最小修复，自有资源已清理 |

| 当前36迁移恢复组合 | 测试冻结 `586fc51f9927ce9534425cd130715cacdc5e6682`，候选 `eaef30124880aeaba2714c83d6e494380783de0e` 已获[窄范围批准](team-review-ops-inventory-eaef301.md)并完整合入 | 独立PG17.11/MinIO实际联合恢复1/1，36迁移bytes及metadata哈希一致，0034–36新增5表schema和行数恢复对照一致且均为空；contracts build/generate:check与backend check通过。所有自有资源清理，未改liveDB；不证明真实业务数据、生产灾备或物理fence，详见[同一运维记录增量](team-ops-full-schema-20261004.md) |

| 未知回执文案修复后的真实浏览器 | run6冻结 `a0fd8d71cf9f20063d9ec6e56f145089d60e9aaa`，仍未通过完整场景 | [固定失败摘要](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-run6-failure.json)首次End真实201/changed=true/replayed=false已经留有限证据，随后故意丢弃客户端响应。verifier仍匹配旧unknown文案，未到达原键接续，模型未启动；显示v2及按钮禁用不能推断UI已显示结束意图。执行前Webcheck/单脚本tsc通过，实际runner所需build/PG阶段通过；修脚本残留前不再启动批次。自有资源已清理 |

| 生命周期与首周期完整真实浏览器 | run7冻结 `73fcd5ffb1836eb3773f39ea6a82d5a19185f607`，同一隔离fixture整批退出0 | [有限成功记录](../../../../artifacts/acceptance/team-lead-20261004/integration3/lifecycle-cycle-run7-73fcd5f.json)：Lifecycle两UI项目/素材v0撤回/延迟暂停跨项目隔离/resume；End首201真实提交后丢回执，页面unknown保留原命令，hold真实GET投递并页面点击同body/key接续201/replayed=true，两组哈希一致。随后模型一次16015ms提案、真实页面批准及方向未知请求复核通过；首cycle1行、当前approval绑定1、输入/TZ/ICU/tzdata一致。补充Task/outbox/revision均0，不证明非空安排；共享journal4行default unknown不等于四次Plan请求未知。自有服务/两容器/凭据已清理；完整Web候选后续以 `1c84441d764424e6530ef5d8859dada12845a7dc` 获[134文件组合批准](team-review-web-lifecycle-73fcd5f.md)并整体集成；末次仅补测试无界等待，不重跑业务，异常注入路径未实测 |

有限安全结果：[反馈](../../../../artifacts/acceptance/team-lead-20261004/integration3/feedback-2c7910e.json)、[服务恢复](../../../../artifacts/acceptance/team-lead-20261004/integration3/runtime-restart-f7dce19.json)、[模型排期](../../../../artifacts/acceptance/team-lead-20261004/integration3/model-plan-80e871a.json)。测试输入为隔离工程输入；真实浏览器操作和真实模型响应不等于真实平台业务验收。清理前只读SQL是补充证据，未用于预置业务成功。

## 修复与独立复核

方向输出提示与有限安全诊断候选 `34aea3a0a688a8172128b8dfae4b097fcc43cbca` 已获[独立批准](team-review-direction-diag-34aea3a.md)。保持严格模型契约，不保存原输出或原未知请求敏感内容。此前方向schema失败和Plan描述超时保留于[第二批记录](team-integration2-20261004.md)。

Plan数据库锁等待回归曾失败，按顺序集成 `6ee0939`、`0305994`、`259bdb6` 的完整修正；修改只涉及测试，不放宽生产检查。锁持有、模型调用次数、最终数据库时钟跨界和事务清理均有断言。固定候选独立复核见[锁等待测试审查](team-review-plan-lock-6ee0939.md)；Web作者实际PG7/7通过，主窗未独立重复这次PG运行。包含反馈导航及上述修订的完整Web源已获[80e候选批准](team-review-feedback-web-f5a81e5.md)。自有进程修复见[独立审查](team-review-process-stop-dba7b34.md)。

共享ledger曾被Web自有 `read | transform | replace` 管道阻塞：同一稳定flock下，read输出背压而replace先等待锁再读stdin，导致互等。作者核对自有PID后SIGTERM该管道，未删除锁文件、未改他人记录；等待read恢复。后续改为先完整消费read snapshot，再单独CAS replace并捕获输出，冲突时重读合并；不新增锁机制。

## 仍在推进与未验证

本批已经整体集成获审的项目暂停/恢复/结束意图、素材内部撤回、任务单一逻辑尝试和批准配置首周期窗口。契约已经按相同revision由参与方签收；实际生命周期和首窗口页面结果见上表。逻辑尝试只记录pending，不会打开物理执行许可；内部撤回不执行公开平台撤下。持续下周期配置生效与真实review loop仍未完成开发，不能以首周期writer关闭这些工作。

恢复工作时，本地Docker、Web/backend及管理模拟器进程均已停止，adb没有USB设备。主窗启动原OrbStack、原自有持久PG实例、原管理AVD和服务，健康/Web200；没有替换数据库或重置数据。为先完成原生未决请求恢复，私有启动副本暂仅核验已应用0001–0033迁移，新增完整组合尚未应用到该实例；队列消费者保持关闭。管理端原未决备注的原key和expectedFactVersion5仍在，实际退出登录后原持久请求逐值未变，服务端只读核对撤销一条会话。随后实际开发验证码页面重登录完成，跨登录接续仍在验证。USB本轮不可见不覆盖此前真机证据。

完整后端候选 `07225e7ddb8dbdd7f95bd477330a1bffae945f94` 曾被独立复核要求修复 `LIFECYCLE-ZERO-VERSION-01`，即合法新项目版本0的素材撤回被错误拒绝。修正候选 `e18d52fe6dddf441ed65912ea3bbfbf83e24dbfc` 已获[完整25文件精确批准](team-review-exec-lifecycle-07225e7.md)并整体集成；新增material PG18/18与先前未变范围的组合31/31分别保留，尚非当前root组合的真实Web验收。迁移现在0001–0036连续，当前运行实例仍为33迁移；最终浏览器组合按最新减负要求串行开展；36迁移恢复补验已按上表完成，原持久实例仍保留33迁移。

用户随后要求禁止模拟器、仅使用USBAndroid，主窗已停止管理AVD，真机实际online。关闭前管理端跨登录后的同一请求重试已完成，原key成功回执1条、版本6、控制/grants0；临时SESSION备注尚待恢复，当前真机保留执行端安装身份，不能通过清数据改身份绕过。详见[同一原生记录更新](team-native-label-821f315.md)。后续不再启动模拟器，不并发跑构建、真实模型或测试组。

减负后的当前服务状态：[有限核验](../../../../artifacts/acceptance/team-lead-20261004/native-session-safe/load-reduction.json)确认原生恢复launcher已正常退出，产品3100/4320及本轮短暂恢复的Demo3000服务均已停止；持久PG和SQLite数据保留，Demo状态仍unknown1/completed6/cancelled1。此前探测Demo `/health` 的409为不存在路径NOT_FOUND，不作为业务故障。后续实际浏览器验证只使用一组自有隔离Web/backend/必要存储，按主窗串行窗口执行；不操作外来容器。

原Plan未知恢复补验未能到达UI恢复阶段：测试默认route.fetch30秒先超时，只读补充所见command/revision/task/outbox0，不推断所有故障的最终回滚。首修dcaf仅按describe45秒设置60秒仍漏coordinator30秒，被独立复核要求修改；完整测试路径修订 `ae629796955cf56f83550ae3fe0d028e55805e7d` 已获[批准](team-review-web-delay-dcaf244.md)，root已集成。fetch120秒、观察真实response190秒包括人工延迟60秒，真实UI未知45秒阈值保持原值。方向Playwright原stdout/stderr不再落盘，采用固定摘要。修正后新的真实恢复已按上表通过，旧失败不覆盖；作者PG direction17/17及Plan7/7是补充，清理两个自有容器/服务/临时凭据完成。

本批源码已整体集成，生命周期/首周期实际Web已按73fcd通过；末次有界等待修订的异常注入未实测。合并后的Webcheck和生产build均通过（Vite大于500kB chunk警告保留，不作功能失败）。本批后续仍需整合head独立复核以及对应新head的hosted CI。现有[草稿PR23](https://github.com/linghuxj/SocialGrowth/pull/23)和已通过的CI仍固定在 `7e8f33b57e133db53940400f40997f4d71854c7c`，不能套用到后续源码；获批后更新同一个PR，不新增批次分支或PR。

真实网络受限准入、短信、第二真机/规模、平台素材/效果/到账，以及旧固定安全门禁仍沿用[第二批去重阻断](team-integration2-20261004.md)。正式签名、生产灾备和旧客户端输入沿用WP27原资源项。已退出Samsung不恢复参与，原unknown不清零，设备队列消费者保持关闭；不公开发布或撤下。

## 接手时的剩余范围（本批固定快照）

通过项仅限上表列出的固定源码与实际场景。完整WP/AC映射继续沿用重新扫描，共享tasks.json仍是唯一认领台账。

- 已完成本批工程：生命周期/素材撤回权威意图与页面、单逻辑attempt记录及默认关闭、首批准周期持久记录、完整36迁移隔离恢复对照；原API fixture失配、StrictMode首次读取、写unknown提示和验证器定位问题已分别修正，旧失败保留。
- 仍未完成开发或实际接线：可信非空安排到Task/Artemis消费者、逐动作当前权限与文件/平台结果生产、物理停止与资源交接、可信实际效果/收入来源、基础分佣到账、持续周期配置/下一轮review loop。现有类型和空投影不关闭这些工作。
- 仍需真实验收：新完整候选在USB执行真机的各原生页面/恢复范围、独立管理真机、受限网络当前修订/共存路径、真实平台对象与来源/指标/收入、20–50台规模和明确性能阈值、正式签名与生产灾备/试运行。缺口沿用既有阻断ID；不新增同义条目。
- 当前残留与环境：Samsung保持退出参与与执行端安装身份；SESSION临时备注v6尚未恢复。USB-only，不启动模拟器；原持久DB33迁移及Demo unknown1保留，自有服务已停。隔离36迁移结果不能套用为原实例已迁移或部署完成。
- 需补的工程验证：最新测试deadline/route失败传播分支尚未实际注入；新的整体head独立复核及hosted CI待下一门禁，不沿用PR23旧7e CI。
