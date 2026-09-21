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
