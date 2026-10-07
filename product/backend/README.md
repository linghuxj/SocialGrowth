# 正式产品后端

当前装配见 [AppModule](src/app.module.ts)，启动及运行参数见 [config.ts](src/config.ts)。业务流程和条件接线见[当前实现](../../docs/current-implementation.md)及[技术说明](../../docs/technical-design.md)。旧阶段流水已从操作说明移除，原实测和审查保留在[证据索引](../../docs/engineering/delivery/records/README.md)。

## 启动和检查

从仓库根目录使用 `pnpm dev`，或准备完整环境后使用 `pnpm dev:backend`。数据库 SQL 位于 [migrations](migrations)，按编号顺序应用；后端进程不自动迁移。`GET /health/live` 只证明进程存活，不表示依赖或业务就绪。

```sh
pnpm --filter @socialgrowth/product-backend check
pnpm --filter @socialgrowth/product-backend test
pnpm --filter @socialgrowth/product-backend build
```

[package.json](package.json)的独立数据库、对象和队列补充检查需要各自明确的隔离环境。不得对原业务库运行 fixture、reset 或成功预置。

## 配置与默认行为

- `SG_PRODUCT_DATABASE_URL` 与 `SG_PRODUCT_AUTH_PEPPER` 是必需的后端身份配置。现有配置由真实服务进程加载，不输出连接密码或 pepper。
- 默认监听 `127.0.0.1:4320`。`SG_PRODUCT_TRUST_PROXY_HOPS` 默认 0，只按实际可信代理设置。
- `SG_PRODUCT_SMS_MODE` 默认 `unavailable`。`development_capture` 必须同时设置独立 `SG_PRODUCT_DEVELOPMENT_SMS_TOKEN` 并使用回环监听；不能作为真实短信发送证据。
- 素材使用 [material-runtime.ts](src/material-runtime.ts)的显式 `SG_PRODUCT_MATERIAL_*` 配置，默认关闭；不从机器已有 AWS profile 猜测资源。
- 业务 AI 以 `SG_PRODUCT_BUSINESS_MODEL_MODE=artemis_configured` 和 `SG_PRODUCT_ARTEMIS_ROOT` 使用已有合法模型环境；默认不可用，不用模板替代失败。
- 手机执行配置及内测网络配置见[技术说明](../../docs/technical-design.md)与[Android 接入说明](../../docs/android-pilot-onboarding.md)。缺失配置时对应操作关闭；USB 在线不授予业务权限。
- 正式网络准入 runtime 和公开引流目标策略在当前 AppModule 中仍为空。指标来源和工作流执行按完整配置接线，不能据接口存在宣称实际采集或发布完成。

## 权限与状态

运营、提供者和安装身份分别认证。运营写入必须通过 Cookie／CSRF；较低权限身份不能通过传入 ID 获得运营能力。原请求键、控制代次、关联版本和当前归属保持原语义。超时或回执未知时查询原请求，不创建替代发布。

## 公司社媒凭据的持久密钥


账号登记和凭据替换使用独立 AES 加密密钥及 HMAC 幂等摘要密钥。服务通过显式 `SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE` 读取受保护的持久 JSON 文件；缺失或不合法时关闭写入，不在启动或重启时随机生成替代钥。账号密码不写入此密钥文件。

首次保管器设置可从仓库根目录运行[离线初始化工具](../../scripts/create-product-media-key-file.mjs)，以实际服务用户创建密钥。先准备该用户持有的真实 `0700` 目录；路径祖先须由 root／该用户持有，拒绝非 sticky 且可由组或其他用户写入的祖先。输出必须为显式绝对新文件路径：

```sh
pnpm exec node scripts/create-product-media-key-file.mjs /absolute/private-key-directory/media-credential-keys.json
```

工具只创建新 `0600` 文件，不覆盖既有文件、不输出密钥。返回失败时目标可能为空或不完整，应由保管者核对后处理；不能自动覆盖重试。将文件保存在 Git、普通日志和页面验收产物之外，并把配置传给实际后端服务进程。

数据库备份恢复必须保留对应加密密钥及所有仍被历史命令引用的 HMAC key ID／密钥。重新生成同名文件不属于恢复，会导致旧密文和原请求核对不可用。此工具只做首次持久密钥设置，不提供加密密钥轮换、平台改密或退出登录；本轮隔离验收的临时钥只用于合成数据，不能复用到真实公司账号。

受控输入使用另一把独立 P-256 授权签名钥，不能复用上述加密或 HMAC 密钥。同一离线工具提供显式模式：

```sh
pnpm exec node scripts/create-product-media-key-file.mjs --grant-signing /absolute/private-key-directory/media-input-grant-signing.pem
```

该模式只写新 `0600` PKCS#8 PEM 文件，仅输出由公开 SPKI 计算的 `publicGrantKeyId`，不输出私钥。签名保管器使用这个公开 ID 核对显式加载的私钥；安装认证的公钥查询与实际当前动作授权分别校验。生成文件本身不开放手机动作或证明登录成功。

后端签名配置须同时提供 `SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE`（绝对路径）、`SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID`（工具输出的公开 ID）、`SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS` 和 `SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS`（明确的 Unix 毫秒有效期）。缺少全部配置时授权组件关闭，部分配置或非法范围拒绝启动；不从示例猜测生产有效期。该配置只接通后端签名组件，实际 Artemis 工具、观察排空及可信手机传输仍按[阻断记录](../../docs/engineering/delivery/records/r159-artemis-controlled-login-blocker-20261005.md)处理。
