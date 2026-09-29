# 分散手机接入：VPN 与 mDNS 可行性核查

初次核查：2026-09-25；补充：2026-09-28。本文研究未部署 VPN 或运行实机测试；用户按 R-109 确认既有远程执行此前已经验证，应复用其证据，不视为全未验证。当前按 R-124 允许自有 App 配套官方 Tailscale，重点是单一 VPN 承担管理与业务上网，以及客户端端点通知和恢复。除该分工外，技术候选不等于已选实现。

## 配套客户端的验证安排

**本轮结果**：R-124 已确认首期允许自有 App 与官方 Tailscale 配套安装。推荐验证拓扑为手机上只由 Tailscale 占用系统 VPN，自有 App 负责注册、状态及 ADB 端点通知；管理流量经 tailnet，FB/YT 公网流量经选定 Exit Node。两个 App 共存与两个 VpnService 共存是不同问题。下述为验证设计，未启动服务、安装 App 或连接实机。

### 已核实的集成边界

- 官方 Android 客户端的 `IPNService` 继承 `VpnService`，包含网络变化、系统常开 VPN 启动及权限撤销处理。源码支持判断其使用系统 VPN，并不能证明任意机型后台永不掉线，也不能据内部启动动作推定自有 App 有对外控制接口。[官方客户端源码](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/IPNService.kt)
- 官方 Exit Node 可承载 Android 客户端公网流量，需在设备选择出口。管理与公网走不同逻辑路径，但共享手机网络和 VPN 进程；出口故障后能否保持管理，必须连同 DNS、路由及访问策略测试，不能只看两条路径的示意。[Exit Node](https://tailscale.com/docs/features/exit-nodes)
- `tsnet` 是 Go 程序内嵌 Tailscale 的用户态网络库。它证明可以给程序提供 tailnet 连接，不证明导入库即可让 Android 的 FB/YT、系统 ADB 服务自动进入该网络；完整手机路由仍需集成。R-124 下暂不把这条路线作为首期前置。[tsnet](https://tailscale.com/docs/features/tsnet)
- Android 提供本地网络服务发现能力；ADB 文档区分配对与连接，并使用 mDNS 发现连接服务。自有 App 本地发现当前设备端点后向中心认证上报，是待验证的接法，不是系统允许静默开启调试或跨 VPN 多播的保证。按候选 Android/ADB 版本检查配对、端点识别及可达性。[Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd)；[ADB](https://developer.android.com/tools/adb)

### 先验证这些结果

| 顺序 | 操作范围 | 需要的证据 |
| --- | --- | --- |
| 1. 对照已有执行 | 记录原已验证的机型、系统、ADB/Artemis 版本和连接方式；仅检查新网络方案影响 | 区分原来已通过的控制能力与新增客户端、出口和恢复部分，不从零重验 |
| 2. 管理与上网并行 | 在实际部署网络中，通过官方 Tailscale 连接管理端并使用指定 Exit Node；同时核验 FB/YT 网络与已有获准控制操作 | 中心连接、ADB 可达、平台页面/所需网络功能及实际出口，包含 DNS、IPv4/IPv6 表现；按 R-129 首期使用稳定现有 Wi-Fi，真实发布仍按既有授权规则，不为网络测试擅自发布 |
| 3. 端点变化后恢复 | 自有 App 可用时验证端点通知；区分配对端口和连接端口、识别本机，中心确认新端点并停用旧端点 | 状态和端点变化关联同一设备，新连接实际可用；只看到服务名或端口上报不算通过 |
| 4. 出口及连接故障 | 分别检查业务出口不可用、管理连接断开、Wi-Fi 掉线/切换/恢复，保留不同故障的实际影响；纯蜂窝持续执行不作为首期通过前提 | 出口失败时管理是否仍可用；管理断开不派发新的依赖任务，恢复先核对未决结果；如核心前提不满足则重新评估方案 |
| 5. 恢复与用户意愿 | 分别检查 VPN 重连、自有 App 重启、手机开机恢复，以及用户暂停、撤权和永久退出 | 哪些能自动恢复、哪些需现场授权如实记录；VPN 在线不能绕过暂停或退出，调试授权丢失不能伪记就绪，任务不重复提交 |

本轮不为上述步骤擅设通用性能阈值。先拿到真实链路与失败行为证据，再结合业务执行窗口评估是否可用；基础成立后按既有计划扩大至 20–50 台。自有 App 尚无本轮验证版本时，可先核查官方网络组合，但不能用这部分通过替代 App 端点通知、恢复及整套接入验收。

所需条件：可使用的候选手机、原验证方式与记录、Tailscale 网络及权限、中心和出口节点、真实部署 Wi-Fi 及掉线/切换环境（纯蜂窝持续执行按 R-129 后续验证）、自有 App 可验证版本或明确的局部原型。本轮未核验这些资源当前是否齐备；境外服务器此前仅为计划采购，不能把历史状态当作当前已部署或当前必然仍缺失。下一次实测前先盘点，不执行采购。

## ADB 端点发现、首次授权与恢复核查（2026-09-27）

本节补充官方资料及源码核查，未连接手机或实现客户端。已有远程执行证明继续有效，但不能替代新客户端首次接入与恢复验证。

### 事实与实现推论

- **配对和连接是不同服务**：ADB 使用 `_adb-tls-pairing._tcp` 进行配对发现，`_adb-tls-connect._tcp` 对应无线调试连接；TLS 连接端口动态选择，不应固定为 5555。信任关联实际 ADB 主机的密钥。由此推论：若自有 App 使用自身密钥完成配对，不能认定中心 ADB 也已获授权；中心执行路径必须单独证实。[AOSP ADB Wi-Fi 架构](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md)
- **本地发现有 API 依据**：Android NSD 提供发现、解析及服务消失通知，文档说明可能发现本机广播。它支持把本地发现作为候选输入，但不保证所有目标机型都能正确发现本机 ADB；多个手机同处一个网络时，不能把任意发现结果认作本机。[Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd)
- **注册不等于首次调试授权**：官方无线调试流程包含用户在系统设置启用功能和配对。故首次接入必须在“现场只有手机”的条件下证明中心如何取得授权，不能把现场 USB 电脑作为未说明的前提；发现端口或完成 App 注册均不能替代这一步。[Android ADB](https://developer.android.com/tools/adb)
- **Wi-Fi 状态可能决定无线调试是否存在**：核查 `android16-release` 的 `AdbDebuggingManager`，其 Wi-Fi 接收器在 Wi-Fi 关闭或断开时将 `ADB_WIFI_ENABLED` 设为 0（核查时约 645–665 行）。这是所查分支的行为，不是对全部厂商及版本的结论；但足以说明“蜂窝网络上 VPN 在线”不能推定“无线 ADB 仍可用”。Android 17/ADB 37 的新连接机制也不能直接外推到较早支持机型。[Android 16 源码](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/services/core/java/com/android/server/adb/AdbDebuggingManager.java)；[当前 ADB 文档](https://developer.android.com/tools/adb)

R-150 已确认正常端口变化只更新状态和记录，恢复失败或需人工才提醒。具体上报关联、受理回执、乱序及失效处理、多机重连与待办路由见[端点上报契约](../technical-design.md#adb-端点上报重连与提醒契约2026-09-28)；该契约为实施草案，不代表原生客户端已验证。

### 要证明的接续路径

用户完成必要系统授权 → App 识别本机当前连接端点并认证上报 → 中心验证实际路径可达及自身 ADB 授权 → 核验目标设备和业务条件 → Artemis 承接获准任务。

本地发现得到的 Wi-Fi 地址不自动成为中心可达地址；经 Tailscale 直连或其他转接如何成立，应复用原验证接法并实测，不先锁定转发组件。上报只包含必要连接信息，不向其他提供者广播配对凭据或私钥。

| 验证情形 | 需要证明的结果 |
| --- | --- |
| 首次接入、中心尚未配对 | 无现场电脑条件下，必要人工授权能落实到实际中心执行路径；只证明手机 App 本地连通不算通过 |
| 同一地点多台手机 | 正确识别各自端点，不因相同型号、服务名相似或首次发现就串接其他手机；与 R-128 一人多设备分别关联 |
| 端口变化或网络重连 | 废弃失效端点，重新核验中心连接、授权和原任务；连接信息更新不新增设备或重复执行 |
| Wi-Fi 断开、切换及重新连接 | 分别记录 VPN 与无线调试状态，判断调试是否被关闭、何时可恢复及是否需用户重新开启；不能只测 App 心跳 |
| 重启或撤销调试授权 | 记录服务、连接及授权各自恢复条件；需解锁或重新授权时交人工，不能承诺普通 App 静默补齐权限 |

**已按 R-129 确认**：首期要求稳定现有 Wi-Fi，不新增现场专用网关；纯蜂窝持续执行留待后续验证。Wi-Fi 掉线、切换及恢复仍属于首期验证范围，不能只验证正常联网。具体邀请、注册及多设备管理均不改变上述调试授权条件。

## Tailscale 入网身份、访问范围与退出核查（2026-09-27）

本节为 R-123、R-126 至 R-129 的技术验证准备；后续 R-148 已确认系统核验通过后自动准入、异常交运营，正常接入不逐台人工审批。以下网络身份、凭据及绑定方式仍为技术候选；未登录管理后台、生成密钥或修改网络策略。

### 官方能力与限制

- 官方 Android App 支持用 auth key 入网，密钥可设为单次使用。无标签时，设备使用密钥创建者的网络身份；带标签时改用标签身份。因此“用密钥接入”本身不代表权限已受限。撤销或过期 auth key 不会自动撤销已入网设备的权限，设备退出须另行处理节点授权。[Auth keys](https://tailscale.com/docs/features/access-control/auth-keys)
- 网络准入支持设备批准，也支持通过 API 自动处理；这与业务上的首次项目/账号分配是两回事。启用批准后，待批准设备不能通过 tailnet 收发数据，因此首次注册、入网和状态上报的先后需要验证，不能形成“尚未入网却必须先访问仅内网接口”的依赖循环。[Device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval)
- Grants 可按来源、目标和协议/端口定义访问范围；但新建 tailnet 的初始策略允许设备互通，不能把规则机制的默认拒绝误解成实际网络已隔离。Tailscale 访问规则不控制手机直接使用本地局域网的流量。[Grants](https://tailscale.com/docs/features/access-control/grants)；[ACL 行为与初始策略](https://tailscale.com/docs/features/access-control/acls)
- Exit Node 的互联网访问许可与手机间访问分别配置；`autogroup:internet` 表达经出口访问互联网，不等于允许访问所有内部节点。[Grants 语法](https://tailscale.com/docs/reference/syntax/grants)
- 标签身份不能与用户身份同时存在，官方主要将其用于服务设备，并提示不适合一般用户终端。我们的专用执行手机是否采用标签身份仍需评估，不能因为是 Android 就直接套服务端示例；业务提供者、实体设备与网络身份仍须分别关联。[Tags](https://tailscale.com/docs/features/tags)

### 自动准入确认与技术依据（2026-09-28）

用户按 R-148 选择系统核验后自动准入，首次项目和账号分配仍由运营确认。再次核对官方文档：设备批准支持收到待批准事件后核验条件，再调用授权 API；Android 官方 App 可使用 auth key 入网。[设备自动批准](https://tailscale.com/docs/features/access-control/device-management/device-approval#automate-device-approval)、[移动设备 auth key](https://tailscale.com/docs/features/access-control/auth-keys#register-a-mobile-device-with-the-auth-key)。这些能力不证明自有 App 已能可信绑定实体手机与网络节点，也不确定凭据发放方式；自动化的管理凭据只应由受控中心使用。

先完成不依赖 tailnet 的注册及关联，再核实实际节点，自动开放限定访问；待批准节点无法访问 tailnet 时仍须有受认证的接入材料传递路径。核验不明或失败转 R-143，不能把超时直接当作批准失败后重复建节点。暂停、退出及归属变化与迟到批准结果的冲突需在准入实施中处理并实测。

### 建议验证的最小连接范围

以下是落实既有授权边界的候选，不是可直接部署的策略配置：

| 连接方向 | 验证目标 |
| --- | --- |
| 指定控制中心 → 已授权执行手机 | 仅实际执行所需的连接；ADB 动态端口与所选连接方式一起验证，不为省事放开全部节点互访 |
| 手机 → 接入、状态及本人业务信息服务 | 允许必要通信，服务端仍校验用户、设备与请求范围；网络可达不授予后台操作或其他用户数据权限 |
| 手机 → 所需业务互联网出口 | 管理与 FB/YT 上网同时可用，出口使用权限不附带其他手机访问权限 |
| 手机 → 其他执行手机或内部管理服务 | 不因同属一个 tailnet 或一个提供者而新增直接控制权限；本人多设备的业务操作仍经过自有系统授权 |

最小连接范围不能仅靠自有 App 隐藏入口实现。还须检查已有允许规则是否叠加放宽，并区分 tailnet、同一地点局域网和公网路径；本表不承诺 Tailscale 能阻止所有绕开 VPN 的本地连接。

### 入网与退出的验证证据

1. **一台设备一次接入**：候选采用受控发放的单次入网凭据，不把可复用公司级密钥放入安装包、普通日志或群发邀请。单次使用不天然证明绑定的是指定实体手机；邀请、业务用户、手机和实际网络节点的对应须核对。这里不要求设备提供者持有公司网络管理账号，也不锁定 auth key 或其他身份集成路线。
2. **分层核验**：分别记录受邀注册、网络批准、ADB 授权、项目分配及业务就绪。网络侧的技术审批可以与已确认流程协同，不新增人工逐任务审批。第一台通过不能让同一提供者的其他手机自动获得资格。
3. **退出与权限回收**：按 R-123 先停止业务派发，保留未决结果；核对业务授权与实际网络节点权限的回收。只撤销邀请或 auth key 不能记为网络退出完成。必要账号清理仍要求有效授权和连接，撤权后不能继续操作，也不能为等待清理而继续派发任务。
4. **正反向验证**：证明控制中心能连接正确手机、手机能上报和访问业务出口，同时证明未授权手机不能经 tailnet 连接其他手机或取得内部管理权限。覆盖密钥已使用/失效、节点未批准、退出后重连及不同提供者，保留真实结果；策略静态检查不代替实际路径验证。

还需落实实际网络身份方案、凭据发放与节点关联方式、服务端鉴权、动态端口访问策略及退出清理顺序。当前不建设完整身份管理平台，不将候选配置当作用户新增确认；使用哪个 Tailscale 套餐及实际可用权限在部署前核实。

### 2026-09-28 实施深化的接入顺序缺口

再次只读核对官方设备批准说明：待批准设备不能收发 tailnet 流量；官方 LocalAPI 客户端的 WhoIs 可根据实际连接来源查询节点。因此，依赖内网来源核验的设计不能放在网络批准之前而没有任何可达路径。推荐的先行受限核验连接、设备签名挑战与动态端口授权见[实施草案](../device-connectivity-implementation.md)；该权限顺序后续已按 R-151 确认，补充 R-148：先核实受邀资格与归属，再开放仅用于核验的连接，节点绑定核验通过后正式准入；失败或失效时回收并核实实际结果。其余接口及参数已细化为联调候选，未部署或实测。来源：[设备批准](https://tailscale.com/docs/features/access-control/device-management/device-approval)、[LocalAPI 官方客户端](https://github.com/tailscale/tailscale/blob/main/client/local/local.go)。

## 其他候选与 Android 运行边界

当前按 R-124 优先验证官方 Tailscale 配合 Exit Node，按 R-129 使用稳定现有 Wi-Fi。以下保留此前研究的替代思路及限制，不作为并行建设要求：

| 方案 | 适用边界 |
| --- | --- |
| Tailscale + Exit Node | 单个系统 VPN 承担管理与所需业务出口；默认安装不改变全部公网出口，需实际配置并验证，不能保证国内网络稳定或故障完全隔离 |
| 自有 App 内统一网络处理 | 若优先方案不能满足已确认要求再评估；`tsnet` 不直接解决 FB/YT 和系统 ADB 的全机路由，首期不以网络引擎内嵌为前提 |
| Clash 非 VPN 代理模式配合 Tailscale | 仅在具体客户端支持且目标 App 流量实际使用代理时才成立，不能假定 FB/YT 自动遵循 HTTP/SOCKS 代理；不是已选方案 |

Android 同一用户或工作资料只有一个活动 VpnService；两个客户端都以此模式运行时，按应用分流不能增加第二个 VPN 实例。工作资料会改变应用与控制范围，不能未经对齐直接当作替代部署方案。[Android VPN](https://developer.android.com/develop/connectivity/vpn)；[Tailscale 共存说明](https://tailscale.com/docs/reference/faq/other-vpns)

mDNS 是本地链路发现，Exit Node 不使它自动跨地点传播。建议 App 在本地发现后经认证单播上报中心；登记身份与当前 IP、端口、服务名分别处理，不把地址变化当新手机。[RFC 6762](https://www.rfc-editor.org/rfc/rfc6762.html)

网络重连、App 服务恢复、开机后恢复和整机重启须分别验证。普通安装不自动取得整机重启权限；已授权 ADB 能发起重启，也不代表重启后能自行重建连接。锁屏、省电、后台回收、用户强制停止和撤权需记录实际表现，不承诺进程常驻或静默重新授权。[PowerManager](https://developer.android.com/reference/android/os/PowerManager#reboot(java.lang.String))；[DevicePolicyManager](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#reboot(android.content.ComponentName))；[前台服务启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)

## Android 接入引导的资料核查（2026-09-28）

本次为 Android 接入页面补查官方资料，未改变支持机型清单或选定具体中心配对接法，也未部署或连接设备。

- Android 官方无线 ADB 指南把系统开启、工作站配对及连接验证列为不同步骤，并以同一无线网络为标准流程条件。因此将远程中心接入改造成“现场仅手机”的产品流程，仍需证明实际可达与授权；管理手机扫码关联不能代替这项证据。当前官方文档还区分新版无线调试行为，不能据此承诺所有候选机型自动恢复。[Android ADB](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)
- Tailscale Android 安装说明包含官方 App 安装与系统 VPN 配置确认；这不证明自有 App 可静默代替这些操作。产品引导先解释用途，再跳转可验证的官方流程；未选择要求提供者持有公司网络管理账号的方案。[Tailscale Android 安装](https://tailscale.com/docs/install/android)
- Exit Node 文档将提供出口、允许使用出口与设备选择出口分开；Android 使用指定出口不等于把这台执行手机设为出口。提供者页面仅表达已分配方案及当前验证事实，不新增让提供者发布出口节点或任意变更路由的入口。[Tailscale Exit Node](https://tailscale.com/docs/features/exit-nodes)
- Android VPN 文档说明同一用户／资料只有一个活动 VPN 服务，新服务会停止已有服务。故页面不引导同时开启 Tailscale 与另一套系统 VPN；发现连接冲突时按事实处理，不能显示“两项授权都已通过”便推定共存。[Android VPN](https://developer.android.com/develop/connectivity/vpn)

设计推论：本机引导采用“显示关联码 → 配套与授权 → 分项检查 → 运营准备 → 初始化核验”，同时保留明确暂停意愿。资料不证明本机断网时能立即中断所有远程操作；R-139 本机暂停入口须补验设备身份权限、离线记录同步、实际停止及旧恢复回执冲突，不能仅测 UI 提示。具体页面和异常见[Android 接入规格](../android-app-page-spec.md#3-扫码关联与本机接入)。

## 既有证据与资源准备

### 首轮连接路径收敛（2026-09-28）

本轮再次核对官方资料，只收敛验证路径，不新增客户端网络引擎或现场设备：

- AOSP 将配对定义为手机信任实际 ADB 主机密钥；配对服务和 TLS 连接服务不同，连接端口动态分配。因此应由实际中心 ADB 身份完成配对，不能以 App 自身配对或 App 业务关联成功替代。[AOSP ADB Wi-Fi 架构](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md)
- Android 同一用户／资料只允许一个活动 VPN 服务，维持自有 App 配套官方 Tailscale 的既定方向。[Android VPN](https://developer.android.com/develop/connectivity/vpn)
- Tailscale 使用 Exit Node 时默认不允许访问本地网络；Android 客户端可设置 Allow LAN access。**验证推论**：本地发现与访问不能只在未启用出口时测通；需要对照选定出口下的本地发现、实际中心连接和平台网络结果。不是要求默认开放全部局域网，也不保证打开该选项即可解决 ADB 连接。[Tailscale Exit Node](https://tailscale.com/docs/features/exit-nodes#local-network-access)

首选验证顺序：先复用已通过的中心连接接法，证明选定手机上经 tailnet 可到达实际配对／连接服务，再用中心自身 ADB 密钥完成配对，最后验证选定 Exit Node 下两类网络同时可用。不能只把本地发现的 Wi-Fi 地址替换成 tailnet 地址就判成功；目的地址、端口监听、身份及连接结果都要核实。直接路径不成立时记录实际失败层，暂停定型该接法，不自动加现场网关、Root、第二 VPN 或通用转发服务。

R-149 已确认在已登录管理手机对应设备页手动输入执行手机系统配对码，并支持多台同时配对；凭据仅走绑定设备、中心身份及本次会话的受控通路，不进入普通反馈、截图、日志或模型输入。各设备端点、会话、输入和结果独立；同机请求互斥，迟到回执不覆盖新会话，实际目标核验及短期凭据传递仍须实测。具体并发契约见[技术设计](../technical-design.md#首次配对与多机并发契约2026-09-28)。无需在本轮新增完整配对设置中心。人工确认系统授权与业务扫码关联仍是不同步骤。

| 沿用验证项 | 本轮收敛后的最小判据 | 当前状态 |
| --- | --- | --- |
| V-02 管理与上网 | 相同配置下分别证明中心访问、实际 ADB 连接、FB/YT 网络可用；记录出口和本地访问配置对结果的影响 | 资料核查完成，实际样机结果未验证 |
| V-03 首次配对 | R-149 手动配对码、多机独立会话并发，现场无电脑；实际中心密钥获授权并连到正确手机，迟到结果不串会话 | 交互及并发要求已确认，远程路径、凭据通路与并发行为未验证 |
| V-04 App 端点 | 配对与连接端点分开、来源绑定本机；端口变化使旧连接事实失效，中心核验新端点 | 原生客户端行为未验证 |
| V-05 重连与重启 | 分别记录网络、调试授权及 App 进程恢复结果；需现场协助时如实提示，不自动解除暂停 | 未验证，沿用既有故障场景，不承诺静默恢复 |

以上状态不覆盖 R-109 的原远程执行证据，也不代表本轮运行了检测命令。实际步骤与证据规则沿用[首轮验证安排](../verification-readiness.md#首轮验证步骤)。

用户按 R-109 确认既有远程执行已验证。首先整理原机型、系统、中心接法、ADB/Artemis 版本及任务证据；只补查新网络、新客户端及未覆盖的恢复，不重新要求证明未受影响的基础能力。

原 Demo 局部核查记录：设备探测通过主机 `adb devices -l` 枚举，执行代理为 Node 侧 WebSocket 与 Artemis 入口。它们不证明已经存在可部署在手机上的 Android App，也不锁定最终架构。参考[设备探测](../../services/execution-runtime/src/device-detector.ts)与[执行代理](../../services/execution-runtime/src/agent-cli.ts)。

实际资源盘点包括候选手机及支持版本、现有 Wi-Fi、中心与出口、网络权限、可验证 App 或局部原型。用户此前可按支持条件筛选手机，境外出口此前计划采购；这些历史描述不代表当前库存或部署状态，实施前核实，不擅自采购。

通过局部链路与故障恢复验证后，再覆盖 20–50 台管理及实际并发，记录在线率、恢复时间、指令与画面延迟、中心和手机负载、素材与证据带宽。样本、容量与可靠性阈值在对应验收前确定，不以一台样机成功外推规模通过。业务条件仍以[需求基线](../current-requirements-summary.md)为准，资料核查不等于真机验证。
