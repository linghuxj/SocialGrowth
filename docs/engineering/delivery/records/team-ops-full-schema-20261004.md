# BE-OPS-FULL-SCHEMA 隔离联合恢复工程补验

日期：2026-10-04
冻结源基线：`3e03cef493126db5eef698119262744caeb6f482`
范围：仅工程合成 PostgreSQL 17.11 + MinIO 联合 fixture；不是生产恢复或业务验收。

## 可复现命令与结果

在仓库根目录和项目配置的 Node 环境执行：

```sh
pnpm env:check
pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-maintenance-recovery.pg-test.ts
```

最近一次输出：1 test，1 pass，0 fail，0 skipped；测试耗时 `35013.550405 ms`，Node test-runner 总耗时 `49536.24143 ms`。此前同一候选改动后首次跑也为 1/1 pass（测试 `28767.932825 ms`，总计约 `43782 ms`）；随后的唯一改动是显式断言 fixture 最新迁移表仅含 migration-owned singleton/其余空表，故以最近一次为最终证据。`pnpm env:check`：Node `v24.16.0`，项目 Node 路径 `/Users/linghuxj/Library/pnpm/nodejs/24.16.0/bin/node`，SQLite OK。

测试从当前冻结源的 `product/backend/migrations/` 枚举全部 33 个四位编号 SQL 文件，排序后逐个读取为 byte buffer；每个 buffer 的 SHA-256 写入 backup metadata，并将同一 buffer 原样应用到自有 source DB。测试对实际读取并应用的列表和加密包 metadata 做相等断言。下表列出本次运行工作树这些 migration bytes 的 SHA-256（与冻结候选比较；本工作仅改测试/记录）。

| migration | SHA-256 |
|---|---|
| `0001_identity_and_device.sql` | `f26a85881c086e994aa62a6042cf0043f52d6e05e417739e8a66acda90f14996` |
| `0002_provider_phone_auth.sql` | `44cd5b066b252fee60fdb4beb9bfa45dc6fcb38c257fa361197599653de917e7` |
| `0003_provider_auth_recovery.sql` | `8d9eb2b72ded8b4a51ebfc6bb1fb3fb73167660c0c8b210d6f8453376c53e581` |
| `0004_installation_bootstrap_admission.sql` | `137fbf26482ad244ee18a7e73471d4b2a7ef540bf1a841071988aac80351abe6` |
| `0005_network_admission.sql` | `704142eb2a39ca868fa1758f62988655127e0f79806241b3b62468c8375cf973` |
| `0006_phone_control_journal.sql` | `c8e3ca05c67a8d848013cc84b33ed6e3d06ac46a2e18b56db26fb1c168e2e28e` |
| `0007_task_recovery_budget.sql` | `4ec4a7753e99db72c777a7749733220b0d1c2ec517a33bc6cc47b2a663268579` |
| `0008_project_basics.sql` | `e2d8016751460255bf227e05e20fbcf02f446837d4c556e2e97864603195e015` |
| `0009_resource_reservations.sql` | `6bef0537936bd8091e5afda9360ba6e530f42e15ad5ec5c74810418da9c81df8` |
| `0010_project_planning_drafts.sql` | `0bd4e27928de1ed295827f17d4ce6dcc5e4d7b5124b20420411bb41c09ccf6a7` |
| `0011_unassigned_device_todos.sql` | `7d990f9c9b13681a5273b321809c714f0ab7dd9e084ead24fa2220dd0c4bda44` |
| `0012_device_assistance_feed_index.sql` | `e81383238ec03e30483505fb025cff3f4ac438adf653e43d4ba2389358a997eb` |
| `0013_device_assistance_notes_index.sql` | `5bf523a015c6ad548670f5b6d0b4099d95ce11b62547694592fbbf8d6531e9e5` |
| `0014_tracking_link_requests.sql` | `90de83ec1c35766948706b15cc60a3795c77da29838157c4355012817fd66589` |
| `0015_endpoint_report_journal.sql` | `7d6f8696a8f4f322f727f5f9f5d420d9980f8377ee19540f9d39f1d4d11be935` |
| `0016_connection_maintenance_budget.sql` | `16f036684d578a9c670a74ad58e3f610c3fcbb71c5657800c8ba354f912e33df` |
| `0017_joint_recovery_reservations.sql` | `d9d82f4689225c09dfdbd865fe70f5aa30169cffc94c9e8308ba043bb18eb5e6` |
| `0018_commission_income_journal.sql` | `85548e339d05f4f226f843eae8bf30a6d152284d264c218b402b9a39c94bf48d` |
| `0019_material_registry.sql` | `a5081e52883bbf1c4d3b0c952b1ad8adf10f14558611bebe5fc4bb079087fe18` |
| `0020_material_upload_tickets.sql` | `b802b94efbe6adcc71494d597425558f421073694e73cacc0e93063ef4e73b0e` |
| `0021_task_recheck_outbox.sql` | `0d2976886bf5c8c30caf18d06aa4a07af2f513074333be776b6c557c860e62d7` |
| `0022_media_registry_commands.sql` | `704ab0dc512ba27646b7b015c5a303e1949541dda446f1ecef73a66a7a24a9ce` |
| `0023_media_credentials.sql` | `40c36906e54c549b8e65787073e337a4bb8d1e5c987bfe19c2b02ea41ea79208` |
| `0024_project_direction.sql` | `24388e30c0474b88473015bcb732a1d5af81aea9bebd71f8bae8f388464bdeda` |
| `0025_artemis_preflight_journal.sql` | `70b244212a8690ea5a56c8b66f87f770e8855e3d35310000ab9e3f559f2a85ca` |
| `0026_account_preparation_tasks.sql` | `d8a0c2b6fd002f31d756c124084b1aa801c21dd76d1d9bf58064af15f1253da5` |
| `0027_artemis_preparation_journal.sql` | `6c0f1ee897f90ac03b795aaae5779dd455889e1774c25e836d8c8cd821a0a52c` |
| `0028_preparation_execution_reviews.sql` | `e018a4413920ff43463068de8634d6decd5f5afbb5d6b1ad18971c63a43ab46c` |
| `0029_phone_holder_grants.sql` | `f6216042a3b5379e9d8676b6bf3f4f40f6e2116f0f2ef3b001fe0a6199184b5a` |
| `0030_local_participation.sql` | `dc73fd904bea5fca70acc04de8f06ae5d23cfb002fcd561f22e14f895e53ca19` |
| `0031_business_plan_tasks.sql` | `4d58bfa1fe1a79febc451f8f46275b68adcc368de409b35bf91d9703ebfe7aff` |
| `0032_business_plan_task_impacts.sql` | `5e2b327ba34673c55eeaadf06b1d4e516acb59e1b8cec49273bfd6ad2cdbd65e` |
| `0033_metric_snapshot_history.sql` | `ee76e9a6d39d69d10b0eba8d60ab86ffebb568424b1e52f89ca96dc1d57098f9` |

