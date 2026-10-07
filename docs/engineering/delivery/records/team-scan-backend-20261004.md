# 后端与执行链扫描 — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

基线为 `f583f184891bd3d0406c43821cb3d36e2eb1233a`（`codex/team-backend` 独立工作树）。本扫描覆盖该固定提交的实现和交接证据，并只读查看当前主工作区未提交的需求基线与 Android 对齐文件；不把未提交的 ADR 或其他本地修改当成已接受实现。任务范围依照有效需求 R-001～R-158、交付台账、C2/C3 记录及 2026-10-03 的 H1～H7 接续单。结论限后端/执行主链，不能替代主会话全 WP/AC 盘点、固定候选非作者复核或业务验收。

## 实际接线与剩余缺口

| 主链 | 已有真实生产者／消费者 | 当前只是基础或缺失 | 最小接续和验收条件 |
| --- | --- | --- | --- |
| 项目与素材 | 项目 CRUD、材料登记、上传票据、实际字节/SHA 校验、私有对象读取、人工声明入口已有服务及页面逐步接线；后端持久化了项目和素材事实 | 上传/声明仍不等于来源权利证据；candidate eligibility、批准版本、任务消费没有接上。无业务素材的权利证明不可由代码推断 | 以一个有来源、有明确业务关系和证据引用的已登记素材，通过 Web 人工提交并读回；后端拒绝待校验/版本已变/无权素材进入批准范围。由 BIZ/用户提供真实业务事实 |
| 目标、方向、周期与模型 | `ProjectPlanningService` 持久保存草案；`ProjectDirectionService` 有模型端口、调用尝试/恢复和确认写入；当前固定记录包含真实模型方向生成、重载和真实页面有限通过证据 | 草案不等于批准或排期；业务建议、内容配额和任务分发部分仍是纯规则核心。没有从“获准模型输入 + 可用素材候选 + 批准范围”生成可执行的不可变计划 | 最小新切片需与现有 Web 草案/批准交互配合，输入必须从服务器当前项目/材料/方向版本读取；真实模型输出留有来源与版本；无合格素材或版本冲突时不产计划/Task |
| Task、名额与队列 | `task-dispatch-core` 和 `content-quota-core` 有纯函数约束；PG 已有资源预约、任务重查 journal/outbox 等局部持久组件 | 未发现核心发布计划的原子 producer 将排期、Task、账号/设备名额和 outbox 一起落库；重查 outbox 是重验事件，不是执行队列；没有已启用的业务 Task worker | 仅在父素材/批准前置成立后，定义一条类型明确的批准计划→Task 持久化契约；并发/幂等、容量竞争与 outbox 重放须用全新隔离 PG 库验证。生产写入默认关闭直到完整条件满足 |
| 网络接入与来源 | CT-05 契约、入网记录/事务、HTTP state/begin/challenge/proof、Android 消费端、真实 Tailscale WhoIs/可信 socket 来源适配均已存在；`TailscaleAdmissionRuntime` 对挑战/已固定 node/key 做 pre-match 并对来源新鲜度、在线状态、socket 连续性检查 | 主业务 `AppModule` 把 admission runtime 设为 `null`；mutation 默认 503、snapshot 两种许可恒为 false。独立核验入口也明确给 revision/policy ports 传 `null`。无正式受控 policy writer、服务端单调 networkRevision 生产者或路径验证消费者。不能将 ETag/入网记录改作 revision | H2 补验 node/key pre-match、撤销/竞争边界、严格 HTTP 失败响应与默认关闭；全局 Tailnet 写规则及许可生产另列 H4/H5，需真实管理员路径、并发保护、逐禁止路径验证和可恢复证据后才可接线 |
| 执行许可、Artemis 与回执 | `action-permission-core` 规则、WP-11 持久 control journal、WP-13 受控准备 broker、WP-25/27 等执行前日志/核验组件各有有限工程证据；C3a 编排 API 明确未知启动不重试、模型回执不能自证发布 | 当前没有生产 Task 消费者、中央实时 action-permit/holder loader、逐动作物理 fence、生产 Artemis runner、任务文件准备串联及独立平台事实核验。C3a 端口默认 null/关闭；stop request 不等同手机停止 | 后端任务 producer、WP-11 实时权威 permit 及真实 Artemis 消费者必须作为依赖链分片；验收从真实 Web 发起，Artemis 自主观察决策，读回结构化回执。unknown 只核实原操作，不重发或宣称失败 |
| 人工反馈、效果和分佣 | 运营/提供者协助信息有实际服务路由；佣金计算核心、收入 journal/feed、追踪链接请求/重定向有有限持久实现 | 无外部平台指标的获准采集 producer、AI 复盘到下一轮有效计划的消费者；佣金算法或人工记录不证明真实来源归属、平台收入、可结算或到账 | 先验证用户反馈如何挂接原 Task/周期并转交复核，再补合法平台来源证据；佣金交付须来自原账号承接期及真实收入依据，不创建支付/提现行为 |

## 最新 H1～H7 复核与阻断去重

