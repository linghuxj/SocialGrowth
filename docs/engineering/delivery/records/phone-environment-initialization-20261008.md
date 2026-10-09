# 手机环境初始化候选记录：2026-10-08

## 当前结果

截至 2026-10-09，可信准备已完成，但第二轮 SFA 配置超时，原回执仍为 UNCONFIRMED。已将时限和安全配置衔接修订提交 dev，并部署手机固定候选 9c04033 到 mh；第三轮正式 Web 等待连接未通过，未新建手机任务。当前反向连接未恢复，已请求机主打开 SocialGrowth，随后才能继续核验。main 保持 bb52422，初始化尚未成功；下文前半部分为历史记录，最新结果见末尾。

使用用户提供的受保护 Clash YAML。解析通过：292 个代理、5 个组；部署副本关闭 TUN 与局域网监听，只保留回环代理。没有记录节点密码、订阅地址或接入密钥。

设备：Samsung SM-S9110、Android 16、RFCW40MYYCV；通过香港生产服务器的反向连接读取，无 USB 回退。2026-10-08 初次检查时 SFA、FlClash、官方 Tailscale 缺失，Facebook、YouTube 已安装。已有 App UI 修改和安装证据另见[UI 记录](android-preparation-ui-20261008.md)。

## 实际传输故障与核验

- 共用 ADB 时，6 MiB 读取只返回 53,248 字节，退出码仍为 0，耗时 11.38 秒；同轮观察到后端硬件检查在约 3.48 秒发起，符合其 8 秒超时断开路径。另一次 1 MiB 读取也被截断。
- 独立 ADB 服务 5038 上，6,291,456 字节全部返回，耗时 116.59 秒，之后原硬件序列号核验通过。5037 的健康检查保留。
- 小段完整传输证明此次分离能避免已复现的截断；不外推为大 APK 安装、长期稳定或新手机验收。完整应用代码包还在受保护目录收集，须继续做大小、SHA-256、签名与 split 校验。
- SFA 1.14.2 与 FlClash 0.8.99 可信包已做本地签名、包名和版本检查；上传后的 SHA-256 与来源副本一致。尚未由本候选安装到手机。

## 已通过的补充检查

后端目标／自动派发相关 9 项测试、执行器安装／初始化／人工协助／回执相关 40 项测试通过。初始化动作守卫 5 项 Python 检查通过；固定上游的部署补丁适用性检查通过。后端、执行器与 Web 构建、布局检查及 diff 空白检查通过。已补充重跑：初始化／回执 24 项测试通过，包含排队及未决任务拦截；后端 9 项含请求编号跨连接保持和归属竞态检查通过。受影响的 Web 和执行器已再次构建。修改文档的 30 条本地链接检查通过；旧全量文档检查器依赖已移除的 artifacts/reports/README.md，本次未将其失败算作通过。

## 仍需验证

1. 固定候选部署后，从真实 Web 查询／交还自动准备开始，观察原任务，不通过直接接口写入替代 Web 验收。
2. 自动安装缺失客户端、正常导入私有文件、机主 VPN 授权、FB 新响应及 YT 播放的真实 Artemis 检查。
3. 同硬件双通道至少 5 分钟观察，以及自动交接后的可用性。
4. 数小时后台／锁屏、重启、断网及 Wi-Fi 切换；这些不能由短窗口推定通过。
5. 零准备新手机首次注册、关联、授权和配对。现有 Samsung 测试不代替这项。

`28c9507` 已晋级 main，GitHub Actions 37762435686 的 TypeScript／Playwright 与 Android 两项任务全部成功。随后补齐独立执行连接的 15 秒只读保活，以及初始化开始前清理该独立服务中的离线目标缓存；保活不重连、不重发操作、不充当成功证据。该补充修改的执行器构建与回执相关 21 项测试通过，须以更新候选的 main CI 作为部署门禁。

上述阶段的生产仍为原版本，尚未创建本轮初始化任务；后续部署和实际触发结果见下文。历史失败任务保留，没有账号变更或业务发布。


