# SocialGrowth 本机执行运行时

承接 2026-09-20 真机交接 DP-01～DP-10 的工程缺口。此模块是单机、单运营身份的本地运行时，不是已经上线的 PostgreSQL/S3 多租户生产系统。

## 运行方式

Node.js 22.13+、pnpm 8.14.0，以下命令均在仓库根目录执行。复用已配置的 Google Artemis 工作树与虚拟环境，不复制模型密钥。本机代理兼容补丁保存在 `patches/`，不是上游已合并功能；应用前核对基线和本地改动。

```sh
pnpm install --frozen-lockfile
pnpm runtime:setup /absolute/path/to/artemis PHYSICAL_ADB_SERIAL
```

初始化只生成权限为 0600、被 Git 忽略的 `.env.runtime` 和 `.env.agent`；已有文件时拒绝覆盖。配置不包含业务账号绑定、素材权利或公开发布批准。这些信息由运营在控制台登记。

### FB / YT 应用准备

预下载已校验安装包，按 `examples/app-catalog.2026-09-20.json` 建立本机清单。示例内路径相对清单文件，实际 APK 不入 Git。将以下非秘密配置加入 `.env.agent`：

```dotenv
SG_APP_CATALOG=/absolute/path/to/android-packages/catalog.json
SG_ANDROID_BUILD_TOOLS=/absolute/path/to/Android/sdk/build-tools/36.0.0
```

只检查已安装状态：`pnpm runtime:check-apps`。
补装缺失应用并复查：`pnpm runtime:check-apps --install-missing`。
正常 Agent 在导入素材前也自动执行同一检查/补装逻辑，不要求人工进入商店安装。缺包但清单/工具未配置则阻断，不下载未知来源包。

候选 APK 按 SHA-256、包名、版本、签名证书、Android 最低版本、ABI、分包名称与必需类型逐项核验。多包必须版本/签名一致并采用一次 `adb install-multiple`；没有 `-r/-d`、卸载或重试安装。已安装应用仅接受候选相同版本或清单明确保留版本；本轮保留 FB 549 登录环境，不因为下载了 579 就替换它。现有应用保留基线不等于新版本业务验收。

Artemis SDK 的 `app_path` 当前只有单 APK 接口。运行时通过 ADB 做确定性单包/分包安装；业务 UI 和账号核对仍只使用 Google Artemis。目录中的清单是受信任本机管理员配置，不允许由任务载荷或网页替换签名/哈希。

前台统一启动（已有配置时跳过初始化）：

```sh
pnpm dev
```

`pnpm start` 等价；Ctrl+C 或任一服务退出时停止整组服务。独立启动使用 `pnpm dev:runtime` 与 `pnpm dev:web`。统一入口不启动设备 worker。

控制台默认通过本机开发代理访问 `/api/runtime`，操作令牌不进入浏览器 bundle。运行时只监听 `127.0.0.1:4318`，控制台开发服务也只监听本机。静态产物或 Cloudflare 部署不会自动代理到操作者的本机；生产部署须独立实现服务托管、TLS、身份与权限，不可直接公开本机代理。

执行一条到期且已明确入队的任务，随后正常退出：

```sh
pnpm runtime:agent
```

没有到期任务返回 `no_task`。持续复查由操作员手动运行 `pnpm runtime:worker`（前台进程，Ctrl-C 停止，不安装守护服务）。默认每 15 秒轮询；每任务失败退避 15/30/60/120/240/300 秒，过期不补发。同一设备必须使用同一 ledger；进程互斥防止并发回放未确认回执。

### 可重复准备与人工接管

WS 顺序为 `PullPreparation → PreparationReport → BeginExecution → ExecutionReceipt`。旧 `PullTask` 拒绝为 `AGENT_UPGRADE_REQUIRED`。task/attempt ID 在入队时预留，只有 BeginExecution 创建业务发布尝试、将排期改为 started。准备失败不消费批准。

准备仅做确定性 App 检查/可信补装、前台包检查、Artemis 被动层级读取。目标 App 前台出现绑定的完整身份 URL 且无已识别登录错误，才进入原有主动身份复核。姓名一致不通过，URL 不可读不能视为已登录。首次打开 App／展示身份页面仍需人工，未达到任意界面的全自动身份发现。

控制台提供人工接管/交还按钮：`POST /device-control {deviceId,held}`。正在检查/执行时不能抢占。接管成功后人工登录，交还后重新检查；交还不是批准，也不解除 unknown 暂停。检查租约最长 10 分钟、ready 有效 30 秒；迟到报告拒绝。任务、素材、批准、排期、授权或绑定变化停止旧任务并重新批准。`GET /status` 的 preparations/deviceHolds 提供原因、阶段、次数、下次检查时间和接管状态。

只验证 Google Artemis MCP 连接及目标设备层级读取：

```sh
pnpm runtime:check-artemis
```

该命令不调用 `mobile_run_task`，不操作页面、不保存草稿、不发布。输出设备序列号、字节数和摘要，不输出页面内容或凭据。

执行 Agent 启动 Artemis MCP 子进程时会设置 `ARTEMIS_STANDALONE=1`。本运行时自身已经负责持久队列、单次执行、状态轮询和超时停止；独立模式可避免外部 Artemis daemon 返回缺少所选设备或结构化结果的调度响应，同时仍复用 Artemis 的共享设备锁，禁止同一序列号并发操作。

## 使用流程

