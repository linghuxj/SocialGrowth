# Artemis 专属只读会话启动与退出

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；输入提交 `dc8abf515202400454fde0d56a485a9db21c2b9b`，承接“继续推进下一阶段内容”，沿用 `codex/core-automation-loop-stage1`。本轮完成**本机 macOS 专属只读 SDK 会话**的实际启动、观察、退出和原启动记录恢复验证。完整 Artemis 业务任务、正式真机 inspect_app 和整机控制交还仍未完成。作者验证，不代替非作者复核／独立 QA；不合入 Developer、不更新父 pending。固定源码及证据见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/manifest.json)。

## 完成内容

核对实际 SDK 后确认，默认 `Agent.init` 在创建任务上下文之前建立 ADB／UI 客户端并预热模型，`_run_task` 又会执行解锁、安装、环境准备和 App lock。它不能直接作为上一阶段 read_screen 范围的入口。本轮没有调用默认初始化、MCP、graph 或模型，也没有修改 Demo 模型配置或覆盖 SDK checkout。

新增 `socialgrowth_read_session.py`：从 stdin 接收原 launchId 和私有 bridge access，以 `-I -B` 排除环境 PYTHONPATH／用户 site 和 bytecode 写入，加入已核对的 SDK／overlay 路径，并在进程内绑定仓库 overlay 的 SDK 模块别名。构造真实 `ArtemisContext`，在尺寸尚未观察时显式设为零；绑定只读 driver 后实例化真实 Pro `OperatorNode`。SDK 包会提前导入部分 Agent／Operator 类，但本入口没有调用其默认初始化或模型方法。`ready` 只表示上下文绑定完成。

会话只接收准确原 launchId 的 `observe(requestId)` 和 `close`，strict 控制 frame 最多 2048 bytes；不接设备、任意命令、App 创建、发布或成功事实。observe 的原 requestId 贯穿 SDK driver → 私有 IPC → SQLite phone fence → 当前 authority → 原 transport。同 ID 不重复读取。返回尺寸和摘要是子进程观察元数据，不构成账号、App 或发布身份的可信核验。

新增 `ArtemisReadSessionProcess`：核对私有 canonical 目录／0600 ledger，固定六份 overlay 及 Python launcher／实际 framework runtime 的 SHA256，使用固定参数、最小环境、shell=false。原 scope 的启动意图在 spawn 前持久化；同 scope 的任意已有记录仅返回原 receipt，不能再次启动。相同 serial 的未收口记录有唯一约束。重建时不通过 PID 杀进程、不清除记录、不重发；缺少源码、当前 scope 或宿主保护能力时拒绝启动，无无保护回退。正式调用仍应使用宿主唯一 canonical ledger，不向外提供替换 ledger 的开关。

本机实际 `/usr/bin/sandbox-exec` 策略：拒绝全部 IP 网络和其他 Unix endpoint，只允许原 bridge socket；拒绝 fork 和其他 executable；文件只能写专属 scratch，不能改父目录中的 fence／启动账本或 SDK／overlay 源码。SDK 导入需要创建临时目录，因此为其分配独立 tmp／app／traces；没有放开全局文件写入。Homebrew Python launcher 会转交 framework runtime，二者分别固定文件指纹和 exec 路径。策略文本拒绝引号、换行、反斜线及经符号链接解析后的不安全路径。

close 先请求原 local fence 停止新增读取，再关闭原子进程；退出以实际 child close 事件记录，清理原 bridge、等待已有 fence work 并删除 scratch。close 可重复等待同一收口。异常 pipe／启动记录写入问题也进入收口，未知读取不会因 child 消失变为已停止。**child_exited／关闭确认不是手机停止证明**，不会恢复 holder，也不会清除 phone fence 的 unresolved action。

## 验证结果与范围

| 检查 | 结果 |
| --- | --- |
| 项目环境 | pnpm 8.14.0／项目 Node 24.16.0／SQLite OK |
| `pnpm test:product` | 594 通过：contracts TS 69／Python 38、backend 340、executor 61、Web 86；非 UI 补充检查 |
| 新会话普通组件 | 5 项通过：固定策略／文本及链接注入拒绝、四种原 receipt 恢复不再启动、缺源码不改变 fence、公开目录／外来 access 拒绝、同 serial unknown 不可替换 |
| 实际 SDK／宿主组件 | 6 项通过：真实 context／Operator 启动、原观察／重复 ID、close／不伪造 phone stop、重建原 intent、旧 scope／源码拒绝、当前撤回、timeout unknown 保留及宿主原生保护；场景有组合断言，合计六项脚本用例 |
| 宿主原生拒绝 | 在安装 Python SDK guard **之前**使用 libc 验证 IP connect、其他 Unix socket、父目录写入、fork 均返回 EPERM；原受控 Unix bridge 仍成功读到合成 2×2 ScreenData，两个禁止 endpoint 的宿主 listener 收到连接数 0 |
| 原 SDK 桥接回归 | 上一阶段组合组件 1 项通过；原 factory／ScreenData／observer、29 个拒绝检查保留 |
| Python codec／既有 overlay | 15 项通过；无真实凭据或设备操作 |
| executor check／build／lint | 最终通过 |
| 根 `pnpm test:playwright` | 八类真实页面场景通过、errors=0；桌面／390px 截图已检查 |

