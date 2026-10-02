# Artemis 私有读屏桥接与拒绝路径

2026-10-02；输入提交 `ca22974b77601497bd3ec61a2b07bffbb2bf7a1a`，承接“继续推进下一阶段内容”，沿用 `codex/core-automation-loop-stage1`。本轮完成 Python／实际 SDK driver → 私有 IPC → 原本地 fence → 受控 transport 的源码组合及组件验证。**完整物理隔离、真实检查器和正式真机闭环仍未完成**。作者结果，不代替非作者复核／独立 QA，不合入 Developer、不更新父 pending。源码与证据见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/manifest.json)。

## 实际实现

`ArtemisReadScreenBridge` 使用规范化、本人所有的 0700 父目录及 0600 Unix socket，拒绝已有路径和错误物理映射。listen 前要求原 holder 在本地 ledger 中当前 enabled，且准确 device／serial／holder／authorization／attempt／generation／用途、租约和唯一 read_screen 范围匹配。固定作用域生成 digest 与私有随机 token，通过可信 task 启动输入交接，不写模型、普通日志、环境开关或公共 HTTP。

IPC 只接受协议、原 requestId、scope digest 和 token，strict schema；不收手机、命令、kind 或事实声明，frame 最多 1024 bytes、最多 16 条连接。requestId 就是原 ledger actionId，每次真正读取仍调用 `PhoneActionFence.execute` 和当前中央授权端口，不能把 IPC token 当作手机许可。丢连接不取消／重置已提交原动作；同 ID 重放无再次读取或截图缓存。截图完成后若本地 scope 已暂停／替换／到期，拒绝返 pixels，但保存原真实回执。关闭 bridge 等待原 work 收口，不提供手机停止证明。

`socialgrowth_read_screen.py` 只使用 AF_UNIX，核验原 socket inode、文件／父目录归属及权限、准确响应协议／request／scope／长度／摘要／尺寸；拒绝截断、尾随和不完整响应，不自动重连／重试，没有直接 ADB 或占位图片。私有 token 不进入 repr。

`ReadOnlyArtemisDriver` 实现本地实际 SDK 的 `BaseDeviceDriver`，真实桥接数据构造原 `ScreenData`。每次读取都跨 host fence；不伪造 hierarchy、package 或默认尺寸。写入、导航、安装、App 管理、录制、shell 和层级等不在当前 read_screen 范围的入口全部拒绝。connect 只是本地生命周期，disconnect 只是拒绝新读屏，二者不作为网络／ADB／停止事实。

`bind_read_only_context` 仅供准确 serial 的全新专属 task 进程：拒绝已有 raw client／driver、第二次绑定或后续替换缓存；既有 factory 的缓存 accessor 可解析到这个实际 driver。绑定在该进程中拒绝已核对的 raw Android driver、UIAutomator、adbutils connection／send_command 和 AdbSession 调用，Python audit hook 拒绝新 subprocess／os.system／exec／fork。它在进程内永久生效，不能在共享 MCP／daemon 上原地安装。拒绝使用 `PhysicalPathDenied(BaseException)`，越过 SDK `except Exception` 的 raw／headless 回退，不能把拒绝吞成假的 PNG。

本仓库 supervision／human_input／observer overlay 已接绑定分支：只暴露获准读屏／等待和 note 工具；拒绝任意 action_names 扩权；保护输入、人工补图／刷新、安装及层级工具不暴露，observer 经同一 bridge 捕图，拒绝后没有 raw ADB fallback。未绑定的既有 Demo 分支保留原行为。**没有复制这些文件到现有 SDK checkout，也没有注册正式 worker 或权限 HTTP**；既有 SDK 外来修改和模型配置保留。

## 覆盖与限制

在实际本地 SDK `371aa6df56880643da57b30da936e9812fb0ec66` 的独立 Python 3.12 进程中，原 `ScreenData`／factory、当前仓库 overlay、真实私有 socket、SQLite ledger 和有界 transport 已组合验证。组件中的中央 authority／网络／停止证明、可执行文件和 2×2 pixels 均为明确的**合成 fixture**；没有调用模型、真实 adb、手机或平台。实际 SDK 源码含既有外来工作，只读兼容清单见[sdk compatibility](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/sdk-compatibility.json)。

进程内 Python hooks 不是 OS sandbox，不能证明其他进程、预先捕获的原始方法、任意 native library 或全部网络连接已被封闭，也不产生 `allPathsFenced=true`。这些问题及已存在控制者必须由实际专属进程／OS／网络／目标边界和原停止证据解决。中央 broker 的真实检查器仍为 null；正式 executor disabled，不能凭类存在、token、已保存核验或组件输出放行。

只读重新查询 Demo 原 task `d634e4c6-4266-4cc7-a784-3a31a1737cac` 的 ID／status，仍为 unknown；见[原操作只读证据](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/original-operation-readonly.json)。没有查看模型私密输出、回填停止证明、清除未知或重发任务。既有 Google Artemis 已验证引擎能力按原覆盖范围复用，不重复验证模型供应商。

## 验证结果

