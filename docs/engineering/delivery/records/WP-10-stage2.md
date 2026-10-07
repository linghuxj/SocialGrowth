# WP-10 第二阶段：当前身份及持久端点回执

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01最新：原b60非作者79行完整报告已读取，一P3/remaining1、G1不通过；0d7独立[来源整改](WP-10-source-snapshot-remediation.md)作者240/184与原13组0反例，交原窗口固定复验，作者不自签清零。已正常合入维护工程分支，不推进Developer@af14；不同阶段原测试数不相加，不以合并树冒充原报告通过。以下此前检查点保留历史。

2026-10-01此前：原b60复核已保存12正常组＋1 RED，WP10-B60-01一P3为证据复制晚于同步取消回调；在对象返回时已过期，回调改新时间后实际受理并写receipt/audit。原窗口报告收尾因平台内容检查中断，仅请求整理已有结果、未要求绕过或新跑；当时没有完整报告，不记G1/问题清零，待独立整改。af14原QA完整报告已读取0findings，经核验Developer@af14；本阶段未合。后续维护账本测试不能覆盖掉该父问题。

2026-10-01接续：原af14非作者完整76行0findings已读，交原QA；本b60固定增量已交原非作者，只读复核进行中。原WP23双门禁完整报告已读及源等价核验后Developer@605af22，不含本WP10。后续[维护预算](WP-10-stage3.md)继续独立工程，不改变下面固定作者183PG范围或自签父门禁。
2026-10-01整改检查点：原b60非作者79行完整报告已读取，WP10-B60-01一P3/remaining1，G1不通过；报告中断后只整理原证据收尾，probe lint/最终hash/DB指标未完成，不补造通过。独立[来源快照整改](WP-10-source-snapshot-remediation.md)改复制早于同步abort，新增6入口组合先18过/1 RED后19 GREEN，作者240检查通过，仍待原固定复核/QA清零。Developer@af14，不含本阶段及后续维护作者代码；下面为提交时历史。

2026-10-01；基线af14e64，feature/wp-10-endpoint-journal-stage2。EX/BE实施代理Codex，AND未来发送/观察生产者，原非作者及原QA固定门禁，OPS真实网络来源，QA/TL支持与验收；真人签收待落实。依据R-109/148～151、CT-05、AC14/15/59、[第一阶段](WP-10.md)、[质量手册](../quality-gates.md)。父链工程门禁分别记录，不自签全部WP。

## 交付范围

0015新增journal/receipt两表及scope组合FK、不可变历史trigger，旧迁移逐字不变。NetworkEnrollment已有真实关联作为关系绑定，受理必须当前安装bearer/会话、提供者、安装代次、未结束的association/device归属及**当前admitted且持钥/node/版本一致**；不接受context或client eligible替代身份。当前provider→install→session→association/device→enrollment→journal共同锁序，锁后重新取真实行，读旧回执也不绕当前撤销、退出或权限变更。

EndpointReportJournal只内部使用，**没有Nest provider/HTTP/Android发送/执行器注册**。默认来源verifier=null，连库前SOURCE_UNAVAILABLE；配置真实verifier时必须显式来源时效。来源接口需从server-owned transport自己核验当前网络身份，不接受header/body/模型指定node。实际LocalAPI适配尚缺，单测seam只合成来源，不是来源实证。

可信来源观察先在事务/锁外完成，3秒技术超时及AbortSignal；随后事务内与锁定当前scope比对、按DB钟检查时效。3秒与5秒锁/10秒statement保护不是生产延迟承诺。提交前同一DB钟同时核对当前安装会话有效与来源仍新鲜，不能在长事务等网络或只取开始时间冒充最终有效。返回观察对象立即复制，不由迟到callback改证据。所有事务/driver异常安全固定码，不带原SQL、token、SPKI/node、签名或原错误cause。

来源epoch与完整快照按第一阶段规则保存，实际DB时间为微秒；同epoch/报告精确重放无新写/审计，旧/乱序/越权拒绝。source epoch重启先失效，旧回执查询只给原ack和当前epoch/候选，不恢复旧port；查询实际数据库而非内存。全签名state与单独ack表逐条一致性核对，缺失/损坏安全拒绝；每次保存、receipt与最小审计核对实际返回行数并同事务提交，真实COMMIT确认后才响应。提交未知可重传原报告，不能换新ID以伪造恢复。

DB UPDATE不能改scope/key或缩短/改写旧epochs/receipts；表DELETE/管理员治理、正式保留与备份仍由OPS另定，不宣称trigger可防管理员。若行政删ack导致账本不一致，读取/重放CORRUPT_STATE，不继续“已确认”。当前按全历史重新验签与比对，容量/查询成本未达标；不裁剪历史、无生产性能承诺。

