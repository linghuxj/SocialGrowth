# 独立安全复审：维护恢复组合

- reviewer：`/root/adversary`
- base：`6136984de4b325644d35d5850687ec4fa8527ac5`
- head：`3d67d5035964492c58da67dae965c2de3df48210`
- verdict：**approved**，维护组合、inventory callback与deploy README三文件；新增/剩余阻断finding为0。

OPS-CAPTURE-01已修：首await之前clone metadata并复制32字节key，capture/save使用同一固定副本，UNKNOWN从原envelope取ID，finally清自有key副本。独立提取精确head函数的异步突变探针通过：原输入metadata/key在等待期被更改仍返回原包ID、save使用原key，副本清零而调用方key保留。

OPS-SNAPSHOT-02已修：snapshot的权威字段/holder/outbox/object引用通过同一withDatabaseInventorySnapshot回调的query读取，与inventory共用其自持READ ONLY事务；不再另取恢复库第二快照。独立静态检查上下文及diff-check通过。本轮没有独立PG或S3演练，不将结构核对宣称为实际联合恢复验收。

所有允许标志保持false、consumersStopped/physicalFence保持unknown、requiresReconciliation保持true。该SQL回调仅供可信维护代码且限snapshot生命周期，不能暴露为HTTP/任意SQL端点。选定字段摘要匹配不代表全系统实时authority一致，也不能释放holder或恢复消费者。作者tsc/lint证据按工程范围引用；真实物理停止、PG/S3联合演练、生产灾备/正式密钥/Playwright未验证，后续实现变化须审新head。
