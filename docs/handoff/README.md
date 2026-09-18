# SocialGrowth 研发交接台账与状态看板 (Handoff Tracker)

> 本目录用于归档所有阶段性交接任务书、审计整改清单及交付状态追踪。  
> **核心目标**：明确“哪些已完成、哪些待开发、由谁负责、验收依据为何”，防止跨团队协作中的重复沟通、遗漏与重复处理。

---

## 一、 交接文档索引 (Handoff Documents)

| 文档名称 / 归档路径 | 交接时间 | 交接主题 | 当前状态 | 负责人 |
|---|---|---|---|---|
| [2026-09-18 研发交接与审计整改任务书](2026-09-18-developer-handoff.md) | 2026-09-18 14:20 | 纯真机底座、1:1绑定路由、切片排他锁、双轨数据降级等 10 项核心整改 | **已交接，待研发执行** | 架构师 / 研发组 |

---

## 二、 全局事项状态总览表（已完成 vs 待完成）

### 1. 已完成交接事项（Completed & Delivered）
以下事项已经完成方案审计、产品运营对齐并正式落盘为规范基线，**严禁再次重复讨论或反向推翻**：

| 事项编号 | 事项名称 | 交付物 / 落地文件 | 状态 | 达成时间 | 关键结论与交付内容 |
|---|---|---|---|---|---|
| **DONE-01** | 执行底座纯粹化 | [`docs/delivery-specification.md`](../delivery-specification.md) | ✅ 已完成 | 2026-09-18 | 确立 100% Google Artemis 纯真机池，彻底废除模拟器与虚拟化。 |
| **DONE-02** | 平台范围阶段性收敛 | [`docs/platform-rules.md`](../platform-rules.md) | ✅ 已完成 | 2026-09-18 | 前期只做 FB + YT 双平台；INS 待稳定后再行接入。 |
| **DONE-03** | 设备与账号规模收敛 | [`docs/monthly-delivery.md`](../monthly-delivery.md) | ✅ 已完成 | 2026-09-18 | 明确首月 3~5 台物理真机（6~10 个账号），前 3 个月扩展至约 20 台物理真机（约 40 个账号）。 |
| **DONE-04** | 1:1 设备账号强隔离原则 | [`docs/delivery-specification.md`](../delivery-specification.md) | ✅ 已完成 | 2026-09-18 | 单台真机同一时期内严格只登录 1 个账号，禁止同机多账号切换。 |
| **DONE-05** | 独占切片分发机制确认 | [`docs/business-requirements.md`](../business-requirements.md) | ✅ 已完成 | 2026-09-18 | 切片由人工确认后加锁，绝不出现同一切片跨账号重复分发。 |
| **DONE-06** | 双轨数据采集策略确认 | [`docs/delivery-specification.md`](../delivery-specification.md) | ✅ 已完成 | 2026-09-18 | 确立官方 API 优先、第三方数据服务全量保底的双轨采集策略。 |
| **DONE-07** | Monorepo 工程结构搭建 | [`README.md`](../../README.md) | ✅ 已完成 | 2026-09-18 | 完成 `apps/`、`services/`、`scripts/`、`artifacts/` 目录组织与脚手架。 |
| **DONE-08** | 全局工程规范与开发准则确立 | [`CLAUDE.md`](../../CLAUDE.md) | ✅ 已完成 | 2026-09-18 | 确立最高开发指南，明确禁止主动启动后台服务，索引架构五大铁律。 |
| **DONE-09** | 系统底层技术架构补强 | [`docs/delivery-specification.md`](../delivery-specification.md) | ✅ 已完成 | 2026-09-18 | 增补第 7 章：持久化存储 Schema、真机 WebSocket Pull 通信、磁盘清理、凭据安全、短链防封。 |
| **DONE-10** | 子模块工程文档补全与纯化 | [`apps/web-console/README.md`](../../apps/web-console/README.md)<br>[`apps/artemis-controller/README.md`](../../apps/artemis-controller/README.md) | ✅ 已完成 | 2026-09-18 | 补齐 Web 控制台说明；Artemis README 彻底剔除模拟器并发布声明式 UI 动作流契约。 |
| **DONE-11** | 容量测算模型与报告全面重构 | [`artifacts/data/3至20台真机设备-前三个月发布与准入测算.md`](../../artifacts/data/3至20台真机设备-前三个月发布与准入测算.md) | ✅ 已完成 | 2026-09-18 | 重构 `calc_launch_capacity.py`，生成 3~5 至 20 台真机数据，归档旧报告。 |

---

### 2. 待开发执行事项（Pending Development - 来自 2026-09-18 交接）
以下事项为代码、脚本与外围交付物层面的具体研发待办任务，需研发团队在代码分支中执行修改，严禁遗漏：

