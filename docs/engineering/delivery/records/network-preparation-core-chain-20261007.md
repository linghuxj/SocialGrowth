# 网络准备固化与核心链路续验：2026-10-07

依据 R-164。从 `dev` 工作目录继续，整理基线为 `3040899b368e9feaf91c509ea77319cf0c00841c`。用户于 2026-10-07 随后明确要求“提交git”，本轮正式产品迁移、文档整理及网络准备改动按阶段保存；提交号以 Git 历史为准。该指令不表示完整链路验收通过，不晋级 `main`。运行环境为项目 Node 24.16.0，SQLite 检查通过。

## 已完成的改动

- 原执行库增加检查网络客户端、准备订阅代理、人工 VPN 切换、共存核验四项定义。正式 Web 共存检查引用库指令。网络安装与私有配置交付的通用消费者仍缺失，不能声称新手机全自动部署完成。
- 正式 Android 本机准备增加业务上网第 4 步、SFA／FlClash 入口和断线恢复说明。安装 SFA 后不自动恢复官方 Tailscale VPN，不用安装状态代表运行或入网。首次关联、系统授权与 ADB 配对仍交用户。
- 修复原操作恢复中的 trace 覆盖：终态写入保留最新实际启动 trace，只有启动回调可替换 trace。避免旧快照覆盖新核验或内容阶段记录。原 operation 和未知结果未清空。
- 用户授权使用之前的切片系列正常公开发布，当前不需要引流地址。真实 Web 读取原《将门逆子》素材，objectId 为 `443193fb-5c6f-4346-bac2-6e03edc2842d`；没有替换文件或另建项目。

完整操作和流程图见[手机网络准备](../../../specs/2026-10-07-phone-network-preparation.md)。仅固化已知阶段和失败处理，不把现有 Samsung 的结果外推为零准备新手机。

## 核心链路状态

| 节点 | 本轮结果 |
| --- | --- |
| 项目及原系列切片 | 真实 Web 核对通过，原字节记录和名称保留 |
| 引流地址 | 用户明确本次无需配置，正常发布 |
| FB／YT 安装状态 | 经远程 metadata 检查已安装，FB 581.0.0.45.58、YT 21.37.42；未重装，不作为新手机首次安装验收 |
| 现有手机网络共存 | 复用已通过的[真实 Web／远程 Artemis 证据](phone-network-coexistence-20261006.md) |
| 新 App 网络指引 | 通过：远程原位更新后，Web 发起 Artemis 真机检查，最终 6 passed、0 failed、0 inconclusive、0 unchecked。检查包含 SFA 入口、无重复领取密钥、切换与恢复说明、当前平台连接 |
| 原 Page 核验 | 原 operation `0ef94113-c6de-4171-b873-fd0c2bf62b53` 已通过真实 Web 顺序接续。最新 trace `7f363c53-2fe9-4285-8db3-b8582d6a6302` 达到 15 分钟上限，SDK cancelled、原操作 unknown；管理关系检查已通过，稳定 Page ID 尚未确认，未进入素材准备或发布 |
| 公开发布及回执 | 尚未通过。当前项目桥仅 preflight，正式监督权限禁止公开发布 |
| 指标采集、分析与复盘 | 当前 Web 指标来源 unknown、0 行报告、采集 not_started；无可信复盘读取，不当作真实零值 |
| Git | 按用户最新指令保存 dev 阶段提交；整个核心业务未通过，未晋级 main、未创建发布标签 |

## 工程检查与复现

Android `assembleDebug` 通过，debug API 保留原 Tailnet HTTPS 入口；原会话和关联数据未清除。debug 更新不等于正式签名发布或新手机安装验收。

contracts 构建及生成检查、executor 与后端类型检查、51 项相关单元检查、修改文件 lint 和 `git diff --check` 通过。新增 trace 回归检查只使用内存 SQLite，不连接手机或伪造业务结果。

用户要求 Git 阶段保存后，补充运行 `pnpm check:product`、`pnpm lint:product`、`pnpm build:product`，均退出 0；lint 保留既有警告，Web 构建保留体积警告。执行器单元检查 187 项通过，Web 单元检查 89 项通过。文档一致性检查覆盖 1474 个本地链接，错误数为 0。

`pnpm test:product` 全量运行未通过：后端 443 项中 442 项通过，ADB 配对测试在 1000 毫秒边界内返回 unknown。单独复跑该文件 4 项均通过；没有修改超时、断言或业务代码，仍保留这次全量失败，不宣称全量测试通过。上述工程检查不替代真实 Playwright、真机及完整业务验收。运行日志保存在本地 `.runtime/git-save-20261007/`，运行配置、数据与原始输出不进入 Git。

```sh
SG_PRODUCT_WEB_SCOPE=network-coexistence \
SG_NETWORK_CHECK_KIND=pilot-coexistence-guide \
SG_PHONE_NETWORK_REMOTE_SDK=127.0.0.1:56153 \
SG_NETWORK_COEXISTENCE_OUTPUT=output/playwright/network-coexistence-20261007/app-guide \
pnpm test:playwright

SG_PRODUCT_WEB_SCOPE=core-chain-status \
SG_PRODUCT_CORE_QUERY_ORIGINAL=1 \
SG_PRODUCT_CORE_PROJECT_NAME='获准原文件字节验收-1791208369573' \
SG_PRODUCT_CORE_CONTENT_NAME='将门逆子' \
SG_PRODUCT_CORE_OUTPUT=output/playwright/core-chain-20261007/authorized-clip \
pnpm test:playwright
```

