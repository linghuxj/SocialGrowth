# Samsung 无线 ADB 与本机参与真机验收记录

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-03，输入提交 `0586ee1`，沿用 `codex/core-automation-loop-stage1`。承接用户继续真机、远程 ADB 和完整链路验收的授权。以下为作者验证，不代替独立 QA，不清父 pending，不合入 Developer。

## 当前边界

Samsung SM-S9110／Android 16 已在 USB 实际拔出后，通过同一已授权 Tailnet 的无线 ADB TLS 连接返回原硬件标识。复用本电脑已有有效 ADB 授权，没有读取配对码、执行新配对或启用 `adb tcpip 5555`。首次管理手机受控输入配对码、多机并发配对、自动网络准入与正式物理控制门禁仍未通过。

正式 Web 通过真实登录、账号与设备页、刷新、选择提供者及设备详情，仍读到“已关联 · 待完成接入”／连接“未知”。无线诊断不写入准入或控制成功状态；正式 executor 保持 disabled，actionPermissionGranted／stopConfirmed 均为 false，control journal／generation 为空。

## 连接、安装与候选

- 手机无线调试由本人开启，本人从系统主页面提供端口 38299。mDNS／系统端口属性未返回可用端点，不把 mDNS 当作跨 VPN 的保证。
- Mac 的普通 Tailnet TCP 路由当时走 `en0`，TCP 探测失败；Tailscale daemon 到手机有 DERP 回应，未建立 direct 路径。新增 `scripts/remote-adb-diagnostic-bridge.mts`，仅把回环 TCP 转发至实际授权 daemon 的 `nc`；固定唯一在线 peer 的节点标识和 key，每条新流重验；限定并发、累计连接数和最长 60 分钟，无 LAN／USB 自动回退。
- 本轮无线端点为 `127.0.0.1:34322`。旧自有 `34321` 已单独断开／关闭，没有 kill-server 或断开其他设备。原硬件标识匹配，USB transport 不在实际列表。仅本次 `4320` reverse 为调试后端通道，不构成正式中心受控通路。
- 初始诊断候选远程备份超时，安装准备改用 USB，不能记为远程安装通过。后续过期保护与周期修正候选都在 USB 拔出后实际无线 `install -r` 成功，不卸载或清数据。
- 最终周期候选 APK SHA256：`8dcd54ad9eb4dd217655c7a39da03bfb87404afcb138d9ef92bfed96e52d1211`。见[无线安装](../../../../artifacts/acceptance/product/B3/remote-adb-live-20261003/cadence-candidate-install.json)、[USB 拔出与设备匹配](../../../../artifacts/acceptance/product/B3/remote-adb-live-20261003/usb-detached-remote.json)。私有原件／配置／SDK 完整日志不进入 Git。

## 原始无线测试及修正

任务 `cb799e90-aa04-460c-b1fd-59dc5caff8dc`，trace `8f391fd7-5848-4306-a440-ac8975d7079d`。根 `pnpm test:playwright` 从实际 Demo Web 申请设备接管、填写客户端模式和包、确认范围并发起；Artemis 自主 Back 至 launcher、等待、从实际图标返回、撤回一次。没有固定 ADB 点按／启动脚本。实际 trace serial 为无线端点，旧未知任务未重发。

SDK completed／检查 1 passed、0 failed、0 inconclusive；其输出为报告 prose 加末尾 JSON，原严格解析拒绝，实际 Web 保存 `UNCONFIRMED`。独立只读采样还发现 launcher 期间 sequence 335 停留，02:40:11.851 后已过期；本轮不能通过后台持续验收。返回前后的 debug 确认间隔约 44 秒，回到 App 后旧客户端自动续接；随后本人授权测试内的 Artemis 撤回，sequence 340／run `b2521fb0-4ee6-46f6-9580-8c4d2470c000` 已 revoked。原 Web 核对保留失败，无重新派发或历史改写。见[原核对](../../../../artifacts/acceptance/product/B3/remote-adb-live-20261003/first-wireless-reconciliation.json)、[实际 Web 原结果](../../../../artifacts/acceptance/product/B3/remote-adb-live-20261003/client/original-web-reconciliation.json)、[时间采样](../../../../artifacts/acceptance/product/B3/remote-adb-live-20261003/participation-samples.jsonl)。

