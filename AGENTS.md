# SocialGrowth Agent 工作规范

> 2026-09-27：当前产品要求以[需求基线](docs/current-requirements-summary.md)及最新用户确认为准，来源见[修订记录](docs/requirements-alignment.md)。现有实现仅为 Demo，用于局部可行性与闭环验证；不能从已有页面、代码或技术栈推定最终设计。以下规范适用于操作现有仓库，不锁定最终实现方案。

本文件适用于整个仓库。执行任务前须阅读并遵守 [CLAUDE.md](CLAUDE.md) 中的工程规范与业务边界。

## 开发方式：不要过度设计

2026-10-05 用户确认：后续采用[简化开发与验证规范](CLAUDE.md#简化开发与验证2026-10-05-用户确认)。一次解决一个实际问题，优先复用现有实现，采用最小改动；小改动默认单负责人，验证范围与影响范围匹配，满足验收条件后收尾。不为未来假设增加框架、抽象、迁移或协作流程。涉及权限、未知提交、敏感信息和真实业务结果的必要约束仍须遵守。

## 分支与版本

2026-10-06 用户确认：只保留 `main` 与 `dev`。所有日常开发在 `dev`；`main` 管理完成部署条件核验的固定版本。版本晋级须按 [CLAUDE.md 的分支与版本规范](CLAUDE.md#3-git-提交与分支规范)执行，历史 Git 合并和局部检查不代表产品验收。

## 安装与启动

- 统一使用 pnpm 8.14.0，项目 `.npmrc` 自动下载并选择 Node.js 24.16.0（首次需要联网），不修改全局 Node。从根目录执行 `pnpm install --frozen-lockfile`；依赖以 `pnpm-workspace.yaml` 与唯一的 `pnpm-lock.yaml` 管理，不生成 npm / Yarn 锁文件。`pnpm env:check` 输出实际 Node 路径及 SQLite 检查结果，不用裸 `node -v` 代替项目运行环境证据。
- 根目录 `pnpm dev`（或 `pnpm start`）当前通过 `scripts/product-local-live.mts serve` 启动正式产品 Web（3100）与后端（4320），Ctrl+C 停止本轮启动的服务组；任一服务退出时其余服务一并停止。`pnpm dev:web` / `pnpm dev:backend` 可独立启动。历史 Demo 使用 `pnpm dev:demo`（Web 3000、execution-runtime 4318），不可混同两个入口的验收结果。
- 运行历史 Demo 的 execution-runtime 时，`.env.runtime` 必须已配置，且由实际服务进程加载。已有配置时不重新运行 `runtime:setup`。设备执行使用独立的 `pnpm runtime:agent` / `pnpm runtime:worker`，正式产品与 Demo 的统一启动入口不自动运行设备 Agent / worker。
- Agent 可按当前任务需要直接启动或重启本地服务，无需另行取得启动授权；操作前核验现有实例、端口及在途任务，优先复用可用实例，避免重复启动或中断未决业务。Web 验证入口为 `pnpm test:playwright`。

## 测试与验证（强制）

- Android 真机通过 USB 连接且 `adb devices` 显示为 `device` 时，Agent 可直接在当前任务范围内进行设备操作与测试，无需另行申请真机使用授权。操作前核对序列号、目标 App 与在途任务；多设备时显式指定目标，未授权／离线设备不视为可用。保持现有业务执行引擎、当前手机授权与任务范围要求，记录实际操作、结果及必要恢复。

- **不使用独立 E2E 测试方式进行项目验收，统一使用 Playwright 进行真实浏览器测试与验证。** 不新增或运行其他 E2E 测试套件来替代 Playwright 验证。
- Playwright 必须从实际 Web 入口操作页面、填写表单、点击按钮，并断言页面反馈和最终状态；不得通过直接调用后端接口、修改数据库、预置成功状态或 Mock 业务结果绕过待验收流程。接口、日志及数据库的只读检查只能作为补充证据。
- Playwright 也能覆盖跨页面完整流程；这里指定的是验证工具与真实操作方式，并非禁止完整业务链路验证。不能仅凭脚本名包含 `e2e` 判断是否合规，也不能仅通过改名宣称完成迁移。
- 保留可复现的 Playwright 脚本、执行命令、环境、断言结果及必要截图；截图和日志须保护密码、验证码、令牌等敏感信息。页面能打开、截图成功或脚本未报错，不等于业务验收通过。
- 运行现有 Demo 的 Web 发起 → Artemis 执行 → 人工介入 → 最终回执验证时，须通过 Web 发起任务及提交人工反馈。Playwright 负责 Web 操作，Artemis 负责真机 App 的识别、决策与执行，不得以固定手机操作脚本替代 Agent 决策。没有真实设备或外部条件时，记录阻断，不能用模拟结果宣称链路跑通。首期已按 R-106 明确选用 Google Artemis 作为手机执行引擎，但 Demo 的接口、部署和其他技术栈不自动成为最终方案；用户按 R-109 补充确认既有远程执行已验证，应复用原证据并注明环境及覆盖范围；当前重点是网络共存、新设备客户端与未覆盖的恢复能力，不将既有链路重新列为全未验证。不满足条件时重新对齐，不自动替换引擎。
- 单元测试、非 UI 集成测试、类型检查、lint 和构建可作为补充检查，不能替代 Playwright 的 Web 验收，也不能证明真实登录、真机操作或公开发布成功。未获得明确授权，不得点击最终发布按钮或扩大任务权限。
- 遵守服务管理纪律：优先使用已启动的服务；不可用或当前验证需要时，可直接启动／重启，并核验现有实例及在途任务。验证命令单次运行后退出，结束时清理本轮自有临时进程，不误停他人服务。报告明确区分通过、失败、阻断和未验证。

上述规则与 [CLAUDE.md 的测试与验证规范](CLAUDE.md#测试与验证规范强制) 保持同步；历史文档中的 E2E 描述不构成绕过本规则的依据。

## Autonomous agent teams

- Default to one owner for small fixes. Delegate only when independent, authorized subtasks benefit from parallel work or the change warrants specialist review; choose the needed roles instead of requiring a full team for every change. When teams are used, the lead uses gpt-6.1-sol/high; ux and backend use gpt-6-luna/medium; adversary uses gpt-6-astra/high. The rules below apply to delegated teamwork.
- Each live teammate owns a distinct detached worktree from a fixed dev SHA. Do not create persistent team branches. Reserve the workspace entry before editing, record each candidate head SHA, and integrate reviewed work into dev. Never share a worker checkout or edit the lead checkout. Historical tasks.json branch names remain historical references, not authorization to recreate deleted branches.
- The canonical task ledger is tasks.json beside the shared Git common directory. Run scripts/team-tasks.py from the canonical repository; all worktrees use the same persistent Git-directory lock. Do not edit tasks.json directly, delete the lock, or commit mutable ledger state.
- Read with `python3 /Users/linghuxj/Documents/myproject/project/SocialGrowth/scripts/team-tasks.py read`. Claim with `claim --task <id> --actor <runtime-agent-id>`. For other updates, send a complete updated JSON snapshot on stdin to `replace --revision <observed-revision>`; on conflict reread, merge your intended change, and retry.
- Task records contain id, title, role, status, owner, depends_on, contracts, and security_review. Use pending/in_progress/blocked/review/done statuses. Only claim tasks matching your role; only change your own task's work state. Preserve other teammates' records. Complete dependencies before claiming dependent work.
- Resolve API and interface contracts directly through available inter-agent messaging, without routine lead mediation. Contract records contain revision, body, participants (runtime agent IDs), and accepted_by. Each participant records its own agreement. Any body or participant change increments the contract revision and clears accepted_by; dependent work requires all participants to accept that exact revision. Do not hold the file lock while messaging, implementing, or testing. If peer messaging is unavailable, record a blocker rather than claiming agreement.
- Before opening a pull request for the lead session, teammates MUST request an independent adversary security review by direct message and receive approval for the exact candidate head SHA. Include base/head SHAs, scope, agreed contracts, and validation evidence. Record reviewer ID, SHAs, verdict, findings, and evidence in the task's security_review. Fix material findings and request re-review; any subsequent code change invalidates the approval. Block PR creation while review is missing, blocked, or changes_requested.
- Team autonomy remains within the authorized task scope and the existing service, device, Playwright, and publishing boundaries. Report passed, failed, blocked, and unverified checks accurately.
