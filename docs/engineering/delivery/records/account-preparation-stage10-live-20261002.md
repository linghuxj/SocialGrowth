# 当前真机验收与新版 Android 候选安装

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；承接“现在开始进行真机测试和验收，然后继续推进下一阶段内容”。输入提交 `d2ae8c73d22b4563af4412ae18a1f612381532a5`，沿用 `codex/core-automation-loop-stage1`。本轮已完成真实 Demo Web→Google Artemis→人工反馈→最终回执的**只读观察验收**，并推进到新版自有 Android 客户端的实际更新安装和真机签名基础验证。正式参与、正式 inspect_app、Page／频道创建及完整业务验收未通过，不能从本轮局部结果外推。作者验证，不代替独立 QA 或非作者复核，不合入 Developer，不更新父 pending。

## 实际设备和环境

Samsung SM-S9110，serial `RFCW40MYYCV`，Android 16／API 36，USB ADB 状态 device，未锁屏；自有客户端、Facebook、YouTube、Tailscale 均已安装。开始和结束诊断的前台包均为 Samsung launcher。USB 在线及安装包存在不证明网络准入、手机参与或平台登录身份。[设备检查](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/device-preflight.json)仅使用只读 getprop／dumpsys／pm 检查。

项目实际环境为 pnpm 8.14.0、项目 Node 24.16.0、SQLite OK。按本轮真机测试授权启动自有 `pnpm dev` 前台组，实际加载已有 `.env.runtime`，Web 3000／runtime 4318。修正观察入口后，在没有 running task／验收任务且没有设备 hold 时重启本轮自有服务，未启动 agent／worker、未消费业务队列。没有改 Demo 模型配置或 SDK checkout，复用原 Google Artemis Pro 引擎；既有 SDK commit 为 `371aa6df56880643da57b30da936e9812fb0ec66`，其中外来工作保留。

## 观察入口修复和真机闭环

准备验收时发现，SDK 的 `locked_app_package` 会在模型决策之前打开目标 App；原 observe 入口也传入这个参数，违反“只观察当前屏幕”。现已仅在 Facebook preflight 模式传入 App lock，observe 不传入。补充检查覆盖 observe 不隐式打开 App，且模型声称 PREFLIGHT_READY 也不能被接受为观察模式的身份准备成功。

实际执行 `pnpm test:playwright`，由已有 `scripts/verify-demo-observation-playwright.mts` 从 Web 申请设备 hold、填写观察表单、点击发起，再从任务中心填写人工反馈并提交；没有通过业务 API 写入、数据库改写或 Mock 绕过页面。

- Web task：`b857bc27-d94d-4cb7-ad19-31e5b5d6b994`。
- Artemis trace：`7a41fd3e-37fd-4b55-9c25-56a83a48bccd`。
- 人工请求：`3ea1729d-3a0e-4e07-ab9d-5f80a6822f2a`，最终状态 verified。
- 2026-10-02 23:02:25～23:08:50（北京时间），最终 finished／OBSERVATION_COMPLETED，登录提交 0、内容提交未点击，Artemis 最终检查通过 2／失败 0／待确认 0。

Artemis 返回权威手机截图并提出澄清：当前是主屏幕，没有打开 Facebook，无法确认登记身份。执行者检查该截图后经真实 Web 回复，确认此限制并要求保持原只读范围；Agent 随后核验并完成观察。该回执证明观察和人工协助闭环，**不证明 Facebook 登录、账号身份或发布前准备完成**。本轮没有打开 Facebook、登录、创建平台资产或公开发布。原手机截图、协助文本及反馈文件留在本地 0600 私有证据，不进入 Git；已检查的 Web 回执截图没有密码、验证码或令牌。

证据：[Web 结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/live-observation/result.json)、[Web 回执截图](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/live-observation/web-observation-receipt.png)、[最终只读复查](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/live-final-readonly.json)。

## 已继续推进的下一阶段

构建包含 ParticipationService 的 Android Debug 主 APK 和测试 APK；当前观察任务结束后，在同一真机使用 `install -r` 更新主包，未卸载主包或清数据，系统 appId／包 UID 保持不变。安装后的 lastUpdateTime 为 2026-10-02 23:10:32，候选文件 SHA256 见[安装结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/android-install-native-result.json)。包 UID 不变及保留数据安装方式不等于已有业务会话仍有效。