| 任务编号 | 所属模块 / 目录 | 优先级 | 任务内容与缺陷描述 | 当前状态 | 责任角色 | 对应详细规范 |
|---|---|---|---|---|---|---|
| **TASK-01** | `apps/artemis-controller` | **P0** | 任务调度器重构：增加 `(platform, accountId)` 精准路由，禁止跨账号串号派发 | 🔴 待开发 | Artemis 研发 | [TASK-01 规范](2026-09-18-developer-handoff.md#task-01-修复任务调度器的设备路由逻辑严格落实-11-账号强绑定) |
| **TASK-02** | `apps/artemis-controller` | **P0** | 端侧看门狗：增加 10 分钟硬超时与 `am force-stop` + Home 键自愈强杀机制 | 🔴 待开发 | Artemis 研发 | [TASK-02 规范](2026-09-18-developer-handoff.md#task-02-实现真机端执行硬超时watchdog与保底自愈强杀机制) |
| **TASK-03** | `apps/artemis-controller` | **P1** | 清理代码与样例配置中残留的 `emulator` 类型，纯化真机配置 | 🔴 待开发 | Artemis 研发 | [TASK-03 规范](2026-09-18-developer-handoff.md#task-03-清理模拟器类型定义与配置样例纯粹化真机架构) |
| **TASK-04** | `apps/artemis-controller` | **P1** | 冷备换号 2FA 交互：支持检测 2FA 挂起任务并接收人工输入验证码恢复 | 🔴 待开发 | Artemis 研发 | [TASK-04 规范](2026-09-18-developer-handoff.md#task-04-设计冷备换号时的-2fa-人工接管hitl交互协议) |
| **TASK-05** | `services/ai-engine` | **P0** | 落地切片排他独占锁（Exclusive Lock），匹配引擎前置过滤已占用切片 | 🔴 待开发 | 后端研发 | [TASK-05 规范](2026-09-18-developer-handoff.md#task-05-落地切片排他独占锁exclusive-distribution-lock机制) |
| **TASK-06** | `services/ai-engine` | **P1** | 补充第三方数据抓取接口契约，并在缺少完播率时降级为公开互动指标评分 | 🔴 待开发 | 后端研发 | [TASK-06 规范](2026-09-18-developer-handoff.md#task-06-补充第三方数据服务契约与-ab-策略降级评分算法) |
| **TASK-07** | `services/shortlink-service` | **P2** | 平台枚举收敛至 FB/YT，增加针对 YT Shorts 描述不可点的主页归因标记 | 🔴 待开发 | 后端研发 | [TASK-07 规范](2026-09-18-developer-handoff.md#task-07-平台枚举收敛至-fb-与-yt保留-ins-扩展预留) |
| **TASK-08** | `scripts/analytics` | **P1** | 重构 `calc_launch_capacity.py`，生成 3~5 台至 20 台真机发布测算数据 | ✅ 已完成 | 数据脚本研发 | [TASK-08 规范](2026-09-18-developer-handoff.md#task-08-重构发布容量与准入测算脚本scriptsanalyticscalc_launch_capacitypy) |
| **TASK-09** | `scripts/ceo_report` | **P1** | 修正 `build_report.py` 中的旧数据（30/90号），重新生成正式 Word 汇报 | 🔴 待开发 | 工具研发 | [TASK-09 规范](2026-09-18-developer-handoff.md#task-09-修正-ceo-汇报-word-文档构建脚本scriptsceo_reportbuild_reportpy) |
| **TASK-10** | 根目录文档 | **P2** | 更新 `README.md` 架构拓扑图与正文，删除模拟器并收敛平台为 FB+YT | ✅ 已完成 | 全栈研发 | [TASK-10 规范](2026-09-18-developer-handoff.md#task-10-修正根目录顶层工程导航readmemd) |

---

## 三、 防重复处理机制与状态流转规则 (Anti-Duplication SOP)

为杜绝后续协作中再次出现“反复审计相同问题”或“代码与文档重复返工”的现象，团队必须执行以下规则：

1. **认领与状态更新**：
   - 开发者开始执行某项任务时，需将本表中对应状态修改为 `🟡 进行中 (In Progress)`，并标注认领人与分支名；
   - 提交 PR 并通过自测后，修改为 `🟣 待验收 (In Review)`；
   - 产品/架构验收通过并合入主干后，修改为 `✅ 已完成 (Completed)`，并填入合入 Commit ID。
2. **唯一可信数据源（Single Source of Truth）**：
   - 本看板为开发整改状态的唯一可信源，后续交接均以本看板为准；
   - 凡是在“已完成事项”中的既定结论，任何人员不得再行提出推翻或重新论证；
   - 若出现新增需求或外部变更，必须通过生成新的带时间戳交接任务书（如 `docs/handoff/YYYY-MM-DD-xxx.md`）并在本看板新增记录，严禁私下口头变更。
