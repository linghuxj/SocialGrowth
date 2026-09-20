# 2026-09-20 真机发布链路修复与验收边界

依据：[最新真机交接 DP-01～DP-10](2026-09-20-device-publishing-verification.md)。本轮用户授权按该清单修复；补充指示是查找并复用已拉取、已配置的 Google Artemis。保留原交接文件、截图及已有未提交修改。

## 结论

新增 `services/execution-runtime`，接通本地 Web 命令、SQLite 持久化、WebSocket Pull 队列、Google Artemis MCP 适配、素材校验及归档回执。控制台现已使用运行时 API；原浏览器状态有显式备份与迁移入口。原控制器的提前派发、执行中重复入队、已排队任务绕过暂停、迟到回执归属不足及平台账号交叉匹配问题已修复。

**工程实现和下列受控验证通过；已有 Artemis 与三星手机的只读 MCP 连接、真实账号唯一身份核对及素材双端哈希通过。Facebook 发布前任务已真实运行，但 Artemis 在媒体选择器阶段因上游模型请求 `413 Request Entity Too Large` 超时，回执保守记为 `unknown` 且 trace 已停止。真实公开发布、YouTube、生产部署和真实指标自动回采未完成，不能标记全量业务收口。**

## 已找到的实际 Artemis 环境

- 项目：`/Users/linghuxj/.gemini/antigravity/brain/0df54168-345f-4b8d-9360-bb757d0c6a2c/scratch/artemis`
- 版本：`371aa6df56880643da57b30da936e9812fb0ec66`，附既有本地修改；本轮未修改此工作树。
- 入口：该目录 `.venv/bin/python -m artemis mcp`，使用其已有 `.env` 与 `config/artemis.jsonc`。
- 已有修改覆盖 `artemis/__init__.py`、`artemis/__main__.py`、`artemis/llm/router.py`、`pyproject.toml`、`uv.lock`；保留其兼容性处理，不套用临时目录中的失败结论。
- 本机 `.env.runtime` 和 `.env.agent` 已生成，权限 0600、Git 忽略。仅保存运行时与设备连接参数；未伪造账号绑定、权利材料、自动化许可或发布批准。

## 逐项处理

| 编号 | 已完成工程内容 | 尚需验收或输入 |
| --- | --- | --- |
| DP-01 | 复用实际 Artemis 环境；MCP SDK stdio，显式序列号、原生 App 锁定、任务运行/查询/停止；真实 `mobile_get_device_state` 和两个独立身份核对 trace 成功；修复 Artemis daemon 启动响应省略 `device_serial` 的兼容问题，并固定单次执行使用其 standalone 路径 | 发布前 trace 在媒体选择器遇到上游 `413` 后超时，尚未得到完成回执 |
| DP-02 | Web API 命令、服务端领域校验、乐观版本、SQLite 事务、唯一排期/尝试、WS Pull、刷新读取、旧数据迁移 | 真实用户完整浏览器验收；单机以外的生产身份/部署另验 |
| DP-03 | 服务端上传/哈希、任务范围签名下载、Agent 哈希、设备端哈希、MediaStore 扫描；链接过期不重建尝试；真实 9,989,392 字节 MP4 的主机/设备 SHA-256 `5fe19c6d…c4dd` 一致 | Facebook 原生选择器已显示目标 60 秒视频，但 Artemis 未完成选择；当前本机文件存储，未部署 S3/MinIO |
| DP-04 | 证据归档、任务归属、原始事件、迟到/冲突处理、公开 URL/ID 必填条件、未知暂停、人工核对、Agent 持久回执补传 | 真实平台公开 URL/帖子事实尚无，不以替身结果冒充 |
| DP-05 | 发布参数表单和服务端门控：Public、文案、AI 标签、音乐权利、本次公开批准 | 真实账号身份、素材权利、文案/标签及本次批准需运营提供 |
| DP-06 | YT 原生包检查、唯一频道身份、儿童受众字段与流程参数 | 未安装或登录 YouTube；未代用户创建/切换频道，真机验收待设备运营 |
| DP-07 | 服务端唯一 device/platform/account 绑定及有效期；执行前 Artemis 核对平台唯一身份，错配停机；真实账号 URL 两次精确核对为 `https://www.facebook.com/profile.php?id=61550800776808` | 该个人账号的业务所有方授权依据仍须运营归档；YouTube 身份未建立 |
| DP-08 | 账号所有方授权、自动化允许范围依据字段和审计；不记录账号密码 | 实际授权/适用平台许可材料仍需业务提供 |
| DP-09 | 带来源/时间/证据的公开可见性、处理状态和限制通知记录 API；保留现有指标观察与缺失语义 | 官方/第三方指标提供方凭据、真实数据采集及平台公开观察验收未完成 |
| DP-10 | 可重复 Agent 单次运行；发布前/正式模式、动态定位指令、媒体摘要、身份核对、超时停止和证据；真实任务超时后 `mobile_manage_task(stop)` 生效，trace 状态为 `cancelled`，没有自动重试 | 媒体网格导致模型请求体过大，尚未到达最终提交页；模式指令不是 LLM 动作形式化保证 |

