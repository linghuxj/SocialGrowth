# B1 首次连接候选（2026-10-08）

实现已晋级 main 固定候选 `e2b64fba0067cdaf809d0436908a70d840bc43b1`，完成 CI 与生产部署，Samsung 已覆盖安装；公共稳定 APK 下载暂未替换。用户选择继续用现有 Samsung 验证改造流程，并将新手机首次接入单列为未验收。

## 已实现

- Android 前台服务建立安装身份认证的反向 WSS；不要求预装网络客户端。维持系统配对弹窗，使用通知内回复配对码。
- 后端仅把已关联安装的本机 NSD 端口映射到服务器回环；受限流量、ACK、会话/端口有效期、归属复核、撤销关闭，复用真实 ADB 配对与硬件检查。
- Web“手机接入与准备”按真实当前连接提供受控 Artemis 准备入口；复用人工占用、未知请求查询和回执，不授予业务/发布许可。
- IPv4 管理地址切换独立核验在线节点、节点密钥和同一手机的 ADB 硬件身份；任务未结束或验证失败时保留 bootstrap。保存安装/版本绑定，省去服务器逐设备手写 allowlist；目前仍由运营填写真实管理地址，配置交付和系统授权可能需要人工协助。

## 当前验证

- `pnpm env:check`：项目 Node 24.16.0、SQLite OK。
- contracts 构建、backend/executor/web 类型检查通过。
- Backend 聚焦验证：使用 `tsx --test --test-concurrency=1` 串行运行 17/17 通过。此前并行执行时既有 ADB 子进程测试的 1 秒超时夹具出现 1 项失败，原日志保留在 `.runtime/bootstrap-b1-20261007/backend-tests-parallel-failure.log`，未修改生产超时。覆盖：认证拒绝、真实本地 TCP/WSS 字节传输及背压、旧会话隔离、撤销和端口撤回、交接控制帧、节点/安装绑定、ADB 成功/失败及未知结果、CSRF。日志保存在 `.runtime/bootstrap-b1-20261007/backend-tests.log`。这些是隔离协议/集成检查，不是手机验收。
- executor `web-verification.test.ts`：20/20，包括任意目标拒绝和人工占用门禁；不代表模型或手机执行成功。
- `pnpm test:config`：3/3；Compose production + execution overlay 配置校验通过，未启动生产候选。
- `SG_PRODUCT_LOCAL_LIVE_TEST=1 SG_PRODUCT_WEB_SCOPE=executor-console SG_PRODUCT_EXECUTOR_CONSOLE_OUTPUT=.runtime/bootstrap-b1-20261007/web pnpm test:playwright`：真实登录、执行页、空接入目标不显示启动按钮、原任务查询和退出共 6 项通过。读取原 9 个任务、56 个检查回执，未派发手机动作。
- Android `assembleDebug testDebugUnitTest lintDebug`：成功；15 个套件、57 项单元测试，0 失败/错误。隔离 Gradle home，首次全局 init 脚本失败和 Google Maven 直连等待已通过隔离缓存及已配置的本机代理解决，未修改用户全局 Gradle 脚本。
- 使用原正式签名 `assembleRelease` 成功。APK 包名 `com.socialgrowth.product`，versionCode 4，versionName `1.0.2-b1`，生产 API 地址沿用 `https://growth.mhtm.top`。
- `apksigner verify --print-certs` 通过，证书 SHA256 `0d8947fbdaaa834db01b3d2f8cdebd5856044cc31b313811205aae0adff13c43`。
- 候选 APK：`output/android/candidates/socialgrowth-1.0.2-b1-4-release.apk`；SHA256 `04ba524c6856f89f1e3f626d95c0daa70be6efdcb6f41c5c8dd3814ce028bfe6`。已于本轮后续覆盖安装 Samsung；完整实机流程结论见下文。

## 实机与发布边界

安装前只读确认 Samsung RFCW40MYYCV / Android 16、App 1.0.1（3）、无线调试关闭。部署后通过 USB `adb install -r` 覆盖成功并启动，确认 1.0.2-b1（4），未卸载或清除数据。未通过 USB 启用无线调试或制造配对成功；已请求机主拔线、保持 Wi-Fi、从系统配对弹窗经通知提交配对码。

尚未验证：Samsung 的 B1 通道与通知首次提交、真实 Artemis 准备及人工协助、管理路径切换与失败恢复；无预装客户端/无旧信任的新手机首次接入、跨 Wi-Fi/休眠/重启恢复。没有正式网络准入、业务执行或公开发布验收结论。

当前 main 规则要求先有对应真实验收。2026-10-08 用户明确批准本次顺序例外：“允许按此顺序部署并验证 Samsung”。因此本轮按固定候选先合 main → 仅 main CI → 服务器部署 → Samsung 实测推进；此次批准不构成新手机、实际控制或网络切换验收结论。


## main CI 与生产部署

