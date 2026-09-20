# Google Artemis 真机执行中枢集成与运营处置指南

**版本**：v1.0 (2026-09-20)  
**适用范围**：`services/execution-runtime`、`apps/artemis-controller`、`apps/web-console`、真机设备运营与发布中枢。  
**约束依据**：[CLAUDE.md](../../CLAUDE.md) 核心五大铁律、[执行与服务契约](execution-contract.md)、[真机交付验收台账](../handoff/2026-09-20-device-publishing-verification.md)。

---

> 2026-09-20 后续实现补充：下文双阶段/Review 流程描述进入设备执行后的处理，不适用于新增可重复准备期。当前协议、人工接管及自动复查以[准备恢复交接](../handoff/2026-09-20-preparation-recovery.md)和[运行时 README](../../services/execution-runtime/README.md)为准。mobile_run_task 的只读指令不是动作级隔离，设备锁不能替代人工接管。任意页面全自动身份发现和公开发布尚未验收。

## 一、 系统架构与与 Artemis 交互方式

### 1. 架构拓扑与边界

```mermaid
flowchart TD
    WebConsole["Web 运营控制台 (apps/web-console)"]
    RuntimeServer["本机执行运行时 (services/execution-runtime HTTP/WS 127.0.0.1:4318)"]
    SqliteStore["持久化存储 (.runtime/runtime.sqlite + agent.sqlite)"]
    DeviceAgent["单次设备 Agent (services/execution-runtime/src/agent-cli.ts)"]
    ArtemisMCP["Google Artemis MCP 子进程 (python -m artemis mcp)"]
    ADB["ADB 底座 (Physical USB/TCP)"]
    PhysicalDevice["物理真机 (如 Samsung Galaxy S23)"]

    WebConsole <-->|"HTTP /api/runtime (0600 Token)"| RuntimeServer
    RuntimeServer <-->|"SQLite 事务 / WAL"| SqliteStore
    RuntimeServer <-->|"WebSocket Pull /agent (design-v1)"| DeviceAgent
    DeviceAgent <-->|"MCP Stdio (JSON-RPC)"| ArtemisMCP
    DeviceAgent <-->|"ADB 命令 / 端口推送 / 截图"| ADB
    ArtemisMCP <-->|"原生 UIAutomator2 / Helper APK"| PhysicalDevice
    ADB <--> PhysicalDevice
```

- **执行底座铁律**：必须 100% 绑定物理真机（严禁 Android 模拟器，`ro.kernel.qemu !== "1"` 且序列号非 `emulator-*`）。
- **账号隔离铁律**：1:1 设备账号强绑定。单台真机同一时期仅登录并绑定 1 个专属平台账号（单机上限 1 个 FB Page + 1 个 YT 频道），严禁在 App 内多账号切换。
- **本地服务纪律**：依工程规范，本地开发环境禁止任何工具/Agent 擅自启动常驻后台守护进程。运行时与 Web 控制台由开发者**手动启动**（`npm run runtime:start` 与 `npm run runtime:web`）。

### 2. Artemis 进程调用与环境隔离规范

运行时通过 `@modelcontextprotocol/sdk` 的 `StdioClientTransport` 启动并持有 Artemis 子进程。

```typescript
// services/execution-runtime/src/artemis.ts
this.transport = new StdioClientTransport({
  command: resolve(this.root, ".venv/bin/python"),
  args: ["-m", "artemis", "mcp"],
  cwd: this.root,
  env: { 
    ...getDefaultEnvironment(), 
    ARTEMIS_STANDALONE: "1" // 强制独立调度分支
  },
  stderr: "pipe",
});
```

- **`ARTEMIS_STANDALONE=1` 关键作用**：
  - SocialGrowth 运行时自身已具备完整的 SQLite 状态机、排期持久化与单次轮询能力；
  - 传入 `ARTEMIS_STANDALONE=1` 可强制 Artemis 绕过其后台 daemon 的异步抢占与非结构化调度响应，保证每次调用能直接返回明确的 `trace_id` 与绑定设备序列号；
  - 同时完整继承复用 Artemis 底座的文件级设备互斥锁（Device Lock），彻底杜绝并发进程对同一物理序列号的冲突操作。

