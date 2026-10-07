# WP-15 第八阶段：显式逐项批量登记与有界历史

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01后续：原QA完整68行`artifacts/acceptance/product/B3/20261001T004244Z-wp15-batch-02a030a/acceptance-report.md`已全文读，指定9/4/4/14/9、原7与原stage8独立9 guard-only通过/new0/remaining0/QA新oracle0；固定17文件双有限增量通过，不清父pending1/Developeraf14或UI/业务准入。QA17.11 Debian/原非作者17.10分别留证，原首不存在docs命令和SHA常量漏抄辅助诊断保留；原第8断言不改且未执行/不计GREEN，原45语义case一组，own资源逐次归属网络cluster及最终0|0|0/三合成桶卷清理完成，不冒称全PG256/作者368复跑。未来e006/2639/任务队列不入旧门禁。

2026-10-01接续：原78行`artifacts/review/wp15-batch-history-02a030a.md`已全文读，SHA cde1127817f325babf4e73c7613a1a2e9e0c6c0f66245a642780aa45696be4aa；固定14cc..02a17文件，新增0/增量remaining0，9BE/TS4/Py4/旧PG14/newjoint9/旧1～7guard-only＋新独立9（45语义case一组）通过。旧第8路由不存在断言保持/未执行不计GREEN，首次辅助lint重复变量及未执行初稿/原旧RED与manifest首败SHA保留；实际9首次pass。原自有PG17.10 Alpine/MinIO3合成桶/两个own容器匿名卷清理0|0|0，原服务未动。已交原QA相同17文件，未来e006列表和stage10不入本门禁；父pending1/Developeraf14、browser/SEC、真实业务/UI/准入/Task/手机门禁仍开放，不报全开发完成。

2026-10-01；基线14cc7aa，feature/wp-15-batch-history-api-stage8。BE实施代理Codex；原复核/原QA固定门禁，WEB/OPS/BIZ/EX真人待签。[单项API](WP-15-stage7.md)、[内部历史](WP-15-stage3.md)、[质量手册](../quality-gates.md)。

领取最多50显式items的批量登记HTTP、每项独立认证/事务/安全结果，以及数值修订cursor的历史分页；不自动分组、改变人工unit/source/语言/对象次序/名额，不用单一batch success掩盖失败或赋予准入许可。保持单项原键/CAS/真实存储复验和完整历史一致性。原Nest默认100KiB JSON传输限额不改，超大批次须按实际字节拆为显式请求（项数和字节两个边界），不是任意50最大声明都能单次上传；单项最大仍已验证。历史分页不删旧版或只看最新掩盖损坏。

默认自有服务/Samsung授权、人工和正式环境需求记录继续，原三窗口模式/只读报告与新固定发送方式保持。浏览器控制不绕过、父pending1/Developeraf14和保护脚本只路径状态不变。UI/准入/Task/手机/真实资料/发布及全AC/G3仍未验；阶段凝聚提交及原门禁不能替真人/业务签收。

## 实际实现与失败恢复

`POST /api/operator/projects/:projectId/materials/batch`严格wrapper metadata仅contractVersion/requestId trace，没有假batch idempotency/cache/整体事务；每item保留自己的原metadata/key。wrapper项目与路径一致/当前Cookie及CSRF实际DB preflight后最多50串行调用既有单项save，每项重新认证、完整字节复验、原CAS/最后DB钟及事务。坏item/版本/path/IO/真实auth失效按index返回固定安全public error，后续仍独立尝试；已提交先前项不因后项失败回滚。结果只有逐项saved/rejected，saved仍pending/false权限，没有allSaved/全批合格 flag，wrapper201表示返回逐项结果而非整批通过。错误不回显原声明/source/DB/配置；session途中失效不凭初次preflight继续授权。

原JSON parser默认100KiB保留，max50是项数边界，非任意50极限声明可单批传送；实际超大合法batch返回安全413/INPUT_INVALID且零登记。客户端必须按实际字节拆显式批次，每项原ID/key保存用于重查/重放，不用新key/新unit掩盖可能已提交。中断/丢回执可能继续处理已经明确授权的余项，不能把断开/未知结果当撤销/未达/无写；没有后台batch作业/整体续跑游标、总请求deadline或全局并发容量声明。既有每项3秒对象核验/DB锁超时分别保留，50串行成本及生产容量待WP28，不伪称吞吐通过。

`GET .../:variantId/revisions?afterRevision=N&pageSize=N`只严格十进制数字，无负数/小数/前零/重复query/额外参数；after默认0、0～1000，page默认20、1～50。先原read真实auth/project/完整1～1000历史核对，再输出current最小视图及本页逐项revision/declaration/ordered bytes facts/time/pending，无actor/key/location/binding；数值连续排序、非字符串第10版先到，nextAfterRevision精确最后一条且有余项才非null。已到末尾空page/null cursor，超过当前或异项目409，off-page早期损坏500而非只看本页成功。

