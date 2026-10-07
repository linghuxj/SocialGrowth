# 受限策略草案与独立核验传输预检 — 2026-10-03

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本阶段接续 `e5a1013`，完成实际 Tailnet 策略草案生成、官方只读校验及电脑/手机到独立核验入口的真实传输预检。**没有下发策略，没有完成安装 Keystore 节点绑定或正式准入。** Web 仍显示已关联、未准入。开始时 ADB 设备列表为空；23:04 后实际检测到 Samsung USB 连接，并补做原生网络检查。既有远程 Artemis 验收证据保留，不重列为全未验证。

## 实际结果

| 项目 | 结果与边界 |
| --- | --- |
| 受控只读 OAuth | 实际读取当前策略、HuJSON 备份和两台设备清单；仅请求既有三个只读 scope |
| 原策略 | 一条 `src:* / dst:* / ip:*` grant；不能靠追加窄规则隔离手机 |
| 草案 | 替换该 grant，Samsung IPv4/IPv6 仅允许至本机核验入口 TCP 9443；保留当前非手机节点间网络访问；其他顶层配置及原有测试保持语义一致 |
| 官方校验 | **通过，0 error / 0 warning**；8 项带明确协议、同地址族的策略测试，覆盖核验访问、选定运营/ADB 端口、UDP 和业务出口目标。策略测试是控制面预检，不等于穷尽端口或实际路径检查 |
| 并发变更检查 | 校验前后实际策略摘要和 ETag 一致，本轮未改变线上规则 |
| 独立传输入口 | 本轮真实 foreground Serve TCP 9443 → 回环 4443，PROXY v1 后 TLS；只接受固定官方 daemon 生命周期所拥有的实际 socket |
| 真实 Mac 协议探测 | 通过。可信连接及 TLS 可达，不匹配的证书和主机名被拒绝，本地伪造 PROXY 被关闭，伪造 `X-Forwarded-For` 不改变实际来源，未具备修订的准入请求返回 503 |
| 手机来源 | **真实 Samsung 请求通过，9/9 补充检查**。服务端实际来源匹配启动时独立读取的预期手机地址、StableID、key 和在线条件；不是请求头或 JSON 提供的节点。Android 保留既有 TLS/主机名校验。USB 只下发测试，不作 HTTPS 转发；不作为本轮完整无 USB 业务验收 |
| 实际 Web | 根 Playwright 登录管理页、打开关联设备、刷新和查看明细，通过；`accessReady:false`、`physicalControllerReady:false` |
| 正式能力 | 挑战/证明 API、受控策略写入、服务端 networkRevision 生产、实际受限路径检查和正式 TLS 仍待完成；本轮入口是传输预检，所有准入/动作许可为 false |

实际原策略 SHA256：`86ed07ee3b120f200af02f9a075948e5d10eb477fd3294b971cf4d41047e2a9f`。

通过校验的草案 SHA256：`bfbb1f3321b03f1ebb2492c0051b2a7883aefaca602ec313e8cf75022673e535`。

原 ETag：`"292f967442d21637982e0ac8487658f972ec6a8bfa787b505bf729853c227821"`。这些是策略清单定位信息，**不是产品 networkRevision**，不产生准入证据。

## 改动与处理约束

