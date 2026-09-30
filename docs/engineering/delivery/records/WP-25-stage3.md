# WP-25 第三阶段：本人最小只读核对投影

2026-10-01；基线7cf8878，feature/wp-25-provider-projection-stage3。BE实施代理Codex；原非作者/原QA，AND/WEB/BIZ真人未签。[基础规则](WP-25.md)、[内部账本](WP-25-stage2.md)、R-126/144～147、AC-51及[质量手册](../quality-gates.md)。

领取Provider真实Bearer会话只读分页接口，范围只取冻结核对结果中的本人，不接受caller providerId。每收入历史修订保留，但已被更正的旧修订明确非当前，不能累计为多个应付；公司空档、他人、未能确认归属的数据不公开给本人。最小账号核对标识/期间/收入/历史比例/内部计算和未记录付款分开，无总余额、提现、写入或账号管理能力。

BE校验同一查询快照的完整历史再做字段allowlist；认证provider/session锁后不取journal guard/收入行锁，不与写者形成反序。分页cursor仅本人原记录，非法/过期会话/损坏记录失败，不靠前端隐藏。AND/WEB后续按有效commission-list/detail图与原提示词实现真实页面；本轮仅契约/API，无UI新设计，RES-WP14-03不得绕过。

RES-WP25-01～03保持：真实income/ownership/rate producer和付款实际记录未实现，本API不得把internal_calculation_only升级为生产可结算或已付。未知金额/归属pending还需未来可靠本人范围生产者，不凭raw UUID或部分上下文暴露信息；此阶段仅已确认本人内部计算历史。默认服务/Samsung授权不覆盖真实付款/资料外发，真实Web/原生验收仍需资源。独立工程继续，不签AC/G3或全部完成。

## 修复、契约与实际验证

原非作者`artifacts/review/wp25-income-7cf8878.md`全文已读，新增WP25-7CF-01/P1、remaining1。旧1unit/22PG通过不抵消独立9通过/2 RED。journal原查询和新feed历史子查询均显式按底层`history_row.revision` bigint列排序，文本只作返回类型；完整校对移到共享validateCommissionHistory，保持原scope/连续性/重算/时刻/1000上限。没有缩小上限或放宽错误关闭。新固定门禁待同一原窗口复验，不作者清零；父WP10来源pending1仍另保留。

增加3严格TS/JSON契约、Python语义消费和只读Nest路由实际AppModule注册。时间0001～9999/精确fraction及offset、整数最小单位/显式precision、历史比例/舍入版本；原Android生成器消费范围不变，没有新的Androidfeed decoder/UI。禁止caller providerId/paid/balance额外字段；paymentStatus=not_recorded表示本内部模型没有付款记录能力，不是已核实未付/可支付。feed按源/全部历史同一SELECT快照复算再字段allowlist；归属更正后本人旧修订标非当前且无新owner。cursor本人历史也完整校验，overscan损坏不生成下一页。分页按UUID/revision而非日期且不是跨页冻结视图，新UUID排cursor前需重新加载；最多50条每条完整历史是原型成本，不报20～50台吞吐通过。

作者证据`artifacts/acceptance/product/B4/wp25-stage3-author`：首次check仅新合成fixture未收窄ownership判别联合TS2339，未开始PG；改成明确kind检查/无provider字段的显式company_gap fixture后check通过。第一次30PG通过；新增1000边界第二次31中30通过/1失败55006（fixture UPDATE后延迟FK未解析便ALTER TABLE），原日志保留；仅先SET CONSTRAINTS ALL IMMEDIATE处理夹具控制，再第三次**31/31**通过，业务断言/1000上限不变。最终env/check/lint/test/build/生成全过，产品**329/329**＝45TS19Python243BE4EX18Web；全PG首轮238/238（未加最后边界）、最终**239/239**＝原230＋新9组，失败/取消/跳过0。不重复累加专项及全量。

新9组：实际正常reconcile连续1～12、10跨界/read/旧key当前/本人顺序；合成完整1000历史含10/100/1000/read/replay/999cursor当前1000，真实更正1001拒绝及故意多一行损坏关闭；真实provider会话本人字段allowlist/他人/明确gap/unknown不披露；更正归属旧人归档/新人当前不汇总；两修订跨income稳定分页/大小写cursor/他人未知统一stale/strict；fixture改存储owner但原context属他人时page/cursor/确定overscan都关闭；真实撤销/新session/停用；实际source-table锁等到DB会话到期后拒绝返回；实际Nest GET/200/no-store/401/400/409/无POST及无写入。HTTP/直接DB合成数据仅非UI补充，不替代Playwright/合法收入/手机业务。1000直接构造不冒称连续1000服务写入或独立算术oracle，实际连续服务覆盖1～12。

实际PG17.10 Alpine/镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74；自有sg-wp25-projection-pg完整ID3b034e1975d62a89de4550287712c0231ed9ace0f0923d775103cf91b056f961，回环32866/专用sg_projection，唯一匿名卷e1506642cf3bd1c4e61d4f898107ebae593c4e267718388a9983ad5229fbc9ed/无宿主挂载。最终schema/其他连接/deadlocks=0|0|0，精确身份/卷独占复核后停止删除可重建夹具、保留源码和日志；其他nestar-stage1/minio/原窗口/手机不触碰。没有真实model/income/支付/外发或新的浏览器真机操作。

复现根env/check/lint/test/build及`python3 docs/engineering/delivery/check_consistency.py`；仅明确隔离reset授权URL下`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/commission-income-journal.postgres-test.ts`（31）或`test:postgres`（239）。不得改指真实库，严格保护原证据及用户脏发布脚本。设计原图/提示词已重读：Android[列表原图](../../../design/android/commission-list-v1.png)/[原prompt](../../../design/android/commission-list-prompt.txt)、[详情原图](../../../design/android/commission-detail-v1.png)/[原prompt](../../../design/android/commission-detail-prompt.txt)及工作台[依据prompt](../../../design/workbench/commission-detail-prompt.txt)，只读列表图目视，未新增设计验收；图中的10%、金额、预估、可结算及已付均非生产事实，不能映射本internal状态。新UI仍暂停、未签本人UI/AC51/G3/全部开发。
