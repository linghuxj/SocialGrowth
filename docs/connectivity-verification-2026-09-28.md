# 真机网络验证执行记录（2026-09-28）

2026-10-06 追溯说明：旧工程已按[迁移记录](engineering/delivery/records/demo-removal-migration-20261006.md)删除或迁入正式执行器。源码链接指向迁移位置；历史实测结论仍限于原日期和范围，迁移不代表风险关闭。

**最新结果（22:07）**：电脑 Tailscale 恢复后，在没有 USB transport 的情况下重新运行原生 NSD 诊断，20 秒自动发现唯一连接候选端口 `46457`，错误为空；中心使用本轮候选经 Tailscale IPv6 核对到同一台 S23，ADB 为 device。单机前台发现与当前网络 ADB 身份核验通过；IPv4 TCP 仍超时，配对端点未知。报告经 ADB 取回，认证上报、多机及后台仍未验证。诊断进程已停止，原型及分轮证据见文末。

**最新复核（21:44）**：用户提供当前连接端口 `46457` 后，Tailscale IPv6 TCP、ADB 既有密钥认证及目标身份核对通过；网络 transport 为 `device`，型号与此前核验的 S23 一致。当前没有 USB transport，未用 USB 替代网络验证。同端口 IPv4 TCP 超时仍待定位。端口由用户提供，本次不覆盖新客户端自动上报、首次配对、多机并发或 Web 业务验收；详细分轮证据见文末。

本轮按用户“按照建议执行验证”执行：先检查同 Wi-Fi 下的前置条件，再计划异网复验。最新结构化采样时间为 2026-09-28 15:16:05（Asia/Shanghai）。结论：**前置检查部分通过，网络及 Web 验证受阻，尚未取得 Tailscale ADB 通路通过证据。**

## 实际结果

| 检查 | 结果 | 证据和适用范围 |
| --- | --- | --- |
| 项目运行环境 | 通过 | `pnpm env:check`：Node v24.16.0，项目选择的运行路径，SQLite OK |
| 真机 USB | 通过 | 1 个在线 USB transport，Samsung SM-S9110，Android 16 / SDK 36；没有用 USB 成功替代网络结果 |
| 手机 Tailscale 安装 | 通过（包存在） | 最新查询当前 Android 用户可见 `com.tailscale.ipn`；不代表登录、VPN 授权或节点连接已成功 |
| 中心 Tailscale 本机状态 | 通过（本机状态） | 最新 `status --json`：Running、Self.Online=true，具有节点地址；不代表目标手机或权限隔离已验证 |
| 目标手机节点 | 阻断 | 中心可见节点中 Android 数量为 0；可能涉及登录、连接、网络选择或节点可见策略，不能仅凭此断言手机未登录 |
| 无线 ADB 准备 | 阻断 | `adb_wifi_enabled=0`；mDNS 未发现 ADB TLS 服务。未执行 pair/connect，也未修改系统设置 |
| Web / runtime | 阻断 | 本地默认 3000 / 4318 未监听；现有 Playwright 脚本真实访问 `http://127.0.0.1:3000/#/home` 返回 `net::ERR_CONNECTION_REFUSED`，后续页面检查未执行 |
| 同 Wi-Fi Tailscale ADB | 未验证 | 缺少已核对身份的手机节点及无线调试端点；未取得网络 transport，不宣称流量经过 Tailscale |
| 异网、恢复及多机 | 未验证 | 尚未切换网络、注入故障或增加设备样本 |
| 新客户端自动接入／端口上报／通知 | 阻断 | 本仓库尚无可验收的自有 Android 客户端及完整接入后端；手工配对无法替代 R-148～R-151 验收 |

本轮开始时手机查询未检出 Tailscale，中心状态为 Stopped；随后复检已变为上表状态。保留这个时间变化，避免把早期快照当成当前事实。本轮 Agent 未安装应用、登录网络或修改网络设置。

## 可复现命令与证据

从仓库根目录执行：

```sh
pnpm env:check
python3 scripts/check-connectivity-preflight.py --output artifacts/acceptance/connectivity-2026-09-28/preflight-latest.json
SOCIALGROWTH_VERIFICATION_OUTPUT=artifacts/acceptance/connectivity-2026-09-28/web pnpm test:playwright
```

