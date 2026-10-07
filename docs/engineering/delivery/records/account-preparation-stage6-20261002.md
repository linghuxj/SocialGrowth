# 初始化当前权威读取与原动作提交

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；承接“继续推进下一阶段内容”，输入提交 `1c5d4dc584b8dc18edc2751093a66e804b9b4615`，沿用 `codex/core-automation-loop-stage1`。本轮完成内部中央权威读取与原命令提交的组合，**真实物理接线仍未完成**。属于作者检查，未代替非作者复核／独立 QA，不合入 Developer、不更新父 pending，不改既有模型配置或外来工作。源码和证据见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/manifest.json)。

## 实现和许可边界

新增 `PreparationActionBroker`，直接从 PostgreSQL 当前事实读取原中央 `inspect_app` 的 task／attempt／准确 assignment、父登录账号与项目分配、运营与提供者状态、当前关联／安装代次／会话、设备版本、本机参与、正式网络节点及控制日志。中央原 task ID 是本切片 authorizationId，另一个 ID、版本、设备、父账号、项目或原 attempt 均不能借用。检查原 immutable intent 与 assignment 指纹，不用 Web 核验快照、模型报告、USB 在线或调用者布尔事实替代当前权限。

该切片只准许 `business/read_screen`，不授予导航、写入、安装、退出、删除、创建或公开提交。holder 最多三十秒，原 grant 的范围与期限不可扩展。中央事实在同一事务里读取、加锁并更新 holder／原动作意图；签发动作票前已提交原命令，物理操作还必须经过真实同步 transport fence。授予、原调用及中央证据审计保持原子，不因审计失败留下部分许可。

外部观察先在 SQL 锁外执行。当前 scope 包括准确 serial、安装／关联／参与 run、会话、设备版本、控制 generation／version、task／attempt、项目／分配版本、正式网络节点／revision、原 trace 及 holder 期限。检查器返回一次 nonce、该 scope 的 digest、当前网络／ADB／目标／所有底层路径／控制占用或交还／静止观测。两秒超时及 Abort 后不采纳迟到结果。返回后重读并加锁当前事实；scope 或当前状态变化均拒绝。多个设备的外部等待不占 SQL 设备或全局元数据锁，短事务的共享元数据锁不成为全局执行器锁。

动作票最多两秒，并截断到当前安装会话、参与及不可变原租约期限；审计后再次检查时限，不能在审计等待后提交已过期许可。原调用／grant ACK 丢失及同键并发只核实持久原命令并返回当前控制状态，重放 ticket=null，不发第二张动作票，不续租、不复查物理检查器或重发 SDK。终态／unknown 原观察、其他未决 attempt、暂停或替换均不能产生新动作。

`PhoneControlJournal` 抽取 `applyInTransaction`，让内部组合使用已有事务，保留原公开存储 primitive 的行为；新增严格核对原 kind／payload／expected version 的 `replayCommand`。回调和外部观察不是 HTTP 请求体，未开放权限路由或环境开启开关。新 broker 没有 AppModule／worker 注册；默认检查器为 null，必须拒绝，不提前激活正式 executor。

## 真实物理边界核查

当前本地 SDK 源码只读核查确认：默认 factory 构造 raw adbutils driver；Android driver 有 ADB／UIAutomator 直接读取、后台线程 shell、录制子进程；UIAutomator 客户端存在另一截图／层级路径；人工保护输入、人工补图和刷新使用独立 raw ADB；Demo 监督保留 READ_ACTIONS 旁路。Android driver 在截屏失败后可能返回用于 headless 测试的占位 PNG，这不能作为真实设备证据，也不能吞掉未来 guard 的拒绝。只加最上层 wrapper 无法封闭这些路径。

[路径清单与源码指纹](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/sdk-boundary-inventory.json)描述的是当前本地源码（含原有外来修改），不是 upstream 保证或实际 enforcement。本轮未编辑 SDK、读取私密模型配置、调用模型或执行手机操作。真实 `PhysicalPreparationInspector` 和每条物理路径的同步 transport 尚未实现；PG 的正例 inspector、正式接入记录及 stopped 证明都是明确的**合成组件 fixture**，不能宣称真实网络、ADB、所有路径或手机停止已通过。

授权 Samsung `RFCW40MYYCV` 的 host USB 枚举为 device。只读查询确认 Demo 原 task `d634e4c6-4266-4cc7-a784-3a31a1737cac` 仍 unknown；已知原 attempt `4920b891-f2aa-4ecc-bb3e-6c1df7dff7fc` 的 trace `c41af179-58fd-4628-a227-20e777f6db70` 存档仍 completed、model Pro，原 PID 当前不存在。证据只读取 task ID／status 和白名单存档元数据，不读取模型输出或私密内容。结果见[原操作只读证据](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/original-operation-readonly.json)和[主机枚举](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/device-metadata.json)。这些事实不能证明所有物理路径停止，未清除 unknown、伪造停止或重发任务。既有 Google Artemis 验证保留原范围，未重新验证上游引擎。

