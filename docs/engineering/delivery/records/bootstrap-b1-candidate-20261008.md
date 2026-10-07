# B1 首次连接候选（2026-10-08）

当前在 dev 工作区，尚未合并 main、部署服务器或覆盖正式 APK 下载。用户选择继续用现有 Samsung 验证改造流程，并将新手机首次接入单列为未验收。

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
- 候选 APK：`output/android/candidates/socialgrowth-1.0.2-b1-4-release.apk`；SHA256 `04ba524c6856f89f1e3f626d95c0daa70be6efdcb6f41c5c8dd3814ce028bfe6`。尚未安装到手机，不能连接尚未部署 B1 的生产后端来完成新流程。

## 实机与发布边界

只读确认 Samsung RFCW40MYYCV / Android 16 当前通过 USB 连接，App 仍为 1.0.1（3），无线调试关闭。未通过 USB 启用无线调试或制造配对成功。后续应先安装候选、由机主开启系统步骤，再断开 USB 验证公网通道，Web 发起 Artemis 并记录真实回执。

尚未验证：Samsung 的 B1 通道与通知首次提交、真实 Artemis 准备及人工协助、管理路径切换与失败恢复；无预装客户端/无旧信任的新手机首次接入、跨 Wi-Fi/休眠/重启恢复。没有正式网络准入、业务执行或公开发布验收结论。

当前 main 规则要求先有对应真实验收。2026-10-08 用户明确批准本次顺序例外：“允许按此顺序部署并验证 Samsung”。因此本轮按固定候选先合 main → 仅 main CI → 服务器部署 → Samsung 实测推进；此次批准不构成新手机、实际控制或网络切换验收结论。
