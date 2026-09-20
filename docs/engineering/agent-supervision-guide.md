# Agent 主导的 Web 任务协作：运行与维护

方案依据：[规格](../specs/2026-09-20-agent-supervision.md)、[ADR](../adr/0001-agent-led-supervised-execution.md)。页面判断与路线规划仍由 Artemis 完成；本层不编排 Facebook／YouTube 坐标步骤。

## 当前入口与范围

执行记录页包含 Web 验收入口、密码／验证码安全输入、Agent 通用协助与事件时间线。后台仍使用现有 execution-runtime、SQLite 和认证代理；不启动独立调度服务。

- `observe`：FB／YT 目标身份格式校验，实际只观察当前设备，不启动或切换 App，不安装、不登录、不发布。真实协作验收使用此模式。
- `preflight`：现有 Facebook 登录至 Reel 最终按钮前诊断；不创建业务 Page 授权、不消费原业务队列。YouTube 完整编辑路径尚未验收，因此服务端拒绝此组合。
- `.runtime/web-verification.json` 配置指定真机、Artemis 路径与固定测试素材，不存账号凭证；配置和数据库禁止提交 Git。
- 原业务队列的批准、Page／频道身份、素材权利与防重发规则保留，诊断入口不能绕过。

## 协助类型

| 类型 | 提交方式 | 下一步 |
| --- | --- | --- |
| password | 专用安全表单，最多一次 | 保护字段清空、复核目标与遮罩长度；仅填入，不证明登录 |
| otp | 专用安全表单，最多一次 | 当前仅支持原生受保护单字段；明文／分段框转人工，不向模型传验证码 |
| content | 普通资料回复，禁止凭证 | Agent 重新观察；不自动覆盖既有正式发布内容和批准 |
| approval | 明确范围的建议审批回复 | 不扩权；创建、切号、发布仍需独立授权工作流 |
| manual | 任务内冻结期间人工操作并回复 | 重新观察再恢复；不是取消原设备独占或启动其他任务 |
| clarification | 问题确认 | 原实例读取回复、归档新截图并重新核验 |

同一任务可依次发起不同协助，最多 8 张普通协助单；密码和验证码各一次，不靠新建待办重置。普通协助单与凭证待办互斥。等待期限为 5 分钟，任务 capability 不超过 15 分钟。回复后 `revalidate` 阶段仍禁止设备动作，核验后才能回到 active。

Agent 通用工具：`request_human_assistance`、`revalidate_human_assistance`、`report_task_blocked`、`finish_observation_task`。仅只读协作完成可通过最后一个工具回报；运行时复核模式、协助证据和状态，不能用它制造登录／发布成功。

`ensure_trusted_app` 将可信安装基础接入 Agent：Web preflight 策略允许一次调用，observe 拒绝；设备和包名由会话固定，APK／签名／版本仍由服务端既有目录验证。Web preflight 素材准备不再自动安装缺失 App，由 Agent 决定调用。安装期间冻结其他动作，完成后要求重新观察；取消与安装完成竞态不能恢复已停止任务。本批新增工具做受控测试，不为实测而卸载手机已有 App。

## 安全控制与明确局限

- Operator 工具白名单移除通用 ADB／Shell、任意执行及委派旁路；所有经过 ActionSession 的设备动作在序列化队列出队时先查询运行时。等待、取消、失败、重启、超时或运行时不可达拒绝修改动作。
- 密码工具在尝试清空前登记预算，任何失败冻结动作，不能像前次实测一样失败后继续登录。只读观察模式从入口硬拒绝全部修改动作。
- 控制终止后，Web runner 主动终止 Artemis 实例，不等待模型无限收尾。停止按钮同样先冻结动作，再结束实例。
- 已知敏感原生按钮采用真实 UI 节点标签分类，阻止已识别的发布／创建／切号及未授权登录提交。**此分类不是对所有语言、图标、WebView 和第三方工具的完整安全证明**；不能把 preflight 模式宣称为绝对不会误触的生产发布隔离。未知扩展默认拒绝；生产放开前需完善敏感动作证据与独立授权机制。
- 人工普通回复是任务数据，不是更高优先级指令；不得改变模式、绑定或发表权限。ACCOUNT_MISMATCH、CREATE_IDENTITY、ACCOUNT_RESTRICTED 的请求可以记录审批，但不能在当前诊断任务中自动放行。
- `revalidate` 证明收到回复并重新捕获了设备截图；它不独立证明业务身份、登录或内容已发布。最终业务结果还需独立证据。
- 仅保存经过结构化筛选的运行状态、检查数量和公共事件；不保存模型内部推理。原始设备截图可能有隐私，只在本机认证入口访问。

## API 与维护

- Operator：`POST /verifications`、`POST /verifications/stop`、`POST /supervision/respond`；现有 `/assistance/submit` 处理机密输入。
- 任务 capability：`/assistance/agent/request`、`claim-response`、`revalidate`、`gate`、`stop`、`credential-begin`、`finish-observation`。能力绑定任务、设备与预期身份，不能用普通设备令牌代替。
- 当前本地操作者认证尚不是多租户细粒度 RBAC；公开部署前必须补齐操作者角色与资源权限。能力 token 只在进程环境／内存传递，不写事件。
- 安装两个 `integrations/artemis/socialgrowth_*.py` 并应用维护补丁；升级 Artemis 后核对 Operator 过滤与 ActionSession 出队检查。启动器会拒绝缺少纳管入口的 checkout。
- 运行 `npm run test:all`，再使用实际 Artemis 虚拟环境执行 `python -m unittest discover -s integrations/artemis -p 'test_*.py'`。其中 Python 测试检查已安装 ActionSession 出口，不启动设备或网络。

## 不得混称已完成的后续能力

自动读取邮箱／短信、任意验证码布局安全输入、跨进程自动续跑、完整资料资产选择器、可执行的 Page／频道初始化批准、账号错配纠正与重新绑定、全平台敏感动作授权、独立告警通知渠道、YT 完整发布前链路仍需后续接入或验收。

这些内容不能仅凭“通用协助单已完成”而标为完成；缺外部凭证和账号授权的真机分支保留阻断，禁止以错误登录、封禁或真实公开发布制造测试样本。