## Artemis 内的云下载候选

按用户确认，将应用检查、可信下载、安装校验和私有配置交付移入同一 Artemis 任务的 `prepare_phone_environment` 工具。普通原生诊断仍无安装权限；准备工具仅对实际运行的初始化任务开放，执行中冻结其他操作，单次调用且失败不重试。手机直接从 OSS／S3 接收 APK，ADB 仅传递命令及校验结果；安装提交未知时保留未确认状态。

SFA／FlClash 已上传到已有私有 OSS 并通过服务器完整 GET 的 SHA-256 校验。OSS 默认公开端点的查询参数签名下载实际返回 `ApkDownloadForbidden`；已改用官方明确支持的 Authorization 请求头签名，真实范围 GET 返回 206／1024 字节。此结果只证明云下载授权，尚不代表真机安装与初始化通过。无需新增域名或将 Bucket 公开。

执行器构建、受影响 58 项检查及 6 项 Python 权限守卫检查通过，固定上游补丁检查通过；lint 两条已有未使用导入警告保留。`3fc2ee8` 的 main CI 37763670302 已成功，但新的云下载候选仍须以其固定提交完成 CI 后才能部署。生产开关继续关闭，原人工接管与历史任务保留。


固定候选 `f4819cc` main CI 37776087151 两项均成功；备份后部署到香港服务器，三服务镜像标签均为完整候选 SHA，48 项数据库迁移保持 current。实际生产 Web 的登录、项目列表、会话重载和退出通过，无业务写入，自动准备保持关闭。

四个应用的 15 个代码包全部完成 OSS 完整 GET 哈希核对；手机实际请求头授权范围下载返回 1024 字节且 SHA-256 与来源匹配。旧 Bookworm apksigner 对 Facebook 的轮换签名返回不支持；官方 Android Build Tools 36.0.0 同包签名核验通过。部署工具改为固定版本 36.0.0，下载始终校验固定 SHA-256（同时核对官方仓库 SHA-1）；离线构建缓存只可提供相同字节。该工具修订须通过其 main CI 后部署，不能以降低 SDK 或忽略签名失败启用流程。


工具候选 `1a94dbd` 的 main CI 37777616990 两项通过，三服务已部署；运行用户对私有清单、凭据、配置、全部 15 个包及 Build Tools 的可读／可执行核验通过。手机打开 App 后真实 Web 再次观察到 Samsung 的 bootstrap 连接已核验。

部署后的检查发现设置 `ADB_SERVER_SOCKET=tcp:127.0.0.1:5038` 时，ADB 不会自行启动远端守护服务；全新执行容器中 5038 尚未监听。修订初始化 overlay，在执行器启动时显式启动唯一的本地 5038 服务，再 exec 正式 Node 入口。该修订前的定位轮次手动启动独立服务，未将其计为自动启动通过。

## 实际自动触发及上游阻断

用户打开手机 App 后，生产 Web 核验原 Samsung 的 bootstrap 连接；实际点击“交还自动准备”后，平台自动派发任务 `aeacdfc1-9a19-4277-8ad5-9633b1181ae4`，Artemis trace 为 `cf73171e-4afc-43f1-b174-66bce6158343`。任务没有通过直接接口创建，也没有用 USB 或固定手机点击脚本替代 Artemis。

主模型 `gemini-3.8-flash` 与备用模型 `gemini-3.7-flash` 的上游 `api.qiuqiutoken.jiawuyu.com` 连续返回 HTTP 500。相同配置的独立最小文本请求也均返回 `bad_response_status_code`／“当前无可用凭证”；模型目录 GET 为 200 不能证明推理可用。此外，目录未列出配置中的 `gemini-3.5-flash-lite` 和 `gemini-robotics-er-2-preview`，恢复后须核对所需工具模型支持。未切换提供方、密钥或模型来绕过此故障。

