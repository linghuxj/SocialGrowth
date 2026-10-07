# 初始化执行条件核验与原回执读取

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；沿用 `codex/core-automation-loop-stage1`，输入检查点 `ad8c7e8975f87425de1146b5192ce8050c9ab715`。承接用户“继续推进”及 R-158。候选来源、日志及截图摘要见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage3-20261002/manifest.json)。本记录为作者检查，未代替非作者复核／独立 QA，未合入 Developer、更新父 pending 或清除 Demo 原 unknown 操作。

## 完成的实际范围

正式产品项目设置增加“核验执行条件”：从原初始化任务读取当前资源预留、父登录对应关系、设备参与状态、入网记录、控制日志及未决操作，保存中央不可变核验记录和审计。任务／资源版本不符拒绝核验；相同请求键重复或丢响应接续复用原记录，不推进任务版本、不创建尝试。核验记录按中央单调提交序号显示最新一项，旧任务／资源版本的记录在 Web 明确标记需要重新核验。

该操作是**执行准入核验，不是手机派发**。没有用页面声明、模型报告或环境开关填补未实现的权限加载器；结果固定为实际阻断，`dispatchCreated`、`actionPermissionGranted`、`publicationAllowed` 均为 false。未增加自动任务队列、holder 授予、回执清除或真实手机操作。

正式 Web 也接入“原操作与回执”只读视图：读取原启动意图、原绑定 trace、最新观察状态和证据引用数量。后台重新验证 assignment 摘要及其中央任务、项目、分配、父登录、目标、范围、操作对应关系；损坏／错 trace／错 fingerprint 的最新回执拒绝投影。启动 ACK 丢失可以有 null 观察 trace，但不会擦除实际已绑定 trace。所有报告继续保持 `identityVerified=false`，`reported` 显示“执行端报告完成，证据待核验”。普通读取不调用 Artemis／ADB、不产生截图，不接收人工密码／验证码或浏览器伪造的许可。

初始盘点再次确认：正式 `PhoneControlJournal` 是存储原语，尚无 holder 获取和真实物理 start／stop fence；`checkActionPermission` 是内部事实判定；正式 executor 主入口保持 disabled。Demo 的 `guard_action` 对 READ_ACTIONS 存在提前放行，不能借其原有就绪声明替代每动作保护。本轮没有修改 Demo 扩展、嵌套 Artemis 环境或既有 Google 模型配置。

## 验证结果

环境：pnpm 8.14.0、项目管理的 Node 24.16.0、SQLite OK；本轮专属 PostgreSQL 17.11 容器，回环 Web 3100／backend 4320；最终独立空数据库从 0001 到 0028 完整迁移。标准部署初始化命令通过 stdin 建立临时运营账号；实际业务项目和任务全部由 Playwright 从 Web 创建。补充数据库检查另用隔离的 `sg_preparation2_component` fixture 库，在重置前核验本轮集群标识，不是实际手机／账号事实。

