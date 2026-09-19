# SocialGrowth 研发交接与审计整改任务书 (2026-09-18)

- **交接日期**：2026-09-18 14:20:00 (Asia/Shanghai)
- **交接版本**：v1.0-20260918
- **交接责任人**：系统架构师 / 审计组
- **接收责任人**：服务端研发团队、Artemis 自动化研发团队、数据与工具研发
- **关联总控看板**：[交接状态总览与追踪清单 (README.md)](README.md)
- **基线规划文档**：
  - [系统交付规格说明书 (docs/delivery-specification.md)](../delivery-specification.md)
  - [年度月度交付表 (docs/monthly-delivery.md)](../monthly-delivery.md)
  - [业务需求与技术规划 (docs/business-requirements.md)](../business-requirements.md)
  - [全局术语与边界约定 (CONTEXT.md)](../../CONTEXT.md)

---

> **2026-09-19 当前解释**：本文件保留既有 TASK 编号及实现背景，不是完整产品路线。商业设备/账号数量不限制开发容量、方式或启动；产品能力依赖见[产品路线](../product-roadmap.md)，当前业务边界见[决策记录](2026-09-19-business-flow-proposal.md)。下列代码/类型示例、缺陷判断和实现状态本轮未复验；与当前业务规则不同处由后续实现任务同步，包括运行时策略提示词。

## 一、 本次交接的核心架构铁律（开发前必读）

任何代码实现与重构严禁违背以下已确认的底座约束：

1. **执行底座锁定**：100% 采用 Google Artemis 纯物理真机池（首月 3~5 台，第 3 个月约 20 台），彻底废除模拟器矩阵；发布流程走原生 App 端到端 UI 自动化。
2. **平台范围收敛**：前期严格锁定为 Facebook (FB) 与 YouTube (YT) 双平台；Instagram (INS) 延后至运行稳定后再接入，代码中不得包含对 INS 的硬性运行依赖。
3. **账号设备绑定**：单台真机同一时期内，每个平台仅绑定 1 个账号（可分别承载 FB 与 YT），禁止同一平台多账号切换；绑定不保证平台不会关联账号。
4. **素材排他机制**：漫剧切片经人工确认后，系统强制加注唯一目标账号独占锁（Exclusive Distribution Lock），严禁跨账号分发。
5. **双轨数据与评价（G-05 已修订）**：官方/第三方逐指标核验；来源切换与缺失原因可见，主指标不可用时不能静默换评分宣布改善。完整合格试验可有无改善/证据不足结论，必需工作缺失不算闭环通过，不能强制输出赢家。

---

## 二、 待开发整改任务清单（待办详情）

> [!IMPORTANT]
> 以下任务按优先级排列，研发人员需在特性分支（如 `feature/audit-remediation-baseline`）上逐项实现并完成单元测试覆盖。严禁本地环境主动启动常驻服务。

### 模块 A：Artemis 执行控制端 (`apps/artemis-controller`)

#### [TASK-01] 修复任务调度器的设备路由逻辑，严格落实 1:1 账号强绑定
- **优先级**：P0（阻塞性 Bug）
- **问题文件**：[`apps/artemis-controller/src/scheduler.ts`](../../apps/artemis-controller/src/scheduler.ts)、[`apps/artemis-controller/src/device-pool.ts`](../../apps/artemis-controller/src/device-pool.ts)
- **缺陷分析**：`scheduler.ts` 中仅使用 `getAvailableDeviceForPlatform(task.platform)` 寻找任意空闲设备，未匹配 `task.accountId`。若真机 A（已登录账号 FB-01）接收到账号 FB-02 的任务，将直接在 FB-01 的 App 界面上错发 FB-02 的切片与文案，造成串号错发与风控关联封禁。
- **开发要求**：
  1. 在 `DevicePool` 中实现 `getAvailableDeviceForAccount(platform: PlatformType, accountId: string): DeviceInfo | undefined`。
  2. 匹配逻辑：
     - 设备当前状态为 `idle`；
     - 设备 `platformBound` 包含目标 `platform`；
     - 设备 `boundAccounts` 列表中明确包含当前 `accountId`。
  3. `scheduler.ts` 调用该精准匹配方法；若对应真机处于 `busy` 或离线，任务在队列中等待，不得跨设备借调。
- **验收标准**：提供 `scheduler.test.ts`，模拟 2 台真机分别绑定不同账号，并发下发 4 个不同账号任务，断言每个任务仅分发至其专属绑定的真机上。

#### [TASK-02] 实现真机端执行硬超时（Watchdog）与保底自愈强杀机制

