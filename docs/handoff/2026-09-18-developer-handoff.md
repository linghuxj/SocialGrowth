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

## 一、 本次交接的核心架构铁律（开发前必读）

任何代码实现与重构严禁违背以下已确认的底座约束：

1. **执行底座锁定**：100% 采用 Google Artemis 纯物理真机池（首月 3~5 台，第 3 个月约 20 台），彻底废除模拟器矩阵；发布流程走原生 App 端到端 UI 自动化。
2. **平台范围收敛**：前期严格锁定为 Facebook (FB) 与 YouTube (YT) 双平台；Instagram (INS) 延后至运行稳定后再接入，代码中不得包含对 INS 的硬性运行依赖。
3. **账号设备绑定**：单台真机同一时期内严格只登录 1 个平台账号（1:1 设备账号强隔离），严禁同机多账号切换。
4. **素材排他机制**：漫剧切片经人工确认后，系统强制加注唯一目标账号独占锁（Exclusive Distribution Lock），严禁跨账号分发。
5. **双轨数据降级**：社媒数据优先官方 API，受限时无缝切换至第三方数据服务；A/B 策略评估器在缺失私有完播曲线时，必须能够降级为公开指标加权评分，禁止报错。

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
- **优先级**：P0（系统稳定性核心）
- **问题文件**：[`apps/artemis-controller/src/scheduler.ts`](../../apps/artemis-controller/src/scheduler.ts)、[`apps/artemis-controller/src/types.ts`](../../apps/artemis-controller/src/types.ts)
- **缺陷分析**：缺少对真机无响应、黑屏、系统弹窗（ANR、Google Play 更新、低电量弹窗）的超时防护。任务卡死会导致真机永久处于 `busy` 状态，阻塞后续所有发布。
- **开发要求**：
  1. 调度器对下发的每项自动化任务设置硬超时看门狗（默认 `taskTimeoutMs: 600000`，即 10 分钟）。
  2. 超时未收到回执时，调度器主动触发设备保底重置命令链：
     - `adb shell am force-stop <targetAppPackage>`
     - `adb shell input keyevent KEYCODE_HOME`
     - 捕获当前屏幕截屏保留为故障现场证据。
  3. 将当前任务置为 `failed`（原因：`TASK_EXECUTION_TIMEOUT_RECOVERY`），并将设备恢复为 `idle`（或若连续超时 3 次标记为 `error` 隔离待人工检查）。
- **验收标准**：单元测试模拟未响应任务，10 分钟（测试中可用可配置的微超时）后断言触发了保底命令并释放了设备状态。

#### [TASK-03] 清理模拟器类型定义与配置样例，纯粹化真机架构
- **优先级**：P1
- **问题文件**：[`apps/artemis-controller/src/types.ts`](../../apps/artemis-controller/src/types.ts)、[`apps/artemis-controller/config/devices.example.json`](../../apps/artemis-controller/config/devices.example.json)、[`apps/artemis-controller/README.md`](../../apps/artemis-controller/README.md)
- **开发要求**：
  1. 将 `DeviceType` 收敛为 `'physical'`（剔除 `'emulator'`）。
  2. 修正 `devices.example.json`，清理所有模拟器实例（如 `emu-pixel7-001`），改为纯物理真机配置样例（如 Samsung Galaxy S23 等），平台绑定仅保留 `["facebook", "youtube"]`。
  3. 更新 `apps/artemis-controller/README.md`，删除所有模拟器矩阵相关描述。
- **验收标准**：TypeScript 编译无错误，样例配置文件符合最新规范。

#### [TASK-04] 设计冷备换号时的 2FA 人工接管（HITL）交互协议
- **优先级**：P1
- **问题文件**：[`apps/artemis-controller/src/types.ts`](../../apps/artemis-controller/src/types.ts)
- **开发要求**：
  1. 在 `TaskStatus` 中扩展 `'waiting_human_takeover'` 状态。
  2. 在 `ExecutionReceipt` 中增加 `challengeType?: '2fa_sms' | '2fa_email' | 'device_verify'`。
  3. 当自动化脚本检测到平台 2FA 验证码输入界面时，自动挂起任务，截屏并向调度中枢上报事件，等待操作员通过 API/控制台注入验证码后再恢复执行。
- **验收标准**：类型定义完备，具备模拟 2FA 挂起与恢复的接口契约定义。

---

### 模块 B：AI 策略与规则引擎 (`services/ai-engine`)

#### [TASK-05] 落地切片排他独占锁（Exclusive Distribution Lock）机制
- **优先级**：P0（运营核心规则）
- **问题文件**：[`services/ai-engine/src/types.ts`](../../services/ai-engine/src/types.ts)、[`services/ai-engine/src/matching-engine.ts`](../../services/ai-engine/src/matching-engine.ts)
- **缺陷分析**：`SliceMetadata` 缺乏独占锁定与归属账号字段，匹配引擎未做过滤，同一短剧切片会被同时计算并推荐给多个账号。
- **开发要求**：
  1. 在 `SliceMetadata` 中增加排他状态与归属字段：
     ```typescript
     export type SliceAllocationStatus = 'unallocated' | 'assigned_locked' | 'published';
     
     export interface SliceMetadata {
       // ...既有字段
       allocationStatus: SliceAllocationStatus;
       assignedAccountId?: string;
       lockedAt?: string;
       publishedAt?: string;
     }
     ```
  2. 在 `TagMatchingEngine` 中增加前置排他校验：
     - 若 `slice.allocationStatus !== 'unallocated'` 且 `slice.assignedAccountId !== account.accountId`，直接跳过或返回匹配分 0 分（标记 `recommended: false, reason: 'ALREADY_LOCKED_OR_PUBLISHED'`）。
  3. 增加切片独占锁定与释放方法：`lockSlice(sliceId: string, accountId: string): void`。
- **验收标准**：单元测试断言已锁定的切片在对其他账号计算匹配度时被强制拦截。

#### [TASK-06] 补充第三方数据服务契约与 A/B 策略降级评分算法
- **优先级**：P1
- **问题文件**：[`services/ai-engine/src/types.ts`](../../services/ai-engine/src/types.ts)、新增 `services/ai-engine/src/third-party-analytics.ts`
- **开发要求**：
  1. 定义第三方数据采集服务标准化接口（适配社媒公开指标抓取服务）：
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
  2. 在 A/B 策略评估器中实现**指标降级评分算法**：
     - 当无法获取官方后台私有完播曲线时，自动回退采用公开指标加权评分：
       $$\text{PerformanceScore} = \Delta \text{Views} \times 0.7 + (\text{Likes} \times 1.5 + \text{Comments} \times 2.0) \times 0.3$$
     - 严禁因缺少 `completionRate` 字段抛出未捕获异常。
- **验收标准**：传入纯公开指标，评估函数正常输出胜出评分，单测通过。

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
