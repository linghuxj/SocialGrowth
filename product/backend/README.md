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
- [`0009_resource_reservations.sql`](migrations/0009_resource_reservations.sql)：内部初始资源预留、不可变中央引用、组合FK及唯一约束；无真实登记生产者/资源验收或释放。
- [`0010_project_planning_drafts.sql`](migrations/0010_project_planning_drafts.sql)：筹备规划输入及幂等记录；只存未批准草案，不开启周期/切换资格/派发任务。
- [`0011_unassigned_device_todos.sql`](migrations/0011_unassigned_device_todos.sql)：无项目设备协助内部日志、逐设备影响/原关联、初始邀请责任、人工说明与单个通知意图；没有真实故障或发送/复核消费者。
- [`0012_device_assistance_feed_index.sql`](migrations/0012_device_assistance_feed_index.sql)：认证只读全局摘要的DB微秒游标索引，不改写历史状态或产生权限。
- [`0013_device_assistance_notes_index.sql`](migrations/0013_device_assistance_notes_index.sql)：运营说明历史的逐事项DB微秒游标索引，保留已有说明及命令行。
- [`0014_tracking_link_requests.sql`](migrations/0014_tracking_link_requests.sql)：不可重绑定的配置链接及原记录ID去重请求日志；配置关联不是实际来源，未提供正式政策时公开路由关闭。
- [`0015_endpoint_report_journal.sql`](migrations/0015_endpoint_report_journal.sql)：内部已准入绑定的端点快照/回执；可信来源缺省关闭，无实际上报或连接消费者。
- [`0016_connection_maintenance_budget.sql`](migrations/0016_connection_maintenance_budget.sql)：独立维护预算/命令；无任务生产者、HTTP或实际恢复消费者。
- [`0017_joint_recovery_reservations.sql`](migrations/0017_joint_recovery_reservations.sql)：共同恢复关联不可重绑，同事务双方占位/结果未知不释放；不证明真实任务或物理调用结束。
- [`0018_commission_income_journal.sql`](migrations/0018_commission_income_journal.sql)：内部稳定收入源/连续修订/冻结计算与命令，实际收款和承接producer缺省关闭；没有应付余额或支付。

迁移当前是待后端迁移执行器消费的前向 SQL；未在真实 PostgreSQL 执行前，不得将其记为迁移或并发验收通过。

## WP-01 事务服务

WP-23新增内部认证TrackingLinkService配置/撤销及`GET/HEAD /r/:token`。真实目标origin政策尚缺，AppModule显式null、公开路由404且无数据库调用，未接运营HTTP合同/UI；没有可对业务开放的生成入口。服务端白名单HTTPS目标不来自query/Host，配置同事务权限/幂等/审计，配置内容关联不证明点击来源；GET提交请求日志后302，HEAD不记录，no-store/no-referrer/无正文。只同record ID重放去重、保守Sec-Purpose预览识别，无正式重复访问窗口、平台路径或实际来源生产者；不能把request_records_prefetch_v1当正式点击/真人/到达/成交或AC-45通过，见[任务与真实资源](../../docs/engineering/delivery/records/WP-23.md)。

WP-14 第一阶段新增运营会话入口`GET/POST /api/operator/projects`及`POST /api/operator/projects/:projectId/basics`。写入需Host会话与CSRF，当前所有运营同权；由会话确定操作人，负责人不是权限隔离。版本CAS保护基本信息，多人冲突不覆盖；actor＋request key的载荷摘要排除requestId，同键返回该项目当前事实，不重复创建；同事务保存项目、命令和最小审计。表单无改动不增加业务版本，停用后原负责人可保留，但不能新指定无效运营。字段仅名称、自营/代运营、客户、负责人、提醒邮箱；无方向确认、任务、提醒发送、身份/手机分配或运行状态迁移。完整交付与原复核/QA门禁见[WP-14任务卡](../../docs/engineering/delivery/records/WP-14.md)。

第三阶段新增`GET/POST /api/operator/projects/:projectId/planning-draft`，运营Host会话读、CSRF写。严格contract/body路径及project/draft版本，空项保留未配置，保存永远unapproved_draft；同事务草案及project版本/审计/命令，无改动不加版本，同键读取当前草案。只支持筹备项目，未连Web；人工国家语言标签和内容说明不是可执行批准边界，不能据此启动周期或任务。完整字段、迁移/测试及真实缺口见[规划输入任务卡](../../docs/engineering/delivery/records/WP-14-stage3.md)。

