# 初始化控制权与逐动作执行边界

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；承接用户“继续推进”，沿用 `codex/core-automation-loop-stage1`，输入检查点 `45095cd038e8765659e22503d238e2b1cb2d75d9`。源码与结果摘要见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/manifest.json)。本记录为作者检查；未合入 Developer，未代替非作者复核／独立 QA，未修改父 pending、受保护发布脚本、既有模型配置或外来未提交工作。

## 实际实现

中央 `PhoneControlJournal` 增加内部 `acquire_holder`。先核验原控制确已 stopped、原调用均结束，再校验当前内部任务、网络／ADB／准确目标、本机十秒内参与确认、用途及租约。授予本身不创建动作；持久 grant、版本更新、原请求及审计在同一事务中提交。设备锁和 CAS 保证同机只能一个 holder 成功，不使用全局执行器锁阻塞另一台手机。

迁移 0029 保存不可变 holder 授予历史。holder UUID 全局唯一，停止后或另一设备上均不可重用；新事实只能收窄原 grant 的动作、用途、任务和有效期，不允许补充事实时悄悄延长租约。丢 ACK 重放返回当前控制状态，暂停后的重放不会重新授予。初始化仍从 stop_requested 开始，缺少停止证据不变成可用。事实和停止证据仅由内部可信端口提供，没有开放浏览器布尔许可入口。

执行侧新增 `PhoneActionFence`，使用独立私有 SQLite ledger、WAL／FULL 与写事务保存原动作意图。同一 serial 不能变成另一 device，holder 不可复用；每次 read_screen 和动作均要求准确 device／serial／holder／generation／task／authorization／purpose、原范围、有效租约及新提交的中央动作票。重放票、未来或过期票、错序列号拒绝交接。原意图先落盘，再在与暂停相同的写锁内重新检查并同步交接 transport；交接后 DB 失败也不能重复执行。

暂停立刻阻止该 ledger 下的新交接，保留在途或 unknown。真实调用结束只记录原 tuple，不开启新控制；丢回执 ACK 可重放原持久回执，不重新读屏或执行。unknown 只能通过原动作、当前停止请求及 generation 一致的可信结束证据核实；其 evidence ID 持久保存。确认停止还要求所有调用结束、证据晚于最后结束时间、十秒内实际检查、所有路径封闭、控制交还及目标静止。取消、租约过期、断线和进程退出均没有清除动作的方法。

**边界：这两项是内部实现，完整下一阶段尚未完成。** `PhoneFenceAuthority` 和同步 transport 是必须由真实系统实现的端口，测试中的 authority／probe／transport 是明确的合成组件 fixture，不能据此声明手机可执行。类只封闭通过其端口的调用，既有 Artemis 的 raw ADB、模型读屏、人工补图等路径还未统一接入；不会仅用顶层 guard／提示词覆盖这些旁路。正式 executor 主入口仍 disabled，Web 核验不派发任务。

## 原任务与设备检查

授权 Samsung `RFCW40MYYCV` 的 USB 枚举仍在线。只读查询确认 Demo 原任务 `d634e4c6-4266-4cc7-a784-3a31a1737cac` 仍 unknown，原 attempt `4920b891-f2aa-4ecc-bb3e-6c1df7dff7fc` 对应 trace `c41af179-58fd-4628-a227-20e777f6db70`。代理账本 acknowledged=1，Artemis 原存档 status=completed，原 PID 查询未发现存活进程。没有读取模型私密输出、凭据或媒体内容。

这揭示了中央与执行存档的未决差异，不证明所有设备控制路径已停止，也不构成新执行许可。本轮未改 Demo 状态、未提交模拟回执、未重发该操作。原未知状态与存档佐证见[只读证据](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/original-operation-readonly.json)。既有 Google Artemis 已验证能力按原范围保留，不重新称为全部未验证。

## 验证

环境：pnpm 8.14.0、项目 Node 24.16.0、SQLite OK；本轮独立 PostgreSQL 17 容器，仅回环端口；重置前检查 `sg_phone4_component` 的准确数据库名和集群 ID。PG fixture 只验证事务，不作为手机事实。独立 `sg_phone4_web` 从 0001 到 0029 完整迁移，标准部署入口从 stdin 初始化临时运营登录，业务项目与任务由实际 Web 创建。