本轮修改：

1. 客户端模式只允许普通导航，拒绝 `manage_app`／recovery；Agent 从 launcher 图标返回，避免 SDK launch 重试 force-stop 后台服务。
2. debug 日志只记固定事件、阶段和耗时，不记录 token／run ID／nonce／请求体／异常文本。
3. 新增单调时钟 freshness 边界：确认过期即结束原轮并尝试撤回，不因页面返回、请求恢复或时间继续前进自动恢复。另一次本人确认 run `1edd8f2f-38fc-41a7-b707-35d063577434` 在网络延迟累积后真实触发 `participation_expired`，03:01:03.783 撤回，sequence 405，03:05:53 仍 withdrawn，未启动新 Artemis。见[实际过期收口](../../../../artifacts/acceptance/product/B3/remote-adb-live-20261003/expired-owner-run-closure.json)。
4. 旧循环在网络返回后额外等 4 秒；连续慢请求可能用尽 10 秒确认窗口。改为从每轮开始计算 4 秒周期，网络耗时计入周期；不增加 6 秒 challenge 或 10 秒确认有效期。
5. 只在无发布客户端诊断内接纳一个有界报告的单一末尾 JSON；拒绝多结果、冲突码、额外权限字段、非客户端结果和发布提交。通用发布／初始化解析不变；仍要求检查 completed、非零 passed、0 failed／inconclusive 和两个真实 UI 观察字段。没有用 prose 推测或伪造业务成功。
6. 全量补充检查发现无线 serial 中的冒号未参与 S3 canonical URI 编码，导致实际 MinIO 上传 403。上传／回读统一编码 object key 的每一段，保留 slash 分隔符；bucket HEAD 非成功也显式失败。未修改存储账号、权限或其他项目配置。修正后真实无线设备 PNG→WebP 上传、读取及 runtime 截图代理回读通过；该基础设施检查不替代业务 Web 验收。编码依据见[AWS SigV4 原文](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html)。

只读系统检查显示 SocialGrowth 与 Tailscale 曾列为后台受限。本人完成电池调整后，SocialGrowth 不再受限；两者 RUN_ANY_IN_BACKGROUND 为 allow，但 Tailscale 当时仍出现在系统受限列表，不能宣称其限制全部解除。Samsung 后台限制机制参考[厂商应用管理说明](https://developer.samsung.com/mobile/app-management.html)；这支持配置检查方向，具体断续原因仍以本轮实测为准。

## 修正候选真实复测

等待新的本人可见参与决定；Agent 不代点确认或自动恢复。复测必须使用新的独立 intent 目录，同时核对真实 Web 回执、SDK 检查、后台期间时间采样和撤回后状态，不能仅用模型 SUCCESS 判定后台连续有效。

## 补充验证及未完成门禁

Android 最终 JVM 39／39、assembleDebug 通过；runtime 类型检查、28 项改动相关补充测试通过。全量 runtime 首次为 93／94，真实设备截图上传 MinIO HTTP 403；修正上述编码后再次运行为 94／94。lint 0 错误，删除截图存储内无用声明后只余 server 原有 1 条 unused warning。临时桥严格 TypeScript 检查通过；未授权及非 Tailnet 目标均实际拒绝，未自动回退。

未完成：R-148／151 实际节点绑定与最小权限准入、R-149 管理手机到真实中心首次配对和多机隔离、真实 endpoint report／中心连接维护、全路径互斥及目标静止检查器、正式 Web→inspect_app→Artemis 的物理门禁、FB Page／YT 频道实测与完整身份权限回读。原发布 `d634e4c6-4266-4cc7-a784-3a31a1737cac` 及六项 identity unknown 继续保留，不释放占用、不重发。无本轮公开发布。

复现 Web 任务：`SOCIALGROWTH_VERIFICATION_OUTPUT=<新独立目录> SG_WEB_TARGET=demo SG_DEMO_WEB_SCOPE=client SG_DEMO_REAL_CLIENT_TEST=authorized pnpm test:playwright`。原任务核对加 `SG_DEMO_CLIENT_PHASE=reconcile`，不得复用 launch intent 启动第二次。

正式 Web 只读核对：`SOCIALGROWTH_VERIFICATION_OUTPUT=<独立目录> SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=verify pnpm test:playwright`。