1. 在“系统管理 / 接入状态”导出旧浏览器工作区备份。需要迁移时，迁移到空的运行时数据库；原浏览器数据保留，素材逐个校验上传，旧批准/排期失效后重新核对。运行时已有业务数据时拒绝覆盖。
2. 登记客户、账号、授权、内容权利、适配结果、内容独占及导流入口；沿既有流程批准和排期。
3. 在接入状态登记真机账号绑定：设备标识、ADB 序列号、平台唯一身份、所有方授权、自动化范围依据及有效期。单设备单平台只绑定一个账号，不允许把 FB 账号借作 YT 账号。
4. 在发布计划选择准确素材版本、绑定、文案、公开受众、AI 标签和音乐/配音权利。YouTube 必须明确儿童受众。
5. 选择 `preflight` 时在最终提交前停止；选择 `publish` 时必须额外填写本次公开发布批准记录。每个排期只能创建一个 task/attempt，重复请求返回原任务。
6. Agent 下载签名 URL，核验 SHA-256，通过指定序列号导入手机并再次核验设备端哈希，触发媒体扫描。UI 操作由 Google Artemis MCP 完成；ADB 只承担物理设备/素材/截图桥接。
7. Artemis 先核对当前唯一平台身份及类型，再进入原生 App 流程。FB 必须是 Page，个人 Profile 不通过；YT 必须是频道。登录缺失、验证挑战、唯一身份无法确认或不匹配时阻断，不自动切换账号。回执 `actionRequired` 显示预期/实际身份、负责角色与处理方式。已完成且明确无内容/账号修改的只读检查失败记 `blocked/not_submitted`；丢失响应、超时或进入发布工作后的失败仍保守记 `unknown`。截图、结构化结果和 trace ID 先归档，随后回传回执。模型报告“完成”不直接等于发布成功；公开结果还须有平台 URL/ID、证据且 UI 层级包含所报 URL。无法满足时保持 `unknown`，交人工核验。
8. 未知状态暂停设备、账号、服务和内容范围。人工上传核对证据并确认关联范围/权限后恢复；原批准和排期失效，需重新批准安排。技术重连不恢复业务。

准备期 waiting 同范围修复后由 worker 自动检查继续；已进入执行的 blocked/unknown 仍需证据复核，不自动重跑。`not_submitted` 不能抹掉 unknown。自主身份检查仍含提示词约束，尚无已验收的动作级隔离，因此不能把自主检查失败放入可重复准备。真实验收及剩余边界见[本轮交接](../../docs/handoff/2026-09-20-preparation-recovery.md)。

`preflight` 的最终提交停止约束通过任务模式和 Artemis 指令实施，不是对任意 LLM 动作的形式化保证；正式启用前仍需对真实账号和 App 版本做场景验收。此轮未执行新发布场景。

## 持久化与故障处理

- `.runtime/runtime.sqlite`：业务状态及版本、命令幂等、唯一排期/task/attempt、绑定、原始回执事件、设备消息幂等、证据、公开观察与暂停范围。事务使用 SQLite WAL + FULL 同步。
- `.runtime/assets`：按 SHA-256 命名的素材，上传后服务端复核摘要。允许 MP4、PNG/JPEG/WebP 资产；视频执行仅使用 MP4。
- `.runtime/agent.sqlite`：发起设备工作前记录尝试；回执先持久化，未确认回执在下一次运行前补传。不会重新调用原任务。
- 运行中断且未取得可靠回执时，领取超时转 `unknown`，保留暂停；无 Agent 时控制台读取也会核对超时。
- 取消/撤权后，派发时重新读取所有业务资格。未到排期不执行，错过窗口不补发。
- 原始冲突/迟到回执留档，已公开事实不可降级。证据引用必须属于对应任务且已归档。
- URL 仅对已存在任务、素材摘要和有效期签名；过期拒绝，不能借刷新 URL 新建尝试。

SQLite 及 WAL/SHM、素材目录、Agent ledger 和密钥需要作为一个部署实例共同备份；不要删除 ledger 后重跑未核对任务。代码更新不要重置 `.runtime`。

## API 与传输

本机控制台 HTTP：`GET /state`、`POST /commands`、`GET /status`、`POST /import`、`POST /bindings`、`POST /tasks`、`POST /assets`、`GET /assets/:sha`、`POST/GET /evidence`、`POST /reviews`、`POST /observations`（均在 `/api/runtime` 下）。公开可见性/处理状态/限制通知可经有来源和截图证据的 `observations` 接口记录；真实指标供应商自动回采仍待接入。指标数值继续使用控制台现有观察入口并明确来源及缺失状态。

设备只用 WebSocket `/agent` Pull 一套传输；设备 token 绑定会话 deviceId，与控制台 token 分离。信封使用 `contractVersion: design-v1`、`messageId`、`sentAt`、`type`、`payload`；响应有 `inReplyTo`。重复消息同载荷返回原结果，同 ID 异载荷拒绝。`PublishTaskDirective` 响应载荷为 `{directive,settings,binding}`，其中 `directive` 复用 Controller 类型，`settings` 明确执行模式和发布参数，`binding` 提供序列号及平台唯一身份。

## 验证

```sh
pnpm test:runtime
pnpm --filter @socialgrowth/execution-runtime build
pnpm --filter @socialgrowth/execution-runtime lint
pnpm test:first-loop
```

测试使用受控业务记录和临时数据库，HTTP/WS 测试使用临时端口并正常关闭。运行时测试不产生真实公开帖子。最新真实验证范围见 `docs/handoff/2026-09-20-execution-runtime-remediation.md`。
