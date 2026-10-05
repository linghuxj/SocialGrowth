# SocialGrowth 工程规范

2026-09-27：产品以最新对齐需求为准，现有实现仅为 Demo 验证参考，既有模块、技术栈及演示结果不构成最终设计或验收结论。以下工程规范适用于操作现有仓库，不要求最终方案沿用 Demo 架构。

- 当前需求：[需求基线](docs/current-requirements-summary.md)
- 来源与修订：[确认记录](docs/requirements-alignment.md)
- 旧版全文：[历史 CLAUDE.md](archive/2026-09-25-before-realignment/CLAUDE.md)

## 二、 本地开发与运行纪律

> [!CAUTION]
> Agent 可按当前任务需要直接启动或重启本地服务，无需另行取得启动授权；先核验现有实例、端口及在途任务，优先复用可用实例，避免重复启动或中断未决业务，不自行安装后台守护服务。测试脚本与构建验证使用单次运行并退出的命令（如 `pnpm build`、`pnpm test`、`python3 script.py`）。

### 包管理与统一启动

- 使用 pnpm 8.14.0，项目 `.npmrc` 自动下载并选择 Node.js 24.16.0（首次需要联网），不修改全局 Node。从仓库根目录 `pnpm install --frozen-lockfile`；仅维护 `pnpm-lock.yaml`，工作区范围由 `pnpm-workspace.yaml` 指定。`pnpm env:check` 输出实际 Node 路径并检查 SQLite；安装时严格校验 engines，统一启动前检查运行环境。全局 `node -v` 不代表项目脚本使用的版本。
- `pnpm dev` / `pnpm start`：当前通过 `scripts/product-local-live.mts serve` 启动正式产品 Web（3100）与后端（4320）；Ctrl+C 或任一服务退出时停止本轮启动的服务组。历史 Demo 使用 `pnpm dev:demo`（Web 3000、execution-runtime 4318），不可混同两个入口的验收结果。
- `pnpm dev:web` / `pnpm dev:backend`：独立启动正式产品服务；已有实例时勿重复启动统一入口。历史 Demo 可用 `pnpm runtime:web` / `pnpm runtime:start` 单独运行；execution-runtime 直接加载已有 `.env.runtime`，避免代理凭据丢失。
- `pnpm runtime:setup <Artemis路径> <真机序列号>` 仅供首次初始化，已有配置时跳过。设备 Agent / worker 仍由 `pnpm runtime:agent` / `pnpm runtime:worker` 单独运行。
- 根入口 `pnpm test:playwright` 验证真实 Web 页面；`pnpm test` 为补充回归，`pnpm build` 构建 Web，`pnpm build:runtime` 检查运行时类型。

### 测试与验证规范（强制）

- Android 真机通过 USB 连接且 `adb devices` 显示为 `device` 时，Agent 可直接在当前任务范围内进行设备操作与测试，无需另行申请真机使用授权。操作前核对序列号、目标 App 与在途任务；多设备时显式指定目标，未授权／离线设备不视为可用。保持现有业务执行引擎、当前手机授权与任务范围要求，记录实际操作、结果及必要恢复。

