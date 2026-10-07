# 独立端口上报与远程 ADB 真机验收（2026-10-03）

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本记录接续 [上一阶段真机验收](remote-adb-native-acceptance-20261003.md)。用户已补充明确授权 Agent 直接进行测试和手机处理；本轮 Web 仍单独保存首次参与确认与端口上报的授权，默认关闭。用户随后要求暂不测试撤回：后续客户端测试默认保持参与，撤回改为独立授权，执行守卫拒绝未授权的撤回点击。旧轮结果不回写为通过。

## 候选与边界

Samsung SM-S9110，Android 16／API 36；硬件标识 RFCW40MYYCV。管理端仍为模拟器，只有一台真实执行手机。本轮为可撤销诊断环境，不是正式网络准入、动作许可或物理停止验收。端口、参与回执与 UI 各自保留证据。

独立手机 HTTPS：`https://macbook-pro.tail3656e0.ts.net:8443`。原 Tailscale ACME 证书签发请求超时，改用诊断专用证书，原生证书链与主机名校验保留。公有测试 CA 仅位于 Android debug 资源，私钥只在 `.runtime/product-local-live` 私有目录，不进入 Git。证书于 **2026-10-05 04:30:56 UTC** 到期；该候选需要重新签发、构建与安装，不能作为正式 TLS 部署。

Tailscale Serve 仅本次前台诊断会话：TCP 8443 → 回环 4343，PROXY v1。网关先核验连接所属的实际 IPNExtension 进程、进程启动时间，再核验来源地址、LocalAPI WhoIs 的已固定节点 ID/key、目标地址和内部目标端口。客户端提供的 JSON/IP 或普通 HTTP 头不能替代来源证据。安装 token、generation、当前归属与账号状态继续由真实后端验证；端口不产生准入或权限。

## 已核验

- 原生 HTTPS GET／POST 未认证探测均返回 403，证书和主机名校验成功；8 项发现生命周期检查通过。它们是平台补充检查，不是业务验收。
- Artemis 在实际 Web 任务中执行一次无线调试 off/on，主页面观察到连接端口 42805。未打开配对码／QR 页面，未移除已有 host keys。
- 手机 foreground reporter 曾通过独立 HTTPS 实际上报完整 connect／pairing 快照；最初均为 unknown，中心没有用已知页面端口替代未知候选。
- 原生 NSD 已实际发现连接候选 42805，配对端口仍 unknown。修正来源：LinkProperties 的未带作用域本机 IPv6 链路地址只可根据实际选中 Wi-Fi 接口补齐；广播中的远端地址仍必须具有严格相等的作用域。没有放宽为任意同网段地址。
- Android 构建通过，补充 JVM 测试 40 项通过。执行库类型检查通过，最新补充检查 100 项通过；报告协议／来源转发头／节点身份补充检查 5 项通过。全量 Web lint 有既有未修复项，不据此宣称全量 lint 通过。

[平台原始观察](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/native-https-platform-observation.json)含候选 SHA256、运行命令与明确验证边界。

## 当前诊断验收结果

实际 Web → Artemis 开启上报 → 中心自动连接、端口变化重连及 USB 拔出后的远程硬件读取已通过诊断范围核验。当晚恢复后，保持原参与 run 的后台持续测试和远程观察 → Web 协助反馈 → Agent 核验 → 最终回执也已通过。断线后的恢复仍需要本人开启系统无线调试或重新启动已停止的上报服务；不据此声称全自动恢复或整条正式产品链路已验收。首次配对、第二台真机、多机隔离与正式网络准入仍未验收。