## 验证

项目环境 pnpm 8.14.0、项目 Node 24.16.0、SQLite OK。专属 PostgreSQL 17 仅回环随机端口，组件 reset 前核验准确 DB 名与集群 ID；真实 Web 使用另一空库，从 0001 到 0030 完整迁移，以标准部署入口从 stdin 初始化临时运营登录，项目、请求、核验、接续及重载都从 Web 表单／按钮完成。没有播种手机、网络或 grant 的成功状态以推动 Web。

| 检查 | 结果与实际范围 |
| --- | --- |
| `pnpm test:product` | 574 通过：contracts TS 69／Python 38、backend 340、executor 41、Web 86；补充检查 |
| `preparation-action-broker.pg-test.ts` | 最终 12／12：真实中央数据组合、两秒动作票、无实际 inspector 拒绝、nonce／目标／未来／过期／缺路径拒绝、等待期间暂停／角色停用／撤销分配／版本变化／替换／本机撤回／网络回收、锁外观察与第二手机推进、同 holder 并发与动作互斥、丢 ACK、审计回滚、原 unknown 拒绝、审计等待中过期、会话截止和外部超时 Abort |
| `phone-control-journal.postgres-test.ts` | 21／21：原持久日志与 holder 不变式回归 |
| `account-preparation-api.pg-test.ts` | 19／19：正式 API 请求、核验、原回执及参与读取回归 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=account-preparation pnpm test:playwright` | 8 类实际页面场景通过、页面错误 0；旧核验／task version、丢 ACK 原键接续、重载、桌面和 390px 只读均保持阻断、不派发 |
| `pnpm env:check`、`pnpm check:product`、`pnpm build:product`、`pnpm lint:product` | 通过；最后错误映射／边界改动再做 backend build／lint、PG 复验。保留原有两条 backend `new Array` lint 警告 |

首次 broker PG 0／9，fixture 误用不存在的 `AccountPreparationService.request`；纠正为实际 `write(...,'request')` 后 9／9，再增加时限、会话和超时检查后 12／12。保留[首次失败日志](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/broker-pg-first.log)及后续结果，不把 fixture 错误解释成设备故障。初写代码的 TypeScript 空值收窄报错在开发过程中修复，最终检查／构建通过。

[Web 结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/ui/result.json)、[桌面](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/ui/preparation-desktop.png)与[手机宽度](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/ui/preparation-mobile.png)截图已检查。[只读 SQL](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/sql-readonly.json)确认 tasks=2、reviews=1、holder grants=0、begin calls=0、Artemis intents=0。Web 验证的是正式阻断流程；不是实际内部 broker 签发或真机闭环验收。

复现组件检查：注入专属回环 `SG_PRODUCT_TEST_DATABASE_URL`、`SG_PRODUCT_TEST_CLUSTER_ID`、`SG_PRODUCT_TEST_ALLOW_RESET=1`，根执行 `pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/<文件>`。broker 需 `sg_broker6_component`，原日志需 `sg_phone4_component`，准备 API 需 `sg_preparation2_component`，禁止在业务／共享库 reset。[可复现 Web 环境辅助脚本](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/web-runner.mjs)需已授权的专属空库 `sg_broker6_web` 及 `SG_PREPARATION_FIXTURE_DATABASE_URL`／`SG_PREPARATION_FIXTURE_CLUSTER_ID`，从项目根 `pnpm exec node <绝对脚本路径>` 执行。它核验库名、集群、空 schema 和空闲 3100／4320，再执行现有根 Playwright，退出时停止本轮服务；不启动设备 worker。脚本没有静态凭据，日志脱敏；PG 容器／卷由本轮单独清理。

## 四态与后续

通过：内部当前事实加载、同事务 holder／原动作提交、严格时限和重放、52 项 PG 补充检查及正式 Web 阻断回归。失败：最终无未解决检查失败。未验证：本机参与新 APK 在真机上的开启／撤回与保活、正式 Web→真实 Artemis `inspect_app`、实际控制交还及独立平台证据消费。阻断：真实网络／ADB／目标检查器、全部 SDK／人工物理路径 fence 和原未决的可信停止证据仍缺失。

后续顺序：补真实检查器和全部原始物理路径；统一处理拒绝、停止、占位回退及原操作核实；在当前参与、接入和停止条件成立后组合原 journal／正式 worker，从 Web 发起唯一一次 inspect_app；最后接可信消费者。缺项不由运营声明、硬编码 true 或 prompt 填补，失败也不退回裸 driver。完整下一阶段尚未完成，正式 executor 保持 disabled。新 Artemis 调用、平台资产创建和公开发布均为 **0**。

本轮专属 Web／backend 已退出，PG 容器／卷和临时辅助文件／凭据收口，其他服务及外来工作保留，见[资源收口](../../../../artifacts/acceptance/product/B3/account-preparation-stage6-20261002/resource-closure.json)。受保护发布脚本只核对路径／状态，未读取、修改、暂存或执行。
