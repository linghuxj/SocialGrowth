# 第四批交付检查点：真实下周期配置确认

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本记录冻结于 root 源码组合 `edc3181b883430e334f5849412eed155773a6b53`，基线为 `5c8960f6e74a3e55105693722b3443f95aa312bc`。完整合入获审 Backend `603ace4a9fd03007f23424366c839885f144ae80`、Web `cbed0e5b78a1c1a08bb101e7f4037a64fb2811a4` 及 OPS `e9f975ba0bb91695dd719e2e760d670c1d205b8f` 的依赖。无冲突；整合后 `product/backend`、`product/contracts`、运维记录与 OPS 候选一致，`product/web` 与两份 planning runner/verifier 与实际验收 Web 候选一致。

本切片让运营在真实当前周期内明确确认下周期的时区、间隔和最低引流数。它追加不可变配置与 actor-scoped 原命令回执，当前周期、首起点、历史口径和许可保持原值。它没有物化后继周期、推进业务任务或完成指标评价。

| 核验 | 固定证据与结果 | 证明范围 |
| --- | --- | --- |
| 接口与候选 | `project-cycle-next-config` rev3 Backend/UX 双签；Backend603、Webcbed、OPSe9 均有 adversary 精确批准 | 各作者完整源码；最终 root SHA 仍须独立复核 |
| Backend 配置 | 603 补充 PG4/4、build/changed lint 通过；ICU/tz 缺失拒绝与保留 prior config 的两个历史 finding 已闭合 | 隔离工程关系，不代替页面或生产验收 |
| 真实页面 | 固定 cbed，根入口 planning Playwright exit0；一次实际模型方向生成并由 UI 明确确认，明确使用未注册的合成身份作为本地测试输入 | 一个临时项目的方向/配置页面流程；不证明真实 Page/频道授权或任务执行 |
| 原请求恢复 | 实际 POST201 confirmed 后只丢失浏览器回执；同运营账号重新登录明确接续，原 body/key 的 SHA256 两次一致，201 confirmed/replayed=true | 当前独立 fixture 内真实持久原命令；未用模拟成功或 DB 预置批准 |
| 账号/版本边界 | 另一运营账号对 A 原命令读取数0；B 旧版本真实写入在 UI 获409 stale；页面保留当前事实及本人输入 | 该固定浏览器流程；未验收所有身份/恢复路径 |
| 最终周期事实 | current 完全保持；配置rev1 = Asia/Tokyo /14天 /最低2，effectiveStartsAt = current.endsAt；nextCycle=null | 配置真实确认且可读，尚未生效/物化后继周期 |
| 许可与手机边界 | executionAllowed=false/publicationAllowed=false，Task/outbox各0；390px只读无横向溢出/无page errors | 未创建业务Task；没有手机执行、公开发布或模拟器操作 |
| 隔离恢复 | 完整37迁移 PG/MinIO 联演1/1；0037两表inventory、source/restore列及行数一致，两表均0行 | schema/inventory恢复；真实配置/current/history/回执行级关系、生产恢复、RPO/RTO未验证 |
| Root 补充检查 | pnpm env:check：Node24.16.0实际路径及SQLite OK；contracts build含generate:check、backend check、web check均exit0；range diff-check通过 | 整合源与包依赖；不替代真实页面/设备/生产 |

脱敏固定页面证明：`artifacts/acceptance/team-lead-20261004/integration4/cycle-config-cbed0e5.json`。原始本地结果/清理位于独立 UX 树 `artifacts/acceptance/product/UX-CYCLE-CONFIG-cbed0e5-20261004/`；root 有限副本、各精确审查报告与补充检查日志位于忽略的 `artifacts/acceptance/team-lead-20261004/integration4/`。两只隔离容器、服务和临时凭据均已清理；原 PG33 与用户未提交修改保留。

此前失败分别保留：82d50 dirty 源首轮在 cycle-config-lost-response 超时，不能归为冻结head；b025第二runner在模型/浏览器前中止并显式清理；固定40b3一次真实模型成功，但配置验证在返回A项目时失败。40b3的phase赋值在B填写完成后，旧checkpoint不能被解释为B填写前失败；ProjectPanel保留已选项目，脚本遗漏“返回项目列表”。NAV及停用账号确认弹窗顺序已修；current读取失败时原请求恢复入口、expired-cycle读取、stale提示、有限日志/APIResponse类型等六项审查finding均闭合。新的 cbed fixture 验收通过不重写或声称恢复已清理的历史fixture。OPS首次check因旧contracts dist失败，依赖顺序重建contracts后通过；不新增重复全局阻断。

下一步是最终 root 候选精确审查、更新既有 draft PR23、核验新head CI。上述动作尚未在本记录冻结点执行；其实际SHA/批准与CI结果以 canonical任务台账、PR和忽略的有限跟进证据为准，避免批准后修改root head。没有新建阶段分支、更新默认main或发布。

仍须继续开发/验收：没有新配置时自动carry的N+1生产者、一次性配置应用来源与连续停机追算、真实指标/周期评价/下一轮安排、Task到Artemis的可信USB安装身份/独占transport/action fence及实机执行、原生管理/短信/外部真实身份和资源边界、真实运维/规模/试运行验收。周期窗口生成不能被称为业务复盘完成。外部阻断沿用既有五项去重清单，不用新合成样例关闭真实权限或生产门禁。