## 验证结果

- Web 领域测试：28/28。
- Controller：8/8，包括未到排期、已入队任务暂停、执行中重复、硬超时、迟到回执归属及跨平台错配。
- 跨模块首条闭环：3/3。
- 运行时：11/11，包括真实 HTTP/WS、服务端权威资格、SQLite 重启、签名下载、证据范围、人工核对、回执丢 ACK 后补传、旧数据迁移及公开事实观察。
- Web TypeScript/构建及本轮修改文件 lint 通过；Controller、Runtime TypeScript/构建及 lint 通过。Web 定向 lint 使用该工作区固定的 `./node_modules/.bin/oxlint`，不混用根工作区的不同版本。
- 全量 Web lint 仍有既有通用组件/hook 报错；不把针对改动文件的检查当成全库 lint 通过。
- 真机：Samsung SM-S9110 / `RFCW40MYYCV` 重新连接后，MCP stdio 调用 `mobile_get_device_state(view_type=hierarchy)` 成功，返回 3110 字节，SHA-256 `68ad7eebcc579124b4967f5b15aefe8ef4eb69de89d66d2cecb9437a4749cf30`；界面动作 0，发布提交 0。
- 真实只读身份任务：trace `c9c145c3-560c-4763-b850-a9b7fe686524` 完成，精确读取 Facebook profile ID `61550800776808`，结构化结果报告 `mutationsPerformed=0`。
- 第一次运行时尝试暴露 Artemis daemon 返回不含 `device_serial` 的合法响应；本地保守回执为 `unknown`。遗留 trace `0bc65db3-b58e-45a2-9eba-46e280e83c09` 仅再次做身份核对，最终 `completed/result=null`，截图仍为 Profile Settings，未进入媒体或发布流程。适配器已兼容可选 serial，并让单次 Agent 固定使用 standalone MCP 分支；回归 11/11 通过。
- 修复后的真实 Facebook preflight：主机与设备端均核对 60.066667 秒、720×1280 H.264/AAC MP4，SHA-256 `5fe19c6d1fe5e2c636a12ee7f559ecc177ebc04876d30e2525e85627ce40c4dd`。身份 trace `7464fcf1-7d47-4c43-8fdb-b3d416484708` 完成且账号匹配。预检 trace `44b168f4-20cd-46ee-b73d-74003a8bdbef` 打开 Facebook `New post` 媒体网格，随后上游模型连续返回 `413 Request Entity Too Large`；9 分钟运行时超时触发停止，最终 trace `cancelled`，回执 `executionStatus=failed / publishStatus=unknown / failureCode=TECHNICAL_FAILURE`。最终截图仍在媒体选择器，无素材已选、无文案、无最终提交动作、无公开帖子。
- 真实证据归档在 [`artifacts/reports/2026-09-20-runtime-real-preflight`](../../artifacts/reports/2026-09-20-runtime-real-preflight)；不含密钥或视频原件。

自动化测试中的设备与业务输出是明确替身；真实真机结果单独列证。未启动常驻开发/执行服务；代码修复提交为 `cc8a84e`，本次真实验收兼容修复另行提交；未推送或部署。

## 启动与下一步

在仓库根目录，由开发者手动在两个终端执行 `npm run runtime:start` 和 `npm run runtime:web`。旧浏览器工作区已备份到本机 Downloads；迁移后仍需登记实际绑定、权利与业务参数并重新批准排期。Facebook 再次预检前应先解决 Artemis 对密集媒体网格的请求体控制（截图压缩/裁剪、上下文压缩或确定性选择器）；不得直接重跑当前 `unknown` attempt。YouTube App 当前未安装。

配置、运行时状态与备份要求见 [运行时说明](../../services/execution-runtime/README.md)。当前单次 Agent 不自动常驻轮询；待批准排期到期后运行。生产系统的身份权限、对象存储、远端网络和常驻运维仍需独立落实。
