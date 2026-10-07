# 运营平台复审后的第二轮完善（2026-10-05）

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本轮在 `22f0bada5d49e75c63c07926fcec0ea743f5d0df` 的真实事实总控修复上继续推进。新增内容均服务于“运营能理解当前状态、知道下一步、保留原操作”，不将 Demo 页面或补充检查作为全产品验收。

## 已实现

- 排期与任务页面接入真实 `business-plan/current-checks` 读取：明确缺失、过期、素材变化、设备控制、参与和网络等条件及已有处理入口。读取失败保留历史标记，不能变成就绪；原尝试仅为逻辑预留，未开始手机执行。旧会话的迟到结果和 401 不会退出替换后的登录。
- 项目概览及总控汇总当前任务检查，账号分配与手机入口通过现有导航可达。
- 初始化核验区显示真实核验时间与资源版本，区分运营资源核对与执行端/证据链路待接入。读失败禁止提交，读取不会替换原任务；网络失败后保留同一正文和幂等键，导航切换不会自动重发。写入更新共享事实；卸载和会话切换阻止迟到结果污染页面。
- 可信报告可携带严格、可选 `metricDefinition`（名称、单位、说明、来源口径）。仅可信 resolver 提供，没有运营输入/补填接口。旧报告兼容且不补写；同一来源报告修订链的全部定义元数据不可改变。页面展示真实口径，缺少名称或单位时明确未知，不解释为播放量、收入或可比结果。
- 修复 viewport 脚本中的失效标题、旧单元格和固定夹具项目名；移动端断言真实执行许可内容及实际边界。更正概览第三列移动端标签为“处理入口”。统一在应用入口加载任务检查样式，保持现有 Node 检查可执行。

## 实际验证与边界

环境：项目 `pnpm env:check` 为 Node v24.16.0 / SQLite OK；Web 为本轮启动的 127.0.0.1:3100，使用原已运行 backend 127.0.0.1:4320。没有修改原数据库或通过接口、DB、Mock 预置浏览器业务成功。

| 检查 | 结果 | 证据/范围 |
| --- | --- | --- |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=operations pnpm test:playwright` | 11 项通过 | 真实工作台、总控、导航、结构化输入、读取失败/恢复、真实 logout 401、390px；业务写入 0 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=operations-completion pnpm test:playwright` | 6 项通过 | 真实条件读取/失败恢复，已有初始化任务的执行条件核验、同请求接续、刷新持久回执、资源入口和390px |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=project-viewports pnpm test:playwright` | 通过 | 真实已有项目，1465/980/700/390px，无页面溢出，手机能完整看见关闭的执行许可；登录以外不写入 |
| Web 原有补充测试 | 89/89 | 单元/静态渲染检查，不替代 Playwright |
| contracts build/generate-check、契约 4/4、历史核心 10/10 | 通过（backend 同伴） | 旧格式兼容、严格元数据与修订不变性 |
| metric-snapshot-store PostgreSQL | 6/6（lead） | 独占临时 postgres17.11-alpine:45439，历史元数据持久化/读取、权限、原子回滚；仅补充后端检查，不是平台真实报告采集 |
| Web build / backend check / Web lint / diff-check | 通过 | Lint 原有 reserved 未使用警告；bundle 原有 >500kB 提示 |
| Impeccable 检测与截图人工检查 | 无主要发现 | 两条12px字号建议；真实桌面和手机截图保存 |

独立证据在 `output/playwright/operations-complete/`（未作为源码提交）：`result.json`、`completion-result.json`、各 scope 日志、`metrics-postgres.log`、构建与补充测试日志、08/09/10截图及 viewports 目录。浏览器脚本保留在 `scripts/`。登录凭据未写入证据，不启用包含输入值的 trace。

完成的 completion 脚本本次有两个 execution-review 请求尝试：第一个由 UI 发起并注入传输中断、未到服务器，第二个携带同一正文与幂等键抵达服务器，保存阻断核验。之前调试运行也曾保存此原任务的阻断核验；均为追加核验记录，无手机派发、身份创建或公开发布。完整页面刷新未重发写入。

## 未完成的业务能力

- 当前真实项目为 **0 个排期任务**，已验真实无任务状态和检查读取失败/恢复。非空任务、过期分配等逐任务 UI 未获真实业务数据验收，不能由字段与代码覆盖推定已通过。
- 当前正式 backend 没有可信指标 resolver / report adapter 接线；新增元数据透传与存储补充检查不代表已经从 Facebook / YouTube 采集到报告，也不代表历史报告自动获得口径或已可复盘。
- USB Android `RFCW40MYYCV` 状态为 device，仅证明当前连接。初始化服务仍要求当前 task scope、手机 holder/lease、逐动作许可、可信平台证据 consumer 和原操作核实，受控 Artemis 工具链没有在正式入口接通。本轮真实核验继续返回 blocked / dispatchCreated=false；未以 USB 状态绕过这些事实。
- 未运行模型、未手机安装/登录/身份创建、未公开发布、未验证自动恢复与最终回执闭环。复用 R-109 历史远程执行证据的范围，不将其说成全未验证。

## 独立复审

UX 独立候选 `18c15292bbaf8d8f5ad922d291bb5d5505e6d1a0` 和 backend `4bc771525a6d15d8370b7acc70fc72c4e76c67e9` 已获 adversary exact-SHA 审查批准。原 `22f0bad` 的 OPS-SEC-01 是 viewport 脚本回归，本轮已修并通过真实多宽度验证。最终集成候选仍需单独按精确 SHA 审查，不能用同伴批准替代。

本轮结束只关闭本轮启动的 Web 与临时 PG；保留原 backend，不创建 PR 或部署。
