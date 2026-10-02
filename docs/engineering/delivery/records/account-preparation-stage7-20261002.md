# 初始化受控 ADB 读屏 transport

2026-10-02；承接“继续推进下一阶段内容”，输入提交 `3554017fe665f85d03e97527ff6923985d2434c9`，沿用 `codex/core-automation-loop-stage1`。本轮交付一个具体的、固定命令的读屏 transport，仍未完成全部 Artemis 物理路径和正式真机闭环。源码／证据指纹见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/manifest.json)。这是作者验证，不是独立 QA；不合入 Developer、不更新父 pending，不修改既有外来工作或模型配置。

## 实际改动

`PhoneActionFence` 的同步 transport 交接新增第三参数：已经核验、冻结的新动作票。原持久意图、与暂停共用的 SQLite 写锁、回执及 unknown 逻辑保留。已有 transport 实现仍能接受该端口；原 fence 的十二项回归通过。

`AdbReadScreenTransport` 是该端口的实际实现，只接受准确原 tuple 下的 `business/read_screen`。内部构造固定 device／holder／authorization／attempt／generation／用途、serial、ADB server IP／port、规范化可执行文件及 SHA-256。启动前重新核验可执行文件身份、权限和内容，然后检查动作票：准确身份、非重放、非未来／过期，且有效窗最多两秒。没有 HTTP 参数、环境开关或自动发现／切换设备。

唯一命令为固定 argv `-H <IP> -P <port> -s <serial> exec-out screencap -p`。不用 shell、await 或排队回调，`spawn` 在本地 fence 写锁内同步发起；子进程只继承三个固定 ADB 端点变量，凭据、动态加载及 Node 配置不进入子进程。它没有任意 shell、层级读取、写入、导航、安装、登录、创建或发布能力。

三秒超时、超过 16MiB、非零退出或信号均拒绝；只有 child close 后才接受结果。PNG 签名／完整 chunks／CRC／非交错 8-bit RGB 或 RGBA／有界解压／扫描行／完整结束均需满足，解压最多 64MiB；1px headless 占位、截断、错误和尾随内容拒绝，没有替代截图或假成功回退。授权内部消费者收到 pixels、尺寸及摘要，不持久化截图或 raw stderr。拒绝由 fence 保留 unknown，杀掉 ADB 客户端不等于 server／派生进程／手机已静止，也不会清空未决操作。

当前可执行文件只读检查确认本机真实 SDK adb 符合构造边界：[host readiness](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/host-readiness.json)。其复现脚本只构造 transport，作用域为明确的合成非设备 binding，**没有调用 start、adb 命令或设备／网络探测**；不是当前 ADB 授权、网络准入或手机可执行证明。

## 仍未接通的范围

这个 transport 只保护通过它交接的这一条读屏路径。未替换 Artemis 默认 raw adbutils driver、UIAutomator、人工保护输入／补图／刷新或 READ_ACTIONS 旁路；未修改 SDK 或私密配置，也不证明 OS 进程隔离或封闭其他 ADB 连接。当前网络、目标、完整物理路径保护、控制交还／静止仍必须由真实检查器提供，中央 broker 的检查器默认 null 拒绝。没有使用组件 fixture 的 true 值构造正式许可。

再次通过 `DatabaseSync(readOnly:true)` 读取 Demo 原 task `d634e4c6-4266-4cc7-a784-3a31a1737cac` 的 ID／status，仍为 unknown；见[只读证据](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/original-operation-readonly.json)。没有读取模型输出、修改状态、回填停止证明或重发任务。既有 Google Artemis 验证按原覆盖范围保留。

正式 executor 仍 disabled；未注册 worker、权限 HTTP 或 SDK 调用者。PNG 也不能独立证明 App、登录账号、Page／频道和管理权限正确，可信平台证据消费者仍待接线。手机客户端新参与 APK 的真机验证仍未在本轮执行。

## 实际验证

