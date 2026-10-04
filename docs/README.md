# 文档索引

更新：2026-10-04。当前需求确认至 R-159。正式工程已在 `product/` 分目录实现多个有限切片，整体开发、业务验收和生产部署仍未完成；Demo 与历史记录只按原证据范围复用。

开发先读[当前需求基线](current-requirements-summary.md)，再读相关业务／技术说明、[交付手册](engineering/delivery/README.md)及对应工作包、契约和验收要求。确认来源以[修订记录](requirements-alignment.md)最新条目为准；阶段报告的“当前”“下一步”仅对应其记录日期和固定候选。

账号管理与 Artemis 辅助登录已经按 R-159 对齐：[当前账号交接](engineering/delivery/records/media-accounts-web-handoff-20261004.md)是此范围的开发入口，[执行库说明](specs/2026-10-02-account-preparation-execution-library.md)说明 Page／频道准备与登录边界。同手机同平台一个公司预申请登录账号，同登录账号一台执行手机；真机管理账号为提供者 App 身份。登记必填登录标识及密码，核验资料可选。[当前实施与验收](engineering/delivery/records/media-accounts-r159-20261005.md)记录页面、数据库及源码验证；Artemis 实际工具与观察隔离仍未接通，不能把受控输入组件当成真实登录完成。

最新已保存的整合收尾见[2026-10-04 第五批记录](engineering/delivery/records/team-integration5-20261004.md)：该批实际 Web 验收失败、交付暂停，不得引用旧成功声明；这是固定快照，不代替共享任务台账或运行前核对。[全范围扫描](engineering/delivery/records/team-rescan-20261004.md)也仅按记录版本定位证据与缺口。

## 开发执行与质量监督

[开发分工与质量执行手册](engineering/delivery/README.md)保留工作包、契约、门禁、验收场景和需求追踪。实际任务所有者及状态按仓库 AGENTS.md 指定的 Git common 目录旁共享 `tasks.json` 读取；文档台账用于工作包汇总和证据定位，不另建立进度系统。

## 当前产品文档

下表列出当前规则和模块说明；标为“历史”的规划／盘点只供追溯，不作为当前环境状态或直接执行旧步骤的许可。

