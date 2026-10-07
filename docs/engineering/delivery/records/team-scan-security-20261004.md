# 团队安全扫描 — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

范围：固定基线 `f583f184891bd3d0406c43821cb3d36e2eb1233a` 的需求、10月3日交接、权限/未知恢复/秘密/来源与执行边界。审查者 `/root/adversary`，独立工作树 `SocialGrowth-agent-worktrees/adversary`、分支 `codex/team-adversary`。本记录完成 SCAN-SEC 盘点条件，不构成候选提交安全批准或全产品验收。

## 已核对的当前边界

| 范围 | 当前代码及证据 | 后续验收条件 |
| --- | --- | --- |
| 网络准入 | `network-admission-api.ts`、store、`tailscale-admission-runtime.ts`、`tailscale-source-verifier.ts`；主业务 AppModule 注入 runtime=null，状态读取与注册/挑战/证明许可分开。opaque socket、真实 WhoIs、node/key、独立 revision 与新鲜度交叉校验；f583f18 的 pinned node/key 增量尚缺行为重跑 | H2 固定候选补验 node/key 变化、关闭连接、过期/撤销安装会话、并发锁等待和来源超时；缺真实 ports 保持关闭。仅旧35/35不能覆盖提交后新增行为 |
| 当前网络隔离 | 10月3日只读控制面报告明确已有无附加条件的全网 grant，窄规则叠加不能抵消 | H4/H5 的实际受控变更必须依据新鲜策略、并发保护和恢复方案；真实路径验证覆盖独立核验入口、ADB、其他手机和业务出口。当前只读来源验证不是网络隔离通过 |
| 动作许可与停止 | `preparation-action-broker.ts` 只允许原 inspect_app 的 read_screen；外部只读观察在SQL锁外，重新锁定后比对当前scope及有效期，重放不发新ticket。`phone-action-fence.ts` 有持久占用/停止代次/原操作回执，unknown 保留占用 | 生产接线不能将body布尔值、USB在线、历史准入或超时当许可。raw ADB/Artemis 绕过fence的路径尚未证明被覆盖。进程退出不等于手机停止，旧回执不能重新授权 |
| 初始方向与模型 | `project-direction-service.ts` 鉴权/CSRF、幂等原键、调用前后snapshot核对，确认保留不可变proposal，response明确executionAllowed/publicationAllowed=false。`artemis-business-model.ts` 仅服务端选择路径，限制输出、固定错误类别并忽略stderr | 后续Task生效须重新核对批准、素材/身份/设备当前事实及窗口；模型输出本身不授予权限。模型输入与日志不能引入凭据或将外部文本作为执行指令。真实模型已用旧证据验证，不代表完整调度完成 |
| 凭据与追踪链接 | AppModule 的 MediaCredentialStore custodian=null，TrackingLinkService policy=null；无真实配置继续关闭 | 真实受控配置、当前许可及真实目的地接入独立补验；不可用临时测试key/目标或未知body配置伪造生产就绪 |
| unknown与发布 | 10月3日交接保留原unknown publication及6个identity unknown，暂不测试撤回 | 先核实原任务和对应平台对象，不换新键重复创建/提交；本轮用户授权团队开发/USB/启动服务，不自动扩大公开发布或撤回范围 |

## 延续已有问题，避免重复记录

- **SEC-WP14-01**：沿用同名记录。候选令牌有效性、轮换与日志访问处置尚无已关闭证据；未读取/diff/hash/运行受保护发布脚本，也未读取或测试秘密值。后续任何依赖该候选凭据的真实执行仍依赖原记录解除条件。隔离凭据和不依赖它的工程可继续。
- **WP-10 原13/P3来源复验**：沿用 `WP-10-review-blocker.md`；未因本轮新来源测试通过而清零原固定来源finding，未改窗口/模型绕过旧平台限制。当前H2是明确的新候选增量审查，不替代旧13组。
- **H1/H2/H3**：沿用 `network-admission-handoff-20261003.md` 的去重ID。H1 UID解析失败、H2后增行为未复跑、H3服务未运行导致Web拒连，均不推定为产品已验收。独立团队整改后逐项保存固定候选证据。

## 本轮结果与候选门禁

- 通过：独立只读扫描上述固定代码与文档，已将当前实际边界直接告知lead、ux和backend；没有新增已复现的代码漏洞结论。
- 失败：复用记录中的H1/H3历史失败，不声称本轮重新触发。
- 阻断：实际受限策略/修订生产者、原SEC和WP10对应解除条件；只阻断依赖它们的具体真实执行或旧链签结论。
- 未验证：本轮没有运行Web、真机、真实策略写入、模型请求、公开发布或撤回；没有签署全系统安全或业务验收。

后续每个候选独立任务须发送完整base/head SHA、实际diff范围、已同意契约revision和验证证据。adversary只审查、不编写被审代码；对精确head回复 approved / changes_requested / blocked。编写者在其任务的security_review记录reviewer、SHAs、结论、finding和证据，任何代码变化使旧批准失效。无需额外审批层；不将安全批准扩展为未经执行的Playwright、手机、网络或发布通过。