最后控制策略的 canonical 路径防注入修订后再次通过[新会话 11 项](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/session-policy-final.log)及 check／build／lint；其余未受影响模块沿用本轮完整产品检查。原 SDK 回归见[sdk-final](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/sdk-final.log)。

首轮三个启动用例失败：本机 Python launcher 所需 runtime 尚未列入 exec 路径；第二轮路径校验遗漏 Homebrew 的 `@`；第三轮 SDK tempfile 导入受到禁止写入保护。分别落实固定 runtime／合法字符及专属 scratch 后通过，原失败日志保留，没有解释为设备故障，也没有使用无保护启动回退。后续自查补充了 pipe／存储异常收口及 canonical exec 路径的文本注入防护，最终均验证通过。

实际 SDK 为既有 `371aa6df56880643da57b30da936e9812fb0ec66` checkout，包含原外来工作；只读兼容清单见[sdk compatibility](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/sdk-compatibility.json)。组件中的中央 authority、停止事实、可执行读屏文件及像素均是明确的**合成 fixture**。宿主拒绝结果是真实 macOS kernel 结果，但仅覆盖这个新子进程及列出的路径，不能据此设置 `allPathsFenced=true`。

Web 使用专属回环 PostgreSQL 17 空库 `sg_session9_web`，检查准确库名和集群 ID，完整迁移 0001～0030，标准运营初始化的临时登录从 stdin 输入；项目和核验经真实页面表单／按钮操作，没有播种手机、网络、grant 或成功任务事实。[只读 SQL](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/sql-readonly.json)为 tasks=2／reviews=1／holder grants=0／begin calls=0／Artemis intents=0。[Web 结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/ui/result.json)是现有阻断流程回归，不是新会话或真机业务验收。

## 当前阻断与后续接线

只读复查原 Demo task `d634e4c6-4266-4cc7-a784-3a31a1737cac` 仍为 unknown，已知原 PID 97609 查询为 ESRCH。该结果不证明手机静止／控制权交还，没有清未知、回填停止事实或重发；见[原操作证据](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/original-operation-readonly.json)。既有 Google Artemis 引擎通过证据继续按原范围复用。

本轮限定 macOS 本机，只支持受控观察。其他执行宿主尚无对应保护；新会话不允许模型网络，因此完整 Pro 模型／graph 执行还需独立的受控供应商接线。未证明其他宿主进程、既有控制者、native USB／IOKit／mach 等全部物理路径已封闭。真实网络／ADB／目标／占用检查器仍未接通，中央 broker inspector 仍为 null，正式 executor 仍 disabled。当前不能把 bootstrap ready、旧核验记录、进程退出或合成图片作为执行许可／平台身份事实。

下一阶段：先实现实际宿主／目标检查和原 unknown 的可信停止核实，落实当前手机参与及完整控制路径；再组合原中央 broker／journal 与专属执行入口，从 Web 发起唯一 inspect_app，并由独立可信证据消费者核验 App／父账号／Page 或频道。条件未成立的部分保留阻断。完整业务任务、真机参与 APK、正式 Web→Artemis、实际控制交还和平台证据消费仍未验收。

本轮真实手机动作、Artemis MCP／模型调用、平台资产创建和公开发布均为 **0**。专属 services／子进程／sockets／scratch 已退出及清理，核对原 container ID 与 owner 标签后只移除本轮 PG 容器／卷，三个其他容器保留，3100／4320／32925 无 listener；见[收口记录](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/resource-closure.json)。受保护发布脚本仅路径／状态检查，外来未提交工作保留。

复现：`pnpm test:product`；`pnpm --filter @socialgrowth/product-executor exec tsx --test src/artemis-read-session-process.test.ts src/artemis-read-session-process.sdk-test.ts src/artemis-read-screen-bridge.sdk-test.ts`（SDK 组件需当前本机 macOS、原 SDK `.venv`，不操作真实手机）；`PYTHONPATH=integrations/artemis:integrations/google-artemis PYTHONDONTWRITEBYTECODE=1 integrations/google-artemis/.venv/bin/python -m unittest test_read_screen test_supervision test_human_input`。Web 用本轮[辅助脚本](../../../../artifacts/acceptance/product/B3/account-preparation-stage9-20261002/web-runner.mjs)在已授权的准确专属空库及 `SG_PREPARATION_FIXTURE_DATABASE_URL`／`SG_PREPARATION_FIXTURE_CLUSTER_ID` 下运行，实际验证命令仍为根 `pnpm test:playwright`；脚本拒绝非空／非准确库和已有服务，不启动设备 worker。