`tailnet-readonly-inspection.ts` 提供固定读取及 `acl/validate` 方法，没有通用写请求或策略应用能力。未知/失败校验响应不按 HTTP 200 认定通过；平台原始错误仅可留在私有诊断文件，公开记录只含固定代码或数量。官方语义依据：[只读 scope](https://tailscale.com/docs/reference/trust-credentials)、[官方 GitOps 校验实现](https://github.com/tailscale/tailscale/blob/main/cmd/gitops-pusher/gitops-pusher.go)、[网络 grants](https://tailscale.com/docs/reference/syntax/grants)。

`tailnet-restricted-proposal.ts` 只转换已核对的一条默认广泛 grant。自定义/条件规则、多条网络规则、重叠目标、LAN 地址、库存变化等均拒绝自动转换。当前两台节点的双栈地址被冻结，新节点需要明确纳入；不能宣称草案对任意未来节点保留原先全互通的效果。原 HuJSON 和完整草案只保存在 owner-only `.runtime/tailnet-control/proposal-*`，不提交账号配置、策略全文或凭据。

`tailscale-serve-listener.ts` 验证回环实际 peer/local tuple、唯一反向连接的进程 owner、官方执行文件及启动时间，再解析有界 PROXY 前缀并完成 TLS。请求 JSON/HTTP 头和外部 socket 形状不能成为来源句柄。连接关闭即失效；上限、超时和进程验证错误均关闭连接。直连和 Serve 监听共用内部来源接口；正式来源核验仍要求节点在线、有效 key、同一节点的 host 地址及独立的新鲜策略修订，未放宽。

`readTailnetNodeIdentity` 专供身份清单；`readTailnetNode` 仍检查 `Online:true`。正式来源不使用仅清单匹配作为在线证据，新增回归覆盖此差别。

新增 `VerifierTransportInstrumentation` 只做实际 HTTPS GET，不打开 UI、不读本机身份令牌/密钥、不提交参与/准入或媒体操作；属于非 UI 协议补充检查。`sgVerifierTransportChecks` 仅选择测试 runner，默认仍保留原 runner，拒绝与原发现 runner 同时启用。主 APK未安装/替换，已存在的测试包先私有备份、`install -r` 后执行并恢复，原测试包恢复成功。测试前后后端实际参与回执均不新鲜，本轮没有提交参与命令或撤回；不存在正在接受验收的新鲜参与会话被该检查中断。首次默认 Gradle 构建受全局初始化脚本的 `uri()` 错误阻断，采用 README 既定独立 Gradle 用户目录后编译通过，未修改全局脚本。

预检服务未接入安装身份、数据库、配对、端点 journal 或准入命令。`/health` 的 HTTP 200 仅表示可信入口存活；返回 `enrollmentApiReady:false`。其余请求返回未具备 networkRevision，不签发证明、不升级许可。沿用已有 debug 信任证书，**2026-10-05 04:30:56 UTC 到期**，不作为正式 TLS 部署。临时 foreground Serve 不修改 incoming preference，不使用 Funnel、不设后台守护，停止只回收自己的监听。

首次策略预检失败曾揭示：官方测试目的端口不支持范围/`*`，跨地址族的 accept 及缺少明确协议不成立。已修正为同地址族、TCP/UDP 分开和采样端口，重新调用实际官方接口通过。首次证书拒绝探测匹配列表漏列 `DEPTH_ZERO_SELF_SIGNED_CERT`，补齐后真实拒绝测试通过；没有关闭证书校验或修改信任范围。

## 可复现验证

项目 Node `v24.16.0`，实际路径由 `pnpm env:check` 输出；pnpm `8.14.0`，SQLite 检查通过。Node 补充测试 **62/62**（四个来源/策略测试文件 32 项，既有 admission/endpoint core 30 项），Samsung 原生补充检查 **9/9**；backend 类型检查、构建、本阶段脚本严格类型检查、定向 oxlint 和 Android test APK 构建通过。补充检查不代替 Playwright 或完整真机业务验收。

```sh
SG_PRODUCT_TAILNET_PROPOSAL=authorized \
SG_PRODUCT_TAILNET_SOURCE_IP=100.118.89.89 \
SG_PRODUCT_TAILNET_VERIFIER_IP=100.75.25.72 \
pnpm exec tsx scripts/prepare-tailnet-restricted-proposal.mts

SG_PRODUCT_VERIFIER_PREFLIGHT=authorized \
SG_PRODUCT_VERIFIER_PREFLIGHT_MINUTES=15 \
pnpm exec tsx scripts/run-independent-verifier-preflight.mts

# 在上述受控 foreground 监听存活时执行；仅补充传输探测。
SG_PRODUCT_VERIFIER_PREFLIGHT=authorized \
pnpm exec tsx scripts/verify-independent-verifier-transport.mts

GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle \
product/android/gradlew -p product/android :app:assembleDebugAndroidTest \
-PsgVerifierTransportChecks=true --no-daemon --console=plain

# Samsung 当前明确已授权连接，预检入口存活，且没有新鲜参与或其他 instrumentation。
# 脚本仅替换/恢复测试包，不安装主 APK。
SG_PRODUCT_VERIFIER_PHONE_PROBE=authorized \
pnpm exec tsx scripts/verify-independent-verifier-phone.mts

SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live \
SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=verify \
SOCIALGROWTH_VERIFICATION_OUTPUT=artifacts/acceptance/product/B3/tailnet-proposal-20261003/web \
pnpm test:playwright
```

预检启动先核对无其他 Serve owner、已授权 incoming 可用、证书有效及端口可独占；依赖不成立时拒绝启动。元数据在 `artifacts/acceptance/product/B3/tailnet-proposal-20261003/`，完整策略、校验原文和本地凭据在私有目录，Web 截图未进入 Git。

## 后续推进与协助边界

1. 实现正式安装身份校验的挑战/证明接口、客户端调用和服务端策略修订生产；不得从客户端布尔值、期待的 enrollment 或 ETag 自行构造成功事实。
2. 将当前草案作为明确的变更范围，准备受控策略写入与并发保护、回收路径。现有资源只有只读权限；实际下发前需要相应受控写配置与这份具体变更的确认，不能扩大使用只读凭据或盲改全局规则。
3. 接续 Samsung 的正式客户端和独立上报恢复。旧临时诊断会话已到期；本轮后半段 USB 可用且完成真实网络来源补充检查，**远程 ADB 尚未在本轮重新建立**，不能复用旧端口冒充当前连接。正式入口/上报恢复通道先准备好，缺少实际通道时才需本人完成一次恢复/升级准备。
4. 先完成实际受限路径与 Keystore 绑定，再升级正式许可及中心配对/重连；这些仍不代替账号分配、初始化和业务就绪。遵守用户暂不撤回、暂不发布的顺序。

不重试或改写既有 unknown publication/identity 结果，不触碰受保护发布脚本、他人未提交文档或 ADR，不合并/发布本阶段分支。
