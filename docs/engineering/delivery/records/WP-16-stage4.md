# WP-16 第四阶段：隔离 Redis/BullMQ 只读重新核对通知适配

2026-10-01原固定复核新增WP16-145C-01/P2/remaining1，完整55行报告已读；原独立10首9PASS+1RED保留，无效URL异常可能含原endpoint。[最小整改](WP-16-queue-config-remediation.md)作者3配置/完整404通过，待同一原非作者复验及原QA，不自清P2；以下原作者389/Redis8通过不抵销该发现。原lock实际19新条目（含平台optional）、本机安装14项，不能将安装数写成锁条目数。

2026-10-01；基线b0b8cb2，feature/wp-16-recheck-queue-stage4。BE实施代理Codex，OPS/EX/原非作者/QA协作真人待签。[上一阶段](WP-16-stage3.md)、[ADR-0007](../../../adr/0007-redis-bullmq-task-queue.md)、[质量手册](../quality-gates.md)。

领取已确认Redis/BullMQ方向的最小`recheck_central_task`运输适配，固定工程依赖版本6.3.10（pnpm官方分发读取），正式环境配置/版本运维验收仍待OPS。仅显式可信server配置连接，默认关闭/没有ambient localhost6379；queue notice只原scope/false执行许可，不传caption/files/secret。真实隔离Redis测试只验证队列组件，不是任务生产、发布或真机许可；没有消费者/Worker/定时常驻服务/HTTP，中心task/quota/outbox原子writer仍下一阶段待接。

