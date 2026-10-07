# WP-16 第三阶段：中心任务、队列通知与执行观察契约

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01；基线2639d7b，feature/wp-16-task-contract-stage3。BE实施代理Codex；EX/OPS/AI/BIZ/原非作者/QA协作真人待签。[WP-16](WP-16.md)、[CT-07](../contract-checklist.md#ct-07-任务队列与外部副作用)、[技术设计](../../../technical-design.md#3-权限与真实事实)、[质量手册](../quality-gates.md)。

领取首期四发布形式的中心任务数据边界、最小队列通知与来源执行观察。关系显式绑定任务/安排修订/原尝试/恢复轮/项目/设备/平台身份/批准及分配版本/人工内容unit及language variant/有序对象字节/业务窗口。类型正确不等于中央已生成或有真实批准/素材准入/手机许可；通知仅请求重新核对原任务，绝不携带可执行权限或自然语言扩权。来源执行结束与平台结果分开，未知只核实原关联、不重发或释放名额；报告成功仍需实际证据与当前可信来源核验。

计划：共享strict TS/JSON/Python契约→纯内部关联/观察处理建议（非writer）→补充正反语义检查→产品检查→阶段凝聚提交/原复核/原QA。下一持久阶段需同事务任务修订/名额/outbox及来源当前事实reader，后续Redis/BullMQ与EX消费前复核实际授权；本阶段不注册HTTP、SQL任务生产者、队列或手机消费者，不虚称完整可靠派发。真实模型/批准规则、合法成品/媒体、分配/当前Task、授权/Artemis/Redis配置及停止能力缺口仍按原WP记录，人工需求不阻独立契约工程。

当前WP15 2639d7b16文件上传恢复列表作者374/5BE/4TS/4Py/旧14PG/new历史票据reader7，非作者待e006阶段后接续，原02a QA/e006原复核进行中；完整门禁不得由作者清零。Developeraf14/父WP10来源pending1与管理员browser/SEC门禁保持；默认自有服务/Samsung授权、保护脚本仅路径状态、原窗口模式/新固定发送与仅读已有报告不重发。无新UI/浏览器/手机/模型/公开发布，全部开发与全AC/G3仍未完成。

## 实际边界与检查

独立`2026-10-01.task-v1`协议，旧B1 identity/control版本及90个JSON schemas逐项不变、新3，不修改Android/Web/executor/依赖/SQL/runtime。centralPublicationTask是首期四形式`publish_content`数据形状，不含任意shell/目标App文本/存储URL-key/访问令牌字段，也不是来源已认证或真正中心生成证明。任务明确绑定task revision/attempt/project/device/identity与批准/安排/分配/material版本和recovery round/显式限额；只验证UUID/字段及跨字段关系，不解析真实资料/批准、占用名额或证明目标身份。初始化、采集、删除等其他任务契约尚未实现，不把四发布形式冒充全部任务种类。

window inclusive starts/exclusive ends与scheduledAt使用原精确时间比较/禁止year0；material1～1000、语言canonical lowercase、objects1～20且大小写UUID唯一/有序，图文只image MIME、视频单非image MIME（允许opaque octetstream，非可解码证明）。title/caption4000 code point/显式非空/trim一致/无NUL、允许多行caption；128MiB/schema对象上界、恢复1～100次/1～3600000ms只是已有技术上界，非运营目标/模型可调额度或生产容量。限额必须由可信中心初始化，schema无自动配置/default/重置行为；原实际2次/300000ms默认核心未改。schema禁止秘密字段不等于自由文本能自动识别/清除秘密，后续受控模型输入与日志仍需真正过滤，当前不日志回显任务文本。

taskDispatchNotice仅messageId及scope、purpose=recheck_central_task/executionAllowed=false，无caption/file/permit/成功字段；createTaskRecheckNotice纯构造，不投递、不认证author或授权/重新开始尝试。taskExecutionObservation来源source/event、原scope及occurred/received排序/唯一evidence IDs，engine running/completed/interrupted/failed独立于publication not_submitted/submission_unknown/reported_published/reported_not_published。reported不是verified：报已发必须platformContentId和至少一evidence、报未发至少一evidence；这些ID/声明仍非实际证据。其他状态不可带contentId，exact fraction/time校核，无纯schema成功→verified转换。

classifyTaskObservation仅内部建议：同原task/project/device/identity/attempt及revision大小写UUID校对，任一异关联/新revision拒绝SCOPE_MISMATCH，不把迟到观察改写为新尝试；所有engine状态下unknown→verify_original_submission；reported两结果→verify_reported_evidence；not_submitted→recheck_current_task。全部execution/publication/quotaRelease=false，不释放名额、重发或根据completed签平台成功，不触发resume/reset。source真实性、去重/迟到历史、当前facts/控制/期限/预算及实际evidence都留明确pendingChecks，不是停止或权限撤销收据。

作者证据`artifacts/acceptance/product/B3/wp16-stage3-author`：新BE3/TS5/Python5首次全pass，fail/cancelled/skipped0；四形式、strict/禁止额外scope缺失/版本与bool整数/opaque引用、图像有序/重复关闭、精确start/end/长fraction offset、最小notice和source报告非verified、全4engine unknown、所有6 scope/revision异关联拒绝。Python递归语义显式year0、与TS保持实际codepoint/ECMAScript trim集合和精确timestamp比较。根env/check/lint/test/build全exit0，产品387=59TS+33Python+273BE+4EX+18Web；旧90JSON逐项不变/new3及identityContractVersion不变。无真实PG/Redis/SDK/HTTP或外部调用，不跑全PG256/父13，不以13纯组说真实任务或队列通过。

通过仅作者上述协议/纯关联基础；当前测试无失败，原保护脚本和旧报告/RED不动。阻断：真实批准/模型fact producer、合法媒体/准入/身份分配、当前授权/来源控制/平台及正式Redis运行输入；浏览器管理员/SEC/父pending1不绕过。未验证/未实现：中央原子task revision/quota/outbox writer、Redis/BullMQ实际投递/消费去重、来源认证/提交意图/迟到receipt存储与实际平台核验、手机/目标App/file/Artemis、UI及全部AC/G3。缺口不代造成功，下一阶段可独立持久基础但默认无生产消费者。
