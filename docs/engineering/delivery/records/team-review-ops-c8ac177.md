# 独立安全复核：维护恢复组合

- reviewer：`/root/adversary`
- base：`6136984de4b325644d35d5850687ec4fa8527ac5`
- head：`c8ac177b0c94dfc9bd6d022f47c80a61f39eb3cc`
- verdict：**changes_requested**，两个P2。范围为maintenance组合及deploy README，无新跨端契约。

## OPS-CAPTURE-01 / P2：异步后读取可变输入破坏原包接续

`captureAndStoreMaintenanceBackup` 在await capture后重新使用input.key，FILE_UNKNOWN时从input.metadata.backupId取ID。既有capture内部已固定metadata/key，而维护wrapper没有固定；调用方在capture等待期间改写输入会让save使用另一key，或让UNKNOWN结果ID与原envelope不同。

独立提取精确head函数，使用同语义的固定metadata阻塞capture及固定UNKNOWN文件端口做纯控制流探针，无DB/文件/密钥操作：得到 `backupIdMatchesEnvelope=false`、`saveUsesOriginalKey=false`、`state=unknown`。要求在异步前固定本次输入/key，UNKNOWN的ID从本次原认证包取得，保持包与key一致。不得通过再capture/换nonce处理。

## OPS-SNAPSHOT-02 / P2：恢复比较混用两个事务

`inspectMaintenanceRestore` 先完成snapshot(restoredPool)，再另调withDatabaseInventorySnapshot(restoredPool)。恢复目标在两者之间变化时，currentAuthority/Control/Queue/Object匹配来自旧状态，databaseMatchesBackup来自新状态；报告可同时true却不对应同一恢复状态。消费者是否停止固定unknown，所以不能假定目标不变。

要求恢复库inventory与对应权威/控制/队列/对象引用取自同一read-only snapshot，或对未固定观察明确unknown，不能用混合读取签匹配。所有允许标志固定false/requireReconciliation保留，不需要新增恢复授权或自动操作框架。

已完整静态审查两文件与底层capture/file-store/inventory/object-storage及实际migration列定义。作者tsc/lint证据仅作工程参考；本轮未跑PG/S3联合演练、真实服务、设备、Playwright或生产恢复。任何新head须重审。
