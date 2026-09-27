# 文档索引

更新：2026-09-27。当前基线已整理至 R-133。现有实现为 Demo 验证参考，旧代码、旧文档及演示结果不自动构成最终要求。

当前重点：设备接入与媒体执行、反馈改进的完整闭环。分佣与付款按 R-120 收敛为基础业务，已确认原则保留，暂不展开完整支付体系。业务主线及核心边界已对齐。当前已形成技术设计 0.1、Demo 与历史证据盘点及首轮验证步骤；用户选择实机资源暂按未确认处理，先完成本阶段设计。实际输入与落实时点见[验证推进安排](next-stage-plan.md)，不把待实测事项重新作为业务选择题。

## 当前产品文档

| 阅读顺序 | 文档 | 职责 |
| --- | --- | --- |
| 1 | [当前需求基线](current-requirements-summary.md) | 说明服务谁、做什么、必须遵守什么、哪些内容待验证 |
| 2 | [业务流程](business-workflow.md) | 说明运营、AI 与系统的职责，以及正常流转和异常处置 |
| 3 | [验收与证据](acceptance-plan.md) | 说明如何验证闭环、首期完整覆盖与关键边界，区分系统结果和商业结果 |
| 4 | [验证推进安排](next-stage-plan.md) | 汇总运行前输入、技术设计问题和验证顺序，不从 Demo 缺口倒推需求 |
| 5 | [首期技术设计](technical-design.md) | 将已确认需求落实为部署职责、数据与任务契约、控制及恢复方案；新增选型为设计建议 |
| 6 | [证据盘点与首轮验证](verification-readiness.md) | 记录 Demo 复用边界、当前资源状态和按顺序执行的增量验证步骤 |
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