| 检查 | 结果与实际范围 |
| --- | --- |
| `pnpm env:check` | pnpm 8.14.0、项目 Node 24.16.0、SQLite OK |
| `pnpm test:product` | 589 通过：contracts TS 69／Python 38、backend 340、executor 56、Web 86；非 UI 补充检查 |
| 私有桥接组件 | 7／7：socket 权限、实际原 fence／有界 transport capture、原 ID 重放、错 token／scope／协议／注入／超量拒绝、当前停止拒绝、丢连接、timeout unknown 保留、错物理映射／文件权限拒绝、执行中暂停不返 pixels；最后关闭 iterable lint 整改后再做 7／7 |
| 实际 SDK 组合组件 | 1／1：两次授权合成 capture；原 SDK factory／ScreenData 与 observer 经 bridge；29 个不支持／原始路径／错误 serial／二次绑定／上下文替换／已关闭／禁止回退检查拒绝。不是二十九项真机验收 |
| Python IPC codec | Python 3.12 下 5／5：错响应 scope／身份／协议、损坏／截断／尾随／错尺寸／超量、unavailable 不重连、公开路径拒绝、坏 request ID 与私有 repr；纯协议合成 host |
| 既有 overlay 回归 | 10／10：未绑定分支的已有监督／保护输入纯组件检查，不操作设备或凭据 |
| executor `check`／`build`／`lint` | 通过；移除新增无用 spread 警告后再次 build／lint，最终无该 warning；无生产逻辑追加 |
| 根 `pnpm test:playwright` | 正式 account-preparation 八类实际页面场景通过，页面错误 0；当前缺条件保持阻断，旧核验／版本、丢 ACK 原键接续、重载、桌面／390px 只读均保留 |

首次 bridge 5／6，丢 ACK fixture 在子进程回执完成前作断言；改为实际 started／ended marker 后通过，无重复物理调用。保留[首次摘要](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/bridge-first.json)和最终日志，未将 fixture 时序错误解释为设备故障。当前最终无未解决检查失败。

Web 使用本轮专属回环 PostgreSQL 17 空库 `sg_bridge8_web`，检查准确库名及集群 ID 后完整迁移 0001～0030，标准运营初始化从 stdin 提供临时登录。项目、请求、核验、接续和重载均通过真实页面，不播种手机／网络／grant 成功事实。[只读 SQL](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/sql-readonly.json)确认 tasks=2、reviews=1、holder grants=0、begin calls=0、Artemis intents=0；Web 是既有阻断流程回归，不能替代新 bridge 或真机闭环验收。[结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/ui/result.json)、[桌面](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/ui/preparation-desktop.png)、[390px](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/ui/preparation-mobile.png)已检查。

复现：`pnpm test:product`；`pnpm --filter @socialgrowth/product-executor exec tsx --test src/artemis-read-screen-bridge.test.ts`；实际 SDK 组合使用同样命令的 `src/artemis-read-screen-bridge.sdk-test.ts`，从根通过 filter 执行，需本地 SDK 既有 `.venv`，不会启动 Artemis／模型；Python codec 用 `PYTHONPATH=integrations/artemis PYTHONDONTWRITEBYTECODE=1 integrations/google-artemis/.venv/bin/python -m unittest test_read_screen`，已有 overlay 用相同 Python、包含 SDK root 的 PYTHONPATH 执行 `-m unittest test_supervision test_human_input`。

[Web 辅助脚本](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/web-runner.mjs)需已授权的专属空库 `sg_bridge8_web` 和 `SG_PREPARATION_FIXTURE_DATABASE_URL`／`SG_PREPARATION_FIXTURE_CLUSTER_ID`，从根 `pnpm exec node <脚本绝对路径>` 执行；只允许准确回环库、集群、空 schema 和空闲 3100／4320。不启动设备 worker，不在共享／业务库 reset。

## 收口及下一步

本轮私有 sockets、Python／合成 transport 子进程及临时 fixture 已退出／清理；专属 Web／backend 退出，核对准确 container ID 和 `socialgrowth.owner=bridge8-20261002` 标签后仅删除本轮 PG 容器／卷，其他三个容器保留。临时 token／登录只在内存、stdin／受控子进程环境，不存普通证据，日志脱敏；资源见[收口记录](../../../../artifacts/acceptance/product/B3/account-preparation-stage8-20261002/resource-closure.json)。受保护发布脚本仅路径／状态核对，未读取、修改、暂存或执行。

通过：私有只读接线、已列出的 SDK 进程内拒绝路径、组件和 Web 阻断回归。失败：最终无未解决检查失败。阻断：完整实际 OS／网络／目标隔离和真实检查器、原 unknown 的可信停止证明。未验证：专属真实 Artemis task 的加载与恢复、真机参与 APK、正式 Web→Artemis inspect_app、实际控制交还、独立平台证据消费。新增 Artemis MCP／模型调用、真机动作、平台创建和公开发布均 **0**。

下一步将这些 source overlay 纳入受控专属 task 启动，实际验证完整进程／网络保护和停止核实；覆盖缺失仍拒绝启动。在当前本机参与、正式接入、ADB 准确目标和原停止事实成立后，再组合原 broker／journal／dispatcher，从 Web 只发一次 inspect_app；后续可信证据消费者独立核验 App／账号／身份，不因组件图片或模型报告授予发布能力。