最新交接是 `network-admission-handoff-20261003.md`。它记录前置受限传输预检通过范围（Mac 和实际 Samsung 来源 9/9），并明确不等于本轮 HTTP/API、网络限制或业务执行通过。代码固定后新增 runtime node/key pre-match 只 typecheck，行为测试尚未重跑；这正是本轮 H2 的直接缺口。

| 编号 | 状态（本扫描） | 解除条件／范围 |
| --- | --- | --- |
| H1 | UX 持有，未由本工作树执行 | 手机脚本仅因 Android 16 `appId=` 与脚本 `userId=` 不兼容失败；先修并验证兼容，不清数据/不卸载主包。主会话持有真实 USB 操作 |
| H2 | 本工作树正在执行补验 | runtime 新的 pinned node/key 行为、会话撤销/竞争、严格响应/默认关闭，以及隔离 PG 回归；不应用策略、不创建真实许可 |
| H3 | UX 持有 | 产品入口从 Web→Playwright 验证设备事实/素材/草案页面；设备连接未知状态继续真实呈现，不得为 UI 增加未授权运营准入路由 |
| H4 | 外部依赖 | 管理员私有受控策略写配置路径尚未交付；预先准备具体草案、版本/ETag 防并发和回滚，不在聊天/仓库放密钥 |
| H5 | H4 后续后端/网络项 | 策略写入、限制路径探测和服务端 monotonic revision 生产未实现；不拿受限预检草案代替线上限制 |
| H6 | 执行/Android/OPS 后续 | 网络绑定正式通过后，继续当前许可、端点上报、端口变化、Wi-Fi/无 USB 重连；复用旧 Artemis 证据但标注范围 |
| H7 | 末端跨端交付 | 账号分配、App/Page 身份检查/创建编排与核心 Web→Artemis 业务就绪闭环；执行后需核验，发布最终步骤前停止，撤回不在本轮范围 |

去重后的当前阻断：**BE-NET-01（H4/H5）缺实际受控 Tailscale 写路径及 revision/path-check 生产能力**；**BE-BIZ-01** 真实素材来源/业务关系/权利证据及可输入的业务事实仍需 BIZ/用户提供；**BE-AI-01** 受控模型服务/版本/输入范围只能按当前真实配置确认，不能由兼容配置名称推定供应商或长期可用；**BE-PHONE-01（H1/H3）** Android UID 检查需要修正后才进入真实协议脚本，本会话不操作 USB；**BE-DEVICE-02** 第二台实体手机/双机光学扫码尚无资源。前四不重复拆成同一“全链路阻断”，其依赖释放前其他可隔离的后端行为检查仍可做。真实短信继续按 R-157 延期，不阻挡当前 H2/C2 编码；历史远程 Artemis 基础验证按 R-109 复用，不重新标为全未验证。

## H2 本轮实际验证

通过：`pnpm env:check` 发现 Node v24.16.0 与 SQLite 正常；`pnpm --filter @socialgrowth/product-contracts build` 及三份 contract generator check 通过；runtime/API/controller targeted tests **7/7**；backend TypeScript `check` 通过；backend lint exit 0，保留既有 `media-credential-key-custodian.test.ts` 两条 warning。

通过：隔离 PostgreSQL 17.11 新容器内，`network-admission-store.postgres-test.ts` **26/26** 通过，覆盖撤销等待、撤销与 proof 竞态、并发消费、唯一 node claim、回收及失败回滚。测试 schema 删除只发生于本轮新建容器中的测试库；未连接或更改 `socialgrowth-product-local-live`、真实账户、Enrollment 或 Tailnet。临时容器已停止并自动移除。

未运行：`scripts/run-network-admission-verifier-check.mts` 会读取真实私有配置并连接 `socialgrowth-product-local-live`，且启动 Tailscale Serve 入口；此 H2 候选不需要这些 live 副作用，故留给主会话在 H1/H3 条件确认后的 USB/受控入口验收。H2 不声明真实手机 11 项检查或完整 network API 已通过。真实策略应用、单调 revision 和动作许可仍保持关闭。

补充检查首次因工作树缺少 `tsx` 依赖与 contract `dist` 产物而启动失败；依仓库规范执行 `pnpm install --frozen-lockfile` 并先构建 contracts 后，以上可重复检查通过。未改锁文件。

## 最小后续候选

当前最小业务 producer 候选是“经服务器当前范围校验的已批准项目目标/方向 + 具备真实来源及权利声明引用的素材 candidate → 一条不可变的发布计划/Task/名额/outbox 事务”。它必须先确认素材候选前置、AI配置可用和人类批准事实，不应从现有草案默认出任务，也不应新建通用调度框架。任务契约应明确项目/计划/方向/素材版本、账号/设备分配版本、批准标识、时间窗口、原 request id 和 outbox event id；父范围不满足时应返回可解释拒绝并保持零写入。UX 当前确认 Web 的 DeviceFactsPanel 不暴露安装认证的准入 API，且没有所需跨端契约；无需为 H2/H1/H3 加新接口或降低运营权限。素材批准/计划 Task 新任务需要主会话先与 UX 协商最小现有页面消费点及依赖，再录入共享 ledger。
