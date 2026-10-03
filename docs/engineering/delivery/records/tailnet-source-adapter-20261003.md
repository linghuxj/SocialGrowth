# 正式接入接续：可信来源适配与 Tailnet 只读盘点

2026-10-03；接续固定基线 `e4c5fcb`，仍使用 `codex/core-automation-loop-stage1`。范围为 WP-08／R-148、R-151 的可信来源和实际策略资源盘点，复用既有远程执行证据。本阶段没有修改 Tailnet 策略、节点标签、路由或设备授权，没有启动正式执行器，没有撤回参与或发布。源码检查点见本记录所在提交。

## 实际结果

- 本人已将只读 OAuth 配置保存到 `.runtime/tailnet-control/read-only-oauth.json`。同一描述符读取的文件必须属于当前用户、仅本人可读写、为普通文件、非 symlink 且不超过 4KiB；空、非法或含额外配置均关闭。凭据不进入输出、截图或 Git。
- 实际令牌交换通过，返回权限严格等于 `policy_file:read`、`devices:core:read`、`devices:posture_attributes:read`；未知、缺失或额外权限不被默认为只读。后续仅调用官方策略和设备 GET，禁止重定向；本轮没有外部配置写入。读取策略摘要 `86ed07ee3b120f200af02f9a075948e5d10eb477fd3294b971cf4d41047e2a9f`，实际注册设备数 **2**。
- 策略静态盘点发现 **0 条 ACL、1 条 grant，存在 1 条无附加条件的全网放行规则**。这是当前配置中的实际整改项；窄规则不会抵消原宽规则。盘点不展开全部选择器或探测实际路径，没有全网放行模式也不能推断隔离通过。路由字段缺失时显示 unknown/null，不推断出口节点数量或可达性。
- Tailscale 1.102.4 的真实 CLI／LocalAPI 查询通过，读取 Samsung 稳定节点 ID `nRwHVsp3dt11CNTRL` 和当前公钥摘要。数字 NodeID 不参与精度有损的绑定，使用正式 StableID。此为指定地址的只读平台观察，**没有取得本轮正式服务的实际入站 socket，没有策略 networkRevision，不是持钥证明或准入成功**。
- 实际 `pnpm test:playwright` 从产品 Web 登录、进入账号与设备、刷新和查看详情。Samsung 仍为“已关联 · 待完成接入”、连接确认未知；没有种入 access_ready、连接或动作许可。管理端仍是模拟器，不能据此签双真机验收。
- 22:40 的只读复核显示参与回执已经过期，仍为 associated_pending_access。上一轮约 22:15 到期的诊断会话不能当作本轮当前连接；本阶段未建立新远程 ADB 会话，未代点首次确认、撤回或重启已停止的手机服务。后续真机操作需先建立新的受控接续，不用历史端口回退。

证据：[控制面实际读取](../../../../artifacts/acceptance/product/B3/tailnet-source-20261003/control-plane-inspection.json)、[LocalAPI 平台观察](../../../../artifacts/acceptance/product/B3/tailnet-source-20261003/local-api-source-inspection.json)、[实际 Web 设备复核](../../../../artifacts/acceptance/product/B3/tailnet-source-20261003/web/verify-result.json)。不提交原始策略、设备清单、凭据或私人截图。

## 实现边界

`tailscale-source-verifier.ts` 实现已有 signed endpoint journal 的内部 `EndpointReportSourceVerifier` 适配。监听器从自己实际接收的直连 Tailnet socket 生成不可伪造的句柄；客户端 body/header、另一监听器、LAN、loopback Serve 和已关闭 socket 均不能取得来源资格。TLS 监听器只接纳 secureConnection。仅接受 Tailnet IPv4／IPv6 单机地址，拒绝子网路由和作用域地址。

每次观察都重新查询实际 LocalAPI；稳定节点 ID、公钥、在线、密钥有效期和该节点自身主机地址必须匹配。独立服务端策略修订端口还必须返回当前 networkRevision 及新鲜观察；不能借 expected enrollment 的修订，也不能把 API ETag／策略摘要自行当作 networkRevision。两秒超时、取消、来源变化、离线、换钥、旧修订或缺失修订均返回未确认，不产生任何准入、ADB 或动作许可。

