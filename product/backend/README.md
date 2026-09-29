# 正式产品后端

WP-00 只提供 NestJS 进程骨架。`GET /health/live` 是进程存活检查，仅表明当前进程能够响应并返回正式产品环境标识；它不是 readiness，不检查 PostgreSQL、Redis、对象存储、迁移或后台作业。

依赖就绪检查将在相应组件接入时单独实现，部署和流量入口不得把 `/health/live` 当作业务可用证明。

WP-01 开始建立正式权威数据模型：

- [首批身份与设备 ER 及事务边界](docs/identity-device-er.md)
- [`0001_identity_and_device.sql`](migrations/0001_identity_and_device.sql)
- [`0002_provider_phone_auth.sql`](migrations/0002_provider_phone_auth.sql)：短信挑战状态、重发/尝试限制和用途绑定；须在 0001 后执行。
- [`0003_provider_auth_recovery.sql`](migrations/0003_provider_auth_recovery.sql)：为已发布 0002 增加 proof/session 响应恢复关联；保留既有行并允许旧会话关联为空。

迁移当前是待后端迁移执行器消费的前向 SQL；未在真实 PostgreSQL 执行前，不得将其记为迁移或并发验收通过。

## WP-01 事务服务

`IdentityTransactionService` 实现当前首批后端事务基础：

- 邀请注册锁定验证与邀请行，在同一事务内复核有效性、创建提供者、扣减名额、消费验证并保存幂等结果。
- 安装端创建新关联会话时失效旧会话；提供者只能读取必要扫码目标并确认。确认事务原子消费会话、创建归属并写入 `associated_pending_access` 设备状态。
- 安装引导只创建低权限 installation/session，不创建 device 或归属。客户端先持久化随机根凭据，服务端仅保存带 pepper 的摘要；同凭据重放恢复同一身份，清数据后新凭据不会自动找回旧设备。
- `/api/installation/*` 以安装 Bearer 会话创建关联会话和查询本机事实；`/api/provider/association-sessions/*` 以 Provider Bearer 会话查看、确认及查询原结果。扫码查看只读，只有确认事务创建归属；`/api/provider/devices/list` 仅列本人设备的必要字段。
- 幂等载荷摘要排除每次重试可变的 `requestId`；同键同业务载荷返回原结果，同键异载荷拒绝。
- 成功注册、关联会话创建和设备关联写入不含令牌、验证码、原邀请码或手机号的审计事实。

真实 PostgreSQL 集成检查会删除并重建目标数据库中的 `socialgrowth_product` schema，因此必须同时显式提供专用测试 URL 和重置开关：

```sh
SG_PRODUCT_TEST_DATABASE_URL=postgresql://.../isolated_test \
SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

HTTP 服务默认不信任代理转发头（`SG_PRODUCT_TRUST_PROXY_HOPS=0`）。经反向代理部署时，必须按实际、固定网络拓扑显式设置可信代理跳数；本地 Vite 开发代理发送转发地址，因此联调后端使用 `SG_PRODUCT_TRUST_PROXY_HOPS=1`。不要在未限制入口来源的服务上扩大该值。

不提供两个变量时测试立即拒绝执行，不存在隐式默认数据库。根据当前用户决定，本阶段不实现迁移历史组件；部署流程必须保证 `0001` 只执行一次。

## WP-02 运营账号管理入口

首账号初始化和受控密码恢复只提供部署命令，不开放公众 HTTP 入口。命令要求显式 `SG_PRODUCT_DATABASE_URL` 和至少 32 字节的 `SG_PRODUCT_AUTH_PEPPER`；后者用于对登录限流的客户端范围做 HMAC，不得与密码共用。密码只能经标准输入传入，不得写入参数、shell 历史、普通日志或交付文档：

```sh
printf '%s\n' "$OPERATOR_PASSWORD" | pnpm --filter @socialgrowth/product-backend operator:admin -- \
  initialize --login-name operator.one --display-name "Operator One" \
  --request-id request-controlled-init-0001
