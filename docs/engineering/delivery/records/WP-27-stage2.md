# WP-27 第二阶段：只读一致快照恢复清单

2026-10-01；基线9f5812f，feature/wp-27-restore-inventory-stage2；OPS/BE实施代理Codex；正式OPS/TL/EX/AND/原非作者/QA真人待签。[第一阶段](WP-27.md)、[质量手册](../quality-gates.md)。

领取维护端只读一致快照/范围受限指纹及恢复比较，补第一演练只有测试中行/约束/触发器对照的工程缺口。无HTTP/自动backup/restore/生产fs/Worker/消费fence或真实发布，不取代RES-WP27-01～03密钥/部署/频率保留/RPO-RTO/当前外部事实/Android签名升级。计划strict清单→自管RR READ ONLY事务＋同snapshot pg_dump callback→实际ownPG恢复与结构/行差异反例→产品检查/凝聚提交/原门禁。

既定原三窗口模式/发送新固定及仅读原报告不重发、默认隔离服务/Samsung授权/人工缺口记录继续不变；保护脚本仅路径状态、父WP10 pending1/Developeraf14/browser/SEC保持，全部开发/AC/G3未完成。

## 维护组件的真实边界

`database-restore-inventory.ts`只接受受信任维护端已有Pool，自管连接→REPEATABLE READ READ ONLY→事务局部statement_timeout5s/idle-in-transaction30s、row_security=off→固定UTC/ISO-YMD/bytea hex/extra_float_digits3/IntervalStyle postgres及pg_catalog search_path→实际清单→pg_export_snapshot→trusted callback使用该同snapshot dump→COMMIT。失败固定INVENTORY_UNAVAILABLE，无原值/cause；ROLLBACK失败丢弃该连接，所有路径release。技术statement/idle时间并非整个callback/连接池等待的deadline或RTO；callback只有维护端显式调用，没有自动备份调度/CLI/fs/HTTP/pg_restore/动作consumer。

只支持PGmajor17、socialgrowth_product普通表/普通索引与内置列类型、普通函数/过程；未知view/序列/分区/外表/自定义类型/aggregate关闭，不遗漏后声称全库。行读取前同snapshot聚合实际count与JSON字节：每表10000行/8MiB、整体100000行/128MiB技术护栏、1000表；C排序完整JSON行SHA，没有截断取样的成功清单。清单只输出表名/行数/字节/摘要及relation设置、列顺序/类型/notnull/default/identity/generated/collation、全部constraints及validated/deferrable、非内部trigger定义/enabled、index定义/valid/ready、函数完整定义和policy的集合指纹；不输出原行/密码/函数文本或DB连接。catalog定义当前仍在维护进程内读取后摘要，不把行护栏宣称为全进程内存/全部catalog大小上界。

只将第一演练的三个具体CHECK嵌套AND精确映射到同项次flat，不泛化SQL重写/OR/括号删除或忽略约束。strict inventory-v1/PGmajor17/unique有序table/合法名称/上述数值上界/7类摘要固定字段；比较只声明sameSchemaAndRows，其真假都requiresReconciliation=true、executionAllowed/publicationAllowed=false。hash/比较对象形状不证明可信来源或当前授权；metadata包含敏感聚合信息，仅维护端受控保管、不可日志/HTTP公开。当前涵盖同PGmajor/同cluster source→独立empty DB真实演练，policy role OID/表达式等保守逐字对照不作为跨cluster语义等价证明；未验证roles/ACL/表空间/extension/custom类型/外部依赖、Redis/S3/设备/当前许可、生产恢复fence。

