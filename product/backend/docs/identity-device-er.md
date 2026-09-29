# 首批身份与设备权威模型

更新：2026-09-29。该模型只覆盖 WP-01/CT-01～04 的首批身份、邀请、安装、设备、关联和请求记录；任务、项目、队列、媒体、收入等后续域不提前建表。

```mermaid
erDiagram
  operators ||--o{ operator_sessions : authenticates
  operators ||--o{ provider_invitations : creates
  provider_invitations ||--o{ provider_invitation_consumptions : consumes
  phone_verifications ||--o| provider_invitation_consumptions : proves
  providers ||--o| provider_invitation_consumptions : registers
  providers ||--o{ provider_sessions : authenticates
  installations ||--o{ installation_sessions : authenticates
  installations ||--o{ association_sessions : offers
  association_sessions ||--o| device_associations : confirms
  providers ||--o{ device_associations : owns
  installations ||--o{ device_associations : identifies
  devices ||--o{ device_associations : records
```

## 权威边界

- PostgreSQL 是上述事实的唯一权威写入存储。Redis、客户端缓存、二维码内容和 IP/端口不是权威身份或归属来源。
- 运营、提供者和安装身份分别签发会话；`principal_id`、`providerId`、`installationId` 或 `deviceId` 等请求字段不能替代服务端认证上下文。
- 邀请和关联码只保存摘要。会话令牌和安装凭据也只保存摘要；审计 `facts` 禁止写入令牌、验证码、邀请原码或手机号全文。
- 迁移不包含通用开发账号或业务 fixture。首个运营账号只能由部署初始化命令幂等创建，属于 WP-02；不得开放公众初始化入口。

## 事务与竞争边界

### 邀请注册

同一事务按以下顺序执行：

1. 以 `(operation, principal, idempotency_key)` 插入或锁定请求记录；同键不同请求摘要返回 `IDEMPOTENCY_KEY_REUSED`。注册尚未产生 provider 身份时，以已核验的 `phoneVerificationId` 作为 `registration` 作用域主体，不接受客户端自报 provider ID。幂等命中前仍先重新验证当前授权。
2. 以 `FOR UPDATE` 锁定邀请和手机号验证记录，按数据库 `transaction_timestamp()` 复核撤销、过期、剩余额度、用途、号码与验证消费状态。
3. 插入 `providers`，由手机号唯一约束裁决同号码竞争；插入邀请消费记录并将 `consumed_uses` 加一，更新验证消费时间。
4. 保存响应和审计后提交。任何一步失败全部回滚；响应丢失时同键读取已保存结果，不重复扣额。

应用实现必须用条件更新（`consumed_uses < max_uses`）或已锁定行更新；“先查询剩余名额再另行写入”不合格。

幂等记录的 `response_available_until` 只是敏感响应保留终点，不是键可重用时点。到期后可清除 `response_body`，但保留作用域、键、请求摘要、状态和非敏感结果定位信息；同键重试返回 `IDEMPOTENCY_RESULT_EXPIRED`，不再执行副作用。这些墓碑与对应业务事实保持同一保留周期；只能在业务事实已合法清理、迟到请求不再可能且审计策略允许时一并删除。

### 扫码关联

同一事务锁定幂等请求、关联会话和安装行，核对会话未消费、未失效、未过期、安装代次与 `expectedInstallationId`。随后创建或确认设备、插入唯一当前关联、将设备状态更新为 `associated_pending_access`、标记会话消费并保存原响应，全部在同一事务内完成。部分唯一索引阻止同一设备或安装同时存在两个当前归属；异主冲突不得自动覆盖。

二维码扫描只得到待确认信息；在提供者明确确认前不写归属。同一安装创建新会话时，先在同一事务中将旧的未消费会话写入 `invalidated_at`，再插入新会话；旧会话迟到时由已消费/已失效状态、安装代次和当前唯一关联共同拒绝。

## 迁移与兼容

- 当前契约版本为 `2026-09-29.identity-v1`；不支持的版本在业务写入前返回 `CONTRACT_VERSION_UNSUPPORTED`。
- 严格 schema 下必须分方向判断兼容：请求新增服务端可选字段可以在旧客户端不发送它时同版本兼容；响应新增任何字段会被旧消费端拒绝，必须提升版本并按协商版本发送。删除/改义字段、收紧有效值或更换身份语义也是不兼容变更，需消费方确认和前向迁移方案。
- `0001_identity_and_device.sql` 是前向迁移。正式升级、旧客户端兼容、回退/前向修复和真实 PostgreSQL 恢复仍需 WP-27 与 AC-53 验证，不能由本地 schema 检查替代。

## 三端状态披露

- 运营视图只在非 `unassociated` 状态返回 provider ID；提供者视图根据当前认证身份在服务端限定本人设备。
- 安装本机视图只返回本安装 ID、已建立的业务设备 ID、状态、事实版本与时间；不返回 provider ID、姓名、手机号或运营信息。
- `unassociated` 必须与空归属/空 device ID 成对，其他状态必须有对应归属/设备 ID；这些组合由运行时判别联合校验。
