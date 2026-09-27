# 平台变现、引流与 Android 控制可行性核查

核查日期：2026-09-26。状态：官方资料核查，未执行实机或账号验证。研究建议与待选项不等于已确认需求；2026-09-27 用户按 R-106 明确选用 Artemis，其他部署及适配方案仍待验证。

## 变现能力

| 项目 | 官方信息 | 对项目的影响 |
| --- | --- | --- |
| YT 广告分成 | 1,000 订阅，以及过去 12 个月 4,000 有效公开观看小时，或过去 90 天 1,000 万有效公开 Shorts 观看；仍需审核与其他条件 | 按发布形式分别跟踪资格进度，达到数值不等于开通 |
| 扩展 YPP | 500 订阅、90 天内 3 次有效公开上传，另加相应观看门槛，较早开放粉丝资助及 Shopping | 加入 YPP 不一定取得广告分成资格 |
| FB Content Monetization | Meta 2026 年 3 月公告仍采用邀请制，可在专业面板表达兴趣 | 核验目标 Page 的邀请、审核及开通状态，不能自定义统一粉丝数等于开通 |

来源：[YT 资格](https://support.google.com/youtube/answer/72851?hl=en)、[扩展 YPP](https://support.google.com/youtube/answer/13429240?hl=en)、[Meta 公告](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/)。公告中的 Creator Fast Track 是特定计划，不能把其外部粉丝门槛视为所有 Page 的通用条件。

受众区域不等于频道经营或收款主体所在地。实际账号的适用地区、收款配置、计划模块与资格证据仍待核验；东南亚和美洲受众本身不足以确定变现资格。

YT 的重复利用内容审核独立于版权许可：获得原作者许可也不自动满足原创性要求。公司制作与客户供稿需分别核验来源、制作参与关系和频道呈现。不能推定客户供稿都不能变现，也不能推定授权且未发布就一定可变现。首期仍不自动增加剪辑制作。来源：[YT 变现政策](https://support.google.com/youtube/answer/1311392?hl=en)；另见[跨平台复用研究](cross-platform-content-reuse.md)。

已确认（R-067）：首期短剧来自公司或客户原创、委托制作，可提供制作来源证明；实际材料尚未核验，不能据此将平台变现资格标为已通过。

## 引流入口与归因

| 入口 | 核查结果 | 对项目的影响 |
| --- | --- | --- |
| YT Shorts 简介、评论 | URL 不可点击 | 填入短链不能算完成可点击引流 |
| YT 频道个人资料 | 链接可点击 | 可作账号入口；共享入口的日志无法独立证明来自哪条 Shorts |
| YT 常规视频简介、评论 | 可点击外链需要频道高级功能 | 核验频道能力及观众实际点击路径 |
| Shorts 关联视频 | 可点击，指向站内视频 | 不是直接站外入口；该方案还需现成配套视频及后续外链 |
| FB Page 图文、视频/Reels | 本轮证据不足以确认所有目标位置的链接能力 | 按实际 Page、客户端、内容形式验证，不能从图文外推全部视频入口 |

来源：[YT 链接能力](https://support.google.com/youtube/answer/13748639?hl=en)。链接仍需符合平台外链政策。

已确认（R-066）：允许按账号统计，内容归因以证据为准。分别记录链接的配置关联和点击可证明的来源；内容来源不明时保持未知，不按发布时间或最近发布视频强行分配，AI 不据此评价单条视频的引流效果。

用户已选择：首期 YT 同时支持 Shorts 与常规视频，按已有成品和目标选择，不增加剪辑制作范围（R-065）。素材规格与平台分类规则另行核验，不能靠任务标签任意指定形式。统计原则已按 R-066 确认；Shorts 具体引流路径仍待验证。

## 原厂 Android 控制与远程接管

| 层面 | 官方信息 | 对项目的影响 |
| --- | --- | --- |
| 操作与截图 | AccessibilityService 有手势派发接口，API 30 起有屏幕截图接口，需相应能力声明 | 有无 Root 的候选技术基础，但不保证所有 App 页面可控，也不据此确定支持版本 |
| 持续画面共享 | MediaProjection 每次新会话须请求同意；Android 14 起强化单次令牌约束；Android 15 QPR1 起锁屏自动停止投屏 | 不能承诺一次同意永久投屏，需验证会话结束与锁屏后的恢复 |
| Google Play 分发 | Play 禁止应用使用 Accessibility API 自主发起、规划及执行操作或决策；固定的人为规则脚本另有规定 | 按客户端实际职责及是否使用该 API 判断适用性，不能由整个系统含 AI 操作推断注册、状态类客户端必然不可上架。商店政策与系统能力分别评估，App 分发方式尚未选定 |
| 管理网络 | VPN 不赋予屏幕读取或触控权限 | 控制、画面、授权、接管互斥和恢复分别验证 |

来源：[AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)、[MediaProjection](https://developer.android.com/media/grow/media-projection)、[Play Accessibility 政策](https://support.google.com/googleplay/android-developer/answer/10964491)、[网络研究](vpn-mdns-device-connectivity.md)。

截图式观察与持续投屏是不同候选方式。前者不能证明远程操作流畅，后者不能假定无人值守恢复。均须遵守无 Root、无现场网关、限定机型版本及必要现场协助的已确认边界。

## 下一步验证（未执行）

1. 记录实际 Page/频道所属变现计划、平台状态、资格证据、功能及采集日期。按 R-131，核实正式开通且已有批准的开通后目标时自动切换该账号运营阶段；其他资格异常交运营，不把数值达标或审核中当成开通。具体来源字段和采集方式仍需验证，不要求先建立完整资格状态模型。
2. 以产品与短剧真实成品核验制作来源、发布形式和可点击入口；没有入口时不能以填写 URL 代替验证。
3. 从观众侧检查链接可见、可点、跳转与统计过滤，记录可证明的项目、账号或内容归因粒度。
4. 在候选原厂手机验证授权、输入、手势、画面、接管互斥，覆盖锁屏、网络切换、后台回收、重启与权限撤销。
5. 在实际部署网络验证管理连接和 FB/YT 上网同时可用，再验证真实执行及恢复；局域网演示不能证明分散部署稳定。

本文不代表已采购、安装、启动服务或真实发布，也不代替其执行授权。


## Artemis 执行层补充核查（2026-09-27）

状态：用户按 R-106 明确确认首期采用 Google Artemis，随后按 R-109 补充确认既有远程执行此前已验证。原研究未独立执行实机测试，不应因此把用户已有验证记为未通过；后续复用原证据，重点补查网络共存及新增客户端。

- 官方仓库为 [google/artemis](https://github.com/google/artemis)。Artemis 根据自然语言任务驱动 Android，内部模型参与界面观察和动作决策；并非只执行外部 AI 提供的固定点击序列。[官方说明](https://github.com/google/artemis/blob/main/README_CN.md)
- 官方 MCP 提供任务启动、状态管理及设备观察工具，支持向执行引擎提交任务。[MCP 文档](https://github.com/google/artemis/blob/main/mcp_server/README.md)
- 官方运行说明展示主机连接 Android，并由设备主机承担 ADB、Agent 等工作；这只能说明官方示例的部署方式。项目既有远程执行已由用户确认验证完成，应整理原拓扑与覆盖条件；网络共存、新客户端和未覆盖的恢复能力另行验证。[运行与 SDK 说明](https://github.com/google/artemis/blob/main/README_CN.md)

本仓库 Demo 的 [MCP 适配](../../services/execution-runtime/src/artemis.ts)会启动 Artemis 并检查工具；[设备执行入口](../../services/execution-runtime/src/device-executor.ts)通过 `mobile_run_task` 传入设备、任务描述及预期结果。这是局部代码事实，不证明真实链路已通过，也不构成最终选型。

已确认分工（R-106）：业务 AI 决定发布对象、内容、时机与获准操作；Artemis 的执行 AI 处理手机界面判断和具体动作；SocialGrowth 维护项目、权限、任务、接管与结果记录。执行结果仍按业务证据核验，不能直接以引擎返回完成替代平台事实。Artemis 已确认为首期执行引擎，但不能把整套 Demo 架构随之自动确认为最终方案。若分散接入无法满足既定要求，依据证据重新对齐，不自动更换引擎。