只读预检脚本为 [check-connectivity-preflight.py](../scripts/check-connectivity-preflight.py)。支持显式指定 ADB、Tailscale 路径和服务端口；多 transport 时不擅自选择手机。脚本仅记录脱敏状态，不保存设备序列号、节点地址、账号、密钥或配对码；只读前置检查不能替代 Playwright 业务验收。

- [首次结构化预检](../artifacts/acceptance/connectivity-2026-09-28/preflight.json)。
- [最新结构化预检](../artifacts/acceptance/connectivity-2026-09-28/preflight-latest.json)。有阻断时脚本返回 2，此次符合预期。
- [Playwright 实际执行结果](../artifacts/acceptance/connectivity-2026-09-28/web/browser-readiness.json)。检查脚本退出 2，pnpm 对外退出 1；这是入口不可用导致的阻断，不是业务断言通过。页面未加载，未产生成功页面截图。

以上原始证据在本地 `artifacts/acceptance/` 下，受现有 Git 忽略规则管理，不包含在普通源码提交中。复测应保留各次证据，避免覆盖本次原始结论。

## 解除阻断后的执行顺序

1. 明确用于本次测试的 tailnet，核对测试手机与中心的节点身份、可见性和访问策略；在手机完成 Tailscale 登录／系统授权及无线调试。节点加入不等于 R-151 受限核验隔离已通过，隔离另行测正反例。
2. 按 [CLAUDE.md](../CLAUDE.md) 获得服务启动授权，或由开发者启动 `pnpm dev`。启动前复核实例及在途任务，只运行 Web 和 runtime；既有 unknown 任务、暂停记录继续保留，不启动 worker／agent 消费旧队列。
3. 在同 Wi-Fi 下验证明确指定的 Tailscale 地址及无线 ADB transport，核对手机身份，记录直连／中继路径；USB 可作准备手段，但网络验证不得走 USB 或退回局域网地址。手工技术探测与尚未实现的管理页面配对验收分开记录。
4. 首轮通过后由现场协助把中心切至独立网络，测试手机继续使用 Wi-Fi，再做同样核验。没有独立网络样本时保持未验证，不将同网结果外推为跨网结果。

本轮未启动常驻服务、创建业务任务、读取手机屏幕或执行公开发布。已有远程执行的 R-109 证据继续有效；本次阻断只针对新增网络接入验证条件。

## 用户指定 galaxy-s23 后的复检（15:22–15:23）

用户确认 Tailscale 已登录，目标设备为 `galaxy-s23`。中心网络图已找到对应 Android 节点，显示名为 `Galaxy S23`；该节点的 IPv4、IPv6 地址均与 USB 真机 `tun1` 接口地址一致，完成本轮目标对应检查。这只是当前网络地址对应证据，不替代 R-151 的设备密钥和节点绑定证明。

中心采样时该节点 `Online=false`。对其 Tailscale IPv4 执行 `tailscale ping --c=3 --timeout=3s --until-direct=false <目标地址>`，3 次均超时、返回码 1。结论是**本次 Tailscale 探测未通过**，尚不能定位为登录、VPN 共存、后台限制或具体网络问题；不能把登录完成视为通路通过。此 ping 属于 Tailscale 探测，也不能替代 ADB 端口及应用权限检查。

手机无线调试仍为关闭；本机 3000／4318 仍未监听。需要现场确认手机 Tailscale 显示已连接并保持前台以便复测，按 Android 系统流程开启无线调试；服务启动授权仍待回复。未开启配对、变更访问策略或启动服务。

证据：[节点出现后的预检](../artifacts/acceptance/connectivity-2026-09-28/preflight-galaxy-s23.json)、[指定节点探测结果](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-ping.json)。这些记录新增保存，未覆盖先前快照。

## 用户完成手机准备后的复测（15:24–15:26）

