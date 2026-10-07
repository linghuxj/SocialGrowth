# 正式工程部署与恢复边界

当前本地服务由根 `pnpm dev` 管理，见[服务组脚本](../../scripts/product-local-live.mts)。[compose.product.yml](compose.product.yml)只配置 PostgreSQL、Redis 和 MinIO 依赖；不包含业务应用部署，不是生产已上线的证明。根本地服务组的实际依赖及保留数据按脚本处理，不重建原业务库。

可以只读检查示例配置结构：

```sh
docker compose --env-file product/deploy/.env.product.example -f product/deploy/compose.product.yml config --quiet
```

实际数据库、认证、存储和密钥由受控环境提供，不提交秘密。示例密码、存储和端口不得直接用于正式环境。服务的存活、依赖就绪、业务认证和发布验收分别确认。当前实现与配置见[技术说明](../../docs/technical-design.md)及[后端说明](../backend/README.md)。

## 数据迁移与备份恢复

SQL 位于 [backend/migrations](../backend/migrations)，按编号顺序应用；进程启动不等于迁移已执行。SQLite 执行库保持原任务、证据和未知状态；不能作为迁移理由清除占用或重试原发布。

[database-restore-maintenance.ts](../backend/src/database-restore-maintenance.ts)提供内部加密采集、存储及只读恢复比较。保存回执未知时保留原备份 ID 和原包；不得重新生成 nonce 覆盖未知结果。比较不执行 `pg_restore`、不启动队列、不释放 holder、不证明物理停止。`consumersStopped`、`physicalFence` 保留 unknown，允许标志保持 false。

数据库包、历史 HMAC／加密密钥、对象、队列、当前撤权和手机在途事实均须对应核验。恢复后不得立即重放任务。已有隔离演练只证明其固定范围，不是生产恢复、容量、RPO／RTO 或全部外部状态的验收；证据见[索引](../../docs/engineering/delivery/records/README.md)。

## Android 发布输入

Release 和包含 release 变体的聚合任务要求以下显式环境输入，具体校验见 [build.gradle.kts](../android/app/build.gradle.kts)：

| 变量 | 用途 |
| --- | --- |
| `SG_PRODUCT_ANDROID_VERSION_CODE`、`SG_PRODUCT_ANDROID_VERSION_NAME` | 当前候选版本 |
| `SG_PRODUCT_ANDROID_PREVIOUS_VERSION_CODE` | 明确上一版本码；当前版本必须递增 |
| `SG_PRODUCT_ANDROID_API_BASE_URL` | 真实 HTTPS 服务，拒绝示例和本机域名 |
| `SG_PRODUCT_ANDROID_SIGNING_KEYSTORE`、`SG_PRODUCT_ANDROID_SIGNING_KEY_ALIAS` | 外部正式签名配置 |
| `SG_PRODUCT_ANDROID_SIGNING_STORE_PASSWORD`、`SG_PRODUCT_ANDROID_SIGNING_KEY_PASSWORD` | 仅进入受控构建进程，不进入仓库和日志 |
| `SG_PRODUCT_ANDROID_SIGNING_CERT_SHA256` | 对应正式签名证书指纹 |

未配置或不匹配时关闭发布构建，不以 Debug APK 代替正式签名、安装升级或回滚验证。

## 分支与放行

开发在 `dev`；只有满足对应检查、真实业务验收及必要审查的固定候选才进入 `main`。合并和部署记录须记录实际固定 SHA、CI 和部署环境；不能用历史整理结果推断当前放行状态。当前流程的未决结果和验收限制见[实现说明](../../docs/current-implementation.md)。


## 服务器 Docker 部署（2026-10-07）

[compose.production.yml](compose.production.yml)运行 Web（Caddy）、后端、PostgreSQL 与 Redis，**不运行 MinIO**。手机执行服务先保留现有运行位置和 SQLite 状态；未配置可信执行器时执行能力关闭。Caddy 转发 `/api/*` 与 `/health/live`，其余请求进入正式 Web。只有 Caddy 暴露端口；数据库、Redis 和后端均不发布宿主机端口。

