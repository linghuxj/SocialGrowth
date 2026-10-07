# BE-OPS-FULL-SCHEMA 隔离联合恢复工程补验

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

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

## Root 当前集成的 36 迁移补验

本节是前述 33 迁移历史运行的增量补验，不覆盖或改写其证据。Root 集成源 `862508b9738b85fe74563fa6fe07ce35a801a83d` 含 0034–0036；本次冻结测试代码 SHA 为 `586fc51f9927ce9534425cd130715cacdc5e6682`。测试动态枚举 36 个迁移，并将同一读取 byte buffer 同时用于应用和 metadata SHA。上表已记录 0001–0033 的 33 个文件与 SHA；补齐文件为：

| migration | SHA-256 |
|---|---|
| `0034_business_plan_task_attempts.sql` | `2204dcce0f6f9b2a6acd86bda700f55132121e6808566daae659ac79b2dda309` |
| `0035_project_material_lifecycle_intents.sql` | `bf346fc6a8eba01707755c048d0a9870df940d1fadf547cf86e6399af8c76b65` |
| `0036_project_review_cycles.sql` | `6bea896add4daf26cc78f323a4e05f8840c95d7df3ba55d7e4dac198acce45c9` |

复现命令仍为：

```sh
pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-maintenance-recovery.pg-test.ts
```

实际结果：1 test，1 pass，0 fail，0 skipped；测试耗时 `30608.753549 ms`，test runner 总耗时 `45144.714367 ms`。本轮在独立 PG17.11 + MinIO 容器中实际应用 36 个迁移，做同快照 dump、加密保存、new client load、空目标 restore、备份后撤销 session/association/participation、删除自有桶对象与联合只读检查。

`business_plan_task_attempts`、`project_lifecycle_intents`、`material_withdrawal_intents`、`business_plan_task_cancellations`、`project_review_cycles` 均在备份 inventory 中；它们的 source/restore 列定义相同、行数分别为 0、0、0、0、0。此前 0031–0033 表的 9 表对照也仍在同一测试中。总 inventory 的 `databaseMatchesBackup=true`；所有这些新业务表行数为空，只证明 schema/inventory 对照，不证明业务数据恢复。

清理由通过的测试 after-hook 断言：PG/S3 pools/client 关闭；精确临时加密目录只含预期文件后删除并 rmdir；本轮容器再次按完整 ownership facts 核验后 stop，随后断言容器 ID 已不在 `docker ps -aq`。两容器使用 `--rm` 与独占匿名卷，Docker 随容器移除匿名卷；测试未扫描全局 Docker 卷列表。包密钥 buffer 以 `fill(0)` 清零，合成随机凭据未打印/写入记录。未操作 live DB、USB、模拟器或其它服务。

随后按依赖顺序执行 `pnpm --filter @socialgrowth/product-contracts build`（包含 `generate:check`）和 `pnpm --filter @socialgrowth/product-backend check`，均通过。真实生产数据/恢复、消费者停止、物理 fence、生产密钥与维护目录、容量和 RPO/RTO 仍未验证；许可状态仍保持 false/unknown。

## 0037配置事实/actor-scoped命令回执表补验

任务 `BE-OPS-CONFIG-SCHEMA` 由 `/root/ops` 原子认领成功（ledger rev510）；依赖 `INTEGRATE-3` 已 done。独立树基于已获审的 36 迁移/恢复候选，安全快进同步完整批准提交 `603ace4a9fd03007f23424366c839885f144ae80`，没有将 canonical 工作树里的用户未提交改动带入或改写。当前源迁移集合为 37 个编号 SQL 文件，0037 SHA-256：`b1d245302364d139e1df3786dd482817919fddcc92a6f9d5dc1dbd19d6cbeca1`。

0037 新增事实表 `project_review_cycle_configs` 与配置模块的 actor/request-key-scoped command receipt 表 `project_review_cycle_config_commands`；后者保存不可变的 response JSON，与 lifecycle journal 不是同一数据源。现有 fixture 仅创建 project/operator，不创建 review-cycle、配置事实或配置命令，因此本次最窄断言将两表追加到既有恢复检查：要求两表均出现在同一备份 inventory，逐列对比 source/restore 定义，并对比精确行数。这个既有 fixture 预期两表均为 0 行；它不会构造成功配置、当前周期、配置版本、重复写或回放回执，也不能证明当前/history/config版本与 actor-scoped replay/read-command 的行级关系保持一致。那些关系保留为未验证边界，不据此给出业务恢复或生产结论。