> **2026-09-19 G-04a 业务修订**：技术超时、人工等待与发布结果必须分开。原“超时即失败并释放设备”的描述不能作为发布未发生或业务可自动恢复的依据；非值守继续有效批准内且确认无关联的安排，需人工处理的异常暂停受影响及关联范围，未知发布结果不重试或释放内容。恢复须核对异常、结果、授权和排期，过期不补发。下列技术参数与命令保留为原交接背景，不替代当前业务规则；本轮未执行开发或测试。

- **优先级**：P0（系统稳定性核心）
- **问题文件**：[`apps/artemis-controller/src/scheduler.ts`](../../apps/artemis-controller/src/scheduler.ts)、[`apps/artemis-controller/src/types.ts`](../../apps/artemis-controller/src/types.ts)
- **缺陷分析**：缺少对真机无响应、黑屏、系统弹窗（ANR、Google Play 更新、低电量弹窗）的超时防护。任务卡死会导致真机永久处于 `busy` 状态，阻塞后续所有发布。
- **开发要求**：
  1. 调度器对下发的每项自动化任务设置硬超时看门狗（默认 `taskTimeoutMs: 600000`，即 10 分钟）。
  2. 超时未收到回执时，调度器主动触发设备保底重置命令链：
     - `adb shell am force-stop <targetAppPackage>`
     - `adb shell input keyevent KEYCODE_HOME`
     - 捕获当前屏幕截屏保留为故障现场证据。
  3. 记录执行超时并保留必要证据；原 `failed`/`idle` 标记不能表达平台发布结果和业务暂停范围，需按 G-04a 分别核对后处理。
- **业务验收补充**：超时后的资源处置记录不能单独证明恢复正确；还需证明未知结果未重发/释放、关联任务暂停、无关联且批准有效的安排可继续、人工核对后恢复且不补发过期任务。原仅验证命令与设备释放的标准不足以作为业务验收。

#### [TASK-03] 清理模拟器类型定义与配置样例，纯粹化真机架构
- **优先级**：P1
- **问题文件**：[`apps/artemis-controller/src/types.ts`](../../apps/artemis-controller/src/types.ts)、[`apps/artemis-controller/config/devices.example.json`](../../apps/artemis-controller/config/devices.example.json)、[`apps/artemis-controller/README.md`](../../apps/artemis-controller/README.md)
- **开发要求**：
  1. 将 `DeviceType` 收敛为 `'physical'`（剔除 `'emulator'`）。
  2. 修正 `devices.example.json`，清理所有模拟器实例（如 `emu-pixel7-001`），改为纯物理真机配置样例（如 Samsung Galaxy S23 等），平台绑定仅保留 `["facebook", "youtube"]`。
  3. 更新 `apps/artemis-controller/README.md`，删除所有模拟器矩阵相关描述。
- **验收标准**：TypeScript 编译无错误，样例配置文件符合最新规范。

#### [TASK-04] 设计冷备换号时的 2FA 人工接管（HITL）交互协议

> **适用前提**：身份验证不只发生在换号时。先核对登录/恢复权限，区分受托 TOTP、短信/邮箱验证码和平台风险挑战；禁止把所有挑战当作可自动绕过的 2FA。冷备账号须独立核验许可与授权，账号终止不自动转为换号继续运营。

> **G-04a 业务边界**：非值守允许等待人工，通知不等于接管；验证挑战过期重新处理，身份验证完成也不代表平台限制解除。恢复前核对发布结果、授权及排期，不沿用过期安排。

- **优先级**：P1
- **问题文件**：[`apps/artemis-controller/src/types.ts`](../../apps/artemis-controller/src/types.ts)
- **开发要求**：
  1. 按[执行契约 design-v1](../engineering/execution-contract.md)采用独立技术状态 `executionStatus: 'waiting_human'`，不以此推定发布结果；旧 `waiting_human_takeover`/`waiting_2fa` 命名不再作为目标契约。
  2. 回执另带 `publishStatus`、证据引用及 `challengeType`（短信、邮箱、设备验证、平台限制或其他）；字段条件以同一契约为准，避免各文档复制不同枚举。
  3. 当自动化脚本检测到平台 2FA 验证码输入界面时，自动挂起任务，截屏并向调度中枢上报事件，等待操作员处理验证；注入验证码后仍须按 G-04a 核对限制、发布结果、授权与排期，经确认后恢复，不把验证完成直接等同业务恢复。
- **验收标准**：目标契约已定义不等于实现通过；实现测试须覆盖[离线场景 T-05/T-08/T-09](../engineering/offline-verification.md)，验证挑战完成不能直接恢复未知结果或过期排期。

---

### 模块 B：AI 策略与规则引擎 (`services/ai-engine`)

