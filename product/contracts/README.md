# 首批跨端契约

`src/` 中的 Zod schema 是 TypeScript 运行时校验源；`generated/first-batch-contracts.v1.json` 是构建时生成的 JSON Schema 2020-12 等价格式，供 Kotlin、Python 和接口评审消费。生成步骤同时产出 Android 使用的 `GeneratedFirstBatchContractSpec.kt`，并在 `generate:check` 中对两种产物做字节级防漂移检查。消费端仍须实际执行运行时校验，不能只依赖静态类型或生成常量。

## CT-01～04 覆盖

| 契约 | 身份 | 权威写入方 | 关键限制 |
| --- | --- | --- | --- |
| `authenticatedPrincipal`、`sessionSummary` | 三类身份分别认证 | Backend | 请求体中的 ID 不是授权证明 |
| `createInvitationRequest`、`registerProviderRequest` | 运营创建；未登录注册流程消费验证结果 | Backend/PostgreSQL | 短信通过不等于注册；最终事务再查邀请和手机号 |
| `associationQrPayload`、`createAssociationSession*`、`inspectAssociationCodeRequest` | 安装创建待确认会话；提供者本人扫描 | Backend/PostgreSQL | `sgassoc_v1_` 码制与契约版本均可校验；新会话响应明示旧会话已替换 |
| `associationSessionView`、`confirmAssociationRequest` | 提供者本人查看必要目标并确认 | Backend/PostgreSQL | 必须匹配预期安装；扫码不直接写归属 |
| `queryAssociationResultRequest`、`associationResultResponse`、`listProviderDevices*` | 提供者查询原确认结果及本人多设备 | Backend/PostgreSQL/Android | pending 不写关联；已确认结果只向原 Provider 返回；本人列表不暴露 installationId 或其他 Provider |
| `bootstrapInstallationRequest`、`installationAuthResponse` | 未关联执行手机建立或恢复低权限安装身份 | Backend/PostgreSQL/Android | 根凭据由客户端随机生成并安全保存；响应不回传根凭据；重装丢失凭据时创建新身份而不认领旧关系 |
| 三类 device view | 运营/本人/安装各取所需字段 | Backend | 严格 schema 拒绝跨身份多余字段；较低 `factVersion` 不覆盖新事实 |
| `productErrorResponse` | 当前认证身份 | Backend | 稳定错误码、可重试标志和原请求 ID，不暴露技术栈或秘密 |

## HTTP 交接表

WP-08 阶段一新增 CT-05 `enrollmentChallenge`、`enrollmentProof` 和 `nodeIdentity`，纳入同一 JSON Schema 生成／防漂移入口，但载荷使用独立 `protocolVersion=2026-09-30.admission-v1`，不改变已部署的 B1 请求与响应。签名为 P-256/SHA-256、IEEE-P1363 的 64 字节 `r||s`（无填充 base64url）；签名字节定义在 Backend `challengeSigningBytes` 的固定有序 JSON 元组中，包含用途、全部身份／代次、节点 ID／密钥／网络修订、随机数和起止时间。来源节点只能由可信核验通道观察，不接受客户端自报或代理头。当前仅有 TypeScript 状态核心和 Python 结构消费，尚无 CT-05 HTTP、Kotlin 签名消费、真实来源／策略适配和持久事务；Android 原生成规格保持 B1 范围，不能宣称新协议跨端已接通。

该表定义语义和身份，不表示 WP-02～06 的路由已经实现。

| 操作 | 身份 | 请求/响应 schema | 典型错误 |
| --- | --- | --- | --- |
| 创建邀请 | operator | `createInvitationRequest` / `invitationView` | `AUTHORIZATION_DENIED`, `INPUT_INVALID` |
| 注册提供者 | registration proof | `registerProviderRequest` / `registerProviderResponse` | `INVITATION_*`, `PHONE_*`, `IDEMPOTENCY_KEY_REUSED` |
| 创建/刷新关联会话 | installation | `createAssociationSessionRequest` / `createAssociationSessionResponse` | `AUTHORIZATION_DENIED`, `INPUT_INVALID` |
| 解析扫码目标 | provider | `inspectAssociationCodeRequest` / `associationSessionView` | `ASSOCIATION_SESSION_EXPIRED`, `AUTHORIZATION_DENIED` |
| 确认关联 | provider | `confirmAssociationRequest` / `confirmAssociationResponse` | `ASSOCIATION_*`, `DEVICE_ALREADY_ASSOCIATED` |
| 读取运营设备视图 | operator | query / `operatorDeviceView[]` | `AUTHENTICATION_REQUIRED` |
| 读取本人设备视图 | provider | query / `providerDeviceView[]` | `AUTHORIZATION_DENIED` |
| 读取本机状态 | installation | query / `installationSelfView` | `FACT_VERSION_STALE` |

所有写请求携带 `contractVersion`、`requestId` 和作用域内的 `idempotencyKey`。同键同载荷在授权仍有效且响应保留期内返回原结果；同键不同载荷拒绝。响应过期后返回 `IDEMPOTENCY_RESULT_EXPIRED`，不重新执行业务副作用。授权失效时先返回认证/授权错误，不因幂等命中泄露旧响应。

请求与响应都使用 strict schema，但兼容方向不同：

- 请求新增服务端可选字段，且旧请求仍能按原语义处理时，可作为同版本兼容变更；新客户端不得向尚未支持该字段的旧服务端发送它。
- 响应新增任何字段都会被旧 strict 消费端拒绝，因此必须提升 `contractVersion`，在服务端按协商版本只发送对应字段，并完成 Kotlin/Python/Web 消费方确认。
- 删除/改义字段、收紧有效值、改变身份或错误语义均是不兼容变更。未知字段拒绝和不兼容版本拒绝必须在业务事务前发生。

## 生成与检查

```sh
pnpm --filter @socialgrowth/product-contracts check
pnpm --filter @socialgrowth/product-contracts test
pnpm --filter @socialgrowth/product-contracts build
```

`generate` 显式更新 JSON Schema 与 Android 规格文件；`check` 和 `build` 使用 `generate:check` 字节比较源 schema 与已提交文件，发现漂移直接失败且不重写文件。Web 和 executor 通过 Zod 边界适配器消费；Android 使用生成规格执行 Kotlin 运行时解析；`python/socialgrowth_contracts.py` 从提交的 JSON Schema 执行严格参考校验。跨语言补充检查不替代旧客户端组合、短信、页面、扫码或真机业务流程验收。
