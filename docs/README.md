# 文档索引

更新：2026-09-29。当前基线已整理至 R-156。现有实现为 Demo 验证参考，旧代码、旧文档及演示结果不自动构成最终要求。

当前重点：设备接入与媒体执行、反馈改进的完整闭环。分佣与付款按 R-120 收敛为基础业务，已确认原则保留，暂不展开完整支付体系。业务主线及核心边界已对齐。主要架构已按 ADR-0001～0011 确认，技术设计已校准为 0.2 开发实施基线；具备进入整体开发、分批实现与验收的条件。已有单机局部实测，正式产品工程尚未搭建，本次先完成文档校准。实际输入与落实时点见[验证推进安排](next-stage-plan.md)，不把待实测事项重新作为业务选择题。

按 R-141，Android 设计进入收敛：先完成受邀接入、设备状态与协助、暂停／恢复／退出及基础分佣，暂停扩展账号、找回工单与提醒渠道；已有图稿不等于首期全部必做。

当前开发准入判断见[2026-09-29 复核](development-readiness-audit-2026-09-28.md#当前复核2026-09-29)，同文保留 2026-09-28 的原审查快照。后续已确认 R-142：退出管理登录不影响执行手机；R-143：分配前接入事项复用全局待办，由邀请运营作为初始联系人。R-144 已确认临时暂停或掉线不打断承接期间；R-145 已确认首次承接从初始化及身份核验通过、具备执行条件时开始；R-146 已确认永久退出以系统受理并停派时点结束承接；R-147 已确认无人承接期间收益保留为公司收入、不计提供者分佣。本轮四项分佣边界已确认；交接生效事实与收入数据粒度的匹配仍须在真实计佣前落实，技术及实测缺口仍按对应交付时点处理。

Tailscale 与 ADB 实施细节正在收敛：R-148 已确认系统核验后自动准入、异常交运营；R-149 已确认手动系统配对码及多台独立会话并发；R-150 已确认正常端口变化不逐次提醒，恢复失败或需人工才提醒。技术设计已补充端点上报、版本校验、重连及待办契约草案；已进一步形成[接入实施草案](device-connectivity-implementation.md)，包含节点绑定方案、访问矩阵、接口和候选参数；R-151 已确认先开放专用核验连接、核验通过后再正式准入，并补充许可升级与回收状态；具体技术路径仍待原型及实机验证。

2026-09-28 晚间实测：[真机网络记录](connectivity-verification-2026-09-28.md)已取得 Tailscale IPv6 ADB 连接与身份核对证据，IPv4 TCP 在该样本仍超时，完整新接入流程尚未验证。[Android 端点发现诊断原型](../prototypes/android-endpoint-probe/README.md)已安装到 S23；中心恢复连接后，在无 USB 的样本中完成新一轮本机端口发现与 IPv6 ADB 身份核验。报告仍经已有 ADB 通道取回，正式客户端与认证上报、多机及后台尚未完成，详见分轮记录。

## 开发执行与质量监督

已形成[开发分工与质量执行手册](engineering/delivery/README.md)：工程审查、30 个工作包、跨端契约清单、分阶段质量门禁、61 组验收场景、R-001～R-156 追踪表、进度台账及记录模板。用于开发任务领取、跨端交接、评审和验收；目前正式任务仍待实名分配，文档不代表产品已实现或测试通过。

## 当前产品文档

最新推进安排：用户将设备认证／端口上报／受控重连闭环移到模块开发过程中测试验证，暂不继续单独推进；当前按已确认架构和首批契约推进工程落实，控制及接入契约随对应模块细化。已有实测证据保留，未覆盖能力不因此记为通过，详见[推进安排](next-stage-plan.md)。2026-09-29 已确认首批先交付运营邀请、提供者登录、逐台关联及两端状态可见，见[首批任务与验收](next-stage-plan.md#首批身份与设备归属交付2026-09-29)；R-152 已确认同一邀请多人可用、次数及有效期可配置，不绑定手机号或增加注册审批；R-153／R-154 已确认内部运营采用系统独立账号＋密码，R-155 已确认首个账号部署初始化、后续运营页面开通／停用；R-156 要求辅助能力简化、优先业务闭环，停用只撤销访问，其他同权运营沿用全局待办代办，不新增交接流程。

| 阅读顺序 | 文档 | 职责 |
| --- | --- | --- |
| 1 | [当前需求基线](current-requirements-summary.md) | 说明服务谁、做什么、必须遵守什么、哪些内容待验证 |
| 2 | [业务流程](business-workflow.md) | 说明运营、AI 与系统的职责，以及正常流转和异常处置 |
| 3 | [验收与证据](acceptance-plan.md) | 说明如何验证闭环、首期完整覆盖与关键边界，区分系统结果和商业结果 |
| 4 | [首期交付与验证推进安排](next-stage-plan.md) | 首批身份归属闭环、Android 六组核心交付项、完成判据、按交付时点落实的依赖及整体验证顺序，不从 Demo 缺口倒推需求 |
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
| 已确认实施决策 | [ADR-0011：正式实现与 Demo 同仓库分目录维护](adr/0011-product-and-demo-in-one-repository.md) | 保留当前仓库与历史证据，正式代码独立目录；工程布局见技术设计，尚未搭建脚手架 |
| 6 | [证据盘点与首轮验证](verification-readiness.md) | 记录 Demo 复用边界、当前资源状态和按顺序执行的增量验证步骤 |
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