- 初次 main `58dd29c` 的 CI 在需求覆盖检查失败，原因是 R-166 未登记至覆盖矩阵；已补齐原矩阵及索引。完整原失败日志保存在 `.runtime/bootstrap-b1-20261007/ci-failure.log`。
- 最新 main `e2b64fb` 的 [CI 37651747665](https://github.com/linghuxj/SocialGrowth/actions/runs/37651747665) 全部通过：TypeScript 产品检查/测试/构建、容器/Compose、文档一致性、真实 Web，以及 Android 构建/lint/测试/发布门禁。
- 生产目录 `/opt/socialgrowth/releases/e2b64fba0067cdaf809d0436908a70d840bc43b1`；backend、executor、web 镜像 revision 均一致，容器健康，后端经共享回环请求执行器 health 返回 200。
- 切换前核验运行任务及检查均为 0。服务器备份 `/opt/socialgrowth/backups/bootstrap-b1-e2b64fba0067cdaf809d0436908a70d840bc43b1` 保存原配置、数据库 dump、ADB 等私有文件及执行 SQLite；SQLite 完整性、归档和 pg_restore 列表校验通过。停止旧进程后再次保存数据库与执行状态，再应用迁移 0048。没有导入本地业务数据。
- `SG_PRODUCT_BOOTSTRAP_ENABLED=true` 仅在生产配置启用。公网 health 正常。生产真实 Web：执行控制台 6 项通过；登录、项目页面、刷新保留登录、退出共 4 项通过。检查期间未发起手机任务。
- 安装启动后，真实 Web 已显示唯一 Samsung 的 bootstrap 连接；数据库有持续端点上报，但当前端口为空、未配对、未连接。此时 USB 仍在，因此只证明新版 App 能主动接通生产 WSS，不计非 USB ADB/Artemis 验收。
- 可复现生产 UI 脚本：仓库 `scripts/verify-product-executor-console-playwright.mts`、`scripts/verify-product-deployment-playwright.mts`；本次受保护的启动包装及手机准备脚本在 `.runtime/bootstrap-b1-20261007/`，凭据文件不提交 Git。生产证据位于该目录的 `production-console-smoke/`、`production-smoke/`、`production-web/`。
- 本轮自有本地 Web/backend/executor 已停止，原本地人工占用及业务记录保留。


## 通知与断线诊断阶段保存（2026-10-08）

用户要求先提交 Git，再考虑迁移服务器。本节为未完成验收的 dev 阶段保存，不晋级 main，不继续部署或实机排查。

- 修复已运行连接服务在通知授权后未重新发送通知的分支：点击准备/权限回调显式刷新通知，重复 START 仅重发通知，保留当前通道与配对状态；请求前台服务通知立即展示。
- 添加 `SGConnection` 诊断，仅记录连接阶段、异常类名、HTTP/关闭状态及受限错误码；不记录异常正文、URL、请求/响应内容、令牌或配对码。
- Android Debug 构建、单元测试和 lint 通过；正式签名候选 `1.0.2-b1.1（5）` 构建通过并覆盖安装 Samsung，保留原数据。APK SHA256：`45bca1270fa49514d520c1470bf022acaa53a519bbeeeee1bdd9b3e2b36e364b`，签名证书与前版一致。APK 和私有诊断证据留在本机，不提交 Git。
- 手机确认通知权限已允许、服务为前台状态；用户能通过通知输入配对码。但服务器未生成实际配对尝试记录，故不能称为配对码错误或 ADB 配对失败。
- 诊断候选安装后，生产 WSS 建立并连续上报，01:32:43（北京时间）记录 `SocketTimeoutException`，随后上报返回 `AUTHORIZATION_DENIED`。01:32:48 再次收到连接 ready，但服务器端点记录停留在 01:32:31，说明握手成功不等于恢复持续上报。连接超时与重连后上报未恢复的根因尚未确定。
- 现有手机启用了 SFA VPN。经用户暂停 SFA 对照，确认无活动 VPN 时该网络下的服务器连接也超时；用户反馈必须启用 VPN 才能正常访问。已请求恢复原 SFA；停止排查时未再次确认其恢复状态。不将当前线路现象推广为所有香港服务器均不能从国内直连，也不把 SFA 直接判为根因。
- 生产仍为 main `e2b64fb`；本次仅有 Android 与证据文档变动，未改变生产后端、域名或数据。USB 仅用于候选覆盖安装和日志读取，没有通过 USB 创建中心配对信任。
- 后续应先确认目标用户能直接访问接入入口，再验证通知授权前后、前后台切换、长连接中断恢复，以及非 USB 的通知配对 → 服务器真实核验 → Web/Artemis。新手机无旧信任首次接入仍未验收。

本轮私有检查与签名构建日志位于 `.runtime/bootstrap-notification-20261008/`；最终通知授权场景和连接恢复不能仅凭本地构建/单元测试算通过。
