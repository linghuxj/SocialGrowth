# 首条闭环：执行与服务契约

版本：design-v1，2026-09-19。状态：待实现的工程契约，不是当前线上协议。修复 B-03；当前源码 v0.1 类型与目标契约分列，禁止在同一字段表中混用。业务依据见[已确认规则](../handoff/2026-09-19-business-flow-proposal.md)，存储语义见[数据模型](data-model.md)。

## 当前可复用材料

[Controller types.ts](../../apps/artemis-controller/src/types.ts)为当前源码类型：指令使用 `mediaAssetPath`、`AutomationStep[]`、`deadline`，回执仅有 `completed/failed`。README 原先另列 `mediaDownloadUrl/mediaSha256/ActionStep/waiting_human_takeover`，与源码不一致，已改成明确的当前/目标分层。

当前 [scheduler.ts](../../apps/artemis-controller/src/scheduler.ts)仍生成占位回执，没有真实 WS/gRPC Agent 服务。以下契约不能直接宣称已被该调度器实现，也不能把其生成的 URL/截屏路径视为发布证据。

## 共同约定

- 目标版本标识 `contractVersion: "design-v1"`。ID 为不透明非空字符串；时间为含时区的 ISO 8601 时间点；日志和消息不传账号密码、验证码或访问令牌。
- 每条消息有 `messageId`、`type`、`sentAt`、`payload`；响应使用 `inReplyTo` 指向请求。`messageId` 同内容重复传输返回原处理结果，不重复创建任务；同 ID 不同内容返回 `ID_CONFLICT`。
- 身份验证来自连接会话；声明的 `deviceId/accountId` 不能代替认证。网关核对会话设备与当前平台账号绑定；不匹配拒绝，不能借其他空闲手机执行。
- 保留既有 Agent 主动建立长连接、Pull 任务路线。选择 WS 或 gRPC 的传输适配属于实现任务；本规格先统一载荷和语义，不要求同时实现两套，也不将缺特定文件格式认定为无契约。
- 网关接受回执表示**记录收到**；不表示平台已公开、设备空闲或业务获准恢复。任务技术状态、发布事实、设备资源状态分别记录。

## 消息与字段

表内字段除明确可选外必填。列表为空和缺字段不同；关联记录需存在、属于同一项目及批准范围。所有消息均受上面的共同信封约束。

| type | payload 字段 | 处理结果 |
| --- | --- | --- |
| `PullTask` | `deviceId`、`resourceStatus: idle/busy/offline/error` | 仅 idle 且网关确认当前条件时给该设备绑定账号的任务；否则 `NoTask`，不能因设备自行报 idle 而解除业务暂停 |
| `NoTask` | `deviceId`、`reason: queue_empty/resource_unavailable/business_paused` | 当前无可下发任务，不能据此清除旧任务或发布结果；下次拉取仍重新检查条件 |
| `PublishTaskDirective` | `taskId`、`attemptId`、`projectId`、`strategyVersionId`、`approvalId`、`bindingId`、`deviceId`、`accountId`、`platform`、`targetAppPackage`、`contentIdentityId`、`sliceId`、`media`、`captionText`、`destinationVersionId`、`scheduledAt`、`expiresAt`、`timeZone`、`steps`、`taskTimeoutMs`；`shortLinkUrl` 可选 | 一次已批准尝试；同一 task/attempt 重传只查询/确认原执行，不能再次触发提交；过期不补发 |
| `ExecutionReceipt` | `eventId`、`taskId`、`attemptId`、`deviceId`、`accountId`、`occurredAt`、`executionStatus`、`publishStatus`、`evidenceRefs`；`publishedPostId/publishedUrl`、`failureCode`、`challengeType`、`resourceStatus` 按下述条件提供 | 校验归属、存档、响应 Accepted 或 Rejected；不以接收顺序覆盖已确认事实 |
| `Accepted` | `eventId`、`receivedAt` | 已记录；不自动恢复旧排期，不增加一次执行 |
| `Rejected` | `code`、`message`、`relatedIds` | 业务状态不变；显示原因供核查；技术重连不能直接转成重新发布 |

`platform` 保留 facebook/youtube/instagram 枚举，当前执行配置仅激活 FB/YT。`media` 包含 HTTPS 预签名 `downloadUrl`、`sha256`、`expiresAt`；过期重新取资产授权链接，不能因此创建第二次发布。`steps` 采用现有 `AutomationStep` 的 `stepIndex/action/targetSelector/coordinates/value/timeoutMs` 结构，动作名为 `open_app/navigate/click/input_text/select_media/scroll/wait`；处理挑战通过回执，不混用 README 旧大写 ActionStep 枚举。坐标须是经端侧核验的非负屏幕内坐标；单步耗时受任务硬超时约束，硬超时不是人工响应 SLA。

字段类型与组合校验：`captionText/targetAppPackage/timeZone` 为字符串，`targetAppPackage` 必须匹配目标平台和已核对动作配置；URL 为字符串；`sha256` 为 64 位十六进制字符串；`taskTimeoutMs`、单步 `timeoutMs` 为正整数；`stepIndex` 为非负整数且在动作序列内唯一；`steps/evidenceRefs/relatedIds` 为数组，证据及关联 ID 元素为非空字符串。排期到期时间必须晚于计划时间，时区必须可解析；`steps` 不能为空。缺必需字段、非法枚举、错误类型或不一致的账号/身份/尝试引用均拒绝。技术失败须给出 `failureCode`；人工等待须有 `challengeType`；是否提供公开标识取决于下表，而不是所有回执一律必填。