- `connectivity-setup-v8`：任务 `f1dc75be-89dd-40a0-8f95-c19dd04e9967`，SDK completed／2 passed／0 failed，实际 Web 保存 CONNECTIVITY_SETUP_COMPLETED。中心从实际认证报告取得 42805，以已有 host keys 自动连接，并读取同一硬件标识。见 [首次自动复用连接](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/automatic-first-reuse-connection.json)。
- `connectivity-rotation-v9`：任务 `3fc95e79-7381-4409-b928-cc5a5859fb66`，SDK completed／5 passed／0 failed，实际 Web 保存 CONNECTIVITY_SETUP_COMPLETED。独立每秒采样确认 candidate 42805 → lost/null → 中心 waiting/null → candidate 43883 → 自动连接并核验同一硬件；没有人工输入端口或重新配对。见 [端口切换断言](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/automatic-rotation/rotation-assertions.json)。该轮仍有 USB，仅供 Artemis 执行开关操作；远程连接明确使用回环桥，没有 USB 回退。
- 用户实际拔掉 USB 后，ADB 列表中已无 USB serial，回环 34323 仍返回 RFCW40MYYCV；新 HTTPS 上报仍持续，未依赖 adb reverse。见 [实际拔线核验](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/usb-detached-automatic-remote.json)。
- `wireless-client-v10`：任务 `a2e00e0e-dfe0-4620-95e0-518c8f9c3188`，SDK completed／6 passed／0 failed，实际 Web 保存 CLIENT_TEST_COMPLETED。只读采样确认在手机桌面期间 11 个样本持续更新参与回执，跨度约 57 秒，同一 run、当前关联匹配。该轮旧流程已于 05:25:58.328 UTC 撤回；动作发生在用户提出暂不测试撤回之前。后续不追加撤回或撤回后停止验收，也不自动恢复旧 run。

### 当前恢复阻断与修复

05:27:41 UTC 远程维护器因执行失败停止；05:27:49 UTC 收到手机上报 STOPPED。网关原日志只记录 payload 拒绝，不能据此断定具体字段或网络延迟是唯一原因。随后 `wireless-client-v11` 任务 `24653d54-6932-4bb4-bf60-3ea74ba1dccb` 无法完成手机操作，实际 Web 保留 UNCONFIRMED／INSPECT_DEVICE_EVIDENCE。重新检查还发现电脑 Tailscale 已停止、手机节点离线；电脑已按原配置恢复，相关网络设置保持一致。

修复了两项可确认的实现缺陷：过期但正确作用域的端口观察不再统一返回致命 403，而返回 409／DIAGNOSTIC_OBSERVATION_EXPIRED，允许客户端丢弃过期报告后重新观察；身份、epoch、重放或未来时钟证据失败仍拒绝。旧报告重复 ACK 不更新 freshness。远程读取硬件身份超时最多连续重试三次，未成功期间 identityVerified=false，不恢复动作权限；真实硬件不匹配立即断开。上述修复的补充检查通过，真实恢复结果仍待手机网络及上报服务恢复后核验。

现有上报服务已经停止，且 USB 已拔出，当前无远程更新通道。已提前通知需要本人在手机连接 Tailscale 并启动一次端口自动上报；不索取配对码，不采用历史固定端口回退，不追加撤回。

### 当晚接续恢复（北京时间 21:15 起）

本人恢复网络及上报后，实际 HTTPS 报告持续更新，但端点 initially unknown。本人开启无线调试后，手机自动发现并报告新端口 37133；中心以原 host keys 连接回环 34323，并实际读取同一硬件标识，USB transport 不存在，无人工端口输入或重新配对。见 [恢复核验](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/recovery-20261003-evening/automatic-recovery-no-usb.json)。这证明一次受必要系统现场恢复后的自动发现与连接，不证明无线调试关闭时能远程自行开启。

`wireless-retention-v12` 任务 `df8f5674-f21e-4310-84d4-a2e8531e0cdc`／trace `12e4d9e1-bdd8-4ab2-a3b7-4409750446f7` 从实际 Web 发起，撤回未授权。Web 最终 UNCONFIRMED／SOCIALGROWTH_APP_MISMATCH，实际参与没有启动；不据此声明保持参与验收通过。后续还观察到网关在 node_identity 阶段返回致命拒绝、上报中断。已将可信节点查询暂不可用或同一 ID/key 的离线观察改为 503／DIAGNOSTIC_SOURCE_UNAVAILABLE；当前 ID/key 不匹配优先拒绝，不因离线状态改成可重试，不保存未核验报告或延长旧端点 freshness。