- **无线调试准备通过**：`adb_wifi_enabled=1`，mDNS 返回与 USB 真机序列号对应的 `_adb-tls-connect._tcp` 服务，连接端口为 `42913`。3 条发现记录是同一服务重复出现，不代表 3 台手机。未发现配对服务，不把连接端口当配对端口。USB 查询 `service.adb.tls.port` 未取得可用端口，因此后续 TCP 探测采用实际 mDNS 观测。
- **VPN 归属已核对**：Android `dumpsys vpn_management` 显示 Active package name 为 `com.tailscale.ipn`。此事实不证明 Tailscale 控制面或数据面正常，也不能据超时直接归因为其他 VPN 冲突。
- **网络探测未通过**：中心采样仍为目标节点 `Online=false`；再次执行 3 次 Tailscale ping 均超时。明确指定该节点的 Tailscale IPv4 和 IPv6、端口 `42913`，TCP 连接各等待 4 秒均超时。没有退回局域网地址，尚未进行 ADB 配对／认证或手机业务操作。
- **下一诊断输入**：核对手机 Tailscale 实际显示的连接状态或错误文字，再决定修复步骤。暂不能区分手机连接、控制面、路由或访问策略原因；继续索取配对码不能解决当前的 TCP 不可达。
- **Web 条件未变**：3000／4318 仍未监听，服务启动授权尚待回复。本轮未重复执行已确认受阻的 Playwright 入口检查。

新增证据：[准备后预检](../artifacts/acceptance/connectivity-2026-09-28/preflight-galaxy-s23-ready.json)、[第二次 Tailscale 探测](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-ping-retry.json)、[Tailscale 地址上的 ADB TCP 探测](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-adb-tcp-mdns.json)、[手机 VPN 归属](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-vpn-owner.json)。本轮同网通路仍未通过，异网及自动上报保持未验证。

### 手机显示 Connected 后的诊断

用户确认手机界面显示 Connected。只读取该 Tailscale 进程的近期有限条日志，发现 15:26–15:27 持续出现控制连接超时、IPv6 拨号 `network is unreachable`，以及无法连接 Tokyo DERP 的健康告警。中心自身 Health 为空，手机节点最后在线采样为 15:20 左右。这说明界面连接状态与实际控制／中继连接健康存在差异；不能仅从其中 IPv6 错误推出禁用 IPv6 就能修复，也尚未证明具体 DNS、路由或运营商原因。