使用已检查的固定 `main` SHA 将源码归档到 `/opt/socialgrowth/releases/<SHA>`，镜像标签及 `SG_PRODUCT_REVISION` 均使用该完整 SHA。先核对该 SHA 的 GitHub Actions；失败时在 `dev` 修复并重新晋级，不部署另一个未经检查的 HEAD。不自动部署任意分支。干净 CI 的文档检查使用 `--allow-missing-private-evidence`，单独报告被 Git 忽略的 `artifacts/acceptance`、`artifacts/review` 引用不可用；其他缺失链接仍失败，该模式不证明历史证据存在或产品验收完成。

配置模板：[.env.production.example](.env.production.example)。实际配置放在 `/opt/socialgrowth/config/.env.production`（目录 0700、文件 0600）；不要提交 Git 或输出展开后的 Compose 配置。`SG_PRODUCT_ENV_FILE` 填此绝对路径，`SG_PRODUCT_PRIVATE_DIR=/opt/socialgrowth/private`。数据库密码和认证 pepper 使用两个独立随机值，数据库 URL 的密码须与 PostgreSQL 一致（建议十六进制避免 URL 转义）。对外部署设置 `SG_PRODUCT_BIND_ADDRESS=0.0.0.0`，`SG_PRODUCT_SITE_ADDRESS=mhtm.top`；域名 A 记录须指向服务器，80/443 入站可达后 Caddy 自动申请 TLS。DNS 未完成时可先用 `http://:80` 及回环绑定检查容器，不作为公网 HTTPS 验收。

密钥目录由后端 UID 1000 持有，权限 0700。仅首次创建时运行镜像内的既有密钥工具；现有密钥绝不覆盖。镜像默认以非 root 运行，目录只读挂载。

```sh
# 在固定版本的源码目录中；实际 env 文件和私有目录先由管理员创建。
docker compose --env-file /opt/socialgrowth/config/.env.production -f product/deploy/compose.production.yml build
docker compose --env-file /opt/socialgrowth/config/.env.production -f product/deploy/compose.production.yml up -d --wait postgres redis
# 仅首次创建：私有目录已经是 1000:1000、0700；此命令拒绝覆盖现有文件。
docker compose --env-file /opt/socialgrowth/config/.env.production -f product/deploy/compose.production.yml run --rm --no-deps -v /opt/socialgrowth/private:/run/socialgrowth-private:rw backend node create-media-keys.mjs /run/socialgrowth-private/media-credential-keys.json
# 显式迁移：每个 SQL 与其 SHA256 记录在同一个事务中，重复执行只跳过相同内容。
docker compose --env-file /opt/socialgrowth/config/.env.production -f product/deploy/compose.production.yml run --rm --no-deps backend node migrate.mjs
docker compose --env-file /opt/socialgrowth/config/.env.production -f product/deploy/compose.production.yml up -d --wait
```

迁移脚本只接受仓库现有事务 SQL。存在未登记的历史业务库时不自动接管；须核对版本与备份。升级前保存 `pg_dump`、云端对象及对应版本配置/历史密钥；不得删除命名卷。SQL 不保证可逆，不能只换旧镜像宣称数据库已回滚。已有任务、未知回执或手机占用不得随部署重放或清空。

首次操作员初始化复用后端 `dist/operator-admin.js initialize --login-name ... --display-name ... --request-id ...`，密码仅通过标准输入提供，不放在参数或日志。部署浏览器检查复用 `pnpm test:playwright`：设置 `SG_PRODUCT_WEB_SCOPE=deployment`、`SG_PRODUCT_WEB_URL` 和 `SG_PRODUCT_DEPLOYMENT_LOGIN_FILE`（保护 JSON 文件，包含 loginName/password），验证登录、项目页面、刷新后的会话及退出，不创建业务记录。浏览器验收从正式 Web 登录验证，`/health/live` 仅证明进程存活。短信默认 `unavailable`，不能据此宣称供应商短信注册、手机执行或公开发布已就绪。

## 云对象存储：OSS 与 S3

服务器只接入云对象存储。用户已有 OSS，凭据由用户在保护配置文件中填写；配置完成后重建后端容器。默认 `SG_PRODUCT_MATERIAL_MODE=unavailable`，不存在自动创建 Bucket、环境 AWS 凭据回退或本机存储替代。

