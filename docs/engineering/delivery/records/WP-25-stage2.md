# WP-25 第二阶段：收入去重与更正的内部持久账本

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01；基线18446ea，feature/wp-25-income-journal-stage2。BE实施代理Codex；原非作者/QA固定门禁，BIZ/EX/WEB/AND职责真人未签。[第一阶段规则与真实需求](WP-25.md)、R-116/119/120/126/144～147、AC-50/51及[质量手册](../quality-gates.md)。

领取内部账本：实际operator会话＋CSRF，收入ID及统一source/sourceRecord映射唯一；保存收入修订、冻结核对上下文、原计算与精确DB时间，连续更正不覆盖原版，重放读当前而不再计算旧版本。收入/承接/到账/比例来源通过服务器DB-only port读取，缺省关闭，不接HTTP/Nest/队列或导入生产者、不信调用者送入到账/权限字段。纯计算或持久记录仍不是应付确认/付款/手机许可，未知或跨边界不分摊。

使用隔离PG补充真实事务，不用数据库夹具伪造Web业务验收。每条修订/源记录/命令/最小审计同事务核验实际影响行数；明确失回执、重启、并发、跨源冲突、旧版本、损坏和会话到期。OPS未来正式源映射须在原命名空间稳定标识实际收入，不得每次导入生成新sourceRecord逃过去重；无历史迁移/自动部署。身份FK仅结构不是实际承接事实；DB-only resolver需与未来权威生产者同锁，禁止锁内网络/模型。

## 实现与实际证据

CommissionIncomeJournal.reconcile只接metadata/incomeId/expectedCurrentRevision，body到账/金额/权限字段strict拒绝。缺省producer在connect前关闭；显式DB-only port的income/context先复制解析，不证明收款真实性或人工批准。operator元数据锁→实际operator/session→单例journal guard→source/修订，原key先认证/验证完整历史，只返回当前最后修订，不调用producer或重算旧版；新key同规范收入不重复修订/审计，也不把新context/最新比例偷偷重算旧收益。需要改依据应由明确连续收入修订关联后重新核对，不能普通配置刷新覆盖已保存原版。

0018 source/sourceRecord在原命名空间全局唯一，同一收入不可重绑平台/identity/account/source。current_revision只前进一步并由延迟FK关联实际修订，历史UPDATE/DELETE触发器拒绝；强DB owner仍可改控制，因此不冒称不可篡改存储。完整最多1000修订、JSON schema/连贯revision/原scope/按原context和原DB时刻重算校对/非倒退时间，缺页或坏计算关闭，不以当前名额/设备分配推翻原归属。上限和单例短元数据guard是原型，不宣称生产规模/高吞吐或完整保留策略。

producer须在当前同guard保护的权威事实下DB-only读取；无注册producer或额外provider/device锁接线，未来共享锁顺序必须先对齐，不能擅自在guard后锁既有认证/设备路径或锁内调用外部网络/模型。identity FK仅登记关系，样本provider/device/evidence字段不证明承接生效/真实初始化/退出停派。read为真实operator会话内部读取已保存历史，可在无producer实例恢复；没有provider本人API/HTTP/Nest/UI/导入服务/应付余额或支付，记录不授手机行为。

作者证据artifacts/acceptance/product/B4/wp25-stage2-author：首次check仅fixture randomUUID窄模板类型TS2322，未开始unit/PG，backend-first.log保留；仅将fixture请求incomeId标为普通string后第二次check/lint、缺省关闭**1/1**、实际PG**22/22**全通过。根env/check/lint/test/build/生成**322/322**＝42TS17Python241BE4EX18Web；全量隔离PG **230/230**＝原208＋新22，失败/取消/跳过0，不重复相加专项与全量。

22组含前向保留既有身份/无收入自动创建、实际认证/CSRF/微秒DB钟与源/修订/command/最小audit同事务、原keyUUID/requestId及0producer重放、跨actor/key同收入冻结原比例、稳定源跨账号拒绝、连续更正/旧key当前读取、陈旧/跳版/异载荷/源重绑、未知到明确receipt不造paid、strict/坏port/定位/登记关闭、真并发同key/同更正只进一次、真实COMMIT成功而ACK丢失后新实例接续、四INSERT及一UPDATE实际RETURN NULL抑制全回滚、SQL历史/跳版/延迟FK约束、fixture故意绕触发器篡改计算或删早期历史后的read/replay拒绝、停用/撤销/等待到期、guard锁等待后先查DB钟、缺guard、合成异常无正文/cause。fixture绕触发器仅隔离DB失败注入，不是生产操作；没有模拟业务成功代替Web。

实际PG17.10 Alpine/镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，独立sg-wp25-income-pg完整IDabffc698081cdda84b7e4b512d63afe600e3509da67c0b1f7f07f5e70c55e222，127.0.0.1:32865/sg_commission，唯一匿名卷6c377038f9f7ec29d1f2ffd3ac70617dd137f437744b403fa1575effca34631e/无宿主挂载/AutoRemove。末次schema/其他连接/deadlocks=0|0|0，精确ID/端口/唯一卷归属复核后仅停止自有实例；container-after/volume-after均空，可重建夹具删除、源码/日志保留。未触碰nestar-stage1/minio-test、原复核/QA或手机；没有新UI/真实收入/模型/付款或发布。

复现`pnpm env:check`及根check/lint/test/build；专项`pnpm --filter @socialgrowth/product-backend exec tsx --test src/commission-income-journal.test.ts`，明确隔离reset授权URL下`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/commission-income-journal.postgres-test.ts`或全量`test:postgres`。测试会重建socialgrowth_product，仅本专用库；文档check_consistency仅结构。禁止改指真实库或以本补充计为Playwright/AC通过。

RES-WP25-01～03仍开放：实际到账/可靠产生期间、确认比例/精度/舍入、初始化/退出/交接生产者、本人API/UI、浏览器控制和合法收入样本未完成。人员/配置不足记录后继续；下一独立工程为真实provider会话的最小只读投影，不披露公司空档或别人的历史/收益。作者完成待固定门禁，父来源pending1/Developeraf14保持，未签完整WP25/AC/G3或全部完成。

## 原非作者后续发现：WP25-7CF-01 / P1

已全文读取`artifacts/review/wp25-income-7cf8878.md`。1unit/22指定PG及静态通过；独立11组9通过/2 RED，对应同一连续修订缺陷，新增1P1/remaining1，本增量需修复、不合入/不提QA。`SELECT revision::text ... ORDER BY revision`按文本输出列排序，合法1～9逐次提交后第10次更正误报CORRUPT_HISTORY并回滚；1000历史读失败，之后1001分支未执行。原失败日志及快照保留，不能通过降低等级/改9条上限或已有通过抵消。

整改在[第三阶段](WP-25-stage3.md)显式按底层bigint表列排序，仍返回文本/完整1000历史/连续性/损坏关闭；增加真实连续1～12更正、旧key当前、本人历史及1000/1001边界补充。作者通过不自签P1清零，形成新固定阶段后仍交同一原非作者窗口复验；该窗口仅读取固定新提交，不夹带活动未来代码。父来源pending1另保留。
