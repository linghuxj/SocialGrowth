# pnpm 工作区与统一启动验收

日期：2026-09-21（Asia/Shanghai）。本次调整包管理、启动入口和开发文档，沿用本机 pnpm 8.14.0；Node.js 验证版本 24.16.0，项目最低版本 22.13.0。

## 变更

- 新增 `pnpm-workspace.yaml`，覆盖根项目与 `apps/*`、`services/*`，共 6 个 workspace 项目。
- 导入已有 npm 锁定依赖为 `pnpm-lock.yaml`，移除根目录及 Web 子项目的两份 `package-lock.json`；旧锁可从 Git 历史恢复。
- 根目录显式声明 `tsx`、Node 类型和 `concurrently`，避免依赖 npm 提升后的偶然可见性。
- 根 `pnpm dev` / `pnpm start` 前台统一管理 Web 与 execution-runtime；服务名区分日志，Ctrl+C 或任一子服务退出会停止其余进程，失败状态向调用者传递。
- `pnpm dev:web` / `pnpm dev:runtime` 支持独立启动。Web 子进程在自己的工作目录直接加载 `.env.runtime`，保留运行时代理认证。
- `pnpm test:playwright` 统一真实浏览器验证入口；检查实际页面发出的 state / status 请求为成功，并核对四个页面标题与连接状态。未主动调用接口伪造页面状态。
- README、AGENTS.md、CLAUDE.md、各模块运行指南改用 pnpm；历史验收报告保留当时实际执行的命令。

统一启动只管理 Web 和运行时，设备任务仍使用独立 `runtime:agent` / `runtime:worker`。没有启动设备 worker 或消费旧发布任务。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 清空依赖目录后的 `pnpm install --frozen-lockfile` | 6 个项目成功安装；原 node_modules 已移动到本机临时备份目录，可恢复 |
| `pnpm test` | 102 / 102 通过；补充业务与运行时检查，不代表真机公开发布 |
| `pnpm build` | Web 构建通过；既有 vinext 静态路由分类 Unknown 提示保留 |
| `pnpm build:runtime`、Web `tsc --noEmit` | 通过 |
| Playwright 脚本独立 TypeScript / 静态检查 | 通过；根脚本采用显式 Node 类型检查，不套用 Web tsconfig 的文件范围 |
| `pnpm dev` + `pnpm test:playwright` | Web 3000、运行时 4318 同时启动；首页、账号、内容、执行记录 4 个页面与实际运行时响应通过 |
| 对统一入口发送 Ctrl+C | 整组退出，3000 / 4318 两个端口均释放 |
| 临时无效端口 `SG_RUNTIME_PORT=invalid pnpm dev` | 运行时启动失败，Web 被联动终止，顶层退出码为 1；两端口均未残留。环境覆盖仅限该命令，未写入配置 |
| `pnpm start` | 正常重新启动整组服务 |
| 数据核对 | 原任务仍为 queued；没有在途 Web 真机任务；已有配置、素材和数据库保留 |

真实 Web 截图及 JSON 检查结果保留在本机输出目录，不提交账号截图或运行配置。发布链路的独立阻断继续以 `2026-09-21-real-web-publication-validation.md` 为准，本次启动迁移不改变其验收结论。

## 用户终端启动失败的复现与修复

此前验收只覆盖 Agent 非交互环境 `/usr/local/bin/node` v24.16.0，没有覆盖用户交互终端 `/Users/linghuxj/.n/bin/node` v22.12.0。不能用上表推断用户终端启动成功。使用后者实际执行 `import('node:sqlite')`，复现 `ERR_UNKNOWN_BUILTIN_MODULE`。22.12.0 默认不提供该模块；[Node.js 22.13.0 发布说明](https://nodejs.org/en/blog/release/v22.13.0)记录解除 SQLite 开关要求。

修复范围：

- 根 `.npmrc` 通过 pnpm 8 的 `use-node-version=24.16.0` 固定项目运行环境，并严格校验 engines。pnpm 下载和缓存项目 Node，不修改用户的全局 Node 或 shell 配置；不加入旧版本兼容分支或 SQLite 实验开关。
- 新增无依赖 `pnpm env:check`，输出真实 Node 版本、可执行路径及内存 SQLite 探针结果。统一启动与独立 runtime 启动前执行；不满足条件时明确失败，不继续启动服务。
- 同步 README、AGENTS.md、CLAUDE.md 与运行时说明，说明首次联网下载要求。`node -v` 与 pnpm 实际运行版本可能不同，不再仅凭 engines 声明推断环境一致。

本次复验使用 `zsh -ic` 加载用户的真实交互 shell，初始 `node -v` 仍为 v22.12.0：

| 验证 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 6 个项目完成安装；自动获取 Node 24.16.0；没有 unsupported engine 告警 |
| `pnpm env:check` | v24.16.0，实际路径 `/Users/linghuxj/Library/pnpm/nodejs/24.16.0/bin/node`，SQLite OK |
| Web workspace `pnpm exec node` | 同样使用上述 v24.16.0，嵌套命令未退回全局 22.12.0 |
| 直接用旧 Node 执行 `scripts/check-node.mjs` | 退出码 1；输出旧版本、实际路径与修复命令 |
| `pnpm dev` | Web 3000 和 runtime 4318 均启动，无 `node:sqlite` 错误 |
| `pnpm test:playwright` | 首页、账号、内容、执行记录 4/4 页面标题及连接状态通过，页面实际 state/status 响应成功 |
| `pnpm test` | 补充回归 102/102 通过 |
| `scripts/check-node.mjs` oxlint、`git diff --check` | 通过 |
| Ctrl+C | 整组正常退出，两个监听端口均释放；未留下常驻验收实例 |
| 只读任务复核 | 仍为 1 个 queued 任务；未启动 worker 或执行发布任务 |

Playwright 本机证据：`/Users/linghuxj/Documents/Codex/2026-09-20/new-chat/outputs/pnpm-node-fix-20260921/browser-readiness.json`，检查时间 `2026-09-21T02:36:20.688Z`；同目录保留页面截图。验收仅证明 pnpm 环境管理与真实 Web 启动链路修复，不代表 FB/YT 公开发布验收。
