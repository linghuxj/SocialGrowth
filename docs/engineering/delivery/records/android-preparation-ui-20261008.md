# Android 手机准备：结果与当前操作（2026-10-08）

本轮按用户最新确认收敛 Android 的手机准备页面：普通用户优先看到结果，只有需要本人手动操作时显示说明。日常开发在 dev，不将 UI 构建或现有 Samsung 的恢复连接当作新手机首次接入验收。

## 本次 Artemis 连接前的实际动作

1. `growth.mhtm.top` 经 Cloudflare 提供 HTTPS / WSS 接入。现有 Samsung 不开手机 VPN 时已能访问；服务器持续收到安装身份认证的端点上报。该结果只覆盖这条线路和这台手机。
2. 允许 SocialGrowth 通知，重新发送保持连接通知。无线调试的系统配对弹窗必须保持打开，通过通知输入配对码，避免切换 App 使配对码失效。
3. 检查 Samsung 的应用后台运行。实际设置为“受限”，系统日志记录 App 在切到设置后被冻结，上报中断。改成“不受限制”后，持续上报恢复；不能据此承诺所有机型永不挂起。
4. 开启开发者选项与无线调试，通过新的系统弹窗和通知提交新码。14:50:59 的真实服务器配对尝试最终为 connected；拔线后 Web 显示 bootstrap 已连接。
5. Web 发起手机准备。服务器 `/tmp/artemis` 的 root 目录归属导致 Artemis 不能创建任务锁，运行时改为 node 用户可写；Dockerfile 已补持久修复，尚未重建生产镜像。辅助组件安装一度遇到 ADB device offline，随后真实设备状态读取成功。

最新准备任务 `d52158d8-64dd-40e6-b92c-93db8fa097e4` 已结束，trace `127aebb4-a506-43ef-a15b-c1eaf02af7f7`，最终回执为 `UNCONFIRMED / INSPECT_DEVICE_EVIDENCE`。已确认 Artemis 能访问手机，不代表管理网络配置、业务上网或完整准备已通过。本轮只查询原任务，不重复创建任务、配对或业务发布。

## 页面调整

- 页面名称“手机准备”，顶部只展示平台当前连接结果及检查时间；紧接着展示当前操作，设置清单放在其后，避免主按钮被推到屏外。
- Wi-Fi、连接通知、后台连接、无线调试、手机配对以紧凑结果列表展示。通知“已允许”只指系统权限，不将它当成通知可见或远程在线证明。
- 只展开当前需要处理的一项，配一个主按钮。设置返回后重新检查；平台事实超过 10 秒或查询失败时不能保留已连接结论。
- 增加后台受限检查，发现受限时先提示打开应用设置处理，再引导离开 App 开启无线调试。无法读取时显示待确认。
- 首次配对只在实际需要时显示三步操作。已有配对但短暂断线显示恢复连接；上次结果未知时先核对，不提示重复提交配对码。
- 已连接时显示等待平台继续准备，无额外手动配置长文；并不宣称具备执行资格。
- 暂停自动连接需要本人明确恢复。业务暂停、退出设备没有开启连接的主动作；本地设置或返回页面不会恢复业务参与。
- “更多连接设置”默认收起，保留通知、后台运行、无线调试、暂停/恢复以及已安装的网络工具入口。网络工具只在工作人员要求时使用。首页入口改为“手机准备”；默认连接通知不再重复首次配对教程。
- 主操作使用已有 Material 库的 Material 3 按钮，最小触控高度 52dp，按钮间隔至少 8dp，正文使用 sp 和可换行布局，支持系统字体放大。保留应用现有浅色外观，不扩展全 App 主题重构。

## 验证与候选

- Gradle `testDebugUnitTest lintDebug assembleRelease` 成功；62 项单元检查，0 失败/错误。新增检查覆盖后台限制、无平台事实、未知配对、明确暂停和连接事实失效的决策边界；不是 UI 单元验收。
- Impeccable 对修改的 Kotlin/XML 进行机械扫描无发现；此检查不能代替原生显示验证。
- 正式签名候选 `1.0.3-preparation`，versionCode 7，API `https://growth.mhtm.top`。证书与前版一致，`apksigner verify --print-certs` 通过。
- APK：`output/android/candidates/socialgrowth-1.0.3-preparation-7-release.apk`。SHA256 `31b08eea3852c12bb975cf94c5b4d0a68e29626ea5d37f6de3ad584c015bd7b8`。
- 原 Artemis Web 任务已结束，服务器无 `background.task_runner` 活进程后，使用 USB `adb install -r` 覆盖安装 Samsung RFCW40MYYCV，保留登录、关联及系统配对。USB 只用于安装与原生显示检查，不作无线连接验收证据。
- 生产 Web 实际登录 → 执行与人工协助 → 查询原任务 → 退出通过；原任务最终为未确认。手机连接仍为 bootstrap，未发起新准备或业务动作。

原生显示与控制确认：Samsung / Android 16 实际截图检查普通字体和 1.3 倍字体，系统夜间模式开启时保留现有浅色方案，无文字重叠或截断；当前操作位于结果清单之前，设置支持滚动和展开。真实点击“暂停自动连接”后显示暂停与恢复主按钮，点击恢复后连接服务重新启动，最终生产 Web 再次显示 bootstrap connected。系统字体恢复 1.0、夜间模式恢复 no。候选覆盖安装及重连期间的短暂待配对显示亦保留原生截图，未重新提交配对码。

原生检查命令：`python3 .runtime/android-preparation-ui-20261008/inspect-native.py confirm`；最终日志 `native-confirm-reconciled.log`。最初脚本在页面初始加载按钮未启用、按钮还在屏外以及重连中的待配对状态处停止；保留 `native-inspection.log`、`native-inspection-retry.log`、`native-confirm.log`，修正检查定位及真实状态断言后完成。本脚本只作原生布局/已有控制补充检查，不是业务 E2E 或新手机验收。

最终生产 Web 查询命令：`pnpm exec tsx .runtime/hk-phone-resume-20261008/observer-retry/observe-and-start.mts observe`，结果保存在 `production-web-final.log`，HTTP/页面检查通过、原任务未确认、设备当前连接正常。受保护构建与原生检查证据保存在 `.runtime/android-preparation-ui-20261008/`；原连接诊断与 Web 证据在 `.runtime/hk-phone-resume-20261008/`，凭据和设备私有信息不提交 Git。

本轮未晋级 main、未替换公共 APK 下载、未发布生产镜像。没有旧信任/预装软件的新手机首次接入、完整 Artemis 准备、管理网络切换和业务上网仍须独立验收。