| 检查 | 结果和边界 |
| --- | --- |
| `pnpm env:check` | pnpm 8.14.0／项目 Node 24.16.0／SQLite OK |
| `pnpm test:product` | 582 通过：contracts TS 69、Python 38、backend 340、executor 49、Web 86；非 UI 补充检查 |
| 新 transport 八项 | 固定 argv／环境隔离／pixels；错 scope／kind／注入／重放拒绝；未来／过期／超过两秒票拒绝；文件替换／可写文件拒绝；截断／CRC／尾随／空／占位拒绝；非零／raw stderr／超量；输出后仍在途超时；真实子进程与原 fence 组合、timeout unknown 跨连接／停止保留。可执行文件、像素和 authority 是明确的合成 fixture，不调用实际 adb／SDK／手机 |
| executor `check`／`build`／`lint` | 通过；最后 fixture 修正后再次类型检查，生产代码未再改动 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=account-preparation pnpm test:playwright` | 八类实际表单／按钮场景通过、页面错误 0；缺资源／许可仍阻断，旧核验／task version、丢 ACK 原键接续、重载、桌面及 390px 只读均保留 |
| Web 只读 SQL | tasks=2、reviews=1、holder grants=0、begin calls=0、Artemis intents=0 |

新增组件首轮 0／8：fixture 使用 macOS `/var` 临时目录别名，生产可执行文件 guard 在启动前拒绝；fixture 使用 realpath 后 7／8，停止证明 fixture 误传完整 state，严格 schema 拒绝。改成精确四字段后，全量产品检查通过。保留[首轮摘要](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/transport-first.json)、[第二轮失败](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/transport-repair.log)、[首次全量失败](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/test-first.log)及[最终全量结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/test-final.log)，没有把 fixture 错误算作手机故障。

Web 使用本轮专属回环 PostgreSQL 17 空库 `sg_read7_web`，检查集群 ID 后完整迁移 0001～0030；标准部署入口从 stdin 初始化临时运营，项目、请求和核验均经实际页面操作，没有播种手机／网络／grant 成功事实。真实 Web 结果、桌面／390px 截图已检查：[结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/ui/result.json)、[桌面](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/ui/preparation-desktop.png)、[手机宽度](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/ui/preparation-mobile.png)。Web 是现有阻断流程回归，不是 transport 或真机业务验收。

复现：组件使用 `pnpm --filter @socialgrowth/product-executor test`，也可执行 `pnpm --filter @socialgrowth/product-executor exec tsx --test src/adb-read-screen-transport.test.ts`。Web 的[辅助脚本](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/web-runner.mjs)从根执行 `pnpm exec node <脚本绝对路径>`，需已授权专属空库的 `SG_PREPARATION_FIXTURE_DATABASE_URL`／`SG_PREPARATION_FIXTURE_CLUSTER_ID`；只允许回环准确库名和空 schema，3100／4320 必须空闲。脚本退出停止自身 Web／backend，不启动 device worker。数据库容器／卷单独清理，不自动部署生产。

## 收口与后续

本轮临时 Web／backend 已退出；检查准确 container ID 和 `socialgrowth.owner=read7-20261002` 标签后，仅删除本轮 PG 容器及卷；三个其他容器保留。八个首轮构造失败留下的临时 fixture 目录按精确脚本前缀、唯一 synthetic-adb 文件及本轮日期清理，其他文件保留；临时登录凭据只存在本轮内存／子进程环境，日志脱敏。见[资源收口](../../../../artifacts/acceptance/product/B3/account-preparation-stage7-20261002/resource-closure.json)。受保护发布脚本仅路径／状态核对，未读、修改、暂存或执行。

通过：单路径具体读屏 transport、八项新增组件检查、原 fence 回归、产品 582 检查及真实 Web 阻断回归。失败：最终无未解决检查失败。阻断：真实完整检查器、全部 SDK／人工物理路径和原 unknown 的可信停止证明。未验证：正式 Web→Artemis inspect_app、实际手机停止／交还、客户端参与及平台可信证据消费。新 Artemis 调用、真机动作、平台资产创建及公开发布均 **0**。

下一步仍需将所有原始路径接入同一实际边界，缺少覆盖则拒绝启动；补真实网络／ADB／目标及占用／静止检查器，核实原未决操作后，再组合原 broker／fence／preparation journal 与正式 worker，从 Web 验证唯一 inspect_app。不会用这个新增模块的存在、host 文件检查或组件截图替代这些事实。
