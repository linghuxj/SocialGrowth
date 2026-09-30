# 正式产品后端

WP-00 只提供 NestJS 进程骨架。`GET /health/live` 是进程存活检查，仅表明当前进程能够响应并返回正式产品环境标识；它不是 readiness，不检查 PostgreSQL、Redis、对象存储、迁移或后台作业。

依赖就绪检查将在相应组件接入时单独实现，部署和流量入口不得把 `/health/live` 当作业务可用证明。

WP-01 开始建立正式权威数据模型：

- [首批身份与设备 ER 及事务边界](docs/identity-device-er.md)
- [`0001_identity_and_device.sql`](migrations/0001_identity_and_device.sql)
- [`0002_provider_phone_auth.sql`](migrations/0002_provider_phone_auth.sql)：短信挑战状态、重发/尝试限制和用途绑定；须在 0001 后执行。
- [`0003_provider_auth_recovery.sql`](migrations/0003_provider_auth_recovery.sql)：为已发布 0002 增加 proof/session 响应恢复关联；保留既有行并允许旧会话关联为空。
- [`0004_installation_bootstrap_admission.sql`](migrations/0004_installation_bootstrap_admission.sql)：记录不含原始地址的安装引导准入事实，为来源和全局数据库限流提供并发一致的计数。
- [`0005_network_admission.sql`](migrations/0005_network_admission.sql)：新增网络接入、幂等命令与外部意图，候选节点／当前设备唯一占用；撤权意图绑定回收ID并分别确认。未开放网络接口或 worker。
- [`0006_phone_control_journal.sql`](migrations/0006_phone_control_journal.sql)：设备调用／停止日志、严格记录和幂等命令；默认停止待确认，无持有者取得／重新启用或实际执行调用方。
- [`0007_task_recovery_budget.sql`](migrations/0007_task_recovery_budget.sql)：内部任务尝试恢复预算、一attempt一round及幂等命令；无真实任务生产者／人工新轮、队列或手机消费者。
- [`0008_project_basics.sql`](migrations/0008_project_basics.sql)：筹备项目识别信息与同事务幂等命令；不产生批准、资源分配、周期或执行事实。

迁移当前是待后端迁移执行器消费的前向 SQL；未在真实 PostgreSQL 执行前，不得将其记为迁移或并发验收通过。

## WP-01 事务服务

WP-14 第一阶段新增运营会话入口`GET/POST /api/operator/projects`及`POST /api/operator/projects/:projectId/basics`。写入需Host会话与CSRF，当前所有运营同权；由会话确定操作人，负责人不是权限隔离。版本CAS保护基本信息，多人冲突不覆盖；actor＋request key的载荷摘要排除requestId，同键返回该项目当前事实，不重复创建；同事务保存项目、命令和最小审计。表单无改动不增加业务版本，停用后原负责人可保留，但不能新指定无效运营。字段仅名称、自营/代运营、客户、负责人、提醒邮箱；无方向确认、任务、提醒发送、身份/手机分配或运行状态迁移。完整交付与原复核/QA门禁见[WP-14任务卡](../../docs/engineering/delivery/records/WP-14.md)。

`IdentityTransactionService` 实现当前首批后端事务基础：

- 邀请注册锁定验证与邀请行，在同一事务内复核有效性、创建提供者、扣减名额、消费验证并保存幂等结果。
- 安装端创建新关联会话时失效旧会话；提供者只能读取必要扫码目标并确认。确认事务原子消费会话、创建归属并写入 `associated_pending_access` 设备状态。
- 安装引导只创建低权限 installation/session，不创建 device 或归属。客户端先持久化随机根凭据，服务端仅保存带 pepper 的摘要；同凭据重放恢复同一身份，清数据后新凭据不会自动找回旧设备。
- `/api/installation/*` 以安装 Bearer 会话创建关联会话和查询本机事实；`/api/provider/association-sessions/*` 以 Provider Bearer 会话查看、确认及查询原结果。扫码查看只读，只有确认事务创建归属；`/api/provider/devices/list` 仅列本人设备的必要字段。
- 未认证安装 bootstrap 只对“新根凭据创建新身份”消费准入额度：默认同一可信来源 15 分钟最多 10 个、全局最多 1000 个；计数与 installation 在同一 PostgreSQL 事务中写入，地址只保存 pepper-HMAC 摘要。同根凭据的恢复不新增事实、不消费新额度。
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

