# 首批跨端契约

`src/` 中的 Zod schema 是 TypeScript 运行时校验源；`generated/first-batch-contracts.v1.json` 是构建时生成的 JSON Schema 2020-12 等价格式，供 Kotlin、Python 和接口评审消费。消费端仍须实际执行运行时校验，不能只依赖静态类型。

## CT-01～04 覆盖

| 契约 | 身份 | 权威写入方 | 关键限制 |
| --- | --- | --- | --- |
| `authenticatedPrincipal`、`sessionSummary` | 三类身份分别认证 | Backend | 请求体中的 ID 不是授权证明 |
| `createInvitationRequest`、`registerProviderRequest` | 运营创建；未登录注册流程消费验证结果 | Backend/PostgreSQL | 短信通过不等于注册；最终事务再查邀请和手机号 |
| `associationSessionView`、`confirmAssociationRequest` | 安装创建待确认会话；提供者本人确认 | Backend/PostgreSQL | 必须匹配预期安装；扫码不直接写归属 |
| 三类 device view | 运营/本人/安装各取所需字段 | Backend | 严格 schema 拒绝跨身份多余字段；较低 `factVersion` 不覆盖新事实 |
| `productErrorResponse` | 当前认证身份 | Backend | 稳定错误码、可重试标志和原请求 ID，不暴露技术栈或秘密 |

## HTTP 交接表

该表定义语义和身份，不表示 WP-02～06 的路由已经实现。

| 操作 | 身份 | 请求/响应 schema | 典型错误 |
| --- | --- | --- | --- |
| 创建邀请 | operator | `createInvitationRequest` / `invitationView` | `AUTHORIZATION_DENIED`, `INPUT_INVALID` |
| 注册提供者 | registration proof | `registerProviderRequest` / `registerProviderResponse` | `INVITATION_*`, `PHONE_*`, `IDEMPOTENCY_KEY_REUSED` |
| 读取扫码目标 | provider | path token / `associationSessionView` | `ASSOCIATION_SESSION_EXPIRED`, `AUTHORIZATION_DENIED` |
| 确认关联 | provider | `confirmAssociationRequest` / `confirmAssociationResponse` | `ASSOCIATION_*`, `DEVICE_ALREADY_ASSOCIATED` |
| 读取运营设备视图 | operator | query / `operatorDeviceView[]` | `AUTHENTICATION_REQUIRED` |
| 读取本人设备视图 | provider | query / `providerDeviceView[]` | `AUTHORIZATION_DENIED` |
| 读取本机状态 | installation | query / `installationSelfView` | `FACT_VERSION_STALE` |

所有写请求携带 `contractVersion`、`requestId` 和作用域内的 `idempotencyKey`。同键同载荷在授权仍有效时返回原结果；同键不同载荷拒绝。未知字段由 strict schema 拒绝，不兼容版本在开始事务前拒绝。

## 生成与检查

```sh
pnpm --filter @socialgrowth/product-contracts check
pnpm --filter @socialgrowth/product-contracts test
pnpm --filter @socialgrowth/product-contracts build
```

`build` 会重新生成 JSON Schema。提交时源 schema 与生成文件必须一致。真实 PostgreSQL 并发、跨语言消费端、旧客户端、短信和真机业务流程需要在对应工作包单独验收。