真实 Web 观察到原任务 `finished`、`UNCONFIRMED`、`INSPECT_DEVICE_EVIDENCE`；没有安装开始事件或可信准备调用。Artemis 子进程已退出，原任务、trace 和接管保留，没有自动重试新任务。需要上游恢复可用渠道后再对原结果核对并继续，不能把本轮自动触发称为手机初始化成功。

启动修订 `c617dc180dba18c107c488011edb79fe8122ef10` 的 main CI 37778981672 两项均通过；确认无在途任务后完成 SQLite、PostgreSQL、私有运行状态和生产配置备份（`/opt/socialgrowth/backups/phone-cloud-20261008T125928Z`），并部署三服务。自动准备保持关闭，手机业务数据和原授权保持。

部署后核对：三服务镜像 revision 均为完整 `c617dc1` SHA，backend／executor 健康；在全新执行容器中、没有手动启动 ADB 的条件下，5038 连接核验通过。原 Artemis trace 的独立状态为 `failed`，无剩余 Artemis 子进程；原任务仅有 `opened`／`stopped` 事件。

实际生产 Web 的登录、项目列表、会话重载和退出全部通过，业务写入为 0。复现命令：`SG_PRODUCT_WEB_SCOPE=deployment SG_PRODUCT_WEB_URL=https://growth.mhtm.top SG_PRODUCT_DEPLOYMENT_LOGIN_FILE=.runtime/bootstrap-b1-20261007/production-login.json SG_PRODUCT_DEPLOYMENT_OUTPUT=output/playwright/phone-initialization-deploy-c617dc1 pnpm test:playwright`。

本轮自动准备通过 `scripts/verify-product-phone-initialization-playwright.mts` 从实际 Web 执行，使用 `SG_PRODUCT_WEB_SCOPE=phone-initialization`、固定 Samsung deviceId 和首次 `SG_PHONE_INITIALIZATION_RETURN_CONTROL=true`。证据保存在 `output/playwright/phone-initialization-live-1a94dbd`；观察窗口返回 `pending_original_job`，后续 Web 查询确认上述失败。云下载授权、包校验、CI 和网页检查均不代替应用安装、网络配置、FB／YT、5 分钟交接和长期稳定性验收。

## 优先初始化及多机候选（2026-10-09）

用户暂停测试并确认优先手机环境初始化。已在 dev 开发不同手机独立派发、同机互斥、持久步骤回执、分机 Web 进度及人工待办。修正初始化 Artemis 客户端没有显式传入当前设备编号／远程序列号的问题；不使用默认 Samsung 标识代替其他手机。

只读查询原 trace `cf73171e-4afc-43f1-b174-66bce6158343` 确认其状态为 failed，错误为模型调用超过 180 秒；原监督仅有 opened／stopped，没有安装或手机动作事件。固定 `bb52422` 部署后的既有 Google SDK 记录显示 8 条记录全部成功（含最终汇总），时间晚于原失败；复用该记录，没有重新运行 SDK 测试。这不证明手机初始化成功。受保护初始化清单只允许现有 Samsung，接入密钥到期为 2026-10-14；未输出密钥或订阅。

新增受控 Web 续接入口：仅在原模型超时且无手机动作的严格停止证据、原占用归属和当前硬件／所有别名锁核对通过后，原子交接至一个固定后续任务。原 UNCONFIRMED 保留，并记录 successor；不会静默把旧结果改成成功，也不通用于安装／配置未知或无限自动重试。代码尚须以实际部署和运行结果更新本节，当前没有新增验收通过结论。

固定 dev 候选 `e3a73dba700ba20fe672b6e80e11b58a71cb2e90` 在 `mh` 完成镜像构建和部署，自动准备启用；main 保持 `bb52422`，未运行测试套件或晋级。Node 24.16.0／SQLite、三端类型检查及部署镜像编译通过。备份为 `/opt/socialgrowth/backups/phone-multi-20261008T163244Z`，PG／Redis 未重启、主机路由未修改，部署前后的原回执及占用相同。

