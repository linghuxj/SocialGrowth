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

开发在 `dev`；只有满足对应检查、真实业务验收及必要审查的固定候选才进入 `main`。本次整理未部署生产、未晋级 main、未创建发布标签。当前流程的未决结果和验收限制见[实现说明](../../docs/current-implementation.md)。