```

受控恢复将更新密码摘要和凭据版本并撤销该账号全部有效会话，不会重新启用已停用账号：

```sh
printf '%s\n' "$OPERATOR_PASSWORD" | pnpm --filter @socialgrowth/product-backend operator:admin -- \
  recover --operator-id 00000000-0000-4000-8000-000000000001 \
  --request-id request-controlled-recovery-0001
```

示例变量仅表示受控秘密来源，不能把真实密码写入仓库或普通终端记录。HTTP 层把登录返回的内部 session token 放入受保护 cookie；普通 JSON 响应只使用公开契约，不包含 session token、密码或摘要。

## WP-02 HTTP 边界

产品后端要求 `SG_PRODUCT_DATABASE_URL` 与独立的 `SG_PRODUCT_AUTH_PEPPER`，并开放同源 `/api/operator` 登录、账号列表、开通、停用和退出路由。登录把内部 token 写入 `__Host-sg_operator_session` Cookie，固定 `HttpOnly; Secure; SameSite=Strict; Path=/`；JSON 只返回公开登录契约。所有响应禁用缓存，写请求还必须携带登录响应中的 `x-csrf-token`。

本地产品 Web 由 Vite 把 `/api` 代理到 `127.0.0.1:4320`，保持浏览器同源；正式部署必须在 TLS 同源入口后提供 Web 与 API，不能移除 Secure/`__Host-` 约束来迁就明文部署。HTTP/Cookie 业务验收统一从 Web 页面经 Playwright 执行，不以直接 API 调用代替。

## WP-03 邀请管理入口

运营会话可通过 `GET /api/operator/invitations` 查询邀请及完整成功注册进展，通过 `POST /api/operator/invitations` 创建邀请，并通过 `POST /api/operator/invitations/:invitationId/revoke` 撤销。两个写入口要求与账号管理相同的 CSRF token、契约版本、request id 和幂等键；撤销还要求当前事实版本。

创建响应中的 43 字符共享码是 bearer secret，只在创建成功或同一创建请求的幂等重放中返回。服务端用 `SG_PRODUCT_AUTH_PEPPER` 做版本化、域隔离 HMAC 派生，数据库只保存其 SHA-256 摘要，列表、审计和幂等响应体均不保存或返回共享码。修改 pepper 后，已经发出的原共享码仍可按数据库摘要继续使用，但服务端无法仅用新 key 重建原码；创建请求重放会先核对派生码摘要，不匹配时显式返回幂等结果不可用，绝不返回无效新码。轮换必须保留旧 key 完成保留期内的重放，或先明确结束旧幂等恢复窗口并撤销相关邀请，不能静默替换。

## WP-04 开发验证码通道

真实短信按 R-157 延期。默认 `SG_PRODUCT_SMS_MODE=unavailable`，请求验证码会明确返回可重试的 `SMS_DELIVERY_UNAVAILABLE`。本地联调可显式启用：

```sh
SG_PRODUCT_BACKEND_HOST=127.0.0.1 \
SG_PRODUCT_SMS_MODE=development_capture \
SG_PRODUCT_DEVELOPMENT_SMS_TOKEN="$DEVELOPMENT_SMS_TOKEN" \
pnpm --filter @socialgrowth/product-backend dev
```

`SG_PRODUCT_DEVELOPMENT_SMS_TOKEN` 至少 32 字节，必须与认证 pepper、运营密码及其他密钥独立。开发捕获模式只允许 `127.0.0.1`、`::1` 或 `localhost`；尝试绑定非回环地址时配置校验直接失败。生成验证码后，受控测试工具使用下列接口读取：

```http
POST /internal/development/provider-sms-codes/read
Content-Type: application/json
X-Development-Sms-Token: <independent development token>

{
  "challengeId": "00000000-0000-4000-8000-000000000001",
  "requestId": "request-development-sms-0001"
}
```

响应只包含 `challengeId` 和验证码，并固定 `Cache-Control: no-store`。验证码仅保存在当前后端进程内，随原 challenge 同时过期，不写数据库、审计或普通日志；进程重启后不能恢复。该接口不得经公网、反向代理或正式客户端暴露，也不证明短信送达。后续真实供应商实现只替换 `SmsDeliveryPort`，不得改变挑战、限流、用途绑定、proof、注册配额或会话语义。