正式 Web 点击受控续接成功：原任务 `aeacdfc1-9a19-4277-8ad5-9633b1181ae4` 保留 UNCONFIRMED，记录终止／锁核对和后续任务 `f55c3055-269d-4c7e-ba47-65c0c4951ceb`，trace `6763c139-6ab7-4206-9bd1-889b493122de`。Web 分机卡片已显示当前观察步骤。该后续任务在 Artemis 初始屏幕客户端连接期间遇到 DeviceOfflineError，未进入可信准备工具，结束为 UNCONFIRMED／needs_attention；平台随后出现新反向连接端口，执行器原端口不可用。初始化尚未完成，后续任务和占用继续保留。

继续定位需要受保护的断开原因记录；增加仅包含设备编号、会话编号、固定原因码及流数量的 relay 诊断，不记录帧、Token 或手机内容。恢复时的设备锁查询须枚举所有端点命名空间及同手机排队任务，避免只查看默认 5037 而漏掉执行器 5038。此项修订仍不授予重试有副作用任务的权限。

固定 dev 候选 `6a119826d8aeeef77f7105bd159f52164d6a2131` 的镜像构建完成后，部署到 mh；备份 `/opt/socialgrowth/backups/phone-multi-20261008T164902Z`。第一次部署命令早于镜像构建结束，因候选镜像不存在失败，已恢复 e3a73db（备份 `/opt/socialgrowth/backups/phone-multi-20261008T164801Z`）；修订部署脚本，要求三个候选镜像的完整 revision 均匹配才允许变更服务。成功部署保留全部回执和占用，PG／Redis 未重启，路由未变。未运行验收测试。

当前连接的只读基础诊断核对到 RFCW40MYYCV，完整屏幕读取 219071 字节／15.15 秒，PNG 头尾完整；Artemis helper 包存在、辅助服务已启用且进程运行。这些仅证明此时基础连接可读，不能解释此前启动时的掉线或证明初始化成功。原后续 trace 的通知只保存失败结果，没有可用于授权新一次初始化的完整副作用核对证据；不放宽原有限续接条件。

已部署 `f47f0a0c644050ea0226feffa45c9881aa84b8d4` 至 mh，备份 `/opt/socialgrowth/backups/phone-multi-20261008T170035Z`。设备清单改为并行核对；已授权但掉线的手机保留卡片及原回执，历史模式仅供显示，连接仍标记未确认，不作为派发授权。候选镜像编译通过，三服务健康且完整 revision 匹配，原回执／占用、PG／Redis 和主机路由保持；main 未晋级，未运行正式测试。多台实机并行尚未验证，当前只有 Samsung 在授权范围。

部署后从正式 Web 查询原任务，仍显示后续任务 f55c3055 的 finished／needs_attention／UNCONFIRMED，人工待办 0，卡片保留原占用。仅查询未发起新的手机操作，不计验收。隔离执行连接再次匹配硬件，ADB 在线；用临时转发只读请求 helper 的 `/ping`，对端直接断开（RemoteDisconnected），临时转发已清理。辅助包版本 1.2.0／versionCode 6，系统显示服务已启用且绑定；尚未确定辅助通道不可用的原因。此问题仍阻断初始化，不以包存在或进程存在替代通道可用。

## 辅助通道只读定位（2026-10-09）

用户要求确认辅助通道问题。本次没有启动初始化、安装应用、修改辅助服务、清除占用或重跑未确认任务。执行器无运行中核验和待处理业务任务；当前反向端口再次核对为同一硬件 RFCW40MYYCV。

手机直接读取 `127.0.0.1:18888/ping` 成功，约 2.83 秒；服务器使用隔离 ADB 5038 临时转发读取同一接口成功，约 2.64 秒。响应版本 code 6、协议 2，与部署 SDK 匹配。因此此前一次 RemoteDisconnected 不能解释为辅助服务持续不可用，也不是辅助包缺失或协议不兼容。