当前没有PairingSession持久来源，因此本层pairingSessionId/expiry明确null，拒绝任何配对candidate；未知/撤销可以记录。没有目标挑战/策略worker/旧授权实际收回/受控连接或维护恢复预算，不连接手机、不改设备state或解除pause/exit，不进入业务ready、不发送正常变化提醒、不重置WP16任务预算。本阶段补持久能力不等于WP10全部完成。

## 作者验证与失败记录

证据artifacts/acceptance/product/B2/wp10-stage2-author。隔离cached postgres:17-alpine实际SELECT version=17.10（镜像93aa428…），专用sg-wp10-endpoint-pg/127.0.0.1:32859/sg_endpoint，完整ID93503ef9071f5328f4be7d6ed75a780f10413c892afb8db80c947fcc4a01f063。仅合成可销毁夹具，其他nestar@55449、Minio@9000及窗口服务不动；默认服务授权有效，不作为生产库使用。

初轮before夹具缺安装credential固定sginst_v1_前缀，16未通过；第二轮6通过/10失败：一个CHECK夹具误用UPDATE先触发历史保护，另九个共享合成source触发既有bootstrap每来源10次限制。原first/second日志保留。修正合法凭据、改INSERT严格CHECK及一致scope的FK负向、每独立合成source唯一，**未扩大生产阈值或删除校验**。第三轮16全过；收尾加强ack一致性和真实影响行数，增加无异常但RETURN NULL的真实trigger/行政删ack两组，最终定向18/18，失败/取消/跳过0，不累计各轮。

18组覆盖：空库完整0001～0015及既有0014身份保留、实际FK/CHECK、default closed、真实bearer/session/异主隔离、两实例并发一次受理、新OS进程只读数据库重建、真实COMMIT仅回执丢失、epoch失效/旧回执/current CAS、缓存观察不刷新且不清pause、错签名/跨scope/无配对session、来源缺失/错node/过时/未来/抛错、真实audit/receipt失败原子回滚、真实DB锁等待直至session到期/来源过期再放行并完整回滚、当前资格/退出/准入reclaim后原成功不能重放、DB历史不可改与签名投影损坏拒绝、真实provider锁后看到禁用、RETURN NULL不假ack、行政删ack不掩盖不一致。新进程证据不声称数据库服务重启/备份恢复或手机独立上报。

根check/lint/test/build/生成最终退出0，240产品（42TS17Python159BE4EX18Web）；收尾18测试类型检查另确认通过。全量PG最终**183/183**（原165＋新18），失败/取消/跳过0，postgres-full-final.log保留；不相加定向与全量。最终schema/其他client/deadlocks均0，核验精确ID/回环端口/AutoRemove与挂载后只停止上述93503实例；可重建合成夹具及匿名卷8451e5…已自动删除，日志/脚本/证据保留，其他服务未动。补充工程检查不能替代Playwright Web/真机真实验收；本轮无新UI/APK/Artemis、公开发布、短信/邮件或真实外部账号。

复现：`pnpm env:check`，`pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product`；明确独立可销毁库后，以`SG_PRODUCT_TEST_DATABASE_URL=<新隔离库> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:postgres`运行全量，定向则`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/endpoint-report-journal.postgres-test.ts`。不新增E2E套件、不对其他库reset。

截至提交前，b9b1983原非作者75行及原QA93行完整报告已读取，原IPv4 P3实际清零/remaining0；QA新221产品、两Android变体各31、Samsung6生命周期但两purpose UNKNOWN，原App哈希/UID恢复，PG151/17组65HTTP明确复用而非新跑。经工作树/祖先/旧tip CAS，Developer从fad821c快进b9b1983。WP23原d253837非作者81行完整报告0findings已读，已交原QA；WP10第一阶段af14e64原复核中，本持久阶段待固定门禁，未随Developer推进。

## 继续推进与分工

RES-WP10-01真实LocalAPI/server channel/当前网络策略、RES-WP10-02中心配对及目标挑战、RES-WP10-03源时钟/观察/维护预算与支持矩阵、RES-WP10-04实名/多机/原设计/浏览器入口仍开放。AND/EX实现协议发送与受控连接，BE持续维护原子ledger/预算/异常待办，OPS落实真实独立来源/策略/部署，原QA区分工程和实际设备/页面；输入、最晚时点及解除步骤沿[原卡](WP-10.md)，角色不是真人已经签收。

下一项先实现不依赖真实外部资源的维护累计预算/失败关闭查询与协议消费，缺人的验收子场景准确记录后继续工程。原窗口固定阶段复核→独立QA→有限G1后才推进Developer；读取旧报告不重新发起，阶段性凝聚提交不逐命令提交。管理员浏览器RES-WP14-03不可绕过，SEC-WP14-01人工核查未关闭；完整WP10/B2/AC14/15/59/G3及所有开发未完成。