### 3. MCP 核心契约接口

客户端连接成功后，必须对 Artemis 暴露的工具列表执行契约断言，缺少任何一项则抛出 `ARTEMIS_CONTRACT_UNSUPPORTED`：

| MCP 工具名 | 入参核心字段 | 返回值/行为 | 业务用途 |
|---|---|---|---|
| `mobile_run_task` | `device_serial`<br>`locked_app_package`<br>`model: "Pro"`<br>`verification_level: "strict"`<br>`task_desc`<br>`expected_output_desc` | `{ trace_id: string, device_serial?: string }` | 启动端侧原生 UI 任务。严格锁定目标包名，注入受限提示词与结构化期望。 |
| `mobile_manage_task` | `trace_id`<br>`action: "status" \| "stop"` | 状态轮询：`{ status: "pending"\|"running"\|"completed"\|"failed", result?: unknown }`<br>主动停机：停止该 trace 的底层模型与动作循环。 | 状态监控与生命周期兜底。每 1 秒轮询一次，硬超时到期时立即执行 `action: "stop"`。 |
| `mobile_get_device_state` | `device_serial`<br>`view_type: "hierarchy" \| "screenshot"` | 原生 UI 树 XML 文本或截图数据。 | 真实环境证据采掘。用于最终发布事实与屏幕内容的强断言，防止 LLM 幻觉。 |

---

## 二、 App 准备、检测与受控安装流程

为了杜绝通过应用商店自动更新引入未知版本，系统采用确定性、基于受控离线清单的 `AppProvisioner` 机制：

```mermaid
flowchart TD
    Start(["准备阶段开始"]) --> CheckDevice["核验 ADB 物理设备状态及属性"]
    CheckDevice --> CheckInstalled{"adb shell pm path 检查包是否存在"}
    
    CheckInstalled -- 存在 --> ReadVersion["dumpsys package 提取 versionName / versionCode"]
    ReadVersion --> MatchRetained{"是否匹配目标版本或属于 retainedInstalledVersions?"}
    MatchRetained -- 匹配通过 --> PassInstalled(["已安装就绪 (复用原登录环境)"])
    MatchRetained -- 版本不匹配 --> FailVersion["抛出 APP_VERSION_UNSUPPORTED (阻断)"]

    CheckInstalled -- 不存在 --> CheckInstallAllowed{"是否允许安装缺失包 (installMissing)?"}
    CheckInstallAllowed -- 否 --> ReturnMissing(["返回 missing 状态"])
    CheckInstallAllowed -- 是 --> CheckCatalog["读取 app-catalog.json 受控清单"]
    
    CheckCatalog --> VerifyHash["逐文件核验 APK SHA-256 哈希"]
    VerifyHash --> VerifySign["apksigner 校验签名证书 SHA-256"]
    VerifySign --> VerifyCompat["aapt badging 检查 minSdk 与 ABI 架构"]
    VerifyCompat --> VerifySplits["检查 AndroidManifest.xml 必需 split 完整性"]
    VerifySplits --> RunInstall["执行 adb install 或 install-multiple (严禁 -r/-d)"]
    RunInstall --> RecheckVersion["复核安装后版本一致性"]
    RecheckVersion --> FinishInstall(["安装成功就绪"])
```

### 1. 检测判断逻辑
- **Android 16 兼容性**：`pm path <pkg>` 在 Android 16 上如果包不存在，会返回退出码 `1` 且 stdout/stderr 均为空；此情况明确识别为“未安装”，其他 ADB 通信中断或无权限错误不得误判为未安装。
- **已安装版本保留基线（Retained Versions）**：
  - 清单中声明 `retainedInstalledVersions`（例如 Facebook 保留 `549.0.0.61.62` 的已有登录与会话环境）；
  - 只要设备上已安装版本在保留白名单内，**禁止静默升级覆盖**，避免丢失登录态与风控会话。

