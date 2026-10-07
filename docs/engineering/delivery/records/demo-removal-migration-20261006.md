# Demo 删除与单一产品迁移记录

日期：2026-10-06。用户已确认开始删除和迁移。修改位于 `dev` 工作目录；未提交、未推送、未晋级 `main`。本次基线 HEAD 为 `3040899b368e9feaf91c509ea77319cf0c00841c`。其他任务已有的未提交修改保持原内容。

正式入口为 `product/web`。既有手机执行能力迁入 `product/executor`。正式 Web 使用同一运营登录、会话和 CSRF 校验。旧 Web 已停止，不再提供新旧产品选择。历史文档和历史证据只用于追溯。

## 删除与迁移

| 原位置 | 处理 | 当前承接 |
| --- | --- | --- |
| `apps/web-console` | 删除整个旧 Web 工程 | `product/web`；新增“执行与人工协助”入口 |
| `apps/artemis-controller` | 删除独立控制器工程 | 必要回执类型进入 `product/executor/src/runtime/domain/execution-receipt.ts`；正式业务后端负责控制 |
| `services/execution-runtime` | 迁移公共源码、补丁和示例后删除原目录 | `product/executor/src/runtime`、`patches`、`artemis-patches`、`examples` |
| `services/ai-engine` | 删除旧模板工程 | 保留正式产品的业务规划和 AI 实现；不将旧模板视为真实 AI |
| `services/shortlink-service` | 删除旧工程 | 保留正式产品承接链接及其验证规则 |
| `prototypes/android-endpoint-probe` | 删除旧诊断原型工程 | 保留 `product/android` 和原网络实测证据；本次未修改 Android 源码 |
| 旧 Web 的 `first-loop/engine.ts`、`types.ts`、`catalog.ts` | 迁移仍被执行器使用的规则 | `product/executor/src/runtime/domain`；相应规则测试同步迁移 |

工作区只保留四个正式 TypeScript 包：Web、backend、contracts、executor。Android 保持独立 Gradle 工程。更新唯一 `pnpm-lock.yaml`；安装移除 451 个旧依赖，增加 4 个迁移所需依赖。执行协议继续使用 Zod 3 别名，以保持原解析行为。正式契约继续使用原版本。

删除旧 `tests/first-loop-integration.test.ts`。删除下列 17 个旧入口脚本：

```text
verify-web-e2e.mts
verify-operations-consolidation.mts
verify-device-initialization-web.mts
verify-identity-onboarding-web.mts
verify-web-publication-readiness.mts
verify-demo-observation-playwright.mts
verify-demo-client-playwright.mts
verify-runtime-core-recovery-playwright.mts
execute-web-slice-workflow.mts
inspect-ui-details.mts
verify-worker-and-device-farm.mts
monitor-device-farm-live.mts
run-artemis-and-monitor-screen.mts
run-complete-preflight-workflow.mts
execute-real-slice-publication.mts
verify-human-login.mts
verify-phone-initialization.mts
```

其余必要手机维护脚本指向迁入后的执行器。根命令取消 `dev:demo`、Demo Playwright 和 `runtime:*`。保留 `executor:setup/start/agent/worker/check-artemis/check-apps`。已有私密配置不重新生成。Agent 和 worker 必须单独启动；统一启动不会自动执行手机任务。

## 唯一操作入口

`pnpm dev` 管理 Web 3100、后端 4320 和已配置的执行服务 4318。执行器复用前须通过带认证的正式服务健康检查。自有服务退出时停止本轮自有服务组。数据库保持原位置。原手机远程网关保持原服务。

正式 Web 的“执行与人工协助”页可读取原任务、回执、设备占用、人工协助及安全登录请求。页面包含受控检查、停止、人工反馈、凭据提交和占用控制。后端仅代理固定路由；浏览器不持有执行器令牌。截图经过运营会话认证。失败响应不返回原始令牌或凭据。未确认的提交须查询原请求，不自动重发。

本次只验证了真实登录、原记录展示、无效表单拒绝、查询和退出。没有真实提交手机任务、人工反馈或凭据。已有账号准备和项目执行由正式业务页面承接；不会复制旧 Web 的独立业务排期及浏览器本地状态模型。

## 原状态与备份

原 `.runtime/runtime.sqlite` 和 `.runtime/agent.sqlite` 保持原路径。原任务 ID、证据、占用、未知结果、Artemis 配置及 vendor SDK 保留。SQLite 不迁入中心 PostgreSQL，不重放历史任务。两个数据库各自保持原职责。

