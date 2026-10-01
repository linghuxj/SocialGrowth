# WP-27 第六阶段：同快照备份采集接线

2026-10-01最新：stage4 QA完整63行SHAabee7a2a6a1b4d3f423a042f5d03a606337026fd5ff09787e02fcc015c5563f1已全文读/有限双新0；stage5复核完整43行SHA2c34628c82e59d5b0b94db770c58aa0972b14a50bc24bcf455ebb10dedd8c111已全文读/新增0/remaining0，port首错预期与最终另存保持。原QA已接新固定525→4e18，原非作者已接本批新固定4e18→c397严格10；不读取现场未来WP15客户端，不重发已有报告读取。作者3/PG4/root431仍仅作者范围，新非作者/QA未签；以下运行状态为历史。主窗口继续独立[素材读取客户端](WP-15-stage11.md)，新UI按设计门禁暂停，非UI工程不阻停。

2026-10-01；基线4e1827e318da61eaad29d89db69cac60d637eb7a，feature/wp-27-snapshot-capture-stage6。OPS/BE实施代理Codex；原非作者/QA固定门禁，真人OPS/TL资源签收待提供。[上一阶段](WP-27-stage5.md)、[分工](../work-packages.md)、[质量手册](../quality-gates.md)。

## 领取范围与接续顺序

新增受信任维护端采集函数：显式pool、真实archive回调、维护key/metadata；缺省关闭，异步前固定key/metadata/回调，不从HTTP提供。使用原自持RR READ ONLY inventory/snapshot，在其有效期把实际snapshotId交给trusted dump回调；回调成功返回的Buffer转交所有权并最终清零，回调失败前的内部Buffer由回调自行清理。只读事务COMMIT成功之后才返回原v2加密包，COMMIT回执丢失不返回“成功准备”或调用文件写入。文件保存仍显式另调原store，保持原ID/原包UNKNOWN接续，不能自动重新dump换nonce覆盖。

实际采集回调仍须维护owner保证正确源/同snapshot/受信任SQL；函数不能证明恶意回调真实性或manifest里migrationFiles是当前部署，不接受MAC/字节形状为SQL可信或最新批准。只固定metadata格式，不创造生产迁移来源、RPO/RTO或key轮换策略。没有CLI/HTTP/scheduler/pg_restore/Worker/消费者、生产部署或跨cluster灾备；dump只内存，manifest敏感明文。

计划：早期非法输入无DB/回调补充→自有PG实际same-snapshot dump与并发源变更→加密包真实file保存/新client读回/自己的empty目标恢复/只读对照→实际只读COMMIT后丢ACK不输出/返回dump清零→原快照及pool释放→根检查/精确清理/凝聚提交。原PG12/crypto/清单SQL/旧8+6文件正文与父门禁不修改、不认领本轮重跑。使用不同的自有32879 fixture，全Docker选定身份/唯一卷与源、目标、bootstrap TCP DB-user-cluster守卫，不碰原窗32878/nestar/9000/外来Env或数据。

上段是开工计划。以下记录已实际执行的结果，不以计划替代通过证据。

## 作者实际执行与清理

证据 `artifacts/acceptance/product/B5/wp27-stage6-author`。新3组早期补充首次通过，缺省pool/archive/key、非法/重复migration metadata、坏key均零连接/零dump；实际connect抛错仅固定UNAVAILABLE，无敏感cause。它们只是非UI的unreachable测试端口，不是真实数据库/业务验收。首check-first 1处TS18046、加PG源后的check-pg-source共4处同unknown错误：固定错误predicate未声明类型谓词；两份首源码、首日志保留，仅补`e is DatabaseBackupCaptureError`，PG在该首轮只编译尚未业务运行；另补owner身份守卫，无原业务断言改变。

真实PG4首次全PASS/skip0：21迁移/66表/七定义、在同snapshot callback实际并发修改源→实际pg_dump→回调返回dump清零→只读COMMIT成功后v2包→私有加密file save→新client load→自己的empty target实际pg_restore→目标等于旧snapshot而非当前源；同时callback实际改caller key和嵌套metadata，返回包仍初始固定值。第二组实际执行只读COMMIT之后throw丢ACK，准备包及后续保存步骤均未返回/调用（计数0），真实dump清零、实际pool释放可用；不是写COMMIT未知或fs丢ACK，函数本身没有fs调用。第三组真实pg_dump后端口只返4字节，原raw及转交bytes均清零/固定INVALID；第四真实unsupported view在dump callback前关闭/calls0并释放事务。没有任何生产SQL恢复/外部操作，SQL来自自己的合成库而非业务来源。