### 2. 受控离线安装规范
- **禁止自动下载与商店安装**：所有候选 APK 必须预先由运维在受控清单（`app-catalog.json`）中显式定义相对路径与元数据；
- **签名证书强核验**：通过 `apksigner verify --print-certs` 提取证书指纹，必须与清单中的 `signerSha256` 绝对一致；
- **多架构与分包支持**：
  - 设备读取 `ro.product.cpu.abilist` 与 `ro.build.version.sdk`；
  - 检查 Split APK（如 `base.apk` + `config.xxhdpi.apk`），必须满足清单与设备 ABI/DPI 要求；
  - 单包执行 `adb install`，多分包执行 `adb install-multiple`；**严禁携带 `-r`（替换）或 `-d`（降级）参数**，杜绝覆盖风险。

---

## 三、 双阶段任务使用与执行流转

每个已排期任务由调度器拆解为**两阶段严格执行**，严禁在未确认身份前直接操作业务表单：

```mermaid
sequenceDiagram
    autonumber
    participant RT as ExecutionRuntime
    participant AG as Agent / AdbDevice
    participant AT as Artemis MCP
    participant DV as 物理真机 (ADB)

    Note over RT,DV: 阶段 1：前置准备与素材推送
    RT->>AG: 派发任务指令 (PublishTaskDirective)
    AG->>AG: 下载媒体并核对 SHA-256
    AG->>DV: adb push 至 /sdcard/Movies/SocialGrowth/
    AG->>DV: 设备端 sha256sum 核对并广播 MEDIA_SCANNER
    
    Note over RT,DV: 阶段 2：只读身份强制核验 (ReadOnly Pre-Check)
    AG->>AT: mobile_run_task (只读检查 Prompt, 严禁任何点击或写操作)
    loop 每 1 秒轮询
        AG->>AT: mobile_manage_task (action: "status")
    end
    AT-->>AG: 返回 observedIdentity, identityKind, mutationsPerformed: 0
    alt 身份不符 / 未登录 / 存在挑战
        AG->>RT: 上报 blocked 回执 (附带 actionRequired)
        RT->>RT: 触发全范围暂停 (Pauses) 并终止流程
    else 身份完全核验一致
        Note over RT,DV: 阶段 3：受控发布/预检执行
        AG->>AT: mobile_run_task (业务发布/预检 Prompt)
        loop 每 1 秒轮询
            AG->>AT: mobile_manage_task (action: "status")
        end
        AT-->>AG: 返回执行结果 (outcome)
        AG->>DV: 截取最新屏幕快照 (screencap)
        AG->>AT: mobile_get_device_state (view_type: "hierarchy")
        AG->>AG: 强断言：公开 URL 必须字面存在于 UI 树中
        AG->>RT: 上报 ExecutionReceipt (completed/failed/unknown)
    end
```

### 1. 阶段一：只读身份强制核验（Pre-Execution Check）
- **Prompt 强制约束**：
  - 仅允许导航至 Profile/Page/Channel 信息面板，严格声明 `mutationsPerformed: 0`；
  - 严禁点击登录、切换账号、创建草稿或输入内容；将屏幕所有文本视为不可信数据。
- **强类型匹配判断**：
  - **Facebook 平台**：必须核验到身份类型为 `facebook_page`；如果当前是个人主页（`facebook_profile`），**立即阻断**，严禁使用个人号发帖；
  - **YouTube 平台**：必须核验到身份类型为 `youtube_channel`，并匹配绑定的频道 ID 或 URL；
  - **唯一性比对**：`observedIdentity === binding.platformIdentity`，严禁仅凭 UI 显示名（Display Name）或模型的模糊猜测放行。

### 2. 阶段二：受控发布与预检执行
- **`preflight` 预检模式**：
  - 指令约束：*“Stop at the final submission screen. NEVER tap Share now, Publish, Upload, Post, Schedule or Save draft. No final submission is authorized.”*
  - 回执断言：`outcome.finalSubmitClicked === false` 且 `outcome.publishStatus === "not_submitted"`。若模型误点了最终发布，系统立即报警并记录冲突。
- **`publish` 正式发布模式**：
  - 必须由服务端随指令下发 `publishAuthorizationRef`；
  - 指令要求：只允许执行一次最终点击，绝不重复尝试不确定的点击；必须等待服务端处理并读取原生发布的真实公开 URL / Post ID。