已用部署容器中未经修改的 Artemis `_default_ping` 函数复现超时误判：其默认 `timeout=2.0` 秒，同一条连接两次按 2 秒读取都返回 None（2.023／2.002 秒）；两次仅将调用超时设为 8 秒，均收到有效响应（2.427／2.021 秒）。未设置全局代理，比较期间 ADB 保持 device，临时转发全部清理。确定存在远程往返耗时超过 SDK 默认探测预算的问题；修复应调整 helper 探测预算，不能通过重装、忽略错误或伪造成功处理。本次仅调用只读 ping，不改变部署 SDK 配置，不计初始化／业务验收。

历史 f55c3055 的异常栈另行核对：helper attach 失败后，screen client 的降级入口检查 ADB 状态，继而抛出 DeviceOfflineError；初始 agent trace 的 steps 数量为 0。该历史连接确实掉线，但原时点缺少精确 relay 断开原因日志，不能证明此次 2 秒误判是掉线的唯一原因，也不能把当前 ping 成功视为原初始化已经恢复。原失败和占用仍保留。

## 解除旧占用并修复启动恢复（2026-10-09）

用户明确要求清除之前占用、重新触发，并修复恢复缺口。候选 `9b4a859501fc7d56ae3aec9fddf9f5bf6f8f2ff8` 已在 mh 部署，备份 `/opt/socialgrowth/backups/phone-multi-20261008T231541Z`；辅助探测支持配置且初始化实际值为 8 秒。固定基座 google-bb52422 仅叠加归档的 helper-timeout.patch，未带入账号自然动作候选。部署保持旧回执和占用、PG／Redis、主机路由；main 未晋级。

正式 Web 初次操作因连接恢复中而未提交；随后点击续接返回 409，查询原任务确认没有新建任务或改变占用。只读定位发现 f55c3055 的监督会话为 closed，只有 opened 事件，缺少 stopped：旧实现把最终报告与截图读取放在同一 try 中，掉线无法截图时跳过报告并直接关闭会话。修订失败收尾，不依赖截图保存 stopped；历史 closed 仅在引擎 failed、初始连接异常栈和归档 steps=0 都匹配时可续接，模型超时仍须原 stopped 证据。未直接修改数据库来补造旧停止事件。

启动恢复为同手机原子释放／交接占用、固定后续请求和根请求沿用；新策略任务停机至少 30 秒后可自动核对执行前失败，最多两次，历史任务要求真实 Web 明确续接。安装、配置或动作已发生／证据缺失时保留未知状态；不将网络恢复当作成功。三端编译和候选镜像构建通过，正式测试继续暂停；实际重新触发结果另行补记。

补充候选 `c0afcc470fd016942089a263124882bf91bbc29d` 的执行器编译、固定镜像构建通过，部署到 mh（备份 `/opt/socialgrowth/backups/phone-multi-20261008T232155Z`）。三服务健康，全部回执及占用、PG／Redis、路由在部署期间保持。dev 已推送；main 未晋级，正式测试未运行。

正式 Web 点击“核对原停止证据并继续初始化”返回 201，新任务 `6cb2dd24-fafd-463b-b25c-b9d300e2185d`、trace `7d64a65d-34b0-4a3c-bc1d-b41766c72d71` 于 2026-10-09 07:22:55（北京时间）创建。新占用自 07:22:55.813 起，已替换旧 00:33:38.163 占用；f55c3055 的 UNCONFIRMED 保留并记录 successor，根请求保持 68cfb747。新启动恢复计数为 1，Web 显示 running／inspecting_apps、人工待办 0。Artemis 实际子进程的环境只读核对为 helper timeout=8、ADB_PORT=5038，不是只查看 Docker 配置。当前没有安装完成、网络配置完成或 5 分钟交接成功证据；新任务继续在服务器运行。