依据[PG17 transaction](https://www.postgresql.org/docs/17/sql-set-transaction.html)、[export snapshot](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)和[局部超时/row_security](https://www.postgresql.org/docs/17/runtime-config-client.html)：snapshot只在持有事务期间有效，调用者必须把对应ID用于可信dump；不以只读事务或row_security=off当权限提升，不符合既有维护身份时关闭。

## 实际检查、第一失败与收尾

作者日志`artifacts/acceptance/product/B5/wp27-stage2-author`：纯3指定首次通过，后补总rows/bytes超限case在原组内；root最终407=59TS+33Python+293BE+4EX+18Web，env/check/lint/test/build/frozen install/文档结构exit0、失败/跳过0。后续只新增一个专项测试命令，无依赖/根lock变化；共享93schemas/21SQL/Android（Git clean-filter）/Web/executor及原backup组件/原5演练源均未改，不重跑或认领旧5/全PG/父来源13。

实际PG首6组=5PASS+1FAIL，最后overflow夹具误用不存在login_digest/window_started_at/failures列，SQL42703；一处夹具修正发生在tsx已加载源之后，因此首轮实际仍执行旧列名，pg-first.log保留，不能将首轮写成全绿。对照真实schema改用login_name/client_scope_digest/failure_count，原callback0/超限关闭/equality断言不放宽。新增RLS和bytes两个真实反例后最终8/8：同snapshot下源实际先变更再dump，66表/7类定义仍还原原snapshot，而当前源较新不等；timezone/DateStyle/bytea局部规范且原session设置恢复；真实缺非约束index和改函数body即使行不变也检出；真实加列/改CHECK150→151检出、同150恢复相等；callback故障安全ROLLBACK/release/设置恢复；non-owner实际RLS正常SELECT看到0行但维护row_security=off拒绝而非成功partial；未知view/实际10001行在callback前关闭；实际8MiB+行字节在接收原值或callback前关闭。后者不覆盖catalog大小边界。只有合成非UI测试，不修改业务成功状态来绕Web/真机验收，没有真实Task/平台执行。

临时ownPG实际17.10 Alpine/image93aa，完整CIDedc47f58f095acd2b9c0a1c1d54f975a40030e01324b5e7ecf9904222c729e2a、/sg-wp27-inventory-pg@127.0.0.1:32878、label socialgrowth.fixture=wp27-restore-inventory、--rm/无hostmount、唯一匿名卷7ed70aac60808e2772c62708a59fe8ee077b57945f280b598d80a9f71292e03a、cluster7691522423404990497。启动前lsof无listener；每RESET/restore/故障DDL/最终after先核对完整CID/name/image/AutoRemove/port/label/全实例卷独占，再TCP DB/user/cluster等own容器，两库source/restore不碰其他库。Docker全实例仅选Id/Name/Image/运行/port/Mounts，不取外来Config.Env或数据；自己的label另读，原nestar/9000与两个原窗口资源未动。

测试after只DROP自身两个合成schema、关Pool，RLS合成role已REVOKE及DROP，dump仅内存且实际恢复后fill(0)，无明文dump/行落盘。cleanup.mjs最终再次全身份/TCP guard，两库schema/他连接/deadlocks/临时role各0|0|0|0，只stop上述精确CID；匿名卷消失/32878关闭。两个自有合成库移除不可恢复但源码可重建，原首失败/最终代码日志留存。不声明密钥/生产数据清零或整个OS内存无残留，不自动停其他服务。

复现frozen install→独占同名label/32878/sg_inventory_source的PG17fixture、启动前端口及全归属核验→`SG_PRODUCT_TEST_INVENTORY_CONTAINER_ID=<新完整own CID> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:database-inventory`单次退出→对应自己完整守卫/精确清理，不能复用本历史已删除CID/卷。仅运维组件补充，未进行Playwright/真机或生产恢复。

## 原复验已读取与阶段交接

原9f整改完整47行报告`artifacts/review/wp16-queue-config-9f5812f.md`已全文读取，SHAb06c7c7ce0ec4c61fb6f0759b858db54a4b2f7c157f19502a264eef08dba4514：原P2实际清零/新增0/remaining0，原完整10/配置2＋当前3（重叠不累计）/真实Redis8/独立三入口1组9调用首次全部pass，原RED/e4ba…与32/24指纹保持；只原145c路径＋整改卡限定快照，不导出/读未来outbox/backup/calendar，作者404不是该窗口新覆盖。自有新Redis8ef304f/唯一e0e070卷完整guard/runIDa79905ee/DBSIZE0/clients1/AOFyes/noeviction后精确清理、辅助lint warning如实保留。

已交原QA两固定段运输11＋整改7并集12路径、最终9f限定复验；原非作者接续145c..cc41881严格9个pending引用文件，没有重新发起既有报告读取/新建窗口/改模式。原cc固定父队列尚带历史URL缺陷，9f独立整改已验证、QA待复验，不拿后来增量替代该门禁。本阶段及546d35b加密/ccc4707日历待逐固定原门禁；Developeraf14/父WP10 pending1保持，不能作者根407清所有门禁。

**通过**仅作者有限只读组件/合成同cluster实际恢复；**失败**首夹具42703保留后修正；**阻断**RES-WP27-01～03正式真人/配置资源与browser/父来源/SEC；**未验证**生产backup绑定清单认证、正式密钥/存储/retention频率/RPO-RTO/ACL/跨cluster及联合恢复、真正当前事实/fence/消费、Android更新回滚/Web真机/全WP/AC/B5/G3。角色为工程职责而非真人签收，人工真实输入记录后继续安全独立工程，阶段凝聚提交并按原窗口门禁。