依据[官方连接说明](https://docs.bullmq.io/guide/connections)、[job ID](https://docs.bullmq.io/guide/jobs/job-ids)、[生产约束](https://docs.bullmq.io/guide/going-to-production)核对有限重试/关闭、job ID重复及移除后的去重边界、noeviction/AOF。使用现有缓存明确redis:7.2.11-alpine作为合成夹具，不修改用户现有Redis服务或把tag等同实际运行版本，不选付费组件/外部托管。

原02a批量QA完整68行`artifacts/acceptance/product/B3/20261001T004244Z-wp15-batch-02a030a/acceptance-report.md`已全文读：9BE/TS4/Py4/旧PG14/newjoint9/原正常7＋原stage8独立9 guard-only全部通过、新0/remaining0/QA新oracle0；旧8未执行且业务断言不改，原45语义case属一组。QA实际PG17.11 Debian与复核17.10 Alpine分开，原首aux不存在docs命令与SHA抄漏常量诊断保留仅修证据工具；own归属/每reset前cluster7691493512215011365匹配/最终0|0|0及两容器卷3合成桶已清理。双有限增量通过，不签真实批量UI/准入/父来源/Developer。

父来源pending1/Developeraf14、browser管理员/SEC/保护发布脚本只路径状态保持；原三窗口模式/新固定发送及仅读报告不重发、默认自有服务/Samsung授权、人力/配置记录继续。真实provider、批准事实/素材/授权/当前Task/消费者、恢复容量/备份运维与UI/手机/Artemis/全AC G3仍未完成，不绕过控制或公开发布。

## 实际实现

backend依赖bullmq6.3.10/ioredis6.0.0精确锁定，根唯一pnpm-lock只新增2直接依赖和其14安装项/peer绑定既有pg8.23.0，不改既有版本/别的importer；机械lock生成后frozen install成功，Node仍项目24.16.0。bullmq官方现行文档说明与实际安装d.ts/实际组件运行共同核对，采用Redis createIORedisClient/Queue，不选择其PostgreSQL替代backend或Pro。

独立TaskRecheckQueue不注册AppModule/HTTP/Worker/定时循环、不自动消费队列。readTaskQueueConfig无配置返回null、partial/未知mode关闭；configured仅可信server env显式endpoint/username/password/name/prefix/timeout，URL必须显式port与DB0～15、无嵌入凭据/query/hash，remote只rediss/TLS不降级，仅loopback允许redis；namespace严格alnum-hyphen，100～30000ms技术timeout。没有ambient6379/开发profile/备用endpoint、requestbody配置。#private字段JSON{}、error只固定code，不日志连接细节/password/原载荷；schema配置函数的返回本身仍含服务端秘密，仅内部使用，不当公开HTTP响应。

每次send先strict taskNotice/UUID lowercase（caller不变）→ready→只读CONFIG核对noeviction/appendonly=yes→检查同ID现有name/strict数据→add原ID/固定kind→重读实际保留job的数据。不同载荷拒绝MESSAGE_ID_REUSED、异常已有job拒绝CORRUPT_NOTICE，不把BullMQ忽略新载荷当成功。保持attempts1/removeOnComplete=false/removeOnFail=false，不能给任务增加业务恢复轮或配额；返回仅queueAcceptance observed/two false permissions。配置漂移拒绝而不自动CONFIG SET；生产ACL没有CONFIG权限时也关闭，OPS需明确只读观察/受控配置方案，不用root权限绕过。

单次send整体单调deadline/timer和有限连接/command超时；无offline排队/无限自动重连，最后IO后再检查clock，所有未知错误映固定QUEUE_UNAVAILABLE。deadline不会证明连接请求未在Redis落地/不会取消已发送命令；未来PG sender保留原messageId/payload并核对，不新ID或推断未发。close自有Queue/client、重复close安全，之后拒绝send；这里只传输opaque重新核对通知，不提供消息来源认证/中心消费确认/业务恰好一次/实际执行/权限撤销收据。RedisACK/queue completed不更新中心任务或publication，移除后同ID可再次投递，PG去重与当前授权必需。

## 实际验证、原窗口与资源

作者`artifacts/acceptance/product/B3/wp16-stage4-author`：配置BE2首次通过；真实Redis8首次全pass，增强离线端口只读socket空闲守卫后最终8全pass，首源redis-test-first-source.ts与首日志保留，不将两轮拼成16组。新守卫只在32909建立无数据socket确认ECONNREFUSED，再以同已声明空端点验证safe/boundedfailure；原首次8未事先单独守卫该空端口，如实留证，不补造检查。已连32908为自己新建隔离Redis0库启动前无listener，strictURL/isolation env/DBSIZE0/noeviction/AOF检查；无FLUSHDB，只删除本轮UUID队列namespace。

真实8：最小原scope/waiting/active0/#private不泄；8并发同ID及uppercase仍1等待job；同ID改revision拒绝且原数据不变；实际非约定name存量关闭不覆盖；own CONFIG仅fixture临时改policy或AOF（finally恢复）→safe拒绝/无job；32909空端点2ms首轮固定错误/500ms deadline/1500ms测试上界，无fallback；关闭/重建运输client恢复原job不新ID；移除job后同ID可再加入，明确队列去重非持久业务去重。没有Worker/真正手机或成功业务Mock，没有实际Redis服务重启/崩溃/AOF丢失恢复测试；client重建不冒称服务器灾备。真实HTTP/PG/outbox、retained completed再核对和真实任务消费者仍未实现。

最终frozen install/env/check/lint/test/build全exit0，产品389=59TS+33Python+275BE+4EX+18Web；共享93JSON/协议/Android及原恢复预算不改，无fullPG256/父13/新UI/手机/模型/公开发布。官方包metadata与实际cachedRedis版本为环境证据，前期猜错d.ts目录/glob只辅助路径诊断，不是测试失败；当前产品/组件断言无失败。先前b0b8协议13指定/387与2639上传恢复16文件/374仍各自待原固定非作者门禁，不由本轮389代签。

原e006列表74行`artifacts/review/wp15-material-library-e006851.md`完整已读，SHA9ef9307d533eecc986258c967c9dc47369a32b72c6cf6786591cc620a43b8e03；10BE/TS5/Py5/旧14/new历史reader8/新独立9（27组内case）新0/remaining0。新9真实1000合成history/UUID边界/live低ID须重查/选中与未选坏history/空页与load最终DB钟到期，ticket0/storagecalls0；非真实bytes/上传准入。首aux文案/未装eslint/首措辞检查均保留只修证据工具，PG17.10/own3c84250与唯一1ad677卷0|0|0精确清理。已交原QA同02a..e00616文件，原非作者接续e006..2639上传恢复16文件，不重发旧读取或修改模式。02a双有限增量已过，但父pending1/Developeraf14保持。

自有Redis完整CIDd028760a750338af79942a1cb5064d3275658536c9330c1eb7605052e9a6e765/sg-wp16-recheck-redis@127.0.0.1:32908，实际Redis7.2.11、镜像sha256:645b5492c5740598de08c58f2d95a8d9aaab1bea00898d23df96950ffe78ffa1、--rm/nohostmount唯一匿名卷64b9febc82ae86551a2f54ea36b9e15416876c24b667ef29978bb238facb94fe。两轮only合成数据库0/自己UUID队列；最后DBSIZE0、connected_clients1为本条INFO的redis-cli、policy noeviction/AOFyes。完整CID/name/image/ports/AutoRemove/唯一卷全实例独占再次机核验，仅stop自己后容器/卷消失，合成queue/AOF数据不可恢复但可重建，源码首/最终日志保留；原9000/nestar/QA32874/复核32875未动，无own残留。

复现frozen install后只重建明确自有32908/Redis0/合成password且AOFyes/noeviction，并核验完整CID/卷/port/数据库空，`SG_PRODUCT_TEST_REDIS_ENDPOINT=redis://127.0.0.1:32908/0 SG_PRODUCT_TEST_REDIS_PASSWORD=<own synthetic> SG_PRODUCT_TEST_REDIS_ISOLATED=1 pnpm --filter @socialgrowth/product-backend test:task-recheck-redis`单次退出；不可指生产/他窗实例，32909先只读空端口守卫。单次8组件补充不替代Playwright项目验收。

通过仅作者有限组件/配置工程；当前测试无失败，辅助猜目录及初次离线端口缺独立守卫如实记录。阻断与未完成：可信原子Task/quota/outbox/central receipt/当前批准/物理资料/授权及actual consumer/正式Redis ACL、持久化/备份/容量/回滚，UI/手机/Artemis/全AC G3及全部开发仍未完成；实际部署版本/操作签收真人待定，当前工程固定版本非擅自生产升级。继续不依赖人工输入的持久基础，不自清父门禁/Developer或后台消费现有任务。
