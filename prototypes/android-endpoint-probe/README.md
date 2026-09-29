# Android 本机 ADB 端点发现诊断原型

此目录只验证一个问题：普通 Android App 在官方 Tailscale 工作期间，能否通过系统 NSD 发现并筛选本机无线 ADB 端点。它不是正式提供者 App，不确定最终客户端技术栈，不实现接入鉴权、中心上报、配对码输入、业务执行或后台常驻。

使用已有 Android SDK 36 / Build Tools 36.0.0 / JDK 17 编译平台 Java API，无第三方库、下载或全局环境修改。原型最低 API 34；当前目标真机 Android 16 / API 36，不能据此确认正式产品支持范围。APK 为可调试诊断构建，不用于生产分发；本地诊断签名密钥保留在被 Git 忽略的输出目录。

## 原型行为

- 启动后仅在前台进行 20 秒发现，分别观察 `_adb-tls-connect._tcp.` 和 `_adb-tls-pairing._tcp.`。
- 使用实际 Wi-Fi `Network`，从对应 `LinkProperties` 取得本机地址。系统解析的地址与本机地址相符才列为本机候选，不使用手机型号、名称或“第一个服务”决定目标。
- 多 Wi-Fi 网络、多个本机候选、解析失败、网络变化及提前退到后台不会给出可用候选。没有发现配对服务记为 unknown，不当作“无需配对”或“系统已关闭”。
- 20 秒结束停止发现和信息回调，文件只是当次观察，不是仍有效的连接租约。失去服务的回调标记 lost；结束后的迟到回调不更新本轮结果。
- 只在本应用私有目录原子写入 `files/probe.json`；不存配对码、服务名、设备序列号、节点地址、账号或密钥。诊断会产生系统 mDNS 流量，不向业务服务器上报。
- 地址匹配仅筛选候选，不能替代设备安装密钥、来源节点绑定、中心调试身份及访问策略验证。

系统 API 依据：[Android NSD](https://developer.android.com/reference/android/net/nsd/NsdManager)、[NsdServiceInfo](https://developer.android.com/reference/android/net/nsd/NsdServiceInfo)。按本机 SDK 36 接口编译，不依赖文档中较新 SDK extension 才提供的合并发现 API。

## 构建与真机执行

在仓库根目录执行，路径按本机已有 SDK/JDK 调整：

```sh
python3 prototypes/android-endpoint-probe/build.py \
  --java-home /Users/linghuxj/Library/Java/JavaVirtualMachines/jbr-17.0.9/Contents/Home \
  --output artifacts/acceptance/android-endpoint-probe/build

python3 prototypes/android-endpoint-probe/run.py \
  --transport '<当前已授权 ADB transport>' \
  --expected-serial '<已核实的目标序列号>' \
  --build artifacts/acceptance/android-endpoint-probe/build \
  --output artifacts/acceptance/android-endpoint-probe/scan-01.json
```

构建保存 APK 哈希、源码哈希及签名验证结果。运行脚本先核对指定 transport 的真实设备序列号，再检查 APK 哈希；不匹配或无法读取就停止，不向其他设备安装。成功安装后仅启动本诊断应用，最多等待 35 秒，读取其新 scanId 的原生报告；随后停止本诊断进程并核实退出，保留 APK 与报告供下次使用。旧文件不当作本轮结果，已存在的证据输出不覆盖。脚本不重启 ADB、不修改无线调试、不控制媒体 App，也不启动 Web、runtime 或设备消费者。

返回码 0 仅表示收到完整观察窗口的报告，须继续检查 connect/pairing 候选、错误列表和实际网络 ADB 核验；不是业务通过。返回 2 表示阻断或观察中断。设备应保持解锁并让诊断页处于前台；结束后可关闭页面，重新检查按钮可再运行一个窗口。

## 后续真实验证

1. 单机：原生发现的连接端口与手机无线调试页面及中心实际 ADB 连接一致。配对窗口未开启时，配对端点保持未知。
2. 打开系统配对窗口：另行验证后台／前台限制及配对端点发现；当前前台原型不能冒充后台持续监控已通过。
3. 同网多手机：观察本机和非本机服务，证明筛选不串号；单台结果不能替代该样本。
4. 切网／无线调试重开：保存前后不同 scanId、端口和服务消失事实；保持系统授权要求，不强制修改系统设置。
5. 取得原生发现证据后，按接入草案接入设备鉴权、完整端点快照、确认回执、旧代拒绝和异常通知；目前没有自动上报能力。

这属于原生网络能力的局部诊断，不是替代 Playwright 的 E2E 套件。完整 Web 管理／配对流程仍须实际 Playwright 页面验收，手机业务执行仍由 Artemis 完成。

## 2026-09-28 实测

Samsung SM-S9110 / Android 16：通过 USB 安装后运行 20,053 ms，自动发现唯一的本机连接候选端口 `46457`，错误列表为空；配对端口为 unknown。原型无端口输入参数，报告为真实 NSD 回调生成；脚本取回新 scanId 后停止诊断进程并核实退出。

证据：[scan-03](../../artifacts/acceptance/android-endpoint-probe/scan-03.json)。中心随后处于 Tailscale Stopped，[原生结果对应的网络复核](../../artifacts/acceptance/android-endpoint-probe/scan-03-network-check.json)记录阻断；此前网络 ADB 成功范围见[分轮记录](../../docs/connectivity-verification-2026-09-28.md)。本次仅通过单机前台发现，尚未验证认证上报、配对窗口、多机或后台运行。

22:07 中心恢复后，通过 IPv6 网络 ADB 重新运行原型，[scan-04](../../artifacts/acceptance/android-endpoint-probe/scan-04.json)再次自行发现端口 `46457`，20,046 ms 无错误；[按本轮候选端口的网络核对](../../artifacts/acceptance/android-endpoint-probe/scan-04-network-check.json)取得 device 状态及正确设备身份，设备列表无 USB transport。此轮报告经已有网络 ADB 取回，仍不是 App 向中心的独立认证上报；IPv4 TCP 超时保留为未解决问题。