该内部适配尚未注册 Nest 路由／消费者；现有默认 null verifier 仍关闭。Mac 的诊断 Serve/proxy 不能拿直连句柄冒充来源，下一切片须接入另行可信验证的代理链，或部署具有实际 Tailnet 直连监听的核验服务。当前的真实 CLI 观察不替代该入站来源验收。

`tailnet-readonly-inspection.ts` 只交换受限令牌和读取策略／设备。输出权限、策略摘要／ETag、设备数和静态风险提示，原始账号／策略内容与令牌均不保存。没有签发入网凭据、节点标签、全局策略写入、节点移除、配对或业务出口变更接口。

## 验证及复现

新适配补充检查 **24/24**（可信来源 15、只读盘点 9）；既有准入／签名端口核心回归 **30/30**。这些 fixture 只检查模块边界，不创建真实设备、restricted/admitted 或实际隔离事实。后端类型检查、构建和新增源文件／脚本定向 lint 通过。先前的控制字符正则 lint warning 已消除，不据此声明全仓 lint 通过。

```sh
pnpm env:check
pnpm --filter @socialgrowth/product-backend exec tsx --test src/tailscale-source-verifier.test.ts src/tailnet-readonly-inspection.test.ts
pnpm --filter @socialgrowth/product-backend exec tsx --test src/endpoint-report-core.test.ts src/network-admission-core.test.ts
pnpm --filter @socialgrowth/product-backend build
SG_PRODUCT_TAILNET_INSPECTION=authorized pnpm exec tsx scripts/inspect-tailnet-readonly.mts
SG_PRODUCT_TAILNET_SOURCE_INSPECTION=authorized SG_PRODUCT_TAILNET_SOURCE_IP=100.118.89.89 pnpm exec tsx scripts/inspect-tailnet-source.mts
SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=verify SOCIALGROWTH_VERIFICATION_OUTPUT=<新证据目录> pnpm test:playwright
```

实际 API／LocalAPI 命令只是补充只读证据。Web 验收使用已启动且 executor=false 的产品服务；本轮无需重启已有服务。原受保护发布脚本和他人未提交内容仅保留路径／状态，不纳入读取、检查或提交。

## 下一执行包及解除条件

1. 固定当前策略摘要／ETag与完整受控备份，准备替换全网放行的精确变更草案，明确现有两节点及管理连接的影响；不直接追加窄规则后宣称隔离通过，不盲目覆盖其他策略部分。当前凭据只有只读权限，真实策略写入需要另行受控资源和对具体变更的确认。
2. 落地独立核验监听、可信来源链和策略修订生产端。先满足“待绑定手机只访问核验服务”，再从真实来源消费安装 Keystore 挑战。当前缺失的是这些真实生产／部署路径，不能归为凭据已保存后自动通过，也不能用一个 enabled 开关补齐。
3. 策略静态／服务端预检通过后，按实际手机从核验服务、ADB、其他手机、运营服务及业务出口逐项检查；确认叠加规则和实际禁止路径。API 读取、策略保存或节点在线都不代替路径验证，失败／超时仍保留回收待确认。
4. 节点绑定与正式网络条件齐备后，再接 R-149 管理端受控首次配对及 R-150 已授权端口重连。沿用原授权有效时自动重连，配对码不进 Agent／聊天；多机隔离和双真机扫码仍需第二台 Android。
5. 最后接执行 broker、实际 Artemis 全路径门禁和平台身份初始化。网络准入不代替项目／账号分配、ADB 授权、本机参与或业务权限。公开发布、撤回／物理停止均不在本阶段验收范围。

此记录为接续事实和工程检查点，不签 WP-08、首次配对、网络共存／业务出口或整个产品验收完成；历史失败与未知发布结果保持。

参考官方实现与规则：[Tailscale identity](https://tailscale.com/docs/concepts/tailscale-identity)、[OAuth clients](https://tailscale.com/docs/features/oauth-clients)、[只读权限范围](https://tailscale.com/docs/reference/trust-credentials)、[Grants 语法](https://tailscale.com/docs/reference/syntax/grants)。