可复现的本轮操作保存在受保护 `.runtime/phone-multi-20261009/operate-phone.mts`，通过实际 Web 登录、查询、点击续接和观察，没有直接 API 写入或数据库清锁。`SG_PHONE_OPERATION=resume` 执行本次已授权续接；`observe` 仅查询原任务。运行环境沿用受保护运营登录文件、固定 Samsung 产品设备编号和本轮 SSH 浏览器代理；操作脚本不是验收套件。自动启动恢复分支尚未通过故障注入或多台实机验证，不能从本次明确 Web 续接宣称这些项已验收。

本次 Artemis data engine 已在新会话开始后保存初始手机观察图（会话开始 2026-10-09 07:23:08、观察图 07:23:41，北京时间），此前失败 trace 没有对应初始观察图。这证明新引擎已越过首次屏幕获取；记录步骤仍为 0，尚不能证明模型已执行可信准备工具或安装应用。


## 初始化未推进的后续检查与修订（2026-10-09）

用户要求继续检查，并在未正常执行时先部署再重测；此次重新授权仅覆盖手机环境初始化。任务 6cb2dd24 于北京时间 07:37:10 结束，UNCONFIRMED／EXECUTION_TIMEOUT_OR_CANCELLED，SDK 为 cancelled，进程已退出。Planner 耗时约 750 秒，包含模型超时重试及 fallback；stderr 有 Gemini 503 high demand。期间仅生成／核对笔记，未调用 prepare_phone_environment。最终有一个实际导航步骤：点击正式 Android App 的“手机准备”按钮；当前 UI tree、目标 package、按钮 bounds 与 dispatched 记录一致。无 install_started，安装尝试为 0；原占用和失败回执保留。此前 running／首次截图不能证明初始化正常推进。

修订固定初始化指令：中心已核验的关联、硬件及权限不再要求模型重复审计，初始截图即观察输入；先一次调用可信准备工具，由其检查并保留已安装 App，再执行返回的配置和核验说明。监督层在可信准备前拒绝导航。Artemis 的 phone-initialization 专用环境只把 Planner 的每轮笔记迭代由 10 限为 2，保留三轮规划校验和 Pro／Google 模型、动作防护及真实 checkpoint，不影响其他任务。

增加显式 Web 续接的严格证据分支：仅原任务 EXECUTION_TIMEOUT_OR_CANCELLED、SDK cancelled／有结束时间／进程退出、stopped 回执、无安装尝试、无业务或协助未决、全部设备锁释放时核验。SDK 记录必须无动作，或唯一动作是已有正式 App 的“手机准备”导航（实际 UI package／按钮 bounds、成功 dispatched 与监督导航数一致）；任何其他点击、配置、安装、缺失／不一致证据仍拒绝。该分支不自动重发，恢复计数计入原最多两次限制；原 UNCONFIRMED 保留，不伪造归档或补写旧事件。

本轮补充检查：执行器类型检查通过；39 项现有监督／Web 核验单元检查通过，覆盖准备前导航拒绝、准备期间冻结及一次工具限制。它们不证明真机初始化成功。候选部署和真实 Web／Artemis 重测结果在下文补记。


候选 054fd002083cf32b5c294a924008dd4b8095ff3d 已在 mh 部署，备份 /opt/socialgrowth/backups/phone-multi-20261008T234510Z；三个服务及 Google 专用代理健康。部署未改变旧回执／占用，PG／Redis 未重启，主机路由未变。真实 Playwright 从正式 Web 点击续接，2026-10-09 07:45:50 返回 409，任务仍为原 6cb2dd24；本次 Web 重测失败，不宣称执行成功。

只读调用真实 Artemis mobile_manage_task(status) 确认响应为 cancelled、有 device_serial、没有 error。续接解析误把 error 作为必填字段，故拒绝；修正为默认空字符串，随后仍核验真实停止、未准备、进程退出、SDK 与监督导航数一致及全部锁释放。原 SDK cancelled 状态文件仍有结束时间，data engine 仅一条已核实的页面导航；使用运行时同一证明代码读取实际记录，导航数 1 返回 true，错误导航数 0 返回 false。没有修改历史 SDK session 的 running 行、补造归档或事件。脚本类型检查通过，验收脚本仅断言契约实际暴露的状态／结果／稳定窗口／Web 管理连接；独立 checker 数量由执行器完成结果门禁强制验证，不假设 Web 返回未定义的 diagnostics 字段。