## WP-08 接入失效回收维护

`NetworkAdmissionStore` 为未注册 HTTP 的内部控制平面；受限策略／凭据／正式策略均仅形成待处理意图，真实适配和来源通道未接通。阶段四提供单批 `reconcileBatch` 和默认关闭的单次 CLI：未完成准入超过接入窗口、当前资格／归属／安装代次失效时，在既有提供者→安装→归属／设备→接入锁内重新判断，原子进入回收待处理、取消未投递升级、登记两种撤权及审计。已正常准入不因10分钟接入窗口被当成网络租约到期，但当前资格变化仍回收。

仅由受控 OPS 环境显式启用，数据库须已执行0001～0005，禁止借用 Demo 或其他项目库。维护执行会修改真实接入状态，不能当作只读检查：

```sh
SG_PRODUCT_ADMISSION_RECONCILE_ENABLED=1 \
pnpm --filter @socialgrowth/product-backend admission:reconcile -- --limit 100
```

`SG_PRODUCT_DATABASE_URL` 从受控环境提供，不放入命令参数、报告或普通日志。输出单批统计、失败接入ID／固定错误码及`nextCursor`；有失败退出1，成功退出0，没有后台守护。存在游标则用 `--cursor <nextCursor>` 接续，直到null；下一完整扫描从无cursor开始。每行事务锁等待候选保护为5秒，超时失败记录，不跳过为成功；不是生产延迟承诺。失败行保留原事实和唯一节点占用，继续其他行并在后续轮次重试／人工排障。

此命令**不执行实际网络撤权，不建立业务就绪、不解除暂停或退出**；两类真实回收结果均核对后才允许释放候选。定期调度、外部原对象查询／串行策略投递、异常待办与通知分别待后续实现和真实资源验证。当前根`pnpm dev`、Nest启动和设备worker都不自动运行该命令。

## WP-11 内部调用日志（未开放执行）

`PhoneControlJournal`仅保存控制记录和调用／停止历史，不注册HTTP、Nest provider或消费者；新记录默认`stop_requested`，没有持有者取得／重新启用接口。`initialize`、`apply`与审计原子提交；锁序设备→journal，旧版本／同键异载荷拒绝，重复请求返回当前记录及`replayed=true`，绝不能重新执行手机调用。未知调用及原持有者在重启后保留；停止三类证据仅供可信内部适配。

它**不是完整动作授权服务**：`trustedFacts`不得来自客户端，实时权威对象加载／共同锁序、当前本机意愿、真实目标fence和全部Artemis/ADB路径尚未接线；`replayed=false`也不是手机许可。实际executor继续关闭。SQL0006须在0001～0005后消费，非UI事务测试仅使用独立可销毁库；没有新增迁移历史组件或自动部署。详见[阶段记录](../../docs/engineering/delivery/records/WP-11-stage2.md)。

## WP-16 内部恢复预算（未开放任务执行）

`TaskRecoveryStore`保存同一task/attempt/device/round下默认2次、累计300000ms恢复预算，锁后数据库微秒墙钟，开始前占次数，在途未知不释放，重启不清零。不同故障不重置，单轮配置不能由命令提高。可能提交未知只转核验，5分钟不是结果核验期限；帐号验证/身份/权限问题直接人工。available和replayed=false均不是动作许可。

没有正式任务表/授权FK、人工新轮、HTTP、真实队列或Artemis调用方，不能将内部输入当当前事实。SQL0007在0001～0006后消费；详见[WP16任务与计时](../../docs/engineering/delivery/records/WP-16.md)。