WP-15 `MaterialObjectStorage`为内部S3/MinIO字节适配器，未接Nest/HTTP/Web/素材登记/消费者；显式受控配置及凭据，无环境默认凭据链。固定UUID对象/条件防覆盖、完整下载哈希/长度验证、配置位置绑定，不产生公开URL/批准/名额或执行许可。`test:storage`只运行明确隔离回环32900新fixture，不是项目E2E或UI验收；适用范围、128MiB缓冲上限、正式S3/上传准入/手机缺口见[素材任务卡](../../docs/engineering/delivery/records/WP-15.md)。

WP-22 `metric-snapshot-core`仅内部效果快照与显式更正规则：精确非负数值、零/缺失/延迟、原来源/定义/粒度/时区/截止、当前前驱连续更正及历史归属不变；不加累计值，不按采集时间冒充新截止，不硬拆账号指标。不连接真实渠道、数据库/每日调度、可比性判定、手机或AI模型，UUID不是权限或发布证明，见[效果数据任务卡](../../docs/engineering/delivery/records/WP-22.md)。

WP-24 `project-cycle-core`只消费未来可信日历生成器的冻结实际边界，检查同瞬间连续/旧周期不变；按原平台task去重、实际发布时间左闭右开归属与迟到核验回原期，计划/完成/失败/待核实/路径不足分开且缺口不自动累入下一期。不生成IANA/DST边界、不查真实发布或引流证明、不存持久报告或授予执行，见[周期任务卡](../../docs/engineering/delivery/records/WP-24.md)。

`observation-window-core`只消费明确的项目默认/形式覆盖、已核验发布与可信来源日历，分别检查精确小时和完整平台日、首不足日、同定义/持续时长/年龄及实际快照覆盖/截止；未满或不足只阻该比较，不产生停发/重发/换主指标。ready/aligned仅进入真实证据充分性复核，不证明可比或授权；未接批准/日历/来源生产者、持久化、AI或页面，见[观察窗口任务卡](../../docs/engineering/delivery/records/WP-24-stage2.md)。

WP-20 `GET /api/operator/assistance-todos`仅以当前Host运营会话读取无项目来源事项的全局摘要，`afterTodoId`及`pageSize`严格分页，默认20/上限50、no-store。初始联系人不隔离访问，originScope不是当前项目分配状态；不返回说明正文/秘密，见[认证分页任务卡](../../docs/engineering/delivery/records/WP-20-stage2.md)。新增`POST /api/operator/assistance-todos/:todoId/notes`需同会话＋CSRF、严格metadata/路径对象/版本CAS/kind/text；reported_processed仅等待复核，不关闭或恢复；同键返回当前摘要，已提交未知响应保留原键核实。摘要共同支持0001～9999年。没有故障创建、真实复核/恢复HTTP或实际事件/邮件/跨端UI接线，不能从测试入库或空页自报完整业务完成，见[说明命令与日历修复](../../docs/engineering/delivery/records/WP-20-stage3.md)。

`GET /api/provider/assistance-todos`新增Provider Bearer本人分页投影，同todoID与当前进度、不返运营责任/内部说明/其他provider，owned微秒cursor不能跨人；事务认证与最后DB钟保护失效会话。只是后端接口，未实现Android待办UI、人工写入或真实恢复，见[本人待办任务卡](../../docs/engineering/delivery/records/WP-20-stage4.md)。

`GET /api/operator/assistance-todos/:todoId/notes`以当前Host运营会话分页读取实际保存的说明/作者及当前摘要，默认20/上限50/no-store，游标仅同事项且取DB完整微秒。记录时间不越过事项创建/更新时间；末页或人工reported_processed不是复核通过或恢复。正文不向provider/模型/日志自动传递，后续UI须纯文本显示；原内部load全部说明的性能不据此关闭。没有UI消费或真实业务验收，见[说明历史任务卡](../../docs/engineering/delivery/records/WP-20-stage5.md)。

说明时间在PG原始精度先检查全事项，包含页外坏记录；±1微秒不会因Date显示同毫秒被接受，正常inclusive/DB微秒分页不变。检查会扫描关联说明，不能据分页上限宣称全部路径性能已达标。原P3/RED及新固定自检见[精度整改](../../docs/engineering/delivery/records/WP-20-stage5-precision.md)，作者不能自签清零。

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

