# 正式产品后端

WP-00 只提供 NestJS 进程骨架。`GET /health/live` 是进程存活检查，仅表明当前进程能够响应并返回正式产品环境标识；它不是 readiness，不检查 PostgreSQL、Redis、对象存储、迁移或后台作业。

依赖就绪检查将在相应组件接入时单独实现，部署和流量入口不得把 `/health/live` 当作业务可用证明。

WP-01 开始建立正式权威数据模型：

- [首批身份与设备 ER 及事务边界](docs/identity-device-er.md)
- [`0001_identity_and_device.sql`](migrations/0001_identity_and_device.sql)

迁移当前是待后端迁移执行器消费的前向 SQL；未在真实 PostgreSQL 执行前，不得将其记为迁移或并发验收通过。

## WP-01 事务服务

`IdentityTransactionService` 实现当前首批后端事务基础：

- 邀请注册锁定验证与邀请行，在同一事务内复核有效性、创建提供者、扣减名额、消费验证并保存幂等结果。
- 安装端创建新关联会话时失效旧会话；提供者只能读取必要扫码目标并确认。确认事务原子消费会话、创建归属并写入 `associated_pending_access` 设备状态。
- 幂等载荷摘要排除每次重试可变的 `requestId`；同键同业务载荷返回原结果，同键异载荷拒绝。
- 成功注册、关联会话创建和设备关联写入不含令牌、验证码、原邀请码或手机号的审计事实。

真实 PostgreSQL 集成检查会删除并重建目标数据库中的 `socialgrowth_product` schema，因此必须同时显式提供专用测试 URL 和重置开关：

```sh
SG_PRODUCT_TEST_DATABASE_URL=postgresql://.../isolated_test \
SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

不提供两个变量时测试立即拒绝执行，不存在隐式默认数据库。根据当前用户决定，本阶段不实现迁移历史组件；部署流程必须保证 `0001` 只执行一次。