填写模板中的所有素材字段并设为 `configured`：OSS 使用 `SG_PRODUCT_MATERIAL_PROVIDER=oss_s3`，AWS/S3 使用 `s3`（省略 provider 保持原 S3 行为及已有引用摘要）。OSS 使用该区域的 S3 兼容 Endpoint，例如 `https://s3.oss-cn-hongkong.aliyuncs.com`，通常 `FORCE_PATH_STYLE=false`；区域必须与 Bucket 一致。Location UUID 是持久绑定标识，不能在已有文件后随意修改。STS 使用时才填写 Session Token。

OSS 专用处理包括签名前加入 `x-oss-content-sha256`、缓冲上传及 Content-MD5、防止覆盖同名对象的 `x-oss-forbid-overwrite`，以及 409 `FileAlreadyExists` 后读取完整字节核验。**OSS Bucket 必须从未启用版本控制**；Enabled/Suspended 都会使禁止覆盖失效，因此每次上传先读取版本配置并拒绝有状态的 Bucket。RAM 身份需要 `oss:GetBucketVersioning` 及目标 `projects/*` 前缀下的 `oss:PutObject`、`oss:GetObject` 权限，无需授予删除/版本设置权限。管理员须保持该 Bucket 的版本设置和对象写入策略稳定，不让其他身份修改同名对象。

S3 继续使用 `If-None-Match: *` 与 SHA256 请求校验。两种模式都在写入后 GET 并核验完整 SHA256、大小、类型，冲突不凭 ACK 判成功。当前协议测试为隔离 HTTP fixture 的补充检查，**真实云服务鉴权、权限、上传/下载及正式 Web 素材流程须在用户填入配置后验证**。