## 已实际验证

- 测试创建本轮随机命名的专用 Docker PG 和 MinIO 容器，各自使用 `--rm`、本轮唯一 fixture label、随机临时凭据、loopback 临时端口及独占匿名 volume；执行中精确核对容器 ID/name/image/label/端口/运行态/volume owner，并核对 PG cluster identity。没有连接 `55432` live 服务。
- 全 33 个 migration 实际应用到独立 source；实际 `pg_dump --snapshot` 进入现有捕获/加密文件存储原语，新 client 从文件存储加载并打开包；通过现有 `pg_restore --single-transaction` 恢复到本轮空 target。
- 全量 inventory 比较 `databaseMatchesBackup=true`；0031—0033 新增的 9 张业务计划/指标表均出现在 capture inventory，restore 前后列定义和逐表行数相同。fixture 中 `business_plan_guard` 只有迁移自带单例，其余 8 张表为空；这是 schema/inventory 工程对照，不是业务数据恢复证据。
- backup 后真实撤销 fixture provider/install session，撤销 installation，结束 association、撤销 participation run，并从本轮 MinIO bucket 实际删除被引用对象。source→restore 的权限差异可见；删除操作收到确认，trusted read 失败为 `STORAGE_UNAVAILABLE`，恢复报告 `restoredObjectsVerified=0`、`restoredObjectsUnverified=1`。
- 目标仍保留历史 `unknown` 控制调用/holder 和 pending outbox；`consumersStopped=unknown`、`physicalFence=unknown`。`executionAllowed=false`、`publicationAllowed=false`、`holderReleaseAllowed=false`。从未将历史 grant 当作当前许可。
- 测试 after-hook 关闭连接、关闭 S3 client、清理加密临时目录，仅允许删除预期包文件，并再次核验本轮容器后精确 stop，断言容器 ID 已不存在。fixture cleanup 成功随测试 1/1 通过确认；环境中的其他容器/服务未操作。

## 未验证及边界

未验证真实生产部署实例隔离、生产 key/custody、正式对象存储、维护目录授权、真实消费者停止或 executor 物理 fence、业务数据恢复、全量生产一致性、RPO/RTO、完整迁移容量/性能目标及真实运维人员签字。工程 fixture 的清空业务表和通过 inventory 不能关闭 LEAD-OPS 真实运维验收。恢复结果默认停消费/不放权。