新own CID b3d9063716fecfb29069f179302d3c685903f36d62b3af5ce9dbb978d5085623，/sg-wp27-capture-pg@loopback32879，image93aa/实际PG17.10/AutoRemove/无hostmount，fixture wp27-snapshot-capture、owner wp27-capture-author-stage6-4e1827e；唯一匿名卷d8841dad77a10321561fbd04c3238927d543cfb79f7be05874ab167beb1aa975，cluster7691643226085675046。启动前端口与同名为空，首次bootstrap socket未就绪stderr/exit2为启动诊断，稍后同CID实际cluster/version核验成功，不是业务失败。每reset/迁移/restore/故障DDL/after完整metadata/卷独占及source-target-bootstrap TCP DB-user-cluster守卫；不读外来Env/数据，不碰原QA32878/nestar/9000。实际文件目录按dev/ino/UID/非symlink精确清理，key/dump不落盘。

cleanup由自有stage4工具复制到新路径，仅apply_patch新CID/卷/cluster/名称/端口/标签/用户库及owner核验，旧工具日志未动。最终source/target/postgres各schema/他连接/deadlocks/临时roles均0|0|0|0，精确stop新CID后容器卷消失/32879关闭；自己的合成资源不可恢复、源码可重建，证据保留。

env:check实际Node24.16.0/管理路径/SQLite OK；check/lint/test/build exit0，根431=59TS+33Python+317BE+4EX+18Web、新3已含根，实际PG4单列不双加。Python3.11.7，根Python stderr确有33/OK，另存独立同源码33/OK日志补留，不增加覆盖数。无新依赖/package命令/lock/93schema/21SQL/旧crypto-inventory-SQL-PG/旧fs14/Android/Web/executor变化；未重跑旧PG12或父13。

复现：`pnpm --filter @socialgrowth/product-backend exec tsx --test src/database-backup-capture.test.ts`；新PG需fresh同名label/owner/镜像/空32879/完整ownCID与卷cluster，显式SG_PRODUCT_TEST_CAPTURE_CONTAINER_ID/VOLUME/CLUSTER和SG_PRODUCT_TEST_ALLOW_RESET=1后`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-backup-capture.pg-test.ts`单次退出，再自己的完整守卫精确清理。旧已删CID不可复用；默认授权不允许偷用他窗或生产资源。

## 原窗口完整结果与实际分工

原第四阶段525非作者完整46行`artifacts/review/wp27-file-store-525a.md`全文已读，SHA9ccff673f852f3a18bf1852628b20e4bcf9abf938c49d29d3e989cc0cc87ca10，有限新增0/remaining0。原8/新独立6/真实OS unlink EACCES晚期1/原PG12/新最小1表PG1首次分别过；后者不是66表。首ENOBUFS→NO_PKG_MANIFEST零产品断言原源日志保留后流式导出，独立lint1 warning/boot诊断分开；41own+16author及旧112指纹保持，自有PG83541e/卷1fa0df/32878、快照和私有目录精确清理，未认领root422或签业务/生产灾备。

主窗口已向原QA发送新固定c147→525严格10（真实窗口模式，非UI本批仅补充，真实Playwright仍受管理员限制）；已向原非作者发送新固定525→4e1827e严格10（原只读非作者模式），未导入本stage6/打断旧任务/重发旧报告读取/新建窗口。双方目前运行中，不凭进度签最终过。默认自有服务/Samsung授权、保护脚本仅PATH/STATUS、父pending1/Developeraf14/browser/SEC与真人资源边界保持。

四态：**通过**作者新3/真实PG4/root431/静态及精确清理；**失败**无业务RED，首类型诊断与启动诊断保留；**阻断**真实生产key/维护目录/支持范围/保留-RPO-RTO/当前facts-fence/联合恢复/管理员browser/父来源/SEC各范围；**未验证**本新stage6非作者/QA、可信生产源/生产灾备/全部开发ACG3/Web真机。原阶段门禁逐批接续，人工真实输入见RES-WP27-01～03，不因此停独立工程。