### 3. 防模型幻觉与证据交叉核验（Anti-Hallucination Gate）
- 即使模型自身报告 `publishStatus: "published"`，运行时绝不盲目信任其返回的文本；
- **UI 树交叉断言**：Agent 立即调用 `mobile_get_device_state(view_type: "hierarchy")` 抓取当前原生页面的完整 View Hierarchy；
- **强制约束**：返回的 `publishedUrl` 必须属于平台域名白名单，且**该 URL 必须真实包含在 UI 层次树文本中**：
  ```typescript
  requireFact(
    typeof hierarchy === "string" && hierarchy.includes(outcome.publishedUrl),
    "PUBLICATION_UI_EVIDENCE_MISSING"
  );
  ```
- 无法满足交叉断言时，回执一律保守记录为 `publishStatus: "unknown"`，移交人工核验。

---

## 四、 阻断分类、级联暂停与恢复矩阵

当任务未能顺利执行完成时，运行时会生成携带结构化建议的阻断信息并联动暂停锁。

### 1. 阻断分类与处理责任矩阵

| 阻断类别 (`actionRequired.kind`) | 触发原因 (`reason`) | 现象与错误码 | 负责角色 | 规定处理动作 |
|---|---|---|---|---|
| **`app` (应用环境)** | `APP_NOT_ALLOWED`<br>`APP_CATALOG_ENTRY_MISSING`<br>`APK_SIGNATURE_MISMATCH`<br>`APK_ABI_INCOMPATIBLE`<br>`APP_VERSION_UNSUPPORTED` | 手机未安装目标应用，或已有安装版本不匹配，或本地离线 APK 签名/架构不符合要求。 | **设备运维负责人** | 1. 检查物理手机 ADB 连接；<br>2. 补充受控 `app-catalog.json` 清单并放置已签名的可信 APK 文件；<br>3. 运行 `npm run runtime:check-apps -- --install-missing` 单次核验；<br>4. 严禁去公开商店人工点击更新。 |
| **`account` (账号与登录)** | `ACCOUNT_LOGIN_REQUIRED`<br>`ACCOUNT_CHALLENGE`<br>`ACCOUNT_TYPE_MISMATCH`<br>`ACCOUNT_IDENTITY_MISMATCH` | App 未登录、遇到 2FA/风控验证码、当前登录的是个人 Profile 而非 Page、或登录的频道与绑定不一致。 | **账号运营负责人** | 1. 在该指定编号的物理真机上**手动**打开 App；<br>2. 完成必要的人工 2FA / 验证挑战并切换至唯一指定的 Page 或频道；<br>3. 严禁由 Agent 自动尝试切号；<br>4. 处理完成后在 Web 控制台登记证据，重新发起排期核验。 |
| **`unknown` (技术不确定)** | `TECHNICAL_FAILURE`<br>`EXECUTION_TIMEOUT`<br>`413 Request Entity Too Large` | 网络中转超时、上游模型请求体过大截断、App 闪退、或在点击提交后失去响应。 | **系统研发 / 技术值班** | 1. 检查截图与链路日志；<br>2. 前往物理机查看当前 App 真实页面状态（已发/未发/审核中）；<br>3. 在 Web 控制台“执行待办”中录入核对事实。 |

### 2. 级联暂停锁（Cascading Scope Pauses）

一旦任务产生 `publishStatus === "unknown"` 或 `failureCode === "IDENTITY_CHALLENGE"`，运行时立即在数据库 `pauses` 表对以下 4 个维度写入级联暂停锁：
1. `device:<deviceId>` —— 暂停该设备上所有后续调度；
2. `account:<accountId>` —— 暂停该账号的所有发帖安排；
3. `project:<projectId>` —— 暂停归属项目的发布派发；
4. `content:<contentIdentityId>` —— 锁定当前切片内容的排他锁，防止被其他任务抢占重发。

在暂停解除前，任何拉取或派发该范围内任务的请求，均直接在服务端以 `DISPATCH_REJECTED` 拒绝。

---

## 五、 Web 运营控制台对接与人工审查规范

Web 运营管理平台通过标准的本机 REST API（`/api/runtime/*`）与运行时交互。

### 1. 核心接口速查

