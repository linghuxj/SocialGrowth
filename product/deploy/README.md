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

使用已检查的固定 `main` SHA 将源码归档到 `/opt/socialgrowth/releases/<SHA>`，镜像标签及 `SG_PRODUCT_REVISION` 均使用该完整 SHA。先核对该 SHA 的 GitHub Actions；失败时在 `dev` 修复并重新晋级，不部署另一个未经检查的 HEAD。不自动部署任意分支。

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

首次操作员初始化复用后端 `dist/operator-admin.js initialize --login-name ... --display-name ... --request-id ...`，密码仅通过标准输入提供，不放在参数或日志。浏览器验收从正式 Web 登录验证，`/health/live` 仅证明进程存活。短信默认 `unavailable`，不能据此宣称供应商短信注册、手机执行或公开发布已就绪。

## 云对象存储：OSS 与 S3

服务器只接入云对象存储。用户已有 OSS，凭据由用户在保护配置文件中填写；配置完成后重建后端容器。默认 `SG_PRODUCT_MATERIAL_MODE=unavailable`，不存在自动创建 Bucket、环境 AWS 凭据回退或本机存储替代。

填写模板中的所有素材字段并设为 `configured`：OSS 使用 `SG_PRODUCT_MATERIAL_PROVIDER=oss_s3`，AWS/S3 使用 `s3`（省略 provider 保持原 S3 行为及已有引用摘要）。OSS 使用该区域的 S3 兼容 Endpoint，例如 `https://s3.oss-cn-hongkong.aliyuncs.com`，通常 `FORCE_PATH_STYLE=false`；区域必须与 Bucket 一致。Location UUID 是持久绑定标识，不能在已有文件后随意修改。STS 使用时才填写 Session Token。

OSS 专用处理包括签名前加入 `x-oss-content-sha256`、缓冲上传及 Content-MD5、防止覆盖同名对象的 `x-oss-forbid-overwrite`，以及 409 `FileAlreadyExists` 后读取完整字节核验。**OSS Bucket 必须从未启用版本控制**；Enabled/Suspended 都会使禁止覆盖失效，因此每次上传先读取版本配置并拒绝有状态的 Bucket。RAM 身份需要 `oss:GetBucketVersioning` 及目标 `projects/*` 前缀下的 `oss:PutObject`、`oss:GetObject` 权限，无需授予删除/版本设置权限。管理员须保持该 Bucket 的版本设置和对象写入策略稳定，不让其他身份修改同名对象。

S3 继续使用 `If-None-Match: *` 与 SHA256 请求校验。两种模式都在写入后 GET 并核验完整 SHA256、大小、类型，冲突不凭 ACK 判成功。当前协议测试为隔离 HTTP fixture 的补充检查，**真实云服务鉴权、权限、上传/下载及正式 Web 素材流程须在用户填入配置后验证**。

官方依据：[OSS 的 AWS SDK 接入](https://www.alibabacloud.com/help/en/oss/developer-reference/use-aws-sdks-to-access-oss)、[OSS PutObject 与版本控制限制](https://help.aliyun.com/en/oss/developer-reference/putobject)。