源码在 `947f58590774f6c0a3e089e7c66a17eb59b840a8` 冻结，并经 adversary source-only 精确批准（base `603ace4a9fd03007f23424366c839885f144ae80`）；源码范围之后未改变。lead 释放窗口后实际运行：

```sh
pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-maintenance-recovery.pg-test.ts
```

结果 1 test、1 pass、0 fail、0 skipped；测试耗时 `24506.970721 ms`，runner 总耗时 `35633.514887 ms`。该次运行实际应用了当前 37 个迁移，capture metadata 与同一批读取/应用的迁移 bytes 使用相同名称和 SHA；0037 的两个表均包含在 inventory 中，列定义 source/restore 完全相同，source 与 restored 行数均为 0。PG inventory 总比较仍通过，权限门禁保持 false/unknown。

最小 backend check 首次失败：独立树未构建 0037 workspace contracts dist，因而提示 8 个 project-cycle config contracts 导出缺失。随后顺序执行 `pnpm --filter @socialgrowth/product-contracts build`（其中 `generate:check` 通过），再执行 `pnpm --filter @socialgrowth/product-backend check`，退出码 0。上述初次 stale-dist 失败及临时构建修复保留为本任务工程证据；不把它扩展为全局阻断。

fixture after-hook 清理通过：关闭自有 PG/S3 client/pool，按 exact temp directory/key 清除加密包并 rmdir，按 ID/name/image/label/loopback port/独占匿名卷归属再次核验本轮容器后停止，并断言容器 ID 已消失；随后只读筛查 `sg-maint-pg-`、`sg-maint-s3-` 无残留。本测试使用 `--rm` 和匿名卷，未触碰原 PG33、其他容器、USB/模拟器、队列或发布。测试仅证明 schema/inventory 及空表行数恢复：0037 两表没有配置事实或命令回执行，不能证明生产 current/history/config version 与 actor-scoped unknown/replay 回执关系、周期业务数据恢复、生产数据恢复、RPO/RTO 或 consumer/fence；不据此给业务通过结论。

## 0038周期来源迁移恢复补验

基线与完整获审 Backend 源为 `e1baeaa8b30cc89f7ded8b06719fbd5dbc21fe2c`（source review report `d656b378`）；测试、migrations 与通用 restore inventory 与此源相同，没有ops代码偏移。迁移目录现枚举 38 个编号SQL，0038 SHA-256：`20f16514ca4a7a8ee563154f82eb6d1ad133b38ca39b00f53c33924c9d7675c8`。

先执行 `pnpm env:check`：Node `v24.16.0`，项目Node路径 `/Users/linghuxj/Library/pnpm/nodejs/24.16.0/bin/node`，SQLite OK。无 stale contracts 依赖阻断本恢复测试，因此没有额外运行 contracts build/generate、backend build/typecheck。

现有恢复命令单次运行：

```sh
pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-maintenance-recovery.pg-test.ts
```

结果：38个迁移实际应用，1 test、1 pass、0 fail、0 skipped；测试耗时 `27809.942289 ms`，runner 总耗时 `41168.683121 ms`。backup metadata 与实际应用的同一组 migration name/bytes/SHA 对齐；加密文件由现有新 client load，恢复到隔离空目标。整库 `databaseMatchesBackup=true`，包含0038对现有周期表的来源列、NULL性、checks、composite FKs、partial unique indexes、function/trigger 与行inventory对照。

0038方向相关的周期/config表在fixture仍为空：该测试证明迁移/schema/空inventory在dump-restore后匹配，不能证明非空 initial/source-config/carry predecessor关系、current/history/config版本传播、command receipt/replay关联或业务周期恢复。不得将空fixture报告为业务成功、生产灾备或RPO/RTO。

测试after-hook清理通过：本轮自有PG/S3 pools和client关闭，精确临时目录仅允许预期加密包后删除并rmdir；fixture按本轮容器ID/name/image/label/loopback port/匿名volume owner核验后stop，并断言容器ID不再存在；测试结束后的只读名称筛查未发现 `sg-maint-pg-` 或 `sg-maint-s3-` 容器。使用Docker `--rm`匿名卷；未检查/触碰其他Docker资源。包密钥buffer清零。没有操作原PG33/SQLite、服务队列、browser/model、USB/模拟器或发布。
