# Android 打开 App 自动连接与恢复

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-06，依据用户最新确认 [R-162](../../../requirements-alignment.md#r-162打开-app-自动保持连接已授权范围内自动修复)。旧流程的页面轮询只读取状态，端口发现／上报服务需手动启动，App 更新或进程停止后不会随普通页面恢复；因此用户必须进入本机准备点击检查。

## 当前实现

- `AutomaticConnectionMonitor` 接入 Activity 生命周期，打开 App 后自动检查本机安装身份、当前关联与平台网络条件；默认约每 5 秒检查，管理首页、分佣、我的及准备页均生效。新的前台服务只在 Activity 前台启动，后台保留既有可见服务，不使用强行唤醒或隐蔽后台启动。
- 仅复用安全存储中的既有安装身份；安装会话过期或被服务端拒绝时按本机根凭据续期并核对同一安装与 generation，不创建新身份、账号或关联。权限拒绝会停止当前会话的自动启动尝试，返回前台可重新核对。
- 已关联、当前网络核验有效及系统条件满足时自动启动既有端口服务。服务每约 3 秒实际发现和上报端口，网络失败按现有退避重试；中心沿用现有受控重连并核对硬件序列号。状态仍来自当前服务端响应，重试和 VPN 开关不直接显示成功。
- 已经由平台核验的本机绑定，在当前关联仍匹配且没有其他活动 VPN 时，通过 Tailscale 的显式 `CONNECT_VPN` 广播请求恢复既有授权 VPN，每 30 秒至多一次。不会发送断开另一 VPN、登录密钥、切换账号或出口的指令；首次登录／系统授权仍由 Tailscale 提示用户。入口在当前手机 Tailscale 1.102.4 的实际包信息中确认，逻辑来源为 [官方 IPNReceiver](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/IPNReceiver.java) 与 [StartVPNWorker](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/StartVPNWorker.java)。
- 普通流程不再有“开始连接检查”这一步。准备页和通知提供“暂停自动连接”，暂停选择安全保存在本机；切换页面、退出再打开 App 不恢复。点击“恢复自动连接”后重新核对条件，恢复连接不恢复业务参与或任务。
- 本机状态卡片在主动暂停时明确显示“自动连接已暂停”；首次配对说明改为先等待自动检查，不重复要求点击启动。未允许通知时提供明确的通知授权入口；通知权限不作为已配对手机普通连接的必需启动条件，符合 [Android 官方通知权限说明](https://developer.android.com/develop/ui/compose/notifications/notification-permission)。

## 候选与检查

最终 Android APK SHA-256：`1dd521197763e9f6191bcc35d7a9800a8a01f217eff8bc7807453fbccdc9d646`。已通过 USB 更新到 Samsung SM-S9110／RFCW40MYYCV，保留既有身份、登录、配对和数据；本轮升级前 APK 私有备份于 `.runtime/automatic-connection-20261006/before-upgrade.apk`。

- Android `assembleDebug` 通过，公开 HTTPS 配置保持。
- execution-runtime 构建通过；web-verification 检查 16 通过、0 失败，包含新自动连接测试范围的权限保护；这不是 UI 验收替代证据。
- 实际升级后、显式启动 Activity 前检查服务不存在；只打开 App，没有点击连接按钮或直接启动服务，新的端口服务自动运行。后端取得本轮新的 source epoch、端口上报及当前中心连接，序列号 RFCW40MYYCV 匹配，已有配对保留。补充证据在 `.runtime/automatic-connection-20261006/`。

Web → Artemis 任务 `1e0c78f4-a30f-4ce6-915c-96ba301b2a46`，trace `38ec769a-b798-44fb-8eb8-613cfc3e6c2e`：检查无需修复点击的首页连接、跨 Tab 保持、主动暂停后 App 重开保持暂停、一次明确恢复后真实连接。首轮未通过：普通 Back 退出本机首页后回到了先前的 Facebook 任务，测试未继续操作该应用；Web 回执为 `finished · UNCONFIRMED / ASSISTANCE_EXPIRED`，SDK 状态已确认 `cancelled`。原输出保留于 `output/playwright/automatic-connection-20261006/`。测试改为明确按系统 Home 回到启动器，仅重开 SocialGrowth，并另起输出目录；未关闭 checkpoints 或最终检查器。首轮的主动暂停已通过本机 UI 恢复，未直接修改偏好或数据库。

## 验证结果与收敛修复

Web → Artemis 重测任务 `4648795f-cd8d-4b1b-b105-06bdb261e26e`，trace `1e9f4b3e-eb07-432b-a750-af5e89892276`，实际回执 `CONNECTIVITY_SETUP_COMPLETED`：4 通过、0 失败、0 待确认，登录提交 0、内容提交未点击。覆盖不点击修复控件自动连接、跨 Tab 保持、主动暂停后重开仍暂停、明确恢复和最终连接页面；复现输出为 `output/playwright/automatic-connection-home-20261006/`。该 UI 回执对应 APK `51d19b97c418fd0f890b543d5748bdb83d59e1dfea6bd2cd8ac91539ee81b6f0`，并非下述最终故障修复候选的再次完整 UI 验收。

后续真实故障测试发现，Tailscale 恢复后端口仍正常上报，但中心 ADB 可能保留半断流的 `device` 缓存，实际读取硬件信息超时。最终只补两处：Wi-Fi 监听显式排除同时带 Wi-Fi 传输标记的 VPN；中心真实硬件核验失败后断开该目标，复用现有退避重试。曾尝试的额外每 30 秒重启发现机制已移除，没有新调度框架或任务恢复机制。

最终候选的补充真机／运行证据：

- 升级后只打开 App 自动启动新的上报 epoch，09:10:08 UTC 中心确认真实连接，未点击连接或刷新按钮。
- 09:15:35 UTC 观察到 Tailscale VPN 确实断开，09:15:38 恢复；09:16:31 中心重新核验连接，后续端口持续更新、配对 `paired`、硬件 RFCW40MYYCV 匹配。09:17:03 经中心 `tailscale nc` 的 loopback 通道独立读取硬件序列号匹配，非 USB 连接证明。
- 09:17:03 UTC 从本机 App UID 停止连接服务，未发送用户暂停指令；09:17:57 确认服务自行恢复、新上报 epoch、真实中心连接及原配对保留，没有点击恢复或直接启动服务。
- 产品服务为加载本次中心修复重启后，App 自动重试恢复上报和连接，没有手动修复点击；原未知业务操作 `0ef94113-c6de-4171-b873-fd0c2bf62b53` 的运行记录保留，旧租约已过期，没有重发或认定完成。
- 最终 Android 构建、产品后端构建和 runtime 构建通过；runtime 范围检查 16 通过，中心 ADB 边界检查 4 通过，包含缓存 `device` 但实际核验失败后下一次重试恢复的检查。

以上故障注入／只读后台和中心核验属于补充证据，未以固定手机脚本代替 Artemis UI 验收。最终候选没有再次重复整个 Artemis UI 任务；首次登录、首次系统授权、首次配对及零准备异地新手机仍不计为本项通过。临时 Demo Web 已停止，公开接入网关、产品服务与替换后的正常 runtime 保留；手机自动连接启用，原业务暂停／未知状态及人工接管保留。私有补充记录在 `.runtime/automatic-connection-20261006/`，不提交 APK、凭据或私人运行配置。

## 复现

该历史操作命令已失效并从说明中移除。原候选和结果保留；现行入口见[当前实现](../../../current-implementation.md)。

原输出目录已有任务时先使用 `SG_DEMO_CLIENT_PHASE=reconcile` 核对，不能覆盖未知结果后重发。当前 UI 检查用 USB，中心连接另核对 Tailnet 通道；不将当前已有授权／配对手机的恢复计为零准备新手机首次登录、首次配对、正式网络准入或业务发布通过。