- **不使用独立 E2E 测试方式进行项目验收，统一使用 Playwright 进行真实浏览器测试与验证。** 不新增或运行其他 E2E 测试套件来替代 Playwright 验证。
- Playwright 必须从实际 Web 入口操作页面、填写表单、点击按钮，并断言页面反馈和最终状态；不得通过直接调用后端接口、修改数据库、预置成功状态或 Mock 业务结果绕过待验收流程。接口、日志及数据库的只读检查只能作为补充证据。
- Playwright 也能覆盖跨页面完整流程；这里指定的是验证工具与真实操作方式，并非禁止完整业务链路验证。不能仅凭脚本名包含 `e2e` 判断是否合规，也不能仅通过改名宣称完成迁移。
- 保留可复现的 Playwright 脚本、执行命令、环境、断言结果及必要截图；截图和日志须保护密码、验证码、令牌等敏感信息。页面能打开、截图成功或脚本未报错，不等于业务验收通过。
- 运行现有 Demo 的 Web 发起 → Artemis 执行 → 人工介入 → 最终回执验证时，须通过 Web 发起任务及提交人工反馈。Playwright 负责 Web 操作，Artemis 负责真机 App 的识别、决策与执行，不得以固定手机操作脚本替代 Agent 决策。没有真实设备或外部条件时，记录阻断，不能用模拟结果宣称链路跑通。首期已按 R-106 明确选用 Google Artemis 作为手机执行引擎，但 Demo 的接口、部署和其他技术栈不自动成为最终方案；用户按 R-109 补充确认既有远程执行已验证，应复用原证据并注明环境及覆盖范围；当前重点是网络共存、新设备客户端与未覆盖的恢复能力，不将既有链路重新列为全未验证。不满足条件时重新对齐，不自动替换引擎。
- 单元测试、非 UI 集成测试、类型检查、lint 和构建可作为补充检查，不能替代 Playwright 的 Web 验收，也不能证明真实登录、真机操作或公开发布成功。未获得明确授权，不得点击最终发布按钮或扩大任务权限。
- 遵守服务管理纪律：优先使用已启动的服务；不可用或当前验证需要时，可直接启动／重启，并核验现有实例及在途任务。验证命令单次运行后退出，结束时清理本轮自有临时进程，不误停他人服务。报告明确区分通过、失败、阻断和未验证。

上述规则与 [AGENTS.md](AGENTS.md) 保持同步；历史文档中的 E2E 描述不构成绕过本规则的依据。

---

## 三、 代码风格与开发标准

### 1. TypeScript / JavaScript 规范
- **严禁泛滥使用 `any`**：所有业务实体、API 入参及出参必须定义明确的 `interface` 或 `type`。
- **严格空值检查**：开启 `strict: true`，所有可选字段使用可选链操作符（`?.`）与空值合并操作符（`??`）。
- **统一枚举命名**：使用字符串联合类型（Union Types，如 `'facebook' | 'youtube' | 'instagram'`）替代原生 TypeScript `enum`，确保序列化的一致性与简洁性。
- **异步处理**：所有 I/O 操作统一采用 `async/await`，必须包裹 `try/catch` 并输出结构化错误上下文，严禁裸奔 Promise 导致未捕获异常崩溃。

### 2. Python 脚本规范
- 统一使用 Python 3.10+，脚本必须包含类型注解（Type Hints）；
- 涉及数据生成、测算模型的脚本必须具备命令行参数解析（`argparse`）与清晰的标准输出日志；
- 数据输出统一使用 UTF-8 编码格式的 JSON 或 Markdown。

### 3. Git 提交与分支规范
- **分支命名**：
  - 特性开发：`feature/<task-id>-<description>`（例如 `feature/task-01-scheduler-route`）
  - 缺陷修复：`fix/<issue-id>-<description>`
  - 规范重构：`refactor/<scope>-<description>`
- **分支生命周期（2026-10-02 用户确认收敛）**：
  - 保留 `main`、`Developer` 与当前实际执行分支；不为每个测试、文档更新或 stage 新建长期分支。阶段检查点使用固定 commit SHA 和交付记录，阶段内凝聚后提交。
  - 只有真正独立的业务切片、并行隔离或需要隔离的整改才建短期分支。Codex 新分支默认使用宿主 `codex/` 前缀；已有 `feature/`、`fix/`、`refactor/` 历史名称不批量改名。
  - 固定批次非作者复核与 QA 结论按 SHA 留痕；Git 可达/合并不等于业务通过。不因减少分支而合入未清父 pending、隐藏 findings 或扩大真实执行许可。
  - 清理前保存精确名称→完整 SHA 恢复清单，核对 tip 未改变、上游、工作树占用与在途协作；按明确名单非强制删除已合入基线的本地分支。不触碰远端或仍承载独有工作/待验门禁的分支；只有在明确收拢范围并保留事实后才另处理。
  - 历史分支清理不删除提交/验收证据；必要时用少量有意义的归档标签保护检查点，不把逐 stage 分支等量改成逐 stage 标签。用户未提交修改及受保护文件不进入清理或提交范围。
- **Commit Message 格式**：
  `[<模块名>] <动作>: <简明说明>`（例如 `[artemis-controller] fix: 严格限制 1:1 设备账号路由，杜绝串号派发`）。

---