## 回执与失败语义

`executionStatus` 与[数据模型](data-model.md)技术状态一致；`publishStatus = not_submitted / in_progress / unknown / confirmed_not_published / published`。

| 事实/条件 | 接收及状态处理 |
| --- | --- |
| 明确尚未提交 | `not_submitted` 须有动作进度依据；无回执不能补填此值 |
| 提交后待平台处理 | `in_progress`；暂停关联新提交，不释放身份 |
| 超时、断线、技术失败而发布事实不清 | `unknown`；`executionStatus=failed` 也不能转换为 confirmed_not_published |
| 平台明确拒绝且排除处理中/已有帖文 | `confirmed_not_published`，必有核对证据；原账号恢复另经人工确认及当前批准 |
| 已公开 | `published`，必有可核对的 Post ID 或 URL 及证据引用；任务完成但无公开证据不得填此值 |
| 人工挑战 | `executionStatus=waiting_human`，`challengeType=2fa_sms/2fa_email/device_verify/platform_restriction/other`；按已知事实记录发布状态，不默认未提交；通知和验证码验证均不等于恢复 |
| 迟到/冲突回执 | 保存原事件和冲突，已确认公开不降级；补记公开历史但不恢复旧任务。证据互相冲突时保持受影响范围暂停并交人工核对 |

收到失联/超时后，先确定影响范围：共同账号授权、设备、素材权利、目的地或服务原因相关的安排暂停；无法排除关联者暂缓。确认无关联且批准有效者继续，不能仅按账号 ID 不同推定无关联。恢复记录需含操作人、证据、结果核对、权限及当前排期；端侧仅报告资源变化，无权自行批准业务恢复。

| code | 含义 | 是否自动重发发布 |
| --- | --- | --- |
| `INVALID_MESSAGE` / `UNSUPPORTED_VERSION` | 字段、版本或组合非法 | 否，修正契约问题 |
| `ID_CONFLICT` | 同事件/消息/尝试 ID 内容不一致 | 否，保留冲突核查 |
| `BINDING_MISMATCH` / `AUTHORIZATION_INVALID` | 绑定或当前权限不满足 | 否，重新核对 |
| `APPROVAL_INVALID` / `SCHEDULE_EXPIRED` | 批准失效或原排期过期 | 否，重审/重排 |
| `CONTENT_CONFLICT` / `ALREADY_PUBLISHED` | 身份冲突、在途/未知或已有发布 | 否，不以新 ID 绕过 |
| `MEDIA_UNAVAILABLE` | 文件不可用或校验失败 | 否；先区分是否曾提交 |
| `EXECUTION_TIMEOUT` / `CONNECTION_LOST` | 执行或连接异常 | 否，核对发布事实 |
| `HUMAN_REQUIRED` | 需要有权限人员核查 | 否，通知不算接管 |

这组错误码为目标契约；当前源码 `failureReason?: string` 尚未实现映射。未知外部错误归入执行异常并保留脱敏来源，不擅自映射为确定未发布。

## 与其他服务的边界

以下定义首条闭环必须交换的业务内容，不宣称现有 REST 路由已实现；服务双方在对应实现中绑定具体入口并复用同一版本定义。

| 调用 | 请求 | 响应及失败边界 |
| --- | --- | --- |
| 控制台 → 策略引擎：生成候选 | `requestId/projectId/goalVersionId`，账号、合格身份/文件候选、规则版本、可得证据 | 草案版本、引用与假设、缺口/冲突；不产生批准或发布任务。无素材返回缺口，不能用高匹配分替代准入 |
| 控制台 → 中枢：确认安排 | 指定策略版本、批准范围、批准人、排期/时区、账号/身份/入口引用 | 逐项批准/拒绝及原因；服务端重读当前条件，不能只信前端检查或一次批量成功文案 |
| 中枢 ↔ Agent | 上述 Pull/指令/回执消息 | 记录技术与发布事实；生产执行仍受纯真机约束 |
| 控制台 → 短链服务：维护入口 | 项目/客户、账号、内容或频道范围、实际目的地/版本、操作授权与维护约定 | 入口 ID/版本及可归因粒度；无授权/不相关目标拒绝，变更不覆盖旧版本 |
| 数据适配器 → 评价 | 指标 ID、单位、范围、来源、时间窗、观察值及可用性、数据证据 | 值与缺失分列；主指标缺失不换评分。所需样例和断言见[离线验证](offline-verification.md) |

## 实现与验收接续

落实时同步 Controller 类型、端侧实现、持久化、调用方与契约测试，不通过仅修改 README 宣称兼容。对旧字段拒绝静默别名迁移；如需过渡适配，显式标注版本及证据不足的状态。验证重复指令、错绑定、超时未知、迟到公开证据、过期批准和挑战后恢复，再分别记录受控测试与真实设备验证。当前待实现项见[修复台账](../handoff/2026-09-19-readiness-remediation.md)。
