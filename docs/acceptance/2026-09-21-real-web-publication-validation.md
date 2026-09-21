# FB / YT 真实 Web 运营发布验证

日期：2026-09-21（Asia/Shanghai）

## 结论

本轮通过 Playwright 从真实 Web 运营平台发起 Facebook 真机发布前任务，Artemis 在 RFCW40MYYCV 上完成素材选择、文案填写和最终发布页面准备，并保持 `Share now` 未点击。任务回传 `PREFLIGHT_READY`，登录提交 0 次，内容提交未点击。

**FB 与 YT 的真实公开发布均未执行。** 当前资料与授权不足以安全进入正式提交，不能把发布前成功、模型自报身份或页面可访问误报成公开发布成功。

## 实际执行证据

| 项目 | 结果 |
| --- | --- |
| Web 发起方式 | Playwright / Google Chrome，通过运营平台页面填写并点击“从 Web 启动完整验收” |
| Web 验收任务 | `c02aa2aa-9fe3-4945-8cfa-d9281c83bdaa` |
| Artemis trace | `45b8d3bb-a12f-4dbe-901c-2d0f7844fe17` |
| 真机 | Samsung SM-S9110 / RFCW40MYYCV |
| 平台 / 模式 | Facebook / preflight |
| 开始 / 完成 | 2026-09-20T15:53:23.012Z → 2026-09-20T16:00:04.426Z |
| 最终页面 | `New reel`，`Share now` 可见且未点击 |
| 配置 | Public、Story sharing Off、AI label Off；文案及 12 秒固定验收素材已填入 |
| 登录提交 | 0 |
| 内容提交 | 0 |
| Web 结果 | `PREFLIGHT_READY` |
| Artemis 检查摘要 | completed；0 passed、0 failed、5 inconclusive |

Artemis 的结果载荷自报 profile ID 61550800776808 及 identityVerified=true，但其检查摘要仍有 5 项待确认，维护笔记未落入独立身份或文件哈希证据。因此本报告不将该字段单独升级为 Facebook Page 身份核验通过。最终截图能证明编辑页状态和按钮未点击，不能证明这是符合项目约束的目标 Page。

## 当前阻断

1. 当前 Web 业务档案只有 Facebook 账号 `Zan Wang (CEO Drama)`；运行时绑定为个人 profile URL，项目规范要求绑定并核验 Facebook Page。未提供或核验目标 Page，不能向当前个人 profile 直接正式发布。
2. 当前没有 YouTube 业务账号、频道 ID、设备绑定、客户授权或发布授权；现有 Web 验收入口也只支持 YouTube 只读模式，拒绝 YT 发布前或发布任务。
3. 用户指定目录中的 27 个 MP4 已完成 ffprobe 可读性检查，但尚未在 Web 完成内容身份、唯一素材、权利依据、账号归属、最终文案、AI 标签和 YT 儿童受众设置。不能用旧任务的“总裁的替嫁新娘”内容身份替换成“将门逆子”。
4. 正式业务表单具有 publish 选项，但当前 Agent supervision 策略的 allowPublication 固定为 false，publish 动作需要尚未接通的独立授权工作流。绕过该保护不属于验收。
5. 旧任务 `1893c4cf-ed42-43b1-81ae-d4704450db12` 仍为 queued / preflight / IDENTITY_NOT_VISIBLE；本轮没有消费、改写或重跑旧任务。

## 启动链路修复

首次按原 `npm run runtime:web` 启动后，Playwright 收到 `/api/runtime/state` 409；直接启动 Web 子项目时返回 200。原因是原根脚本没有在 Web 子项目工作目录中可靠加载运行时代理凭据。本轮新增 Web 子项目 `dev:runtime`，根命令改为调用该脚本。修复后重新执行 `npm run runtime:web`，Playwright 确认 `/api/runtime/state` 与 `/api/runtime/status` 均为 200，且页面展示上述真实任务结果。

## 素材检查

目录 `/Users/linghuxj/Downloads/切片/将门逆子` 包含 27 个可读取 MP4，均为 H.264：23 个 3346×1882、3 个 1920×1080、1 个 720×1280。竖屏候选 `将门逆子-pxy-8.15-二创 (7).mp4` 为 720×1280、136.278005 秒、17,066,476 字节；尚未内容审看或被运营批准，不能自动视作 FB / YT 最终版本。

## 验收边界

本轮没有卸载 App、制造未安装分支、错误重试密码、触发验证码、切换账号、创建 Page / 频道或点击最终发布。FB 的发布前路径已真实跑通；YT 与两平台正式公开发布仍为阻断。必须补齐明确的 FB Page 与 YT Channel 目标及授权，并将对应档案、绑定、素材和独立发布动作授权接入 Web 后再继续。
