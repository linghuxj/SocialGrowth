# 2026-09-20 FB / YT 应用准备、账号阻断与 Artemis 兼容修复

承接 [运行时修复](2026-09-20-execution-runtime-remediation.md)。本轮用户确认正常路径全自动，仅 FB / YT；缺 App 使用预下载可信 APK，暂不走应用商店；账号未分发、未登录或不一致时提示对应负责人，不能静默切号。修复及受控验证不代替完整真实业务验收。

## 已落地

- `AppProvisioner` 接入实际 Agent 的媒体准备路径，并提供一次性 `runtime:check-apps [--install-missing]`。校验 SHA-256、原签名、包名/版本、Android/ABI、同版本分包完整性后安装；单 APK / install-multiple 均支持。没有自动商店、卸载、覆盖、降级或失败循环重装。
- 保留已安装版本必须在受控清单内明确声明。本轮 FB 549.0.0.61.62 保持原登录环境；没有因为下载了 579 就覆盖现有应用。
- Android 16 的 `pm path` 在缺包时返回退出码 1 且 stdout/stderr 为空；已纳入明确缺包识别。其他传输错误不当作缺包。
- Artemis 发布前检查区分 FB Page / 个人 Profile / YT channel；精确唯一身份匹配，不以名称或模型 `matches=true` 单独放行。
- 账号问题回执含 `actionRequired`（预期身份、实际身份、原因、账号负责人处理提示），Web 执行记录直接展示。明确完成且无内容/账号修改的只读负面结果记 `blocked/not_submitted`；未完成、响应丢失、已进入发布流程的失败仍保留 `unknown`。
- 负责人处理配置后可归档证据、重新审查范围；不能用 `not_submitted` 抹掉未知事实，不能解掉同范围其他未决账号阻断。旧批准/排期作废，下一合法任务自动重新核对应用和账号。

## APK 与真机事实

本轮查询到的最新正式分发版本（不包括 beta，不保证所有地区/设备商店分阶段版本相同）：

| 应用 | 候选版本 / 代码 | 格式与兼容性 | 真机事实 |
| --- | --- | --- | --- |
| FB | 579.0.0.52.74 / 474818488 | base + config.xxhdpi；armeabi-v7a，min API 30 | 两个文件签名及必需分包已校验；未安装新版本，保留 549.0.0.61.62 |
| YT | 21.37.42 / 1561296049 | 完整 APK，多 ABI，min API 29 | 本轮通过实际自动安装器安装成功，再次读取版本一致 |