| 端点 | 方法 | 关键载荷 / 作用 | 错误码边界 |
|---|---|---|---|
| `/api/runtime/state` | `GET` | 获取 `{revision,state}` 业务快照；任务、准备、暂停、接管见 `/api/runtime/status`。 | `AUTHENTICATION_REQUIRED` |
| `/api/runtime/bindings` | `POST` | 登记 1:1 设备账号绑定：`{ id, deviceId, platform, accountId, serial, platformIdentity, authorizationRef, automationScopeRef, validUntil }` | `BINDING_EXPIRED`<br>`DEVICE_HAS_UNRESOLVED_TASK`<br>`ACCOUNT_PLATFORM_MISMATCH` |
| `/api/runtime/tasks` | `POST` | 下发排期任务入队：`{ scheduleId, bindingId, sliceId, mode, captionText, aiLabel, madeForKids, rightsRef, publishAuthorizationRef? }` | `SCHEDULE_INVALID`<br>`BINDING_INVALID`<br>`CONTENT_UNAVAILABLE`<br>`CONTENT_ALREADY_QUEUED` |
| `/api/runtime/evidence` | `GET ?id=...` | 获取该任务归档的结构化事件、View Hierarchy 或 PNG 截屏证据。 | `EVIDENCE_NOT_FOUND` |
| `/api/runtime/reviews` | `POST` | **人工审查与业务恢复入口**：`{ taskId, publishStatus, evidenceRefs, reason, relatedScopeReviewed: true, authorizationRechecked: true, publishedUrl?, publishedPostId? }` | `TASK_NOT_REVIEWABLE`<br>`NON_SUBMISSION_NOT_ESTABLISHED`<br>`PUBLISHED_FACT_IMMUTABLE` |

### 2. Web 控制台处理阻断与业务恢复的标砖 SOP

```mermaid
flowchart TD
    Detect["Web 控制台展示执行阻断 (actionRequired 高亮提示)"]
    ActionPrompt["显示预期身份、实际身份与处理建议"]
    OfflineAction["线下人工处置 (设备运维配 APK / 账号负责人真机解验证)"]
    InspectEvidence["运营在控制台查看执行截屏与 UI 证据"]
    
    SubmitReview["运营提交审查 (POST /api/runtime/reviews)"]
    CheckDeclarations{"是否显式勾选:
    1. relatedScopeReviewed: true
    2. authorizationRechecked: true"}
    
    CheckDeclarations -- 否 --> RejectReview["服务端拒绝 (400 校验失败)"]
    CheckDeclarations -- 是 --> ExecuteReview["服务端事务核实并记录确核事实"]
    
    ExecuteReview --> ClearPauses["自动解除对应范围的暂停 (pauses)"]
    ClearPauses --> InvalidateOld["作废旧排期与批准 (防止旧任务重跑)"]
    InvalidateOld --> ReSchedule["运营人员发起合规重审与重新排期"]
    ReSchedule --> NextAutoRun["下一个合法排期到期时自动重新检查"]
```

1. **阻断感知**：控制台“执行记录/待办”列表通过 `receipt.actionRequired` 呈现结构化告警。
2. **线下物理处置**：
   - 若是 `kind: "app"`，通知设备负责人处理 APK 清单；
   - 若是 `kind: "account"`，通知账号负责人前往对应真机完成登录或挑战；
3. **录入审查（Review）**：
   - 运营人员在 Web 界面调阅该任务的最后截图；
   - 调用 `POST /api/runtime/reviews`，录入确核状态（`published`、`confirmed_not_published` 或 `not_submitted`）；
   - 表单中必须显式确认两项合规断言：
     - `relatedScopeReviewed: true`（已审查同设备/同账号受影响关联范围）；
     - `authorizationRechecked: true`（已重新核对账号所有方授权与当前有效性）。
4. **状态解除与重新排期**：
   - 服务端审查通过后，对应 `device` / `account` / `project` / `content` 的暂停标记被自动清除；
   - **原排期与批准自动失效**（`invalidated / ATTEMPT_FINISHED_REAPPROVAL_REQUIRED`），系统绝不会自动重跑原任务；
   - 运营人员重新发起策略批准与排期，下一个合法任务启动时，Agent 将自动重新执行从 App 到账号的完整健康检查。