自有客户端／连接验收的模型工具列表移除了禁止使用的 manage_app、密码／OTP 输入和可信安装工具；原发布前范围保留。前台包暂未知只允许两次间隔 250ms 的只读重查，仍未知则 FOREGROUND_UNAVAILABLE，不使用缓存包名或放行操作。原 v12 错误仍保留，尚不能确定它来自错误工具目标、前台过渡还是传输读取失败；本轮不通过放宽任意包范围消除错误。新增节点身份检查、类型及定向 lint 均通过，SDK 编译与工具排除补充检查通过；真实恢复及保持参与复测仍待本人重启已停止的上报服务。

上报恢复后端点仍 unknown；v13 在尚无 ADB 端点时过早派发，任务 `f1750a77-f600-406c-a4c5-3dc4337974a3` 未通过，未启动参与。已补充验收脚本的远程前置检查：在首次进入页面及提交前各核验新鲜认证端点、中心当前硬件验证、实际 getprop 硬件一致及 USB 不存在，失败不派发新的 Web 任务。此检查只是诊断前提，不能替代正式物理门禁。

本人随后恢复无线调试广播，自动上报新端口 40925，中心用已有授权连接并核验硬件。v14 任务 `57c52eb8-a534-41e5-bde3-a3d589397ca1`／trace `b417d85f-f91d-4b6a-98b6-f96e793f3309` 经前置检查后从实际 Web 发起。12 个手机桌面 active 样本跨度 **71.731597 秒**，sequence 444→458，同一参与 run `31da6f17-3c56-4ef4-98be-840ebcdaf437`，归属匹配、采样有效期未过、未撤回；返回 App 后继续 active。SDK completed／7 passed／0 failed，但返回结果文本为空，仅在本轮 client-test-result.md 保存了完整 JSON。实际 Web 原结果仍 UNCONFIRMED／INSPECT_DEVICE_EVIDENCE，不回填历史为通过。见 [后台参与断言](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/wireless-retention-v14/backend-retention-assertions.json)。

已修复后续诊断回执适配：仅当 SDK 结果文本明确为空且本轮独立 checker completed／passed>0／failed=0／inconclusive=0 时，读取相同 trace 的固定诊断笔记；规范路径、同 UID、非 symlink、16KiB 限制、原严格 JSON schema 和摘要均核验。非空或冲突结果不被笔记覆盖，其他 trace、重定向路径、额外权限字段、失败／缺失检查均不能补为成功。SDK 原结果、诊断笔记摘要与解析值保存在该新任务的 raw_result 中。v15 已通过实际 Web 复测，任务 `62fa59b5-1a17-49a7-8648-2df0dc8b1302`／trace `6e401a53-0eb2-42b3-947d-c922c4ac7cb2`，CLIENT_TEST_COMPLETED／checker completed／4 passed／0 failed。12 个手机桌面 active 样本跨度 **64.578784 秒**，沿用原 run `31da6f17-3c56-4ef4-98be-840ebcdaf437`，没有重复首次确认或撤回。该轮 SDK 返回完整文本、diagnosticNoteDigest=null；证明正常回执链路，新增空文本笔记恢复路径仅有补充测试证据，未在该轮真机命中。见 [真实 Web 回执](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/wireless-retention-v15/result.json)、[后台持续断言](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/wireless-retention-v15/backend-retention-assertions.json)及[回执来源](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/wireless-retention-v15/diagnostic-note-provenance.json)。

v16 远程观察闭环于 14:05 UTC 完成，任务 `c4816145-26fe-4efd-9f1c-75a50da629e5`／trace `68627441-6999-4fe4-94f6-847699fe95ff`。Artemis 发出本任务澄清请求 `e9c673ca-9f35-4027-a37b-23f578e8c375`，核对任务链接中的真实截图后，通过实际 Web 表单提交事实反馈。Web 断言 assistance verified、finished／OBSERVATION_COMPLETED、登录提交 0、内容提交未点击，通过并正常释放本次 Web 接管锁。未停止端口上报、未撤回参与、未操作 Facebook。截图仅显示 SocialGrowth 本机设备事实，不能证明已登记 Facebook 身份或平台授权。见 [远程观察及 Web 反馈结果](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003/remote-observation-v16/result.json)。

### 下一阶段的实际缺口