## WP-10 内部端点报告（未开放真实上报）

WP-10 新增内部 `endpoint-report-core` 只校验签名完整双用途快照、来源epoch/BigInt序号及回执账本。缓存观察的新序号不刷新端点观察计时，旧ID恢复原回执不回退当前状态；配对过期只留回执、不再返回配对候选。重新载入须重建与验签；全历史数组不是已完成生产持久化/容量方案。authority/serverNow 只能由可信内部生产者提供，没有HTTP/数据库/Android上报注册，不授动作许可或解除暂停/退出，源码时间字段不证明当前NSD或来源。真实职责和后续持久/认证/目标/恢复缺口见[WP10任务卡](../../docs/engineering/delivery/records/WP-10.md)。

阶段二 `EndpointReportJournal` 增加0015持久快照/回执，真实安装bearer与当前归属/已准入绑定在同事务内重查；来源接口缺省null在连库前关闭。可信来源观察在事务/锁前完成，有3秒技术超时与AbortSignal；锁后及提交前以实际DB微秒钟再校验来源和会话，不在长事务等外部网络。该接口没有实际LocalAPI实现、Nest/HTTP或Android发送接线；测试来源是合成非UI seam，不是已验证独立来源。配对session未持久接线，本层只允许pairing未知/撤销，不允许真实配对候选。保存、回执、最小审计同事务，行数核验，默认不派动作/队列或新网络许可。完整记录及后续范围见[持久阶段](../../docs/engineering/delivery/records/WP-10-stage2.md)。

阶段三 `connection-maintenance-budget` 是独立纯预算：明确内部限额，无假任务、不采用草案生产默认；次数/耗时跨端点、重载及成功不清零，未知调用继续占位、人工门禁不由迟到成功清除。有任务必须同时满足真实任务预算，无任务null只由权威内部来源提供。返回budgetsAvailable不是动作许可，两份观察副本须共同持久后才可进入未来执行；没有持久/当前任务resolver/HTTP或消费者。详见[维护预算阶段](../../docs/engineering/delivery/records/WP-10-stage3.md)。

阶段四 `ConnectionMaintenanceStore`/0016增内部持久维护round和command；当前DB-only context resolver缺省关闭，不冒充实际来源/任务生产者。旧键只返回当前state与joint=null；有任务明确禁止maintenance-only begin，阶段四提交时联合分配未实现。共同观察在device→maintenance→task锁后按DB钟计双方账本，双方command/audit同事务且检查真实影响行数；不授动作或解除pause/exit。详见[持久维护阶段](../../docs/engineering/delivery/records/WP-10-stage4.md)。

阶段五/0017在任一未来实际恢复开始前同事务占双方次数与不可变关联，完成只对应原任务/原attempt，未知继续占双方位，迟到结束不自动清人工门禁。旧任务结果可能提交只转核验；缺关联关闭、无历史回填。DB context与物理结束生产者未实现，成功返回仍不是动作许可；父来源复核pending1不能由本有限增量通过替代。详见[共同占位](../../docs/engineering/delivery/records/WP-10-stage5.md)。

## WP-17 内部业务建议与模型协调（无真实模型接入）

`business-suggestion-core`严格四结论、当前引用和名额，只形成checked_advisory_only；旧task占位即使部分任务投影遗漏也不得作为新schedule，取消不释放名额。`business-model-coordinator`缺省facts/model/policy关闭；显式port时严格JSON及大小、私有副本、三段共同deadline和最终await后事实/clock核对，无模板/旧成功兜底。provider/model/response标签或modelRequested不证明真实网络/费用/AI；没有生产事实reader、Task writer、HTTP/UI/队列/执行许可。详见[边界](../../docs/engineering/delivery/records/WP-17.md)及[协调](../../docs/engineering/delivery/records/WP-17-stage2.md)。

## WP-21 内部任务影响分类（无变更执行）

`task-impact-core`按完整任务/名额与版本区分更正、撤回、暂停、结束及恢复；未知只核实原提交，编辑中只建议安全停止与检查。更正按显式材料variant谱系，不扩大到另一语言/平台；原任务窗口/材料/名额及成功/取消历史保持，结束无普通恢复。impact_advisory_only不修改任务、不能删除或释放资源，无生产writer/outbox、物理停止或迁移实现，详见[变更任务卡](../../docs/engineering/delivery/records/WP-21.md)。

