# 0037 配置 schema 恢复测试增量审查

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

- Reviewer: `/root/adversary`
- Base: `603ace4a9fd03007f23424366c839885f144ae80`
- Head: `947f58590774f6c0a3e089e7c66a17eb59b840a8`
- Verdict: **approved**，仅 source-only 两文件增量。
- Task: `SEC-OPS-CONFIG-SCHEMA`
- Findings: 无未处理问题。

完整差异只包含既有 `database-maintenance-recovery.pg-test.ts` 和 `team-ops-full-schema-20261004.md`。测试将固定表名 `project_review_cycle_configs`、`project_review_cycle_config_commands` 加入既有 captured inventory 存在性、source/restore 列定义及精确行数比较。SQL 表名来自固定数组，不来自调用输入；没有增加种子配置、业务回执、权限、API 或 runtime 改动。现有 fixture guard、资源所有权核验、cleanup 与密钥清零逻辑均未变化。

独立核对完整 diff-check 通过；文档所记 migration0037 SHA-256 与候选中的确切字节一致：`b1d245302364d139e1df3786dd482817919fddcc92a6f9d5dc1dbd19d6cbeca1`。未读取或哈希受保护发布脚本。

文档明确新增两表预期都是空表：配置命令是 actor/request_key 作用域的独立 immutable receipt，不是 lifecycle journal。列与空行一致不能证明当前/历史配置版本、unknown 原回执或 actor-scoped replay 的行级恢复关系；这些边界仍未验证，不能推断生产灾备、物理 fence 或配置生效。

作者只完成 source-only diff-check，新的37迁移 PG/MinIO 联演、build/check 仍待主会话释放唯一窗口。Reviewer 同样未运行编译、测试、容器、服务或设备。本批准是源码门禁，不是恢复测试通过；原36迁移成功记录不得改写为本候选37迁移已经通过。后续代码变化需新精确 SHA 复核，测试结果应按实际候选另记。

## 实际证据补充 head e9f975b

- Base: `603ace4a9fd03007f23424366c839885f144ae80`
- Head: `e9f975ba0bb91695dd719e2e760d670c1d205b8f`
- Reviewer: `/root/adversary`
- Verdict: **approved**，完整两文件增量；无新 findings。

独立差异确认相对947f585仅同一运维文档变化，测试源码及0037 migration 未变；完整范围 diff-check 通过。新增记录将本轮实际执行固定到947f585源码，作者报告37迁移 PG/MinIO 1/1、测试24506.970721ms/runner35633.514887ms，并保留首次 workspace contracts dist 陈旧导致八个导出缺失的 check 失败，以及随后按依赖构建再 check 成功。准确区分源码批准、补充运行与业务恢复，未宣称全量业务或生产通过。

新增 cleanup 说明沿用已审 fixture 的精确所有权/临时目录校验、停止自有容器后确认 ID 消失；不将只读名称筛查当作任意外来资源清理授权。0037 两表仍为0行，不证明配置/history/actor-replay 的行级恢复；physical fence、生产RPO/RTO仍未验。Reviewer 本轮仅核对文档和不变源，没有读取原始运行日志、重复测试或操作设备/服务；运行结果属于作者记录。该证据增量不改变安全结论。