本机后端仍为 associated_pending_access，action_permission_granted=false、stop_confirmed=false；诊断成功不更新正式准入或动作许可。R-148／R-151 的受限入网、可信节点绑定与外部最小访问策略尚无实际平台适配验收；现有 network-admission-reconcile 只产生内部回收意图，不能证明 Tailnet 策略已回收。R-149 的管理端受控首次配对、跨提供者／多设备隔离和真实物理门禁仍待实现及真机验收。只有当前一台 Samsung，模拟器管理端不能证明双真机或多机验收。后续需要实际网络策略控制适配与对应管理权限资源，新增真实设备验收时需第二台 Android；当前无需提供配对码。FB Page／YouTube 频道创建、身份与权限、业务发布也未由本轮诊断验收。

当前诊断接收、Serve、桥和维护器有各自最长 60 分钟边界，本轮 Serve／桥约北京时间 22:15 到期；不会因测试通过转为常驻生产通道。记录完成时保持现有参与和连接，不主动撤回、停 reporter 或断开 ADB；到期后需新的受控接续，不能凭历史端口恢复动作。

## 失败历史保留

证据目录：[本轮真实测试](../../../../artifacts/acceptance/product/B3/endpoint-auto-live-20261003)。早期任务保留 UNCONFIRMED／cancelled：页面后端连通失败、诊断包范围守卫、传输超时和 Web 解析失败均不覆盖为通过。`connectivity-setup-v4` 为服务重启尚未就绪时浏览器连接失败，没有生成手机任务；v6 经实际 Web 停止，保留 OPERATOR_CANCELLED。

`connectivity-rotation-v7` 的 SDK 检查 completed／2 passed／0 failed，但返回末尾 fenced JSON 被旧解析器拒绝，Web 原结果仍 UNCONFIRMED。新解析器仅接受单个末尾 JSON 或完整配对的 json 代码块，同时拒绝冲突、额外权限、缺失／失败的独立检查；只用于后续任务，不重写该轮结果。

## 复现入口

Web 验收统一使用 `pnpm test:playwright`，需要实际已启动 Demo Web／runtime 和实际 Samsung。每次使用新输出目录，保留原任务意图，未知结果先核对或通过 Web 停止，不重发。

该历史操作命令已失效并从说明中移除。原候选和结果保留；现行入口见[当前实现](../../../current-implementation.md)。

一次端口切换另加 `SG_DEMO_ROTATE_WIRELESS_PORT=authorized`。客户端参与测试移除 connectivity mode，明确设置 `SG_DEMO_CLIENT_INITIAL_CONFIRM=authorized`；一次初始确认失败或过期后不得自动恢复。默认目标为保持参与，不设置 `SG_DEMO_CLIENT_WITHDRAWAL_TEST`；只有用户后续独立授权撤回验收时，才设置该变量为 authorized。`SG_DEMO_CLIENT_PHASE=cancel` 通过真实 Web 停止原任务，`reconcile` 只核对原结果。

本轮远程验收额外设置 `SG_DEMO_REQUIRE_AUTOMATIC_REMOTE=authorized` 与已核对的 `SG_DIAGNOSTIC_TAILNET_IP`／`SG_DIAGNOSTIC_PRODUCT_DEVICE_ID`／`SG_DIAGNOSTIC_SOURCE_NODE_ID`，先核验有效自动端点、真实远程硬件及 USB 缺席，再从页面发起。参与已经 active 时移除首次确认授权，保持原 run。

独立上报服务可见、可停止、非 sticky／非开机自启，诊断会话最长约 60 分钟。中心报告使用 epoch／reportId／递增 sequence／原始 observedAt；丢失 ACK 只重试原报告，不刷新旧候选。connect 与 pairing 区分，lost／conflict／unknown／stopped 或超过 10 秒均不用于连接。桥和连接维护器只管理本轮回环 34323；单次诊断会话总计最多三次连接尝试；连续失败窗口最多 120 秒，成功硬件核验仅结束失败窗口，不重置总尝试数，不读取配对码、不主动新配对、无 USB/LAN 固定端口回退。

原发布 `d634e4c6-4266-4cc7-a784-3a31a1737cac` 和六项 identity unknown 继续保留。本轮不公开发布。