## WP-15 人工素材内部登记（无准入或发布）

`MaterialRegistryStore`/0019只持久当前operator/CSRF的人工unit/source、语言variant、不可变对象manifest/修订、命令及最小审计。默认对象verifier关闭新save，旧read不证明当前字节仍在；server-only核验在事务外，随后重新认证/CAS及最后DB钟，同原key读当前不重做IO。名称/hash/语言或新UUID不推定实际身份，给定原source命名空间稳定唯一；更正保留原unit/文件，saveBatch最多50逐项独立结果，失败不阻合格项，但所有保存仍pending_validation/candidateAllowed=false/publicationAllowed=false。MaterialStorageVerifier实际readVerified完整字节核验，production upload/location lookup及HTTP/跨端/UI/候选/名额/Task/手机接线尚未配置或实现；详见[素材登记](../../docs/engineering/delivery/records/WP-15-stage3.md)。

后续内部`MaterialUploadStore`/0020先固定认证object票据与server存储绑定、声明SHA/长度/类型；事务外真实条件PUT＋完整GET，重新认证及最终DB钟后才记verified_bytes/immutable manifest。存储或COMMIT失ACK/过期均按原ID原字节核实重试，历史重放不重复IO；不自动删对象或迁移旧manifest。server-only DB objectVerifier只读matching verified票据并重新验实际bytes，不再依赖临时map。仍无受控runtime配置注册、HTTP/跨端/UI/媒体准入/Task/手机，verified_bytes不等批准，许可false。`test:upload-storage`仅显式自有PG＋32902合成真实存储补充检查，不能替代Playwright；详见[上传票据](../../docs/engineering/delivery/records/WP-15-stage4.md)。

第五阶段已实际注册MaterialRuntime及`POST /api/operator/projects/:projectId/material-uploads`/`GET .../:objectId`认证票据API。当前Cookie/CSRF/DB钟、最小共享TS/JSON/Python契约；只返必要bytes/status/时间与false许可，不返descriptor/位置/key/凭据。默认无配置新写503、历史read不重新证明当前bytes。显式SG_PRODUCT_MATERIAL_MODE=configured及所有受保护server字段才构造SDK，详见[配置/字段/实际测试及缺口](../../docs/engineering/delivery/records/WP-15-stage5.md)。shutdown关闭自有SDK，不自动发现/创建生产bucket。字节HTTP、素材登记HTTP、UI/准入/Task/手机仍未实现，不能把票据API当整个上传或媒体链路通过。

第六阶段提供同object的`PUT .../material-uploads/:objectId/bytes`，raw application/octet-stream＋x-sg-contract-version/x-request-id/x-idempotency-key、Cookie/CSRF；先实际认证/票据binding，再锁外有界读取与原upload二次认证。HTTP prepare/PUT技术上限16MiB/总读15秒，内部128MiB不等HTTP支持；断开/超时/超量可能关闭连接，必须原ID/key查当前/重试，不自动删除或换ID。成功仅verified历史，两许可false，无下载/登记API/UI/媒体准入或手机Task。新Cookie保留完整值再精确校验，不截断`=`后缀；bf5局部原P3同窗实际清零、组合原QA仍待。见[真实测试/原失败/规模与人工缺口](../../docs/engineering/delivery/records/WP-15-stage6.md)。

后续六类运营控制器统一`operatorSessionTokenFrom`，完整43字符base64url且同名唯一，拒绝数组合并/后缀/名称畸形及控制字符，不改变auth、CSRF或响应Cookie属性。作者2unit/3实际AppModule认证回归及产品356/全PG256通过，原固定门禁另做；非真实浏览器登录、全站生产安全或媒体验收，见[Cookie统一整改](../../docs/engineering/delivery/records/operator-cookie-hardening.md)。

## WP-25 内部分佣核对（无实际收入或付款）

`commission-core`只对明确到账/产生期间/承接及历史统一比例作BigInt精确核对；跨承接/比例不能可靠拆分、配置未定或未知保持pending。确认空档归公司不是缺记录默认，不公开到本人；币种/精度/舍入显式无生产默认。internal_calculation_only没有真实producer、持久去重、本人API或支付，不能将重复纯计算累计为新应付。78位金额/0～12位精度/18位比例只是技术边界，图稿数字不是配置，详见[分佣任务卡](../../docs/engineering/delivery/records/WP-25.md)。