> **2026-09-19 G-04 业务补充**：自主托管只自动处理已验证且已授权范围内日常执行；新策略小批试验先经人工批准，列明假设、版本、范围、发布量/预算、期限、观察及停止条件。启动不等于验证有效或可自动扩大，不能因账号成熟绕过本次批准；原任务开发状态不变，详见[决策记录](2026-09-19-business-flow-proposal.md#8-逐项确认与整改记录)。

#### [TASK-05] 落地切片排他独占锁（Exclusive Distribution Lock）机制

> **2026-09-19 业务规则补充（G-03 系列）**：同一画面片段的字幕/配音语言版本共用内容身份和账号归属。审批后取消原安排，确认全部版本均未提交、无发布历史且旧批准与执行安排失效后可释放；新分配重新审核。进行中、已提交或结果未知不释放，已发内容不跨账号复用，原账号也不得重发；同一内容只选一个语言版本发布一次，删除原帖不恢复资格。编辑原帖、确定从未发布后的恢复与重发分别判断，重复发布不增加合格交付量。G-03c 允许不同切片必要的少量剧情衔接，须人工确认主体剧情不同并记录片段、重叠范围及依据后才可分别发布；重叠关系不等于同一身份，不能靠语言变化或轻微改剪绕过一次发布。下列目标设计用于后续实现；文档修复不表示源码、数据库或测试已经完成。详见[当前确认记录](2026-09-19-business-flow-proposal.md#8-逐项确认与整改记录)。

- **优先级**：P0（运营核心规则）
- **问题文件**：[`services/ai-engine/src/types.ts`](../../services/ai-engine/src/types.ts)、[`services/ai-engine/src/matching-engine.ts`](../../services/ai-engine/src/matching-engine.ts)
- **当前状态**：B-02 旧示例已修订；TASK-05 应用实现与验收仍待完成。
- **已核实差距**：AI 源码的 `SliceMetadata` 尚无统一内容身份/归属，匹配仍只算标签分；前端另有旧文件级锁。文档中的错误同账号放行条件已移除，不能以任一旧层作为完整业务实现。
- **开发要求**：
  1. 以[数据模型 design-v1](../engineering/data-model.md)为唯一目标关系，文件引用共同内容身份；类型示意如下（不是已合并的源码接口）：
     ```typescript
     type AllocationStatus = 'unallocated' | 'reserved' | 'assigned_locked';
     type PublishStatus = 'not_submitted' | 'in_progress' | 'unknown'
       | 'confirmed_not_published' | 'published';
     interface ContentIdentity {
       contentIdentityId: string;
       allocationStatus: AllocationStatus;
       assignedAccountId?: string;
       firstPublishedAt?: string;
     }
     interface SliceAsset {
       sliceId: string;
       contentIdentityId: string;
       language: string;
     }
     interface PublicationAttempt {
       attemptId: string;
       contentIdentityId: string;
       sliceId: string;
       accountId: string;
       publishStatus: PublishStatus;
       evidenceRefs: string[];
     }
     ```
  2. 匹配先校验身份/权利/归属及当前资格，再给合格候选评分；已发历史对原账号也拦截。进行中/未知不能形成第二份可执行安排，明确失败后的原账号恢复另经人工确认。
  3. 批准/分配以内容身份为原子边界核对归属版本和全部尝试，不能靠单文件 `lockSlice(sliceId, accountId): void` 提供并发保障。
  4. 释放必须核实全部语言版本均未提交、无发布历史，且旧批准及全部在途安排失效；失败、超时、删除、退出均不能作为通用解锁条件。
- **验收标准**：按[离线规格 T-02 至 T-07](../engineering/offline-verification.md)验证跨语言竞争、同账号重发、合法取消、未知结果及明确失败恢复；核对前端、AI、数据库和执行层一致性。原“只断言其他账号匹配被拦截”不足以通过本任务。


#### [TASK-06] 补充第三方数据服务契约与 A/B 策略降级评分算法

> **2026-09-19 G-05 业务修订**：本任务历史标题保留用于追溯，当前要求为数据可用性与可信评价，不再要求缺主指标时输出降级胜出评分。下列早期字段示例不证明实际来源均可提供；字段缺失、零值、延迟和授权问题须区分，来源变化需展示和复核比较资格。任务开发状态不变。

- **优先级**：P1
- **问题文件**：[`services/ai-engine/src/types.ts`](../../services/ai-engine/src/types.ts)、新增 `services/ai-engine/src/third-party-analytics.ts`
- **开发要求**：
  1. 定义第三方数据采集服务标准化接口（适配社媒公开指标抓取服务）：
     > 下列是历史公开字段示例，不是当前完整可用性契约；目标观察结构及零值/缺失/延迟/无权限/来源切换样例见[离线验证规格](../engineering/offline-verification.md)，真实字段需供应商证据。
     ```typescript
     export interface PublicMetricData {
       platform: 'facebook' | 'youtube';
       externalPostId: string;
       views: number;
       likes: number;
       comments: number;
       shares: number;
       capturedAt: string;
     }
     
     export interface ThirdPartyAnalyticsProvider {
       fetchMetrics(platform: 'facebook' | 'youtube', externalPostIds: string[]): Promise<PublicMetricData[]>;
     }
     ```
  2. **当前评价要求（G-05）**：按试验前批准的主指标、单位、来源、观察窗及证据判据评价；无改善、证据不足和必需工作未完成分别报告，不能用另一评分代替缺失主指标。早期公开播放/互动混合公式已被本规则替代。
- **业务验收标准**：按真实证据分别验证比较条件、来源变化、缺失分类、结果及适用范围；公开数据可用不必然能判断原目标胜出。完整合格试验与复盘可验收闭环，缺必需执行、采集或评价记录则不通过；策略有效、增长目标和推广许可另列。此处仅修订文档，不代表测试或实际供应商验证已完成。

---

### 模块 C：导流短链服务 (`services/shortlink-service`)

#### [TASK-07] 平台枚举收敛至 FB 与 YT，保留 INS 扩展预留
- **优先级**：P2
- **问题文件**：[`services/shortlink-service/src/types.ts`](../../services/shortlink-service/src/types.ts)
- **开发要求**：
  1. 统一 `PlatformType` 类型定义为 `'facebook' | 'youtube' | 'instagram'`，但在短链分发与校验配置中，默认只对 `facebook` 和 `youtube` 激活路由分析；
  2. 针对 YouTube 导流短链增加“主页链接/长视频说明”归因追踪标记（因为 Shorts 描述区链接不可点击）。
- **验收标准**：编译通过，短链能够正确标识 FB 帖文短链与 YT 频道主页链接。

---

### 模块 D：计算脚本与外部交付成果物 (`scripts/` & `artifacts/`)

#### [TASK-08] 重构发布容量与准入测算脚本 (`scripts/analytics/calc_launch_capacity.py`)

> **后续修订 v2.1（2026-09-19）**：修正配套MD的108观看分母及3,420计划库存，JSON补独立内容字段并重生成；本地检查与待审状态见[复核记录](2026-09-19-audit-verification.md)。下列“已完成”为原重构记录，不表示新修订已合并或实测。
- **优先级**：P1
- **当前状态**：✅ **已完成 (2026-09-18)**
- **问题文件**：[`scripts/analytics/calc_launch_capacity.py`](../../scripts/analytics/calc_launch_capacity.py)
- **交付内容**：
  1. 批次已重构为最新 3~5 台（6~10 号）、第 2 月 8~10 台（16~20 号）、第 3 月 20 台（40 号）纯真机基线；
  2. 脚本运行重新生成 [`artifacts/data/前三个月发布测算-数据.json`](../../artifacts/data/前三个月发布测算-数据.json)；
  3. 新建权威配套报告 [`artifacts/data/3至20台真机设备-前三个月发布与准入测算.md`](../../artifacts/data/3至20台真机设备-前三个月发布与准入测算.md)，并将原 15~50 台旧报告标记为历史归档。

#### [TASK-09] 修正 CEO 汇报 Word 文档构建脚本 (`scripts/ceo_report/build_report.py`)
- **优先级**：P1
- **当前状态**：🟡 **文本已修正，待生产环境生成 docx**
- **问题文件**：[`scripts/ceo_report/build_report.py`](../../scripts/ceo_report/build_report.py)
- **开发要求**：
  1. 修正第 74 行、第 124-125 行文字：
     - 首期平台：Facebook、YouTube 双平台验证，首月 3~5 台真机（共 6~10 个账号）；第二月爬坡至 8~10 台真机；第三个月约 20 台真机（约 40 个账号）。
     - 验收材料：双平台真实发布与执行记录、短链统计、独占切片排他流。
  2. 运行 `build_report.py` 重新生成正式交付物：[`artifacts/reports/SocialGrowth年度技术规划与预算汇报.docx`](../../artifacts/reports/SocialGrowth年度技术规划与预算汇报.docx)。
- **验收标准**：文本无“三平台 30/90 账号”历史残留。

#### [TASK-10] 修正根目录顶层工程导航 (`README.md`)
- **优先级**：P2
- **当前状态**：✅ **已完成 (2026-09-18)**
- **问题文件**：[`README.md`](../../README.md)
- **交付内容**：
  1. 平台描述已收敛为 Facebook / YouTube 双平台，Instagram 待稳定后接入；
  2. 拓扑图彻底清除模拟器，改为纯物理真机设备池，并增补 PostgreSQL、Redis、S3 基础设施层与 WebSocket/gRPC Pull 通信管道；
  3. 补齐 `shortlink-service` 启动指引与 `CLAUDE.md` 开发纪律引用。