| 阅读顺序 | 文档 | 职责 |
| --- | --- | --- |
| 1 | [当前需求基线](current-requirements-summary.md) | 说明服务谁、做什么、必须遵守什么、哪些内容待验证 |
| 2 | [业务流程](business-workflow.md) | 说明运营、AI 与系统的职责，以及正常流转和异常处置 |
| 3 | [验收与证据](acceptance-plan.md) | 说明如何验证闭环、首期完整覆盖与关键边界，区分系统结果和商业结果 |
| 历史规划 | [首期交付与验证推进安排](next-stage-plan.md) | 2026-09-29 的批次原则与准备阶段记录；实际开发与验收状态读取交付手册和固定候选记录 |
| 当前账号实施 | [媒体账号管理实施与验收](engineering/delivery/records/media-accounts-r159-20261005.md) | R-159 实施、固定候选通过结果及真实手机／Artemis 阻断；原交接为历史快照 |
| 当前执行说明 | [发布身份准备与执行库](specs/2026-10-02-account-preparation-execution-library.md) | R-158／R-159 的已申请账号登录、Page／频道准备及真实执行边界；其中阶段检查链接仅供追溯 |
| 4a | [首批业务流程与最小契约](first-delivery-flow.md) | 邀请、登录、逐台关联及状态可见的正常流、失败接续、数据与接口职责和完成判据，辅助功能按最小方案落实 |
| 5 | [首期技术设计](technical-design.md) | 0.2：已接受的架构决策、运行职责、数据与任务契约、控制及恢复方案；具体组件与参数随模块落实 |
| 5a | [Tailscale 与 ADB 接入实施草案](device-connectivity-implementation.md) | 节点绑定、R-151 受限核验接入边界、动态端口策略、接口、联调参数及分步验证；尚未部署 |
| 已确认实施决策 | [ADR-0001：正式实现与 Demo 复用边界](adr/0001-separate-product-implementation-from-demo.md) | 建立正式实现主线，保留 Demo 和历史证据并按需复用；主要技术方向见后续已接受 ADR，物理部署随实施落实 |
| 已确认实施决策 | [ADR-0002：业务后端与手机执行边界](adr/0002-modular-business-backend-independent-execution.md) | 业务按模块集中组织，手机执行独立进程，Android 独立客户端；物理部署另行确定 |
| 已确认实施决策 | [ADR-0003：正式中心业务采用 PostgreSQL](adr/0003-postgresql-for-central-business-data.md) | 从首批开发采用 PostgreSQL，保留 Demo SQLite；手机本地存储、数据库托管另行落实，队列方向见 ADR-0006 |
| 已确认实施决策 | [ADR-0004：中心后端采用 TypeScript＋Node.js](adr/0004-typescript-node-central-backend.md) | 确认中心业务后端语言及运行时，Artemis 保持独立 Python 引擎；后端框架见 ADR-0009，Web 方案见 ADR-0010，正式版本另行落实 |
| 已确认实施决策 | [ADR-0005：Android 采用 Kotlin 原生方案](adr/0005-kotlin-native-android-client.md) | 确认客户端技术方向；UI 框架、支持系统版本及后台策略另行落实，接入闭环继续在开发中验证 |
| 已确认实施决策 | [ADR-0006：手机任务采用独立派发队列](adr/0006-independent-task-dispatch-queue.md) | PostgreSQL 保持业务事实权威；组件选择见 ADR-0007，可靠投递机制待落实；设备互斥及恢复边界保持 |
| 已确认实施决策 | [ADR-0007：队列采用 Redis＋BullMQ](adr/0007-redis-bullmq-task-queue.md) | 执行适配层消费队列并调用 Artemis；版本、持久化与可靠投递机制待落实 |
| 已确认实施决策 | [ADR-0008：可配置 S3 与本地 MinIO](adr/0008-configurable-s3-storage-local-minio.md) | 正式文件使用 S3，本地开发使用 MinIO，环境配置连接；对象引用与权限由业务数据库管理，兼容性分别验证 |
| 已确认实施决策 | [ADR-0009：中心业务后端采用 NestJS](adr/0009-nestjs-central-business-backend.md) | 组织模块化业务后端；HTTP 底层及数据访问组件另行落实，Web 方案见 ADR-0010 |
| 已确认实施决策 | [ADR-0010：Web 采用 React＋TypeScript＋Vite](adr/0010-react-typescript-vite-operations-web.md) | 浏览器渲染并调用 NestJS 接口；路由、数据请求及 UI 组件随实现落实，真实 Web 验收使用 Playwright |
| 已确认实施决策 | [ADR-0011：正式实现与 Demo 同仓库分目录维护](adr/0011-product-and-demo-in-one-repository.md) | 保留当前仓库与历史证据，正式代码独立目录；工程布局见技术设计；实现及验收状态另查固定候选记录 |
| 历史盘点 | [证据盘点与首轮验证](verification-readiness.md) | 2026-09-27～29 的环境、原型及资源快照；不能用来判断当前是否有 App、连接或服务 |
| Web 已确认方向与设计建议 | [Web 运营工作台 UI 与交互](workbench-ui-alignment.md) | 依据当前业务与 DESIGN.md 范式，对齐工作顺序、页面内容及交互；未确认建议不覆盖需求基线 |
| Android 已确认方向与设计建议 | [设备提供者 App 设计与业务流程](android-app-alignment.md) | AND-001～009 已确认管理与接入边界、手机号验证、自助现场处理、首页第 1 版视觉方向、邀请方式按 R-152 修订为多人限次限期、本机暂停及人工找回；R-141 要求收敛首期 |
| Android 页面草案 | [App 页面与交互规格](android-app-page-spec.md) | 0.8：邀请按 R-152 支持多人限次限期；保留首期接入、状态、协助与控制、基础分佣，完整账号能力暂不展开 |
| Android 设计规范 | [Android DESIGN.md](design/android/DESIGN.md) | 0.5：沿用所选方向及现有组件，明确首期范围；数值待原生验证 |
| Android 视觉稿 | [首页与关键页面图稿](design/android/README.md) | 已选择第 1 版；保存原候选、后续修订、提示词及生成偏差 |
| 设计对齐稿 | [DESIGN.md](../DESIGN.md) | 当前以 UI-001～UI-012 和 UI-014 为准：首页并列、浅色设备与接管稿；UI-013 的 Demo 大屏方向已留档 |
| 页面规格草案 | [Web 工作台页面规格](workbench-page-spec.md) | 0.9：主要页面、项目控制、跨页状态及可点击原型范围；方向确认沿用 R-017 |
| 流程核对 | [跨页面流程与状态](workbench-flow-consistency.md) | 同一任务在首页、项目、设备、复盘等页面的语义与返回路径，供后续原型与真实验证 |
| 视觉稿与预览 | [工作台视觉稿索引](design/workbench/README.md) | 主要页面及暂停/恢复/结束图稿、提示词与生成偏差；Demo 大屏探索为历史参考 |
| 可点击设计原型 | [原型与检查说明](design/workbench/prototype/README.md) | 17 个视图、9 组 Playwright 原型检查及截图；未连接真实业务 |
| 参考 | [业务术语](../CONTEXT.md) | 统一业务名词，不承载技术方案 |

## 来源与研究

[需求确认与修订记录](requirements-alignment.md)保留讨论来源和修订关系；较早的未决描述不覆盖后续确认。[旧版归档](../archive/2026-09-25-before-realignment/ARCHIVE.md)仅供历史追溯。

| 研究记录 | 用途 |
| --- | --- |
| [素材识别与业务关联](research/content-understanding-and-association.md) | 后续技术参考；R-125 已确认首期人工处理，形成标准后再接入 AI |
| [跨平台内容复用](research/cross-platform-content-reuse.md) | 核查 FB/YT 内容复用的规则与未知影响 |
| [VPN 与 mDNS](research/vpn-mdns-device-connectivity.md) | 复用既有执行验证，核查 Tailscale/Clash 共存、客户端端口通知及恢复限制 |
| [平台与 Android 可行性](research/platform-and-android-feasibility.md) | 核查变现、引流入口、原厂手机控制与接管限制 |
| [效果数据时间粒度](research/effect-data-time-granularity.md) | 核查观察窗口与来源统计区间的匹配条件 |

研究结论以记录日期和证据范围为限；候选技术与建议不等于选型。Demo 文件、工程 fixtures、prompts 和旧测试只用于现有验证程序，不构成新需求。工程操作仍遵循 [AGENTS.md](../AGENTS.md) 与 [CLAUDE.md](../CLAUDE.md)。