`CommissionIncomeJournal`/0018另提供内部operator会话＋CSRF的稳定源去重、连续修订和冻结原依据；缺省producer在connect前关闭。旧key读当前不重算，换actor/key相同收入不重复计数或用新context自动改历史。修订/源/命令/最小audit同事务，完整历史按原context/DB微秒钟重算校对，损坏拒绝；没有实际到账/承接producer、本人feed/HTTP/UI或付款。DB-only port需同guard保护，未来共享锁顺序须先对齐，不在guard后擅自锁provider/device或外部网络；详见[收入账本](../../docs/engineering/delivery/records/WP-25-stage2.md)。

后续`GET /api/provider/commissions`仅真实Provider Bearer当前会话只读本人**内部**计算历史，默认20/上限50、严格成对afterIncomeId/afterRevision与no-store；不收caller providerId。按同一查询快照完整重算历史，cursor/overscan同样校验，归属更正后原人的旧修订currentForIncome=false，不得累加多个应付。公司空档/他人/未知归属不披露，只有必要Page/频道标识、期间、原比例/舍入版本与内部金额，没有原source/receipt/他人/凭据、提现/总余额/付款。paymentStatus=not_recorded不是已付或未付事实确认。数值修订排序整改不削减1000上限；跨页不是冻结快照，新插入UUID排序在cursor前须重新加载。尚无实际收入producer、本人Web/Android消费者或付款记录，详见[本人最小投影与整改](../../docs/engineering/delivery/records/WP-25-stage3.md)。

## WP-11 内部调用日志（未开放执行）

`PhoneControlJournal`仅保存控制记录和调用／停止历史，不注册HTTP、Nest provider或消费者；新记录默认`stop_requested`，没有持有者取得／重新启用接口。`initialize`、`apply`与审计原子提交；锁序设备→journal，旧版本／同键异载荷拒绝，重复请求返回当前记录及`replayed=true`，绝不能重新执行手机调用。未知调用及原持有者在重启后保留；停止三类证据仅供可信内部适配。

它**不是完整动作授权服务**：`trustedFacts`不得来自客户端，实时权威对象加载／共同锁序、当前本机意愿、真实目标fence和全部Artemis/ADB路径尚未接线；`replayed=false`也不是手机许可。实际executor继续关闭。SQL0006须在0001～0005后消费，非UI事务测试仅使用独立可销毁库；没有新增迁移历史组件或自动部署。详见[阶段记录](../../docs/engineering/delivery/records/WP-11-stage2.md)。

## WP-16 内部恢复预算（未开放任务执行）

`TaskRecoveryStore`保存同一task/attempt/device/round下默认2次、累计300000ms恢复预算，锁后数据库微秒墙钟，开始前占次数，在途未知不释放，重启不清零。不同故障不重置，单轮配置不能由命令提高。可能提交未知只转核验，5分钟不是结果核验期限；帐号验证/身份/权限问题直接人工。available和replayed=false均不是动作许可。

没有正式任务表/授权FK、人工新轮、HTTP、真实队列或Artemis调用方，不能将内部输入当当前事实。SQL0007在0001～0006后消费；详见[WP16任务与计时](../../docs/engineering/delivery/records/WP-16.md)。

## WP-14 内部初始资源预留（未开放真实分配）

`ResourceReservationStore`尚无登记生产者/HTTP/UI/任务消费者。中央账号/发布身份来源引用不可变；组合FK、唯一约束与短事务guard保证账号/手机同期一项目、同机同平台一身份、同身份一当前手机。与项目负责人更新保持operators表元数据锁→actor/session→guard→project→device顺序（读取同样遵守），不与手机执行互斥混用。operator会话/CSRF及资源/project/device版本检查、同键当前读取、原子审计与最后锁后会话到期回滚；返回一律pending_initialization。

不能将预留当作真实身份已核验、承接生效或动作许可，也没有释放/换机/跨项目转移。登记生产者须持同guard并提供正确canonical source ID，WP-13还须读取新鲜实际授权/连接/控制事实。SQL0009在0001～0008后消费，阶段证据与缺口见[资源任务卡](../../docs/engineering/delivery/records/WP-14-stage2.md)。