[脱敏错误摘录](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-network-errors.json)仅保存近期相关错误，移除 URL 和地址；未上传诊断日志到外部服务。后续先重建手机 Tailscale 连接并复测，如仍失败，再用另一可用 Wi-Fi 做对照定位。网络调整属于诊断样本变化，须单独记录，不冒充原同 Wi-Fi 验证通过。排查方向参考 [Tailscale 官方连接诊断](https://tailscale.com/docs/reference/troubleshooting/connectivity/connect-internet-failure)。

## 断开重连后的验证（15:28–15:31）

用户执行手机 Tailscale 断开重连后，中心仍显示目标离线、最后在线时间未更新，3 次 Tailscale ping 仍超时。端口仍为 `42913`：目标 Tailscale IPv4／IPv6 的 TCP 探测均超时；对同一 USB 真机对应 mDNS 局域网地址做一次诊断对照，TCP 成功。局域网结果只证明这个路径上监听可达，**不算 Tailscale 或 ADB 认证通过**。

手机近期日志仍有控制连接超时和 IPv6 不可达，并出现注册请求超时相关告警。手机 Wi-Fi 已连接，未检测到全局 HTTP 代理配置；中心 shell 也未检测到常见代理环境变量。未据此推断路由器或应用没有其他代理／路由设置。

为缩小范围，从手机 shell 发起有限时长的 HTTPS HEAD：IPv4 访问 `controlplane.tailscale.com/key` 返回 200，普通公网 HTTPS 对照返回 200；IPv6 访问同一控制服务连接失败。中心 shell 对控制服务 IPv4 请求超时。手机 shell 的路径不等于 Tailscale 应用自身受保护 socket 的路径；中心一次 HEAD 超时也不证明正在运行的 Tailscale 控制连接已中断。当前证据不能得出“手机完全不能上网”或“只需禁用 IPv6”的结论。

下一步选择独立 Wi-Fi 做对照：电脑留在当前网络，手机改连另一 Wi-Fi／另一手机热点，保持手机使用 Wi-Fi 的需求边界。先重新发现端口和核对节点，再测试；如恢复，将记录为异网样本，原同网失败仍保留。现场网络尚未切换，未宣称此步骤通过。

证据：[重连后应用错误](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-after-reconnect-errors.json)、[Tailscale 与 LAN 的 TCP 对照](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-after-reconnect-tcp.json)、[HTTPS 对照](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-https-diagnostic.json)。未进行配对、未调整 tailnet 策略、未改变系统 DNS／IPv6 设置。

## 手机切换 Wi-Fi 后的异网结果（15:33）

用户确认已切换手机 Wi-Fi，中心留在原网络。中心网络图中 `galaxy-s23` 恢复 `Online=true`；对既定 Tailscale 地址执行 3 次探测均成功，路径为 **direct**，延迟分别为 122、131、178 ms。另一次 `tailscale ping --tsmp` 成功，工具实际返回 1 个响应，延迟 322 ms；即使参数含 `--c=3`，也不记成 3 次 TSMP 成功。

**本轮异网 Tailscale 探测通过**，证明这个样本的节点间探测和 WireGuard TSMP 通路可用；它不等于 ADB、应用访问策略隔离或业务验收通过，也未覆盖 DERP 回退。原同网失败与换网后恢复都保留，当前只能确认恢复与网络切换／连接重建相关，尚不能确定原网络具体故障点，更不能归因为“同一个 Wi-Fi 必然影响 Tailscale”。

换网后 `adb_wifi_enabled=0`，中心 mDNS 也未再发现服务；旧端口 `42913` 不再作为当前有效端点使用。已请用户按系统流程在新 Wi-Fi 下重新开启无线调试，再取得该手机的新连接端口进行网络 ADB 验证。当前只有 USB transport，未进行配对或执行手机业务操作。

证据：[异网探测汇总](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-alternate-wifi-summary.json)、[TSMP 实际结果](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-alternate-wifi-tsmp.json)。本报告开头为首轮历史结论，最新网络结果以本节为准。

### 上一网络的 ADB 补充结果（15:35–15:36）

用户重新开启无线调试后，USB 只读查询观察到新监听端口 `46785`。对 Tailscale IPv6 地址的 TCP 连接成功，随后显式使用该 IPv6 端点 `adb connect` 成功，`get-state=device`；通过这个网络 transport 读取的序列号与 USB 真机一致，型号为 SM-S9110。由此确认**上一网络样本的 IPv6 ADB 连接、既有密钥认证及目标身份检查通过**，未使用配对码或验证首次配对流程。

同端口的 Tailscale IPv4 TCP 初测及后续 2 次复测均超时，IPv6 复测仍成功。只记录这个样本的地址族差异，不推断平台普遍仅支持 IPv6或直接归因于策略。没有执行手机屏幕读取、App 操作、公开发布或新客户端自动端点上报。

证据：[IPv6 ADB 认证与身份核对](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-alternate-wifi-adb-ipv6.json)、[后续双栈 TCP 对照](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-address-family-recheck.json)。

## 用户再次切换 Wi-Fi 后的独立复核（17:42–17:43）

按用户要求重新采样，不沿用旧端口或 ADB 成功状态。初次中心节点快照显示目标离线，但紧接着对明确目标的 3 次实时 Tailscale 探测均成功，经 `DERP(sin)` 返回，延迟 215、230、156 ms；另外 IPv4 和 IPv6 ICMP 分别成功，延迟 167、180 ms。节点状态快照与实时可达性不一致需分别保留；不以状态快照否定实际探测，也不把 ICMP 当作 ADB TCP 通过。

当前 `adb devices -l` 返回空列表，USB 与此前网络 transport 均不在其中。无法读取当前手机无线调试开关或新端口，状态为**未知**，不是已关闭。首次采样辅助代码未逐项检查 shell 返回码，已将证据文件中的对应 false／空字段纠正为 null，并注明不可读取原因，避免把探测失败解释成设备事实。

已请用户提供无线调试主页面的当前连接端口，或重新接入 USB 供只读发现；没有探测旧端口、扫描高位端口或索取配对码。取得端口后将分别测试双栈 TCP、显式 ADB transport 和目标身份。本次结论为 **Tailscale 实时网络探测通过，当前 ADB 验证阻断**。

证据：[本次设备及节点快照](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-wifi3-inventory.json)、[本次中继及双栈探测](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-wifi3-network.json)。不同网络和时刻独立记录，本次 DERP 成功不覆盖上一网络的 IPv4 TCP 失败。

### 再次尝试（21:39）

用户要求再次尝试后，重新读取中心状态：`galaxy-s23` 在线，`adb devices -l` 和 `adb mdns services` 均为空。对历史已认证端点 `46785` 做一次有限重试，明确将端口标为“历史候选、当前有效性未知”：Tailscale IPv4 TCP 超时，IPv6 TCP 返回 ConnectionRefusedError。没有端口扫描，也没有因节点在线就声称 ADB 已恢复。

当前无法区分无线调试关闭、端口已变或明确拒绝连接的其他原因。需要读取手机无线调试主页面的当前连接端口，或重新接入 USB；不需要配对码。证据：[本次双栈重试](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-retry-133959.json)。未成功建立 ADB，未执行设备业务动作。

21:42 用户补充确认已打开无线调试后再次尝试：节点在线，ADB／mDNS 仍为空，历史端口 IPv4 超时、IPv6 拒绝连接。无线调试“已开启”记录为用户确认，未因无法读取而写成关闭；目前缺少的是当前连接端口。证据：[开启无线调试后的重试](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-wireless-enabled-retry-134216.json)。

## 当前端口确认后的网络 ADB 结果（21:44）

用户从无线调试主页面提供连接端口 `46457`。对绑定节点的两个 Tailscale 地址分别检查：IPv4 TCP 等待 5 秒超时，IPv6 TCP 成功（约 167 ms）。随后明确指定 IPv6 端点执行 `adb connect`，返回成功；同一 transport 的 `get-state=device`，只读取得的序列号与此前 USB 核验值一致，型号 SM-S9110。**当前网络下的 Tailscale IPv6 ADB 连接与目标核对通过**。

本轮开始时无任何 USB／网络 ADB transport；成功后的身份读取明确指定 IPv6 端点，不存在通过默认 ADB 选择退回 USB 的情况。重连使用既有中心密钥，没有新的配对码流程；不能把已有信任关系下的连接成功记成首次配对通过。

最新端口与旧端口 `46785` 不同，说明执行端不能一直重试历史端口。本轮由人提供新端口，不证明 App 发现／上报／重连通知已实现；应继续按 R-150 和既定完整快照契约实现。IPv4 和 IPv6 必须分别保留实际可达结果，不能只凭节点在线或一个地址族通过就宣称全部可用。IPv4 超时的根因尚未查明，未擅自修改 tailnet 策略、系统 IPv6 或手机网络设置。

证据：[当前端口的双栈探测、ADB 认证和身份核对](../artifacts/acceptance/connectivity-2026-09-28/galaxy-s23-port46457-134410.json)。本轮未读取手机屏幕或执行 App 业务操作，未启动 Web／runtime／设备任务消费者。自动上报、首次配对、多机隔离、受限准入与正式权限、Web 业务验收仍未验证。

## 下一步：原生端点发现原型（21:56）

用户要求继续推进后，实现了[隔离诊断原型与操作说明](engineering/delivery/records/demo-removal-migration-20261006.md)。它使用系统 NSD 在本机 Wi-Fi 上观察连接及配对服务，以本机地址筛选候选，处理未知／多个候选／网络变化／离开前台，20 秒结束并写入私有报告。没有设备 shell、中心上报或配对码逻辑；候选地址匹配不当作可信设备绑定。

构建使用本机 SDK 36、Build Tools 36.0.0、JDK 17；原型 minSdk 34 / targetSdk 36，只有 INTERNET、ACCESS_NETWORK_STATE 两项普通权限。编译及 APK 签名验证通过；构建存在 Java 8 引导类路径与弃用 API 提示，不影响本次生成 APK，不因此宣称正式兼容性通过。本地生成诊断签名密钥，仅用于此 APK，存于 Git 忽略的证据输出目录，未生成或变更 tailnet 凭据。

实际安装前明确核对目标身份，发现既有 IPv6 transport 为 offline；只对这个端点执行一次 disconnect/connect，结果仍 offline。持久层只读快照无 queued／running 任务，保留 completed 6、cancelled 1、unknown 1，holds 0。没有全局重启 ADB或启动任务消费者。执行脚本在身份检查处返回阻断，**未安装 APK、未启动原生应用、没有真实 NSD 结果**；没有通过修改结果或模拟服务绕过。

产物和证据：

- [已签名诊断 APK](../artifacts/acceptance/android-endpoint-probe/build/endpoint-probe.apk)。
- [构建及源码 SHA-256 记录](../artifacts/acceptance/android-endpoint-probe/build/build.json)。
- [真机安装前阻断记录](../artifacts/acceptance/android-endpoint-probe/scan-attempt-02.json)。

已请求用户保持手机解锁、确认当前无线调试连接端口，或重新插入 USB；恢复指定 transport 后才能验证原生发现。原型编译不替代 Web 的 Playwright 验收，也不证明自动准入、认证上报、端口异常提醒、首次配对或多机并发通过。

### USB 恢复后的真实原生发现（21:58–22:01）

用户回复“已在线”后重新盘点：USB transport 恢复，原 IPv6 网络 transport 仍 offline。使用明确 USB 目标，序列号与已核验设备一致后安装上述 APK，启动独立诊断应用；不把 USB 安装作为网络 ADB 通过证据。

应用自行使用 NSD 观察 20,053 ms：1 个 Wi-Fi 网络、4 个本机 Wi-Fi 地址；解析到 1 个连接服务，其 4 个地址中存在本机地址匹配，端口 `46457`。候选数为 1，发现／解析错误为空。应用未接收人工端口、服务名、手机序列号或扫描高位端口的输入。配对服务未发现，结果为 unknown，不记录成无需配对或首次配对通过。

**单机前台本机连接端口发现可行性通过**。这是 Android API 产生的真实观察，不是脚本填入成功结果。报告由 USB `run-as` 取回以保留实验依据，因此**认证 App 上报仍未实现**；本机地址筛选也不代替安装密钥和节点绑定。中心原生结果复核时 Tailscale 已为 Stopped，没有继续尝试网络 ADB，记录阻断。已请用户重新连接电脑 Tailscale。

执行脚本收集了新 scanId，随后仅停止诊断应用进程，并核实进程已退出；APK 留在手机供后续复测。未停止 Tailscale、系统 ADB 或媒体 App。未验证后台发现、配对窗口、多机隔离、切网重新发现和正常变化不通知／异常提醒。

证据：[真机 NSD 报告](../artifacts/acceptance/android-endpoint-probe/scan-03.json)、[原生结果的中心网络复核阻断](../artifacts/acceptance/android-endpoint-probe/scan-03-network-check.json)。原有 scan-attempt-02 安装前阻断保留，不覆盖历史失败。

### 中心重新连接后的无 USB 复核（22:06–22:07）

用户确认已连接后重新查询：中心 Tailscale 为 Running、Self.Online=true、Health 为空，手机节点也在线；ADB 初始列表为空。有限重试上次原生候选 `46457`，IPv4 TCP 超时、IPv6 TCP 成功，IPv6 ADB 连接及序列号核对通过，先恢复用于运行诊断的已有授权通道。

随后通过这个网络 transport 重新运行原型，取得新的 scanId。应用观察 20,046 ms，再次发现唯一的本机连接候选端口 `46457`，错误为空；配对端点保持 unknown。脚本取回新报告并停止诊断进程，核实进程退出。

最后从**本轮 scan-04** 取出端口，显式使用对应 Tailscale IPv6 端点检查 ADB 状态和身份：`device`，序列号匹配此前核验设备，型号 SM-S9110；设备列表不含 USB transport。本次已经把原生发现结果和当前远程 ADB 对应起来，**单机前台本机发现＋网络 ADB 目标核验通过**。

此实验使用先前可信端口恢复诊断通道，再由 ADB 取回原生报告，不是脱离已有 ADB 的首次接入，也不是生产环境的认证 HTTP 上报。没有证明未知新端口可由中心自动获知、后台持续报告、首次配对、多机隔离或异常通知已完成。IPv4 超时继续保留，不被 IPv6 通过覆盖。

证据：[中心恢复及初始双栈连接](../artifacts/acceptance/android-endpoint-probe/center-restored-140645.json)、[本轮真实原生发现](../artifacts/acceptance/android-endpoint-probe/scan-04.json)、[按本轮发现端口完成的网络身份核对](../artifacts/acceptance/android-endpoint-probe/scan-04-network-check.json)。未启动业务服务、未执行媒体 App 操作或发布。