分页是活的append-only历史，不是跨多请求冻结snapshot：更正新增保留旧记录，后页可见新currentRevision；本次同一内部read取得的current与page一致，并校验最后版和current内容/time、每页连续与单调时间/两许可false。仅输出分页、底层仍完整有界历史核对，不虚称DB只读取pageSize或已优化全量历史内存/集群吞吐。

共享新4TS/JSON及Python语义：batch request/response、数值history query/response。unknown items有意逐项校验，不用急切数组parse阻断好项；index须对应0..n-1，saved项目同wrapper，嵌套pending/current/decl语义递归一致。历史完整语义除结构还核对cursor/连续数值/对象媒体声明类型及严格长fraction时间/current对应；raw JSON不独立表达跨字段，TS/Python消费才完整。旧82schemas/contractVersion逐项不变、Android生成不变，无新迁移/权限/默认存储变更；单项save/read、内部store及实际auth/storage主体未改。

## 作者实际检查

证据`artifacts/acceptance/product/B3/wp15-stage8-author`。新增controller2及shared TS2/Python2，连同旧指定合为BE9/9（core5＋controller4）、TS4/4、Python4/4；旧内部真实PG14/14及新真实AppModule＋自有PG/MinIO9/9分开，fail/cancelled/skipped0。新9首次即通过：2坏2好和原key重放零额外command；wrapper auth/CSRF/path/版本/51items拒绝零写；实际50相同原key只有一次advance/50对应结果、合法超100KiB batch安全413；实际首项commit后仅fixture seam撤销真实session（所有返回仍原save真实结果），之后独立401/首项保留；真实连续12版数值5/5/2分页再append第13版，旧事实保留、live view不冒冻结；严格query/末尾空页/异项目/无auth精确关闭；off-page第1版坏year拒绝后页；实际command INSERT RETURN NULL只坏项整事务回滚后项保存；pending object坏项503/好后项保存、关闭配置时auth401/合法仅rejected/history可读。合成bytes不是媒体/Playwright或发布业务。

根env/check:product/lint:product/test:product/build:product全exit0，产品368/368＝52TS＋26Python＋268BE＋4EX＋18Web。全PG256未本阶段重跑，不将14+9拼成全PG/业务通过。一次指定命令误拼`material-registry-controller.test.ts`不存在，未执行业务测试，原终端诊断保留；改实际点号文件名后指定9通过，不改断言。所有真正指定/新联合从首轮通过，没有用新正常项抵消旧1486 RED/父来源。文档结构仅结构；无新UI/手机/模型/公开发布或父来源13。

## 自有环境与真实缺口

PG实际17.10 Alpine/缓存sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整CID461613f4b498ad96cbdca3df12367cb90c9cf369c022136bec5a813a6bd0da7d/sg-wp15-batch-api-pg@127.0.0.1:32873/sg_batch_api，唯一匿名卷31273b2d5f3ea12ca19cf739232a2c045bbe0f162a2a3874409d5f51ffddfba5；网络DB/currentuser与ownCID pg_control_system cluster7691483218896154657一致才reset新9。MinIO实际RELEASE.2025-09-07T16-13-09Z/commit07c3a429/缓存sha256:69b2ec208575b69597784255eec6fa6a2985ee9e1a47f4411a51f7f5fdd193a9，完整CIDbd19126f2ca260244a28dfacab581ad26b05b6e00f7cd9edad28649b87388ec6/sg-wp15-batch-api-storage@127.0.0.1:32906，唯一匿名卷2a658509f5688bea287a71364109160f41530cb08142e0d577969333bac72baf。仅自有--rm/无host mount/合成随机私有桶，不读取原9000或原review32872/32905/QA32871环境秘密。

实际最终schema/其他连接/deadlocks=0|0|0；完整CID/name/image/端口/AutoRemove/两卷全实例独占核验后仅stop自身两容器及自动清理匿名卷，after容器/卷各0字节。自有合成DB/随机私有桶/bytes不可恢复但可重建，源码/首次命令诊断/指定及新9日志保留、外国服务未动。复现明确32873/sg_batch_api及32906/reset1/isolated1/显式合成credentials，先完整归属/网络cluster守卫；`test:material-batch-api-storage`、旧14单独`tsx --test --test-concurrency=1 src/material-registry-store.postgres-test.ts`，运行后退出并仅自身清理，非另套项目E2E验收。

通过只是作者上述工程；历史首诊断/RED保留，父来源pending1/浏览器RES-WP14-03/SEC-WP14-01及正式受控配置/合法真实媒体/来源和批准依据仍阻断所属门禁；素材项目列表/页面/准入/Task/下载到手机/Artemis正确选取/发布与AC/G3仍未实现或未验。WEB解除管理员限制后按原批量/preview/bulk-dialog图与prompt实现真实Playwright；OPS存储最小权限/传输限制/保留恢复及规模；BIZ可核对人工身份/合法声明/批准方向、疑点接续；EX实际Task及正确文件准备/选取；真人实名/签收未假造。缺人/配置记录继续独立工程，下个切片可做认证素材页查询，仍不自签全开发。