| 命令／证据 | 结果与边界 |
| --- | --- |
| `pnpm env:check`、`pnpm check:product`、`pnpm lint:product`、`pnpm build:product` | 通过；最后的序号排序修正后 product-backend 再次 build／lint 通过。保留原有密钥托管测试两条 `new Array` lint 警告 |
| `pnpm test:product` | 558 通过：contracts TS 66／Python 38、backend 339、executor 29、Web 86；非 UI 补充检查不证明真实手机执行 |
| `pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/account-preparation-api.pg-test.ts` | 最终 **18/18**；新增核验并发／进程重建／原键复用／范围及 CSRF／伪造许可拒绝、暂停与报告完成不授予执行、原 trace 保留、坏回执拒绝、审计回滚、不可变历史、旧版本核验保留，以及同时间戳按提交序号排序。回执来源为明确的合成 PG fixture，不冒充平台成功 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=account-preparation pnpm test:playwright` | 最终 **八类场景通过**，页面报错为零。真实表单与按钮覆盖检查持久保存、执行准入阻断、两种提交后丢 ACK 的原请求接续、同任务 recheck 与旧核验提示、重载保留、390px 手机只读和无横向溢出 |

最终[浏览器结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage3-20261002/ui-final/result.json)、[桌面截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage3-20261002/ui-final/preparation-desktop.png)、[手机截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage3-20261002/ui-final/preparation-mobile.png)及[只读数据库佐证](../../../../artifacts/acceptance/product/B3/account-preparation-stage3-20261002/sql-readonly-final.json)确认：两个原任务，一个执行核验记录，任务版本 0／1、旧核验版本 0；接续没有新增记录或手机启动意图，审计保留实际 request／recheck／execution_review。

两个丢 ACK 都是 `route.fetch` 等真实提交完成后丢弃浏览器响应，然后从页面读取并点击接续；没有 Mock 业务回执。正式 Web 本轮只覆盖“尚无原手机操作记录”的实际空状态；**有真实原操作时的回执展示、真实证据消费和 Web 人工反馈闭环未验收**。后台原回执投影的边界由上述非 UI PG fixture 检查补充，不外推为真机验收。

日志位于同一证据目录：`product-check.log`、`product-tests.log`、`product-lint.log`、`product-build.log`、`backend-build-final.log`、`backend-lint-final.log`、`postgres-final.log`、`ui-final/playwright.log`。首次 17 项 PG 与八场景 Web 均通过，随后为同时间戳排序增加序号和第 18 项检查，再在新空数据库重新走完整 Web；原始 `postgres-first.log`／`ui-first` 证据保留，没有覆盖第一次结果。当前候选未留未解决的本轮检查失败。

复现时，Web 脚本要求 `SG_PRODUCT_PREPARATION_OWNED_ENV=1`、回环 `SG_PRODUCT_WEB_URL`、证据目录 `SG_PRODUCT_PREPARATION_SCREENSHOT_DIR`，临时运营登录通过 `SG_PRODUCT_TEST_LOGIN_NAME`／`SG_PRODUCT_TEST_PASSWORD` 私密注入。PG 脚本要求专属本机 `sg_preparation2_component`、`SG_PRODUCT_TEST_DATABASE_URL`、`SG_PRODUCT_TEST_CLUSTER_ID`、`SG_PRODUCT_TEST_ALLOW_RESET=1`；不得对共享或业务数据库运行。原始工具日志保留空白，源码单独通过差异格式检查。

## 尚未实施与验收门槛

| 缺口 | 责任范围与下阶段验收门槛 |
| --- | --- |
| 当前物理许可与 holder | 中心后端＋手机客户端＋执行侧：加载当前真实网络／准确 ADB 授权、本机参与、任务与 holder 关系；每次真实读取和动作前保护，暂停／退出／接管及时撤回，原调用未决禁止新动作 |
| 所有读写路径保护与停止确认 | Artemis 集成＋执行侧：工具读屏、人工协助、补图／刷新均经过保护；未知工具和替代 shell／ADB 无旁路；控制日志 cancelled、SDK stop 或租约过期不能代替真实停止／控制交还证据 |
| 正式 dispatcher／worker | 中心＋执行侧：仅在上述保护和当前事实通过后接原 journal 与独立队列；启动结果不明核实原操作，不因新请求键或新 task version 重发。当前 execution-review 不创建 dispatch，因此此项尚未完成 |
| 可信消费者、协助和身份绑定 | 中心＋执行侧＋Web：真实证据与准确 ID／类型／父登录／名称／管理权独立核验；安全安装／登录协助和 Web 人工反馈；原未决核实、任务结束／范围变更及绑定激活不能凭模型报告进行 |

这些是缺少实现／真实事实的技术阻断，不是重新索取用户已给出的素材、账号或初始化操作授权。没有通过核验的事实不得用合成项目记录、旧截图或 Demo 参数替代。

四态：**通过**＝执行准入核验的 Web 持久链路及上述工程／PG 边界；**失败**＝最终检查无未解决失败；**阻断**＝当前物理保护、holder、正式派发及可信消费者尚未接线；**未验证**＝真实 Web→Artemis→人工反馈→平台身份核验／绑定。真实 Artemis 调用、平台资产创建和公开发布均为 **0**。

本轮专属 Web／backend、容器及临时凭据已清理；其他服务和外来未提交工作保留。资源记录见[清理证据](../../../../artifacts/acceptance/product/B3/account-preparation-stage3-20261002/resource-closure.json)。
