# 手机环境初始化候选记录：2026-10-08

## 当前结果

已补齐连接核验后的自动派发、Artemis 任务内可信云下载／安装、私有配置交付、四项实际画面检查和双通道观察／交接代码，并部署至香港生产服务器。Samsung 恢复连接后，真实 Web 交还原人工接管，平台自动创建了初始化任务；模型上游返回“当前无可用凭证”，任务结束为未确认，未进入应用下载、安装及配置步骤。生产自动准备开关已暂时关闭，保留原任务和初始化接管。新流程尚未通过生产实机验收；用户已批准本轮先晋级 main、通过 CI 后部署，再验证现有 Samsung。新手机与长期稳定性分别验收。

使用用户提供的受保护 Clash YAML。解析通过：292 个代理、5 个组；部署副本关闭 TUN 与局域网监听，只保留回环代理。没有记录节点密码、订阅地址或接入密钥。

设备：Samsung SM-S9110、Android 16、RFCW40MYYCV；通过香港生产服务器的反向连接读取，无 USB 回退。当前 SFA、FlClash、官方 Tailscale 缺失，Facebook、YouTube 已安装。已有 App UI 修改和安装证据另见[UI 记录](android-preparation-ui-20261008.md)。

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