设备 RFCW40MYYCV 为 Android 16/API 36、arm64-v8a/armeabi-v7a/armeabi、480 dpi。FB 候选不是 arm64 变体，但设备支持其 ABI。APK 来源：[Aptoide FB](https://facebook.en.aptoide.com/app)、[Free-Codecs YT](https://www.free-codecs.com/youtube-for-android_download.htm)，YT 另与 [APKMirror 版本/签名资料](https://www.apkmirror.com/apk/google-inc/youtube/youtube-21-37-42-release/youtube-21-37-42-3-android-apk-download/)核对。第三方镜像不表述为官方直接下载渠道。

SHA-256 与签名固定在 [`app-catalog.2026-09-20.json`](../../services/execution-runtime/examples/app-catalog.2026-09-20.json)。实际文件位于本次 Codex 任务输出目录的 `android-packages/`，不向公开 Git 仓库提交 APK。FB 新签名的旧签名部分与本机已安装 FB 提取证书一致；YT 旧签名与独立参照一致；新旧轮换签名和 FB 两个分包均通过 `apksigner verify`。

安装由运行时 ADB 基础设施完成，非自然语言点击安装器；Artemis SDK 的 `app_path` 本身只支持单包。UI 账号和发布流程仍只使用 Google Artemis，不使用平台发布 API。

## 413 与 400：独立根因及兼容补丁

原 trace `44b168f4-20cd-46ee-b73d-74003a8bdbef` 的持久消息复核：

- 成功 Operator 消息约 741,017 字节、3 张图；失败消息 1,159,430 字节、4 张图，图片 data URL 合计 1,124,272 字节（约 97%），随后两次 413。**这是保存的 LangChain 消息字节数，不是完整 HTTP 请求体**；尚未测得网关精确阈值。证据足以支持历史图片累积是该次请求体膨胀主因，而不是仅凭媒体网格截图猜测。
- 独立 Checker 400 报错为 Gemini 上游不接受 `response_schema` 的 `$defs/$ref`，不是 413，也不是素材文件大小问题。
- 实际 Artemis 工作树的 transcript 三项配置调为 `image_scrub_depth=1`、`image_scrub_depth_relaxed=1`、`pending_grace_steps=0`。保留摘要与 trace 引用；不同角色/工具仍可能携带额外图像，**不是所有 HTTP 请求恒定只有一张图的字节上限保证**。
- Checker 对实际 ChatOpenAI 传输使用 `function_calling`，由 LangChain 内联工具 schema 并继续 Pydantic 验证，不绕过 Checker 判据。最终实现解开 `RobustChatModelWrapper.base_model` 和 `RunnableBinding.bound`，检查实际客户端：现有路由会在配置名义为 Google 时强制返回 ChatOpenAI，不能只读配置的 provider。前两次真实复测分别暴露封装层和名义/实际 provider 不一致，均已补回归。最终补丁仍待完整真机复验，不能标为已彻底解决。
- 本地补丁已应用，基线 `371aa6df56880643da57b30da936e9812fb0ec66`；可审计补丁保存为 [`artemis-371aa6df-proxy-compat.patch`](../../services/execution-runtime/patches/artemis-371aa6df-proxy-compat.patch)。不覆盖 Artemis 既有其他修改、不冒称已提交上游；升级底座时需重新检查/测试此兼容补丁，不能盲目重复应用。

## 验证分层

- 运行时 26/26（新增 10 个应用安装/拒绝测试及账号类型、登录、挑战、不可核验、配置恢复覆盖）。
- Controller 8/8，跨模块 3/3，Web 领域 28/28；SocialGrowth 合计 65 项通过。
- Runtime 构建/lint、Controller 构建/lint、Web TypeScript、改动文件 lint 和 Web 构建通过。没有把既有 Web 全库 lint 报错宣称修完。
- Artemis Checker/记忆 ledger 57/57，含名义 Google / 实际 OpenAI 的双层封装回归；真实配置读取结果为 1/1/0。
- 真实且无设备动作的 wrapped Checker 探针：HTTP 200、2.77 秒，返回空 verdicts 并成功校验。它只证明 schema 连接兼容，不代表任何业务或 UI 检查通过。
- YT 第一次只读 trace `58e286c4-8143-49f5-b7a1-5fecc4b9d36d` 在约 240 秒上限后取消；38 个持久 LLM 记录中两次旧 schema 400、无 413，消息最大 670,565 字节、最多 2 张图。该 trace 运行时尚未加载封装层修复，因此不把它算成修复后完成验收。
- 第二次只读 trace `e2bc909c-0282-433d-aa34-e67c5f04ff6a` 184.9 秒后 `failed`，Checker 三项 inconclusive；25 个 LLM 记录中三次 schema 400、无 413、消息最大 99,726 字节。原生界面明确出现“登入您的帳戶時發生問題”；Operator 只读观察与现场截图一致，不曾点登录或选择频道。设备已装 Google Play Services/Framework，系统有 3 个账号；不能把失败简单归因于“缺 Google 服务/没有系统账号”，具体会话/网络原因仍待核对。
- 最终按实际客户端解包的补丁完成后，匹配名义 Google 路由的小型无设备探针在 40 秒上限超时。前一次名义 OpenAI 探针 HTTP 200 不替代此次结果；模型服务延迟和完整真机成功仍待验收。两个设备 trace 均已终止，无遗留正在执行的发布任务。

字节汇总归档：[`artifacts/reports/2026-09-20-app-readiness`](../../artifacts/reports/2026-09-20-app-readiness)。不包含截图 base64、完整提示或密钥。

## 必须继续保留的阻断

1. **业务身份未闭环**：现有 FB 只读证据指向个人 Profile，尚非已验证 Page；YT 当前原生界面登录报错，需账号负责人处理并给定真实业务频道的精确 ID/URL，再验证绑定。不得自动从系统 3 个账号中挑一个，或创建/切换频道。
2. **权限/内容/发布批准**：既有测试漫剧素材的真实权利与 AI 标签判定未完成归档，本次没有一次真实公开发布授权；不能拿测试占位批准补齐。
3. **真实自动操作验收**：原 FB 媒体网格仍需在正确 Page 和批准边界下重做安全预检；本次下载/安装、schema 探针与 YT 只读检查都不代替 FB 该场景复测。
4. **全业务传输路径**：真实 Web→HTTP/WS→签名素材→Artemis→服务端归档与公开事实全链路未完成；此前本地 preflight 是直接调用执行器，必须区分。当前不得以人工选素材完成来代替自动化验收。
5. **自动恢复仍有工程缺口**：正常单次 Agent 能自动检查/补装、自动核验账号并提示负责人；尚未实现独立常驻健康轮询、自动识别人已配置完成并解除暂停。当前需负责人记录配置处理与重新批准，下一任务自动复查。常驻服务依仓库规范由人类手动启动，未擅自启动守护进程。
6. 真实指标回采、生产部署及公开发布后的可见性/版权通知验证沿原交接保留，不以本次回归代替。