## 第二次 Web 重测与配置续接候选（2026-10-09）

40e8b5ada66f4bc017b1c84d5a412ce6f9c8f6cc 已部署 mh，备份 /opt/socialgrowth/backups/phone-multi-20261008T234953Z。正式 Web 续接返回 201，新任务 34241355-79df-4583-97ab-8dd48750849d，Artemis trace 92289c60-c85a-4769-9421-8ca42c1bcf66；原 UNCONFIRMED 与根请求保留，占用原子交接。规划耗时约 60 秒，可信准备工具真实执行一次，2026-10-09 07:54:28（北京时间）完成，之后 16 个真实 dispatched 步骤涉及 SFA／文件选择／导入／名称编辑。08:04:51 父任务 14 分钟上限终止，仍为 UNCONFIRMED；没有完成四个实际检查点、300 秒稳定观察或管理通道切换。该轮未发现 helper 离线或 Gemini 503 标记，不能将安装成功等同整体验收。

配置衔接要求原可信准备成功、父任务超时且 SDK cancelled、有结束时间及死进程、所有动作 dispatched 且无 incident，SDK 动作数与监督动作数相等、全范围锁无占用、硬件一致。实际 trace 用候选同一只读证明代码：16 个匹配返回 true，错误计数 15 返回 false。没有补写 SDK 会话或旧事件。衔接仅一次、由真实 Web 发起，复用原准备请求的配置与管理节点命名；已安装应用只核验，缺失则停止而不重新安装；重新投递原私有配置并核对手机 SHA-256，从当前屏幕继续，已有对应配置不得重复导入。准备前自动恢复上限仍为两次。初始化时限 40 分钟，监督有效期额外 5 分钟；未确认时保留私有配置供衔接，成功后清理。

补充检查：60 项准备／监督／应用／Web 单元检查通过，包含缺失应用不重装、不投递，以及只有完成准备事件才展示准备完成标记；执行器、Web 及验收脚本类型检查通过。真实 Web 验收尚待新候选部署和第三轮重测。共享 dev 中另有身份工作提交，本轮部署固定树从原线上 40e8b5a 叠加本轮手机修订构建，保留该工作的代码和运行数据，不带入其未部署功能。


## 配置续接候选部署与第三轮 Web 阻断（2026-10-09）

修订已提交 dev 0629029；从原线上 40e8b5a 叠加手机修订的固定部署候选为 9c04033f0e3b240d831ff2dddc3febba0953fc93。mh 三端及 Google 专用代理构建、固定镜像标签与健康检查通过；备份 /opt/socialgrowth/backups/phone-multi-20261009T001848Z。旧任务及占用完整保留，PG／Redis 不重启，主机路由未变；main 未晋级。

第三轮 Playwright 通过正式 Web 登录及进入执行台，但手机连接等待 60 秒仍为 connected=false，未点击续接、没有新任务。08:21 的正式 Web 只读复核同样显示 bootstrap／connected=false、原 34241355 UNCONFIRMED、phone-initialization 原占用。后台数据库最后有效连接／端点回报停在 08:18:48，安装会话有效至 2026-11-06 且未撤销；新容器 ADB 无已连设备，没有 USB。当前阻断是反向连接未恢复，不能写成续接安全门禁或 Artemis 执行失败。尚无手机侧日志证明断开及未重连的准确原因；需在手机打开 SocialGrowth，恢复通道后读取日志并由 Web 继续原任务。浏览器和服务器读取不能替代真实连接。

第三轮受控证据 output/playwright/phone-initialization-20261009-r3/failure.json；正式 Web 连接复核 .runtime/phone-multi-20261009/operation/latest.json、phone-card.png。验收脚本补充失败阶段及只含连接／任务状态的诊断记录，不保存登录凭据或原始上游正文。
