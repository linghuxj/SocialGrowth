# 证据盘点与首轮验证准备

更新：2026-09-29。当前需求依据为 R-001～R-156，实施选择见[技术设计 0.2](technical-design.md)及已接受 ADR；整体开发已具备准入条件，按[当前交付顺序](next-stage-plan.md#当前开发准入与交付顺序)分批落实。本文件保留原盘点和增量检查的时间、环境及局限，历史“资源未确认／未接触设备”不代表最新证据状态。

最新已记录的 2026-09-28 22:06–22:07 样本完成单机前台原生 NSD 连接端口发现，并按本轮端口完成无 USB 的 Tailscale IPv6 ADB 目标身份核验；使用既有中心密钥，报告仍经已有 ADB 取回。首次配对、独立认证上报、后台、多机及完整网络共存未由该样本证明，IPv4 TCP 超时保留。详见[分轮证据](connectivity-verification-2026-09-28.md)。这不是本次重新实测，设备与服务的实时状态在下一次操作前另行核对。

设备认证／端口上报／受控重连及停止恢复在对应模块开发中实现和验证，不作为所有开发开始前的独立门槛；真实业务验收要求保持。

## 初始盘点范围（历史快照）

日期：2026-09-27。范围：只读检查仓库、归档报告、部分结构化证据和本地 Artemis 源码。没有启动服务、连接真机、安装 App、修改 VPN、创建平台内容或付款。用户本轮明确：暂按资源未确认推进，先完成技术设计、证据盘点和验证步骤。

2026-09-28 增量复核：按 R-141 的核心范围重新读取接入探测、动作拦截、停止、人工接管及实时截图路径。原六个关键文件 SHA-256 均与下表一致，原有判断仍有效；新增发现见下一节。只做代码与官方资料核查，没有调用运行接口或接触设备。该次复核业务依据至 R-141，当前基线已至 R-156，历史证据不因此改写。

## 真机连接后的只读准入检查（2026-09-28）

后续按用户“按照建议执行验证”进行了实际预检、Playwright 入口访问及多轮网络检查，见[真机网络验证执行记录](connectivity-verification-2026-09-28.md)。截至 21:44 的阶段样本：Tailscale IPv6 ADB 连接、既有密钥认证及目标身份核对通过，同端口 IPv4 TCP 仍超时；端口由用户提供，自动上报与首次配对未验证，Web 服务仍有阻断。以下表格保留为较早快照，以执行记录的时间和证据为准。

用户说明真机已连接后，本轮仅做只读检查；前文“未接触设备／资源未确认”是此前盘点快照。本节更新当前可见事实，不代表已启动业务实测。

| 项目 | 本轮观察 | 判定与边界 |
| --- | --- | --- |
| 本机 ADB | `adb devices -l` 识别 1 台 Samsung SM-S9110，状态 device，含 USB transport；不在文档复制完整设备序列号 | USB 连接已确认；未证明无线 ADB、Tailscale 或业务执行通过 |
| Android | 指定设备只读 `getprop ro.build.version.release` = 16，SDK = 36 | 已取得本次系统版本；不外推其他机型支持范围 |
| 无线调试 | 指定设备只读 `settings get global adb_wifi_enabled` = 0 | 当前关闭；首轮网络配对前需要本人按系统流程启用 |
| 手机官方 Tailscale | `pm list packages com.tailscale.ipn` 未返回包 | 当前查询用户未检测到该包；安装及网络授权尚未核实，不外推其他 Android 用户／工作资料 |
| 中心侧 Tailscale | `/Applications/Tailscale.app` 存在，PATH 未找到 tailscale 命令 | 仅证明本机安装目录存在；登录、节点身份、策略及出口未核实 |
| 本机 Web／runtime | `lsof` 未发现默认 3000／4318 监听；配置的 runtime 端口为 4318 | 当前默认本地验证入口不可用，未检查其他主机或自定义 Web 地址；本轮没有启动服务 |
| 项目环境 | 根目录 `pnpm env:check` 通过，Node v24.16.0，实际路径 `/Users/linghuxj/Library/pnpm/nodejs/24.16.0/bin/node`，SQLite OK | 项目 Node 与 SQLite 前置检查通过；不是 Artemis 或业务验收通过 |
| 运行文件 | `.env.runtime`、`.env.agent`、Artemis Python 路径及 Playwright／tsx 入口存在 | 不打印秘密、不重新运行 setup；配置内容与实际执行健康仍需对应检查 |
| 既有任务记录 | 以 SQLite `mode=ro` 查询：completed 6、cancelled 1、unknown 1；无 queued／running 记录；preparations 为 execution_started 7、waiting 1；device_holds 0、pauses 4 | 是存储快照，不证明所有进程空闲或未知结果已解决；不清理旧库、不启动 worker 消费旧任务、不重发 unknown 任务 |
| 新客户端 | 本仓库非归档范围仍未找到可测的自有 Android 工程／APK；R-148～R-151 仍为文档及契约 | 完整自动准入、配对会话、端点上报和回收须先提供最小客户端及接入后端，手动 ADB 不替代这些验收 |

当前可以开始单机网络与接入可行性准备：核实专用测试机及允许的操作范围、可用现有 Wi-Fi、官方 Tailscale 的安装授权、实际中心／核验服务／出口及策略权限；保持 USB 作为准备和诊断手段，但网络测试须明确证明流量使用目标 Tailscale／无线 ADB 路径，不能把 USB 成功记为网络通过。

准备顺序：先确认网络资源及这台手机的可用范围 → 最小原型与测试环境准备 → 安装并完成必要系统授权 → 验证受限核验服务的正反向可达性 → 单机真实配对和端点变化 → 暂停／退出及故障恢复 → 多机交错与规模。现有 Demo 的页面／基础链路可单独验证，但不能覆盖尚未实现的新接入能力；已有远程执行证据继续复用。

单机探索不要求先备齐四台；R-149 的并发场景后续仍需三台同一提供者手机及另一提供者手机的计划样本，管理手机另作为输入和管理入口。服务需由开发者手动启动，或明确授权 Agent 后启动；启动前核对在途事实。根 `pnpm dev` 不消费设备队列，不因此授权另行启动 agent／worker。公开发布、重启手机或故障注入须有对应范围授权。

本轮未截屏、安装应用、改系统设置或网络、发起设备任务、启动 Web／runtime／worker、发布内容。检查仅覆盖上表，结论分别为前置检查通过、当前缺项或未验证。

## 已有证据及适用范围

用户在 R-109 确认既有远程执行已验证，继续保留该事实。以下盘点用于明确本仓库可复查到的覆盖范围，不把材料未整理齐等同于用户没有验证。归档中的旧需求、步骤、技术选型和阻断不直接成为当前要求；按日期和后续证据判断。

| 证据 | 本次可确认的内容 | 不能外推的内容 |
| --- | --- | --- |
| [2026-09-20 真机报告](../archive/2026-09-25-before-realignment/docs/handoff/2026-09-20-device-publishing-verification.md) | 历史 Samsung SM-S9110 / Android 16，FB 最终提交页面的前置路径；报告写明未发布 | 旧报告中的“控制链路尚未接入”不能覆盖后来报告；型号也不等于当前完整支持清单 |
| [2026-09-21 Web 发布验证报告](../archive/2026-09-25-before-realignment/docs/acceptance/2026-09-21-real-web-publication-validation.md) | 报告记录 Playwright 从 Web 发起，Artemis 完成 FB 发布前流程，`PREFLIGHT_READY`，内容提交 0 次 | 报告明确未公开发布；目标 Page 身份当时仍有证据缺口，不能用个人 profile 或模型自报替代 |
| [2026-09-23 工作流结构化证据](../archive/2026-09-25-before-realignment/artifacts/acceptance/web-live-acceptance/full-workflow-evidence.json) | `executionStatus=completed`，但回执 `publishStatus=not_submitted` | 完成是执行事实，不是发布成功或反馈闭环完成 |
| [历史任务快照](../archive/2026-09-25-before-realignment/artifacts/acceptance/real-slice-publication/full-publication-evidence.json) | 本文件 8 条任务：1 条发布结果未知、2 条未提交、4 条确认未发布、1 条无回执；没有 `published` 回执 | 文件名含 publication 不表示发布成功；不能自动重跑未知任务，也不能用这份快照证明所有历史验证情况 |
| [素材准备证据](../artifacts/reports/2026-09-20-runtime-real-preflight/media-verified.json)与[同轮回执](../artifacts/reports/2026-09-20-runtime-real-preflight/receipt.json) | 素材校验阶段已记录；同轮最终为执行失败、发布结果未知 | 文件准备通过不能替代整次任务通过，也不证明图文、多设备传输已支持 |

本轮未逐张复核全部截图，未重新查询平台当前内容。上述结论分别来自原报告及列明的结构化字段，不能称为本轮独立实机验收。原始证据可能包含内部标识，只在获准范围内使用，不复制到设备提供者视图。

## 现有实现的复用判断

| 已检查实现 | 判断 | 新方案中的处理 |
| --- | --- | --- |
| [Artemis MCP 适配](../services/execution-runtime/src/artemis.ts) | 有 `mobile_run_task`、状态管理、设备观察调用，依赖本地 Python 环境及 SocialGrowth 扩展，使用 standalone 路径 | 候选复用边界；先固定版本和契约，不能把接口存在当作全部新场景通过 |
| [设备任务执行](../services/execution-runtime/src/device-executor.ts) | 按指定设备传送 MP4、核对 SHA-256、触发媒体扫描并轮询 trace | 可作为文件传送与任务关联参考；图文、分散网络及平台结果核验仍补验 |
| [本地动作拦截扩展](../integrations/google-artemis/artemis/tools/socialgrowth_supervision.py)与[中心检查](../services/execution-runtime/src/supervision.ts) | 扩展在获取有效会话后对读取动作提前返回，中心 `read` 分支也不检查控制状态为 active；本次仅作代码事实判断 | 必须验证并调整为按暂停用途区分读取权限，不能直接宣称满足提供者暂停期间不采集。会话失效保护不等于所有暂停状态均已覆盖 |
| [任务停止](../integrations/google-artemis/mcp_server/tools/task_manager.py) | standalone 非 Windows 路径发送 SIGTERM 后写 cancelled，没有在该分支等待全部手机动作停止的确认 | 补验进程及实际动作停止、控制权释放和未决结果；不能只用 stop 返回值交还手机 |
| [本地持久层](../services/execution-runtime/src/store.ts)及[执行代理](../services/execution-runtime/src/agent-cli.ts) | 已有 SQLite、任务/事件/暂停记录及执行端回执账本；代理是中心侧 Node 进程 | 提炼有用的事务和重连经验；不是 Android App，不直接沿用 JSON 状态整体作为新领域模型 |
| [Demo 匹配器](../services/ai-engine/src/matching-engine.ts) | 标签、受众及语言按固定分值匹配 | 可作历史参照，不证明真实业务 AI 决策，也不升级为首期策略库 |
| [短链入口](../services/shortlink-service/src/index.ts) | 工厂返回名称及版本，导出过滤等工具 | 不证明真实跳转、点击采集及来源归因已实现；新方案须验证实际路径 |
| Android 工程搜索 | 本次在非归档、非 Artemis 集成目录内未找到 Kotlin/Java/Manifest/Gradle 工程 | 在已搜索范围内未找到可复用的自有客户端；不推断用户其他目录不存在相关代码 |

上述是选取相关入口进行的设计盘点，不是整个仓库的代码安全审计。不会因此修改、重置或清理 Demo。

### 首期控制能力增量复核（2026-09-28）

| 已核实的代码事实 | 对首期的影响与最小处理 | 验证位置 |
| --- | --- | --- |
| [人工接管](../services/execution-runtime/src/runtime.ts) `holdDevice` 在设备已有 running 任务或 checking 准备时拒绝；[入口](../services/execution-runtime/src/server.ts) `/device-control` 接收 `held` 并检查人工协助占用 | 这是人工占用机制，不能直接改标签当作 R-133 提供者暂停。提供者暂停须先受理停用意愿、停派并驱动当前操作停止，实际停止后再交还控制 | V-06：运行中暂停不能因忙碌而丢弃停用意愿；受理不冒充停止 |
| [动作会话](../integrations/google-artemis/artemis/mcp/action_session.py) 在发送工具前调用 `guard_action`；扩展的 READ_ACTIONS 提前返回，中心 `gate` 的 read 分支也提前允许 | 可复用拦截位置，但需要按提供者暂停、项目暂停、恢复核验分别判断读取用途，不能一概放行或一概禁止所有读取 | V-06／V-07：暂停后无新手机采集；明确恢复后允许必要检查，仍禁止新发布 |
| [设备状态入口](../services/execution-runtime/src/server.ts) `/devices/states?capture=1` 在缺图且 ADB 在线时可调用截图；`/devices/refresh` 也直接调用 [captureDeviceScreen](../services/execution-runtime/src/device-detector.ts)，该函数直接执行 ADB screencap；相关调用处未见提供者暂停判定 | 只修 Artemis 工具拦截不够。所有实时手机读取入口都须接入同一许可判断；普通状态查询与读取既有证据不触发新截图。这里是业务控制缺口判断，不声称这些调用无需入口认证 | V-06：暂停后分别覆盖任务读取、状态页补图及手动刷新，不能继续触发真实截图 |
| [人工协助扩展](../integrations/google-artemis/artemis/tools/socialgrowth_supervision.py) 的 `capture()` 在取得会话、核对 serial 后直接运行 ADB 截图，不经过 ActionSession 的工具发送检查 | 直接 ADB 的必要协助取图同样纳入许可；等待人工处理不自动获得继续读屏的权限 | V-06／V-07：受理新暂停后协助取图也受限，恢复核验按限定用途重新授权 |
| [任务停止](../integrations/google-artemis/mcp_server/tools/task_manager.py) standalone 非 Windows 分支发 SIGTERM 后写 cancelled；[执行器](../services/execution-runtime/src/device-executor.ts) 异常处理中会调用该 stop | cancelled 是任务记录，不能直接映射为“手机已停止／可现场处理”。需要确认实际动作通道停止、在途调用结清及控制交还；未知发布继续保留 | V-06：停止回执早于实际结束时仍显示待确认；停止后无旧动作接续 |
| [设备探测](../services/execution-runtime/src/device-detector.ts) 使用中心主机 `adb devices -l`，异常时返回空数组 | 只能复用已有连接枚举，不能替代 App 端点发现／上报或中心首次配对；查询失败也不能直接写成所有设备已退出或无设备 | V-03／V-04：中心配对、目标身份及端点变化有各自证据 |

本次新增读取文件的 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| execution-runtime/src/server.ts | `167882fc1a5f516c73bce1fce26dfbe8799059b2e333a7f69d5d921360eba6bd` |
| execution-runtime/src/runtime.ts | `ee5aa30336abf86c1d02b07a2a85c33720407787f4c2bed3a7fb73725fffbb75` |
| execution-runtime/src/device-detector.ts | `a6739f21087d242c7712cd7e994370f5ec72d28781c8d49494e620b689bbd353` |

上述缺口已经由代码确认，但修复效果尚未验证；没有据此修改运行中代码，也不否定 R-109 已有远程执行通过事实。实施时先统一实际动作许可与停止证据，再连接 App 页面；不能仅新增一个提供者暂停字段便宣称满足要求。

## 版本与资源状态

本地 `integrations/google-artemis` 基础提交为 `371aa6d`，工作区存在修改及未跟踪扩展；因此不能仅记录该提交就声称环境可复现。其当前 `pyproject.toml` 要求 Python ≥3.12，不应由仓库通用 Python ≥3.10 规范推定 Artemis 也可用 3.10。

本次核查的关键文件指纹，用于后续判断盘点是否已过时；不是整个依赖包的完整发布清单：

| 文件 | SHA-256 |
| --- | --- |
| execution-runtime/src/artemis.ts | `71444cc6424dbd7c7524ec974afd2f3a6e5ed7cb2c7b7dce4b145a61b92d9387` |
| execution-runtime/src/device-executor.ts | `b8069f9b71b675b6e8455a3f271181504ae3d660ebfd6375b87c1b71263f086f` |
| execution-runtime/src/supervision.ts | `cdc69d33f07f2d6aae67f3c19e3a2aaeea25dbe25ddd717795653dcd55faca80` |
| Artemis 的 socialgrowth_supervision.py | `1aa62e32e92976df146504e6cc392de6f982a5cc770295956cd9bc9f0f3d6f65` |
| Artemis 的 action_session.py | `fc50707bafecc79ff1913ba001f66769c3fb72341236962ea9623e26940611da` |
| Artemis 的 task_manager.py | `23a3cabb7ca1fd53bd79305e057e14b4f31e472e498f23368c20d7bc0c704f94` |

后续固定环境时记录完整提交、必要补丁、依赖锁文件和配置键名；不把凭据、令牌、私有地址配置或未经处理的 trace 一起打包。当前未改动该嵌套仓库。

| 资源 | 本轮状态 | 实测前需要落实 |
| --- | --- | --- |
| 历史测试机 | 报告存在型号和版本；当前可用性未确认 | 实际手机、原厂系统版本、现有 Wi-Fi、必要现场协助 |
| 控制中心及业务出口 | 用户选择暂按未确认推进 | 实际可用节点、区域、网络权限、ADB/Artemis 运行条件 |
| 运行配置与 Python 环境 | `.env.runtime`、`.env.agent` 和 Artemis `.venv/bin/python` 路径存在；本轮未读取秘密或执行它们 | 确认适用配置、版本和启动方式；文件存在不等于服务健康 |
| 提供者 App | 未在已搜索代码范围找到可用 Android 工程 | 构建受邀接入和端点通知原型，或提供现有可验证版本 |
| 平台与内容 | 只读取得旧报告及证据，未核验当前 Page/频道和素材 | 本次获准身份、素材及人工资料、实际入口与执行范围 |
| 数据与容量判据 | 需求给出管理范围，没有具体性能数值 | 先确定本轮样本、成功/失败判据、延迟及恢复容许值，再测量 |

### 接入深化后的验证补充（2026-09-28）

按[接入实施草案](device-connectivity-implementation.md)新增核验通道隔离、来源节点证明、精确动态端口策略及四机交错样本；参数表只是首轮候选，执行时记录实际配置。R-151 已确认受限核验接入顺序，可按该边界准备和验证最小路径；当前没有 App、节点配置或真机执行结果，状态仍为未验证。

本轮再读 `device-detector.ts`，仍只能枚举中心现有 ADB 连接，不能当作 Android 本地发现及可信上报实现。未重新运行历史任务或改变服务状态。

## 首轮验证步骤

先验证接入和控制边界，不直接运行旧队列。下面每个步骤保存时间、环境版本、配置依据、实际操作及证据位置，结果为通过、失败、阻断或未验证。以下列出完整场景，不表示所有子项都未验证；已取得的局部证据见本文开头和分轮记录，其余子项仍待对应模块验证。

| 编号 | 前置与操作 | 通过证据及失败处理 |
| --- | --- | --- |
| V-01 环境固定 | 核对既有执行证据，确定本次 Artemis 版本及扩展；只读盘点当前队列、控制权和未决任务 | 能区分原通过范围和本次增量；存在未知任务则保留，不以清队列或重置库准备测试 |
| V-02 管理与上网 | 在实际现有 Wi-Fi 上接入官方 Tailscale，按需要配置出口；分别检查中心可达、ADB 路径和 FB/YT 网络功能 | 三类结果分别记录，包括 DNS、IPv4/IPv6 和实际路径；不以 VPN 开关或平台首页单项通过代替全部执行条件 |
| V-03 首次配对 | 按 R-149 从管理手机对应设备页输入执行手机系统配对码，现场只用手机；区分配对及连接端口，覆盖同人三机与另一提供者交错配对及错误码、乱序、重试、旧结果迟到 | 中心实际 ADB 密钥获对应手机授权，逐台核对身份和结果，不串号；仅端口变化不重新索码。不得撤销在用设备授权、全局重启 ADB 干扰其他设备或引入现场电脑；并发容量另测 |
| V-04 App 端点 | App 发现并认证上报本机端点，覆盖同网多手机、端口变化、重启换代、重复／乱序／失效上报、响应丢失和身份不一致；核对 R-150 正常变化无人工提醒、恢复失败或需人工才进入待办及去重 | 中心只连接绑定手机，拒绝陈旧／越范围端点；旧核验不覆盖新版本，通知失败不关闭待办，重连不解除暂停／退出。无 App 时保持未验证，不用手工输入替代 App 验收 |
| V-05 故障与恢复 | 分别验证出口故障、管理中断、Wi-Fi 切换、App 回收和系统重启；重启仅在可控空闲设备进行 | 记录哪些自动恢复、哪些需现场授权；恢复先核实原任务，不能据心跳认定 ADB 或业务已就绪 |
| V-06 停止与互斥 | 在无公开提交的受控任务中测试提供者暂停、项目暂停、人工接管；让读取和操作请求与停止交错 | 单机无争用；提供者暂停后读取也被阻止；请求/停止确认分开。不能证明停止时，不把手机交给新持有者 |
| V-07 恢复核验 | 提供者请求恢复后，仅允许必要核验，检查项目暂停、撤权、身份及旧任务；中途断开控制进程 | 核验本身可运行，未通过时新发布被拒绝；旧进程和迟到消息不能重新取得控制 |
| V-08 素材与证据 | 从实际运营入口录入获准成品及人工资料，检查文件传送、手机选取、版本更正及敏感输入路径 | 文件/任务/身份可对应；错误版本不执行，密码或验证码不进入实际模型输入和普通证据 |

V-02 至 V-07 随接入与控制模块开发优先验证，不应等运营页面全部完成才发现底层条件不成立；它们不作为首批身份归属闭环开工前的集中门槛。部分局部探测可使用原型，但完整业务验收仍从真实 Web 用 Playwright 发起，由 Artemis 执行手机操作。Android 客户端的原生授权、暂停和本地状态使用真实 App 操作及证据验证，不宣称 Web 测试已替代手机端验证。

若需启动/重启服务或操作设备，按[工程规范](../CLAUDE.md)和本次具体任务授权执行；资源及在途任务在每次执行前核对，不沿用历史快照推定当前可用。此处保留的是可执行步骤，不是已获准立即对任何设备运行的脚本。

## 后续真实发布与反馈

V-01 至 V-08 解决增量接入及控制条件后，使用本次明确的真实 Page/频道和成品，通过实际 Web 入口完成一条获准发布及核验，再获取真实反馈并执行下一轮有效安排。某项局部控制通过不授权公开发布，也不意味着必须为目标产品永久保留逐条人工批准。

之后覆盖 FB 视频/图文、YT Shorts/常规视频、短剧依赖、跨平台独立进度、换机/跨项目交接、数据延迟和 20–50 台管理；基础分佣沿用真实可核对资料与已确认口径，不要求先接入自动付款。完整清单以[验收与证据](acceptance-plan.md)为准，本表不缩小范围。

每轮实测前明确设备/网络样本、任务窗口、并发、延迟、恢复时间和完成率判据。首次探索只报告测量结果，不事后指定通过线；未能控制的故障注入或缺乏资源的场景记阻断，不制造成功记录。

## 本阶段产出与后续入口

已形成[技术设计 0.2](technical-design.md)、首批最小契约、证据复用判断及增量验证步骤。主要架构已按 ADR-0001～0011 确认，需求以 R-001～R-156 为准；从首批身份与设备归属闭环进入正式开发，V-02～V-07 的风险随对应模块实现并在交付前验证。云厂商、模型服务、依赖版本和实际测试资源仍按使用时点落实，文档不替代真实证据。