核对实际 test manifest 注册的是 EnrollmentCryptoInstrumentation 后，执行既有非 UI、非网络的真机 Keystore 补充检查：10 通过／0 失败，包含缺钥拒绝、真实不可导出 P-256 私钥、签名验证及错代次／错安装／过期拒绝。本次随机测试密钥已删除；开始时不存在测试包，结束仅卸载本次安装的测试包，主候选保留。ParticipationService 未自行运行。没有以该 instrumentation 代替 Playwright 或完整业务验收。

首轮安装前只读检查采用旧 Android `userId=` 字段未解析成功，尚未执行安装即退出；核对 Android 16 的真实 `appId=` 字段后使用明确兼容解析完成本轮安装。失败未解释成设备业务故障，未清应用数据。

## 验证结论

| 范围 | 结果与证据边界 |
| --- | --- |
| Demo 真实 Web／Artemis／人工反馈／回执 | 通过本次只读观察范围；Facebook 身份无法确认 |
| runtime 构建／补充测试 | 构建通过，86／86 测试通过；修订测试排版后 5／5 定向检查再次通过 |
| runtime lint | 退出 0，两个既有 unused warnings 位于 screenshot-store.ts／server.ts，未修改外来代码 |
| Android 候选构建及真机更新安装 | 通过；主包保留，UID 不变，不证明业务会话或参与已通过 |
| Android 真机 Keystore | 10／10 补充检查通过；测试密钥和测试包清理 |
| 正式关联、显式参与／撤回、后台运行 | 未验证；当前没有可运行正式后端及真实关联联调资源 |
| 正式 Web→Artemis inspect_app | 阻断；物理检查器仍未接入，整机控制路径和原 unknown 尚未取得可信停止／结果证据 |
| FB Page／YouTube 频道创建与发布 | 本轮未尝试；不能从本次观察或安装推定通过 |

原发布 task `d634e4c6-4266-4cc7-a784-3a31a1737cac` 及原六条 identity_jobs 均继续保留 unknown，没有改写、重发、释放业务占用或伪造停止事实。本轮新 trace 的 completed／进程退出及手机主屏幕均不构成全路径停止证明。正式 executor 继续 disabled。本轮可确认闭环和新版候选已安装；正式业务验收的下一项是用当前真实安装会话完成关联和显式参与联调，再接入可信物理检查与原操作恢复核实，条件成立后才从正式 Web 发起 inspect_app。当前手机已有本轮候选，无需继续把“尚未安装”作为未完成项。

本轮 owned hold 已从 Web 交还；没有在途 running job 后退出自有统一服务组，3000／4318／3100／4320 均无 listener，其他容器保留；见[资源收口](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/resource-closure.json)。原受保护发布脚本仅路径／状态检查，外来未提交工作保留。源码及证据摘要见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage10-live-20261002/manifest.json)。

## 复现

在已授权启动且加载原配置的 Demo 服务上，使用以下环境执行真实 Web 脚本：`SG_WEB_TARGET=demo SG_DEMO_WEB_SCOPE=observation SG_DEMO_REAL_OBSERVATION=authorized SG_DEMO_IDENTITY_NAME='Xj Linghu' SG_DEMO_IDENTITY_ID=61550800776808 SOCIALGROWTH_VERIFICATION_OUTPUT=<私有输出目录> pnpm test:playwright`。脚本在 waiting.json 后等待同 taskId／requestId 的 operator-feedback.json；须先检查其权威手机截图，只写事实与原范围内的说明，由脚本通过页面提交。不能重用旧截图或直接改写回执。

补充检查为 `pnpm --filter @socialgrowth/execution-runtime build`、`pnpm --filter @socialgrowth/execution-runtime test` 和 `pnpm --filter @socialgrowth/execution-runtime lint`。Android 在既有 JDK 17／SDK 配置及独立 `/tmp/socialgrowth-product-gradle` 缓存下执行 `product/android/gradlew -p product/android assembleDebug assembleDebugAndroidTest --no-daemon`；实际 APK 安装／既有 Keystore instrumentation 命令见 Android README，执行前核对目标设备、当前任务及没有外来测试包。不得清主包数据或将非 UI 检查描述为业务验收。