在停止旧服务后，使用 SQLite 备份接口生成一致性备份。私密备份在 `.runtime/migration-backup-20261006/`，目录权限为 0700，文件权限为 0600。该目录不进入 Git。公共源码备份在本机 Codex 可视化工作目录的 `socialgrowth-demo-migration/public-source-before.tar.gz`；清单含 313 个公共文件及摘要，不包含私密配置、数据库和 vendor SDK。

迁移前后只读比较结果：

- 执行库 23 张表的记录数量及逐表 SHA-256 全部一致。
- 保留 9 个原任务、43 个受控检查、37 条证据和 1 条设备占用。
- 本地任务、检查、控制、Agent 请求和人工协助的活动数量均为 0。
- 中心工作流状态数量保持一致。仍有 1 条原工作流显示 `running`；其提交状态为 `unknown`，原租约已过期。本地对应执行也保留 `unknown`。

状态检查脚本遇到中心未决流程时返回 2，明确标记未决状态。迁移没有把它改成成功或失败。没有重试该流程，也没有释放原占用。数据库摘要一致仅证明本次状态未变，不证明该原流程已经闭环。

## 验证结果

环境：macOS 本机，pnpm 8.14.0，项目 Node 24.16.0；实际 Node 路径由 `pnpm env:check` 输出。使用现有 PostgreSQL 和 SQLite。Web 为真实本地正式入口，浏览器使用 Chromium。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile`、`pnpm env:check` | 通过 | 唯一锁文件、四个正式包及根包；SQLite 可用 |
| `pnpm check:product`、`pnpm build:product` | 通过 | 正式工程类型及构建；包含旧目录和引用守卫 |
| `pnpm lint:product`、`git diff --check` | 通过 | lint 有既有非阻断警告；diff 无空白错误 |
| backend / executor / Web 回归 | 通过 | 分别 442、182、89 项；非 UI 补充检查 |
| contracts TypeScript / Python | 通过 | 分别 98、39 项 |
| 核心过程补充断言 | 通过 | 4 项合成场景；不能作为真实发布验收 |
| `SG_PRODUCT_LOCAL_LIVE_TEST=1 SG_PRODUCT_WEB_SCOPE=executor-console pnpm test:playwright` | 通过 | 5 项真实浏览器断言；显示 9 个原任务和 43 个回执；未执行手机操作 |
| 原状态摘要比较 | 通过，仍有未决状态 | 23 表摘要一致；中心状态数量一致；保留原 unknown |
| 文档一致性检查 | 失败 | 迁移造成的链接已修正；原有需求追踪仍缺 R-160、R-161、R-162 |
| 真机及 MinIO 补充测试 | 阻断／未验证 | 初次测试无可用 ADB 设备，MinIO 不可用；没有以模拟结果替代 |
| 完整手机业务链路、真实人工反馈、真实凭据传递、公开发布 | 未验证 | 本次未运行，不新增通过结论；原实测按其环境及范围保留 |
| Android 构建和真机验收 | 未验证 | 本次没有 Android 源码改动 |

初次浏览器读取发现两条历史回执缺少 `mode`。显示值修正为 `unknown`，数据库不补写模式。最终浏览器复测通过。补充测试中发现的合成数据字段缺失、私有数据库连接被序列化及并发资源争用已作最小修正；没有放宽权限、发布状态或未知结果规则。

执行器默认回归包含无需真实设备和存储服务的测试。资源补充检查保留为明确的 `test:device` 和 `test:storage` 命令。它们的阻断不计为通过。

## 证据与发布边界

- [原状态比较](../../../../artifacts/acceptance/demo-removal-migration-20261006/state-comparison.json)
- [迁移前摘要](../../../../artifacts/acceptance/demo-removal-migration-20261006/state-before.json)与[迁移后摘要](../../../../artifacts/acceptance/demo-removal-migration-20261006/state-after.json)
- [真实浏览器结果](../../../../artifacts/acceptance/executor-console-migration-20261006/result.json)与[脱敏截图](../../../../artifacts/acceptance/executor-console-migration-20261006/formal-execution-console.png)
- [验证命令汇总](../../../../artifacts/acceptance/demo-removal-migration-20261006/validation-summary.json)
- [单一产品决策](../../../adr/0013-single-product-remove-demo.md)及只读盘点的历史记录（原来源 `docs/engineering/delivery/records/demo-dependency-markers-20261006.md` 已移除，见[处置记录](documentation-cleanup-20261006.md)）

证据位于本机忽略目录，未进入 Git。历史设计预览和历史文档保留为参考，不纳入工作区或产品启动。已修正本轮删除造成的正式文档失效链接。

代码整理和本地入口切换已完成。`main` 仍是原固定版本 `c7461c1e466d36ff996e6a1d1f0290272f67f6cd`。本次未标记正式发布，未执行生产部署。未决业务结果、完整业务验收及需求追踪缺项须分别处理。