第二条真实 Web 检查通过，业务修改数为 0。输出中 `coreChainAccepted=false` 是完整验收未通过的事实，不因用户新授权或工程检查而改为成功。

现有业务绑定仍指定 USB serial RFCW40MYYCV；网络指引与共存检查使用远程 serial 127.0.0.1:56153。两者为同一手机，任务顺序执行，不用两种 serial 绕开单机独占。

新指引 job `d4643ea7-af94-4eab-b6a7-f92c4bde9d09`，trace `1f02f8e8-d107-45b9-a062-815a52774a56`，Web 实际显示 `CONNECTIVITY_SETUP_COMPLETED`。保存路径为 `output/playwright/network-coexistence-20261007/app-guide/`。使用远程 alias 且硬件回读一致，无 USB 回退；原业务 hold 保留。此检查没有启动／停止 VPN、读取秘密、安装网络客户端或发布。

安装检查通过现有 `AppProvisioner.ensure(serial, packageName, false)`，没有安装请求或 UI 操作；补充证据 `output/playwright/core-chain-20261007/installed-apps.json`。

本轮原核验第一次接续中，SDK 实际观察到目标管理 Page 和完整 ID，独立检查通过，但 note 使用 snake_case 与 status completed，缺少正式 camelCase 回执字段。没有修饰该历史结果或人工写成功。现把执行库任务说明与 expected_output_desc 共用同一 JSON 结构，要求结束前保存该结构。共享 30 分钟会话的尝试被既有 15 分钟上限拒绝（HTTP 409、未新建 trace），该改法已撤销。现每阶段使用独立的最多 15 分钟会话；第一阶段通过后撤销旧 token，第二阶段重新核对绑定并取得新会话，禁止再次取密码、验证码或登录提交。每动作仍核对当前中央范围；原素材、账号和发布限制不变。修复后将通过 Web 接续同一 operation，保留第一次失败及 hold。

修正后会话与监督相关 23 项非 UI 检查通过，包含旧 token 失效、15 分钟上限保留、第二阶段无重复登录及发布权限仍关闭。执行器和后端类型检查通过。`page-resume-contract-fixed` 第一次启动保存 HTTP 409 拒绝证据，不把该次启动记为手机操作；当前继续验证独立阶段会话。

独立阶段会话版本通过真实 Web 接续，trace `76f20622-2dee-4ded-a1b8-3ca835d75df6` 最终达到 15 分钟上限，SDK cancelled，正式诊断 `identity_audit_timeout`，原 operation 保留 unknown 和 hold。仍是原素材、账号和设备范围。核验期间独立检查指出“已复制”提示不足以证明实际 Page URL／ID；Artemis 后续通过 UI 粘贴读取，但在时限内没有保存完整正式回执，不人工填补。复现输出为 `output/playwright/core-chain-20261007/page-resume-stage-session/`，另存 `sdk-status-summary.json`；脚本仅一次 retry、零新建 attempt、零新派发 preflight，并通过 Web 查询原结果。

因该问题阻断素材准备，补充执行库的普通搜索框 Paste／键盘剪贴板读取提示，禁止提交搜索、使用 composer、剪贴板 API 或 shell；没有更换引擎或放宽身份核验。确认无活跃设备任务后，仅重启本轮执行服务加载提示，再从 Web 接续原已停止的只读核验。新输出为 `output/playwright/core-chain-20261007/page-resume-visible-link/`，结果另行记录。

`page-resume-visible-link` 的 trace 为 `7f363c53-2fe9-4285-8db3-b8582d6a6302`。Artemis 保存的正式字段 note 为 `unverifiable`：父账号与绑定匹配、目标 Page 的管理关系已检查，但 `identityId` 为空。独立检查保留了未通过项。15 分钟到期后 SDK cancelled，Web 实际显示 `identity_audit_timeout`；本次 1 次 retry、0 个新 attempt、0 次新 preflight 派发，浏览器已退出。USB 和远程 alias 的 SDK 物理锁均无 active owner；原业务 hold 仍保留。没有使用早期错误格式 note 填补当前缺失 ID，没有清除未知结果或再次盲目派发。

已请求用户在手机上定位目标 Page 的透明度／关于页面，使稳定 ID 可见；这不是重新申请发布授权。等待该实际入口后，通过 Web 接续原身份核验，不能把用户回复直接写成核验成功。公开提交的正式桥、可信当前动作核验和正式网络准入仍待接通；Page 指标消费者已存在，但单条内容的发布关联与可信复盘源尚未通过实测。

原任务文案只读检查：含《将门逆子》系列名，不含外链或 App 引流文字。R-164 已纳入原需求追踪表，文档结构检查通过：164 条需求、1,474 个本地链接、0 个错误；该结果不代表业务验收。

终态真实 Web 复核保存在 `output/playwright/core-chain-20261007/current-blocked/`：原素材字节及名称保留，原 operation 查询仍为 submission_unknown，显示身份核验超时及已停止只读核验的重试入口；公开权限 closed，Page 采集 not_started，指标来源 unknown、0 行记录，可信复盘未接入。复核的业务修改数为 0，`diagnosticPassed=true`、`coreChainAccepted=false`。不会因重试入口重新出现就自动发起第四次重复核验。后续须先确认实际 ID 入口或取得可复核的明确观察条件。
