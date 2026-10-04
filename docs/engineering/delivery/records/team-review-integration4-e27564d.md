# 第四批根组合独立复核

- Reviewer: `/root/adversary`
- Base: `5c8960f6e74a3e55105693722b3443f95aa312bc`
- Head: `e27564d6a2aca4f00e9177f784935b5063fcfee5`
- Verdict: **approved**
- Task: `SEC-INTEGRATE-4`
- Findings: 本精确范围无未关闭问题。允许保持该 head 更新现有 PR；新 head hosted CI 仍待实际取得，不沿用旧 PR23 CI。

## 完整来源与边界

独立复核完整21文件范围，逐文件对象核对19项与既有完整批准候选精确一致，没有冲突处理或遗漏父依赖带来的额外源码：

- 后端10文件与 `603ace4a9fd03007f23424366c839885f144ae80` 一致，原 base 为本次5c8960f；包含 migration0037、AppModule、controller/service/PG、完整DTO/registry/generated/export。见[后端审查](team-review-cycle-config-802ac33.md)最终附录。
- Web/runner/verifier七文件与 `cbed0e5b78a1c1a08bb101e7f4037a64fb2811a4` 一致，原 base603ace4，见[Web完整审查](team-review-cycle-config-ui-b025d68.md)最终附录。先前六个 findings 已在该精确来源闭合，历史撤回批准/changes_requested不删除。
- 运维测试及记录两文件与 `e9f975ba0bb91695dd719e2e760d670c1d205b8f` 一致，原 base603ace4，见[运维审查](team-review-ops-config-schema-947f585.md)最终附录。

仅新增根交付记录 `team-integration4-20261004.md` 与 `integration4/cycle-config-cbed0e5.json`，均逐项读取。已核对 project-cycle-next-config rev3 仍为 backend/UX 双签；四项依赖任务均 done。源增量不包含 ledger、用户 dirty 文档或受保护发布脚本；仅以路径/status观察 canonical 未提交项，未读取/diff/hash/stage该脚本或用户修改。报告只写入独立 reviewer 分支，不改变被审根 head。

组合保持 operator cookie/CSRF、事务行锁与最终会话时效、actor/project/key/body 摘要绑定和不可变回执。confirmed配置仅追加记录，effectiveStartsAt来自活动周期原结束时刻；无运行时信息、晚确认或不可解日历边界不新增配置。unresolved按rev3保留旧配置事实，不假装新增确认；客户端原请求恢复不依赖当前周期可读，跨actor不lookup/replay。命令lookup的not_found不能推定未执行。nextCycle=null、执行/发布false且无 Task/quota/设备消费者副作用，整合没有放宽这些边界。

## 实际证据独立核对

读取作者指定 cbed 实际验收目录中的四个有限 JSON：planning/acceptance-summary.json、planning/cycle-config-safe-facts.json、business-plan-readonly-facts.json、cleanup.json。未读取原始日志、截图、模型输出或配置。根固定proof中的 acceptance 对象与作者摘要逐对象完全一致；transport事实的两次body/key哈希及回执与原safe-facts一致。

- cbed 根入口 planning 实际退出0，摘要明确 cycleConfigAcceptanceExecuted=true、实际模型调用1、真实页面方向生成并确认；输入为未注册身份的工程测试，不代表真实平台身份授权。
- 首次真实POST201 confirmed只丢弃浏览器响应，原运营重新登录显式继续原请求，两次body/key SHA一致，第二次201 confirmed/replayed=true。
- 实际B旧版本UI拒绝、不同operator命令读取0、currentCycle保持，配置rev1为Asia/Tokyo/14天/最低2，起点与current.endsAt一致；未物化后继周期。只读补充Plan command/revision/Task/outbox全0，执行/发布仍false。
- cleanup有限结果：自有服务已退出、两个精确容器ID移除、临时凭据已删除。没有本reviewer重复运行或当前全宿主资源扫描的主张。

固定proof只包含有限状态、哈希与计数；人工检查及常见Bearer/私钥/带口令连接串模式检查未发现凭据。root文档保留82dirty首轮失败、b025初始化中止、40b模型完成后A导航失败和后续精确修复，未将新的隔离成功写成恢复旧已清理fixture。OPS首次旧dist检查失败及依赖重建通过仍保留。

37迁移PG/MinIO1/1沿用作者固定运维记录：0037两表都是0行，仅证明schema/inventory/空行恢复，不证明实际配置/current/history或actor-scoped回执的行级恢复；生产灾备、RPO/RTO及physical fence未通过。当前真实页面也不证明自动carry N+1、配置一次性生效/追算、业务评价、非空Task到Artemis、USB动作或权限/平台发布。

## 本次检查与后续

独立执行：完整来源匹配、已签契约及依赖检查、两份新增交付文件/有限原证据核对、完整 range diff-check，均通过。根 Node24.16/SQLite、contracts build/generate/backend check/Web check 为主会话报告；本reviewer未重复编译、测试、浏览器、模型、容器、服务或设备操作。

此批准只对所列base/head。根不得将本报告合入后继续沿用e275批准；需要新源提交时重新固定复核。现有PR23更新及新精确CI属于后续步骤，未在本文声称完成。外部真实权限、规模、短信/独立管理真机、生产恢复等沿用既有去重阻断，不以本切片成功关闭。
