# 当前正式实现

核对日期：2026-10-07。依据 `dev` 中的正式源码，整理基线为 `3040899b368e9feaf91c509ea77319cf0c00841c`。用户随后明确要求“提交git”，本轮正式工程迁移、文档整理和手机网络准备改动按阶段保存到 `dev`；对应提交号以 Git 历史为准。`main` 的固定版本尚未包含本次整理。这里的“正式工程”指产品实现主线，不表示已发布或已通过整体业务验收。

## 代码与入口

| 部分 | 当前代码 | 作用 |
| --- | --- | --- |
| Web | [应用入口](../product/web/src/app.tsx) | React、TypeScript、Vite；运营登录及同一工作台 |
| Backend | [模块装配](../product/backend/src/app.module.ts) | NestJS；权限、中心事实、业务状态与接口 |
| Contracts | [契约导出](../product/contracts/src/index.ts) | Zod 源校验；生成 Kotlin／Python 消费规格 |
| Executor | [进程入口](../product/executor/src/main.ts) | 既有 Artemis 适配、SQLite 账本、人工协助及回执；独立设备 worker |
| Android | [Activity](../product/android/app/src/main/java/com/socialgrowth/product/MainActivity.kt) | Kotlin 原生；本人管理身份与本机安装身份分别验证 |
| 本地服务 | [服务组脚本](../scripts/product-local-live.mts) | 统一启动正式 Web、后端及配置的执行服务；保留数据库 |

Web 为 3100，后端为 4320，配置的执行服务为 4318。不存在另一个产品 Web。`pnpm dev` 不自动开启设备 Agent 或 worker。历史接口名和 SQLite 账本用于保持原任务，不构成另一套产品。

## 已有业务接线

以下是源码事实；操作按钮、类或接口存在不等于实际业务成功。

| 流程 | 当前实现 | 关键边界 |
| --- | --- | --- |
| 运营登录与账号 | `OperatorController`、`OperatorAuthService`、Web 账号页 | Cookie、CSRF、限流、停用与原操作人保留 |
| 邀请与提供者 | `InvitationManagementService`、`ProviderController`、Android 注册／登录 | 成功注册才消耗名额；开发验证码不代表真实短信 |
| 安装与关联 | `InstallationController`、`AssociationApiClient`、Android 本机关联／扫码 | 管理会话与安装身份分开；确认目标后关联，不自动认领旧安装 |
| 手机连接 | `NetworkSetupApi`、`DeviceConnectionApi`、`EndpointReportingService`、`AutomaticConnectionMonitor` | 内测节点核验与正式网络准入分别表达；自动连接不恢复业务参与或任务 |
| 控制与协助 | `DeviceControlService`、两端控制接口、协助待办及复查 | 受理暂停、停止派发、物理停止和交还控制分别记录 |
| 项目与资源 | `ProjectService`、规划／方向／周期／生命周期服务、`MediaAccountStore` | 独占分配、版本与批准范围；账号登记不等于 Page／频道核验 |
| 素材 | `MaterialRuntime`、上传／登记接口及 Web 素材面板 | 已确认元数据、对象引用与实际文件分别核对；未配置存储时关闭对应操作 |
| 业务 AI 与执行 | `ArtemisBusinessModel`、`BusinessPlanService`、工作流及 `BusinessPlanExecutionRuntime` | 实际模型和执行端口须显式配置；任务结果未知先查询原任务 |
| 效果与周期反馈 | `MetricSnapshotStore`、`PageMetricSource`、周期配置与推进服务 | 来源、单位、区间与关联须核实；无数据不是零，账号数据不强配到内容 |
| 引流与基础分佣 | `TrackingLinkService`、分佣核对及本人读取 | 默认装配不提供真实引流目标策略；核对记录不证明实际收入或付款 |
| 执行与人工协助 | [正式 Web 面板](../product/web/src/executor-console-panel.tsx)、[认证代理](../product/backend/src/executor-console-service.ts) | 固定路由、认证及 CSRF；浏览器不持有执行器令牌；凭据不保存为页面草稿 |

## 当前配置与待核实范围