官方依据：[OSS 的 AWS SDK 接入](https://www.alibabacloud.com/help/en/oss/developer-reference/use-aws-sdks-to-access-oss)、[OSS PutObject 与版本控制限制](https://help.aliyun.com/en/oss/developer-reference/putobject)。

## 本地与部署配置（2026-10-07）

三份模板分别为[本地后端](.env.local.example)、[生产后端](.env.production.example)、[执行器](.env.executor.example)。模板不含实际凭据，也不创建业务绑定。现有配置文件、SQLite/PostgreSQL 数据、历史密钥和设备授权均保留；本轮配置整理不自动部署或连接云存储。

本地 `pnpm dev` 与 `pnpm config:check` 共用配置加载代码。覆盖顺序为：允许覆盖的显式进程变量 → `.runtime/product-local-live/backend.env` → 现有 `material-storage.json`、`network.env`、`execution-binding.json`、`.env.runtime` → 本地默认值。新文件可选，必须当前用户持有且权限 0600；只接受模板涉及的后端可选字段及端口。数据库密码、认证 pepper、开发短信令牌仍由原 `config.json` 管理。任何素材覆盖都替换整个素材配置组，必须完整提供，避免混用旧凭据；只设置 `SG_PRODUCT_MATERIAL_MODE=unavailable` 可关闭。旧素材 JSON 也支持 `provider: "oss_s3"`，省略时保持 S3 行为；不要变更已有对象位置 ID/摘要来冒充存储迁移。

生产使用受保护的 `.env.production` 及 Compose 的固定容器监听设置；变量名与本地可选配置一致。Web 保持同源 `/api`，无需另填公网 API 地址。Android 生产构建仍按上文注入 HTTPS 地址和签名材料。

执行器继续读取原 `.env.runtime`，Agent 继续读取 `.env.agent`；不得用示例整体覆盖。截图存储现使用 `SG_SCREENSHOT_*`，旧 `SG_MINIO_*` 不再读取。需在下次重启前显式填写新的云存储字段；未配置时仅截图存储操作返回不可用，不自动连接 MinIO。SDK 支持 S3/OSS、区域、虚拟主机/路径寻址、STS 和请求超时；Bucket 必须预先存在，上传未确认时不自动重试。历史对象不会搬迁，旧截图可读性需另行核验。APK catalog 与 Android build-tools 必须通过选项或 `SG_APP_CATALOG` / `SG_ANDROID_BUILD_TOOLS` 指定，已移除个人电脑路径回退。

只读脱敏检查（无数据库连接、云请求、设备操作或服务启动）：

```sh
pnpm config:check
pnpm config:check --profile production --env-file /absolute/path/.env.production
pnpm config:check --profile executor --env-file /absolute/path/.env.runtime --runtime
```

`configured` 只表示配置检查通过；`disabled` 为明确未配置/关闭；`incomplete` 为缺项或格式冲突；`missing_dependency` 为当前机器缺文件/程序；`not_wired` 表示组件未接入。缺项/依赖失败时退出码为 1，关闭项不自动视作失败。`--runtime` 仅检查**运行检查命令的机器**，不能用 Mac 的依赖代替容器证据；生产默认仅检查配置结构。原始错误、令牌、连接串及密钥不输出。配置文件读取失败也只输出固定错误码。

待部署接线的明确边界：基础镜像不包含 Python/Artemis/视频分析工具；完整执行部署需使用下述 execution overlay；执行器保持回环监听，需要可信通道和反向回调，业务绑定必须对应目标数据库；阿里云短信适配器已接入，真实发送需配置签名、模板和凭据；Redis 队列组件尚未注册；Tailscale/ADB 需要明确执行位置与工具/状态挂载。以上检查不是这些能力的业务验收，不会自动开放公网、创建云服务或重放任务。


## 阿里云短信与服务器执行部署

短信选择 `SG_PRODUCT_SMS_MODE=aliyun`，按生产模板填写 `SG_PRODUCT_SMS_ALIYUN_*`。使用中国站 `SendSms`（2017-05-25）国内验证码接口，仅接受 `+86` 大陆手机号码；注册和登录可配置不同已审核模板，模板变量默认 `code`。显式 RAM/STS 凭据仅存在保护 env 文件中，不使用默认凭据链。SDK 自动重试关闭，错误输出脱敏；成功只代表接口受理，实际送达须通过真实 Web 验证码流程核验。未提供凭据时继续保持 `unavailable`。本地可用 `backend.env` 覆盖短信模式与阿里云参数，切换到真实短信时自动移除开发验证码令牌；不会同时启用开发验证码读取。

Artemis 上游固定为 `351ca8422f7b5b54e80a9c1ce03a222e02415b6b`（本轮获取的 main），[构建文件](artemis/Dockerfile)应用[项目补丁](artemis/socialgrowth.patch)，保留人工介入、动作保护、结果核验与代理适配。补丁包含锁定依赖；原本地 Artemis 工作目录及其私有配置不覆盖。上游代码及补丁在镜像中，实际模型凭据、JSONC 配置、ADB 密钥、SQLite 状态均在镜像外。

```sh
docker build -t socialgrowth-artemis:351ca8422f7b5b54e80a9c1ce03a222e02415b6b product/deploy/artemis
# env 文件中需填写 execution overlay 的路径与对应执行器配置。
docker compose --env-file /opt/socialgrowth/config/.env.production -f product/deploy/compose.production.yml -f product/deploy/compose.execution.yml build
```

[完整执行部署](compose.execution.yml)增加执行器容器，并为后端提供 Python 3.12、Artemis、ADB、ffmpeg/ffprobe。执行器仅在 Docker 网络监听 4318，不发布宿主机端口；后端通过 `http://executor:4318` 访问，执行回调使用 `http://backend:4320`。Redis 继续使用生产 Compose 中的 Docker 服务和持久卷；现有队列组件尚未注册，不因 Redis 存活而启动任务消费者。

Tailscale 在服务器宿主机运行，持久化节点身份；容器调用挂载的 Linux CLI/本机 socket 查询节点，访问权限由 Tailnet 策略及容器用户权限共同约束。服务器加入当前 Tailnet 后核验容器到手机的真实路由，不以主机 ping 代替容器验证。首次手机联系仍使用公网 HTTPS。ADB 私钥须保留，状态目录由容器 UID 1000 持有；不重新生成密钥代替原配对。

迁移时分别保存 PostgreSQL、执行器 SQLite（含原未决状态）、素材引用、原密钥和 Artemis traces。禁止把本地业务绑定直接接到空的服务器业务库，也不能让原执行器和新执行器同时接管同一设备。`unknown`、人工占用与历史回执原样保留，不自动释放或重发；固定版本发布前后用 Playwright 验证实际 Web，并另行记录模型/MCP/设备通路的证据边界。
