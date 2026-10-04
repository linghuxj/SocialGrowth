# 初始化检查入口、持久任务与 Artemis 原操作记录

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；分支 `codex/core-automation-loop-stage1`，输入检查点 `57ac7c248311226942e693b583a4d691976ec08c`。承接 R-158 与用户“继续推进下一个阶段”的授权。第一阶段执行库登记和本阶段实现凝聚提交；当前来源 SHA-256 见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/manifest.json)。这是作者验证记录，未代替独立复核／QA 签收，未更新 Developer、父 pending 或旧任务结果。

## 已完成

- 正式产品 Web 的项目设置增加“发布身份初始化”：准确平台／父登录记录／目标／范围输入，默认仅检查；读取原记录、重新检查原任务，以及未知响应时锁定原输入并接续原请求。桌面可以提交；390px 手机端沿用只读处理，不开放写操作。
- 中央 PostgreSQL 增加初始化 Task、原命令、检查历史与审计。校验实际操作员会话、CSRF、项目阶段、当前资源版本和中央预留。无分配时持久保存阻断；相同原请求或相同不可变业务意图复用同一任务，换键不能改变原范围。重新检查只推进原任务版本；后续可附加匹配的中央预留资源，不能替换已选资源。
- 共享执行库每次选择一个下一步。调用者不能提交伪造的安装／登录／身份事实或执行许可；现阶段所有物理许可、身份验收和公开发布标志都保持 false。
- Artemis 增加显式工具、物理许可 guard、journal 端口的会话适配；PostgreSQL journal 绑定中央任务、版本、资源和原操作摘要。先落启动意图，再调用一次 `mobile_run_task`；原 trace 只能首次绑定，不可替换。未知启动／丢失绑定确认／旧操作未决不能重发；guard 失效时请求停止，但停止确认仍需核实。
- 模型“reported”仅保存待核验观察，不视为平台身份已验证。正式 AppModule 只接初始化检查服务与控制器，**没有注册 Artemis dispatcher、worker 或可信回执消费者**。该适配不是当前 Web 可直接执行真机的入口。

## 实际验证与来源

环境为 pnpm 8.14.0、项目管理的 Node 24.16.0，SQLite OK，见[环境日志](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/environment.log)。使用本轮专属 PostgreSQL 17.11 容器、隔离数据库及回环 Web 3100／backend 4320；迁移执行到 0027。正式浏览器使用新建合成项目和声明，经真实登录与页面提交写入；没有为 Web 验收预置业务成功、直接写数据库任务或 Mock 业务回执。补充 PostgreSQL 组件检查另有显式合成资源／会话 fixture，其结果不等于实际账号或手机准入。

| 检查 | 最终结果与边界 |
| --- | --- |
| `pnpm env:check`、`pnpm check:product`、`pnpm lint:product`、`pnpm build:product` | 均通过；lint 保留原有 `media-credential-key-custodian.test.ts` 两条 `new Array` 警告。最终移动端样式修正后单独重新构建 product-web 通过 |
| `pnpm test:product` | 558 通过：contracts TS 66、Python 38、backend 339、executor 29、Web 86；不代表真机／外部平台验收。executor 新会话 6 项使用 stub 端口 |
| `pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/account-preparation-api.pg-test.ts` | 独立 PostgreSQL + Nest HTTP 11/11，通过真实事务、并发原请求去重、提交后丢 ACK、进程重建、版本／范围／CSRF 校验、审计回滚、后续资源附加、journal 原 trace 及未知操作保留；这是非 UI 补充检查 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=account-preparation pnpm test:playwright` | **六类场景通过**，从实际 Web 登录、创建项目、填表和点击操作，见[最终结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/ui-visual-final/result.json)。页面报错为零；两任务保存、同任务 recheck、丢响应接续、重载保留和手机只读均有断言 |

Playwright 所需环境：`SG_PRODUCT_WEB_URL` 为受控回环地址，`SG_PRODUCT_PREPARATION_OWNED_ENV=1`，`SG_PRODUCT_PREPARATION_SCREENSHOT_DIR` 为证据目录；登录名／密码通过 `SG_PRODUCT_TEST_LOGIN_NAME`、`SG_PRODUCT_TEST_PASSWORD` 私密注入，不落入交付物。PostgreSQL 补充检查仅接受专属本机 `sg_preparation2_component` 数据库，要求 `SG_PRODUCT_TEST_DATABASE_URL`、`SG_PRODUCT_TEST_CLUSTER_ID`、`SG_PRODUCT_TEST_ALLOW_RESET=1`，并在重置前校验集群标识；不得对共享或业务库运行。

丢响应验证是在服务真实提交后通过浏览器 route.fetch 丢弃 ACK；接续再次走原请求键，没有返回模拟成功。最终[桌面截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/ui-visual-final/preparation-desktop.png)、[手机截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/ui-visual-final/preparation-mobile.png)经过目视检查；[只读 SQL 佐证](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/sql-readonly.json)确认两个任务，版本分别 0／1，资源尚未分配，真实 Artemis 启动意图为零。

完整工程日志位于同一证据目录：`product-check.log`、`product-lint.log`、`product-tests.log`、`product-build.log`、`web-build-final.log`、`postgres-journal-final.log`。失败证据保留：`postgres-first.log` 是首次组件检查对既有 CSRF 401 的预期写错，后已修正测试；`ui-first/result.json`、`ui-diagnostic/result.json` 是 select 隐式标签包含选项文本导致定位失败，已补明确 aria-label；首次 Web check 的回调签名问题亦已修正。最后一轮通过，未抹去这些失败或把其算入最终通过结果。

UI 仅在已有项目设置中补充表单与三行局部 CSS，未重做工作台。视觉检测器报告的是已有样式问题，未宣称整个站点设计规范通过；最终手机截图修正了按钮纵向折行。

## 未完成、正在推进与需验证

本阶段代码和验收收尾已完成，没有本轮遗留在运行的验证服务。下一阶段尚未实施的内容为：

1. 为每次底层读取／动作实现真实物理许可，绑定当前任务、单机独占控制、设备参与、网络准入和即时撤回。会话中的 guard 接口／提示词不能替代这项实现。
2. 正式 dispatcher／worker 与该 journal 组合，安全安装源、原登录账号协助、Web 人工反馈及秘密桥接；完整实际资源分配入口。不得绕过已存在的 Demo 原 unknown 操作。
3. 独立消费真实证据、准确父登录、平台 ID／类型／名称／管理权，原操作核实、任务结束／范围变更协议及最终绑定激活。当前 journal 尚不释放已记录意图；需要可信消费者后才能推进后续动作。
4. Playwright Web 发起与反馈，Artemis 自主真机执行的两平台闭环：已有身份复用、确实缺少才创建、App 缺少、错父登录、创建确认丢失、暂停恢复、移动网站／系统登录边界。真实创建／管理权／设备准入均未由本轮验证。

四态：**通过**＝正式 Web 保存／接续／重新检查与上述工程、事务检查；**失败**＝最终候选无未解决的本轮检查失败，历史失败已保留；**阻断**＝正式每动作物理许可和可信消费者尚未接线，现有 Demo 原未决及实际业务身份事实不能被本轮合成声明覆盖；**未验证**＝真实 Web→Artemis→人工反馈→平台身份核验与绑定激活。

真实手机动作、平台资产创建、公开发布均为 **0**。本轮专属 Web／backend 已停止，容器和临时凭据已移除，其他服务保留，见[资源清理记录](../../../../artifacts/acceptance/product/B3/account-preparation-stage2-20261002/resource-closure.json)。