[AppModule](../product/backend/src/app.module.ts)的装配是默认可用性的依据。`NetworkAdmissionApi` 的正式准入 runtime 仍为 `null`。内测网络连接实现不能代替这一正式准入链。`TrackingLinkService` 的真实目标策略仍为 `null`。

业务模型、素材存储、受控凭据、签名授权、执行运行时和 Page 指标来源均取显式配置。工作流消费器先以空端口构造；只有完整执行配置满足时，才安装运行时端口。不能沿用旧阶段文档的“从未接线”，也不能把条件接线写成默认可发布。具体配置见[后端说明](../product/backend/README.md)和[技术说明](technical-design.md)。

Android 已有单手机管理／执行入口、本机关联、准备引导和自动连接检查。已有系统权限、首次配对、网络恢复及手机生命周期分别核验；当前代码不证明零准备异地新手机已经全流程验收。最新范围见[自动连接记录](engineering/delivery/records/automatic-connection-20261006.md)及[新手机记录](engineering/delivery/records/new-phone-access-20261006.md)。

受控 Artemis 填密仍受[已记录的接线边界](engineering/delivery/records/r159-artemis-controlled-login-blocker-20261005.md)限制。历史[切片与效果复核](engineering/delivery/records/slice-page-feedback-revalidation-20261006.md)及[核心链路复核](engineering/delivery/records/core-chain-verification-20261006.md)保留当时的失败和未知结果。当前手机已通过订阅上网与远程管理共存验证，不使用 Macmini 出口；旧 FlClash 导入错误不再是当前网络结论。最新原 Page 核验、App 引导及业务阻断以[本轮核心链路记录](engineering/delivery/records/network-preparation-core-chain-20261007.md)为准。公开发布、指标及复盘仍未完整通过。

## 可使用的验证入口

```sh
pnpm env:check
pnpm check:product
pnpm lint:product
pnpm test:product
pnpm build:product
pnpm test:playwright
python3 docs/engineering/delivery/check_consistency.py
```

Playwright 的流程范围由 [runner](../scripts/run-playwright-target.mjs)定义，通过 `SG_PRODUCT_WEB_SCOPE` 选择；实际测试需要对应真实环境和输入。默认 `identity`，执行控制入口为 `executor-console`。补充单元、数据库及原生检查不替代真实 Web 业务验收。

最近迁移只验证了正式登录、原任务展示、表单拒绝、查询和退出。执行库 23 表内容摘要一致，保留 1 条历史未决中心工作流及原设备占用；没有重试、发布或伪造成功。证据见[迁移记录](engineering/delivery/records/demo-removal-migration-20261006.md)。

## 文档使用边界

[需求基线](current-requirements-summary.md)与[确认来源](requirements-alignment.md)保存有效要求。页面规格和验收矩阵是输入与目标，不是实现清单。固定候选审查及实测记录按[证据索引](engineering/delivery/records/README.md)追溯，不能当作当前操作手册或当前源码批准。文档清理不取消未实现需求，不关闭未决业务或验收门禁。

当前手机网络共存候选使用 SFA 的唯一 VPN、内置 Tailscale endpoint 与现有 FlClash 非 VPN 订阅代理。当前手机的在线节点、真实远程读取、已通过的 Android 平台连接检查及 FB/YT 共存 Web 验证见[网络共存记录](engineering/delivery/records/phone-network-coexistence-20261006.md)。新节点产品绑定、零准备设备引导与恢复场景分别验证，不从该候选推定正式业务验收完成。

2026-10-07 已把网络检查、订阅代理准备、人工 VPN 切换及共存核验登记到原执行库；Web 共存检查引用库指令。Android 本机准备新增第 4 步、客户端入口及失败恢复说明，检测到 SFA 后不恢复官方 Tailscale VPN。2026-10-08 候选已接入连接后的自动派发、可信安装与私有配置交付，生产开关默认关闭；实机初始化与新手机全流程尚未验收，见[连接后的初始化](specs/2026-10-08-phone-environment-initialization.md)。既有操作规则见[手机网络准备](specs/2026-10-07-phone-network-preparation.md)。用户已授权原系列切片正常发布，本轮无需引流地址；当前业务验收仍需原 Page 核验、真实发布与回执、指标及复盘。
