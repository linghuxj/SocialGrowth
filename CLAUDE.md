# SocialGrowth 工程规范

2026-09-25 需求重新对齐：旧版业务基线、技术路线与文档索引已归档，新一轮业务约束以用户后续确认为准。归档内容不自动成为当前要求。现有工程运行与代码规范暂时保留。

- 当前需求：[需求对齐](docs/requirements-alignment.md)
- 旧版全文：[历史 CLAUDE.md](archive/2026-09-25-before-realignment/CLAUDE.md)

## 二、 本地开发与运行纪律

> [!CAUTION]
> 本地常驻服务通常由开发者手动启动与调试。用户明确授权 Agent 启动或重启时可执行，先核验现有实例及在途任务，不自行安装后台守护服务。测试脚本与构建验证使用单次运行并退出的命令（如 `pnpm build`、`pnpm test`、`python3 script.py`）。

### 包管理与统一启动

- 使用 pnpm 8.14.0，项目 `.npmrc` 自动下载并选择 Node.js 24.16.0（首次需要联网），不修改全局 Node。从仓库根目录 `pnpm install --frozen-lockfile`；仅维护 `pnpm-lock.yaml`，工作区范围由 `pnpm-workspace.yaml` 指定。`pnpm env:check` 输出实际 Node 路径并检查 SQLite；安装时严格校验 engines，统一启动前检查运行环境。全局 `node -v` 不代表项目脚本使用的版本。
- `pnpm dev` / `pnpm start`：前台统一启动 Web（3000）与 execution-runtime（4318），日志带服务名；Ctrl+C 或任一服务退出时停止整组服务。
- `pnpm dev:web` / `pnpm dev:runtime`：独立启动；已有实例时勿重复启动统一入口。运行服务进程直接加载已有 `.env.runtime`，避免代理凭据丢失。
- `pnpm runtime:setup <Artemis路径> <真机序列号>` 仅供首次初始化，已有配置时跳过。设备 Agent / worker 仍由 `pnpm runtime:agent` / `pnpm runtime:worker` 单独运行。
- 根入口 `pnpm test:playwright` 验证真实 Web 页面；`pnpm test` 为补充回归，`pnpm build` 构建 Web，`pnpm build:runtime` 检查运行时类型。

### 测试与验证规范（强制）

- **不使用独立 E2E 测试方式进行项目验收，统一使用 Playwright 进行真实浏览器测试与验证。** 不新增或运行其他 E2E 测试套件来替代 Playwright 验证。
- Playwright 必须从实际 Web 入口操作页面、填写表单、点击按钮，并断言页面反馈和最终状态；不得通过直接调用后端接口、修改数据库、预置成功状态或 Mock 业务结果绕过待验收流程。接口、日志及数据库的只读检查只能作为补充证据。
- Playwright 也能覆盖跨页面完整流程；这里指定的是验证工具与真实操作方式，并非禁止完整业务链路验证。不能仅凭脚本名包含 `e2e` 判断是否合规，也不能仅通过改名宣称完成迁移。
- 保留可复现的 Playwright 脚本、执行命令、环境、断言结果及必要截图；截图和日志须保护密码、验证码、令牌等敏感信息。页面能打开、截图成功或脚本未报错，不等于业务验收通过。
- Web 发起 → Artemis 执行 → 人工介入 → 最终回执的验证，须通过 Web 发起任务及提交人工反馈。Playwright 负责 Web 操作，Artemis 负责真机 App 的识别、决策与执行，不得以固定手机操作脚本替代 Agent 决策。没有真实设备或外部条件时，记录阻断，不能用模拟结果宣称链路跑通。
- 单元测试、非 UI 集成测试、类型检查、lint 和构建可作为补充检查，不能替代 Playwright 的 Web 验收，也不能证明真实登录、真机操作或公开发布成功。未获得明确授权，不得点击最终发布按钮或扩大任务权限。
- 遵守现有服务启动纪律：使用已启动的服务，或在用户明确授权后启动／重启；验证命令单次运行后退出，服务不可用且未获启动授权时记录阻断。报告明确区分通过、失败、阻断和未验证。

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
- **Commit Message 格式**：
  `[<模块名>] <动作>: <简明说明>`（例如 `[artemis-controller] fix: 严格限制 1:1 设备账号路由，杜绝串号派发`）。

---
