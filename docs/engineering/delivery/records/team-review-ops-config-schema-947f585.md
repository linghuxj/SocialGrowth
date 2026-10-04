# 0037 配置 schema 恢复测试增量审查

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