| 检查 | 最终结果与边界 |
| --- | --- |
| `pnpm test:product` | 571 通过：contracts TS 66／Python 38、backend 340、executor 41、Web 86；非 UI 补充检查 |
| `pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/phone-control-journal.postgres-test.ts` | 21／21：原持久日志约束及新增 holder 并发、不可变历史、跨设备／原 holder 重用拒绝、范围及租约不扩展、ACK 重放、授予审计回滚 |
| 执行侧 fence 新增检查 | 12 项：初始阻断、同 ledger 双连接及两个独立 OS worker 的占用／暂停、授权等待中暂停、未知跨重启保留、回执重放不执行、错范围拒绝、旧／假停止证明拒绝、原动作核实、结束前的停止证明拒绝、重放／未来／过期／错设备票拒绝。合成 transport，不调用真机 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=account-preparation pnpm test:playwright` | 八类实际表单／按钮场景通过、页面错误零；原键接续、丢 ACK、重载、版本变化、桌面及 390px 只读，保持未派发和未就绪 |
| `pnpm env:check`、`pnpm check:product`、`pnpm build:product`、`pnpm lint:product` | 通过；执行侧最后改动再次 build／lint／test。保留原有 backend 两条 `new Array` lint 警告 |

首次跨 OS fixture 的内嵌 JavaScript 换行转义错误导致子进程未启动（9／10）；修复后 10／10，后续新增两项安全边界后最终全量通过。保留 `fence-first.log` 与 `fence-repair.log`，未覆盖失败或把子进程错误解释成设备结果。一次只读 SQL 佐证查询使用了不存在的 version 列，按实际 task_version 修正后重新读取；没有写入业务状态。

[浏览器结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/ui/result.json)、[桌面截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/ui/preparation-desktop.png)、[手机截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/ui/preparation-mobile.png)已检查。[只读 SQL](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/sql-readonly.json)确认两个任务、一个旧版本核验，holder／控制日志／Artemis 启动意图／观察均为零。没有通过预置 grant 或手机回执推动 Web 成功。

复现 PG 检查必须注入本轮同用途独立集群的 `SG_PRODUCT_TEST_DATABASE_URL`、`SG_PRODUCT_TEST_CLUSTER_ID`、`SG_PRODUCT_TEST_ALLOW_RESET=1`，数据库名须为 `sg_phone4_component`。Web 使用既有脚本，需 `SG_PRODUCT_PREPARATION_OWNED_ENV=1`、回环 `SG_PRODUCT_WEB_URL`、`SG_PRODUCT_PREPARATION_SCREENSHOT_DIR` 及私密的临时登录变量。禁止在共享／业务库运行 reset；日志不保存密码、令牌和连接串。原始日志保留工具空白，源码差异格式检查单独通过。

## 后续实施顺序与四态

1. 手机客户端提供当前参与确认，内部 broker 在一致锁顺序下加载当前安装／参与／任务／网络／准确 ADB 事实；不能用 Demo ready 或运营页面声明补足。
2. 将真实 Artemis 底层 driver、模型工具读屏、人工协助捕图、刷新及其他 ADB 路径统一纳入实际同步 transport，并处理退出、暂停及原未决的可信停止／交还。未覆盖路径必须拒绝，而不是提前放行。
3. 在以上事实和路径成立后，组合现有 preparation journal、正式 dispatcher／worker；从实际 Web 发起一次 `inspect_app`，启动 ACK 丢失只核实原 trace，不因新键／版本重发。
4. 接可信证据消费者，独立核验 App 包、安装／可用状态及准确作用域，再推进后续库操作；模型报告不能单独激活身份。

通过＝内部 holder 事务、受保护 transport 的本地 fence 和正式 Web 阻断回归；失败＝最终无未解决检查失败；阻断＝实际本机参与与权威加载器、真实全部物理路径及停止确认尚未接线；未验证＝正式 Web→Artemis `inspect_app`、实际停止／交还、可信消费者及登录／身份绑定。完整真机下一阶段不能写成完成。真实 Artemis 新调用、平台创建和公开发布均为 **0**。

本轮专属 Web／backend、容器／卷、私密凭据和临时辅助文件在收口时清理，其他服务及外来工作保留，见[资源收口](../../../../artifacts/acceptance/product/B3/account-preparation-stage4-20261002/resource-closure.json)。
