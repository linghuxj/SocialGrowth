# WP-15 第六阶段：有界认证 HTTP 字节传输

2026-10-01；基线1486eaf，feature/wp-15-authenticated-byte-transport-stage6。BE实施代理Codex；原非作者/QA、WEB/OPS/EX/BIZ真人待签。[配置与票据](WP-15-stage5.md)、[上传持久层](WP-15-stage4.md)、[质量手册](../quality-gates.md)。

领取同原object票据的认证HTTP bytes PUT：先认证Cookie/CSRF/当前项目/票据/存储绑定，再读严格长度、有界大小和总时限的原始请求流；网络和storage IO均不持DB锁，完整实际bytes交原upload重新认证/核验/同ID恢复，不向client提供存储URL/秘密。初期HTTP缓冲技术上限16MiB、总读取15秒，不等素材或发布规则；未读完/断开/超时不能记录verified，也不自动删除未知对象或换ID。大型/分片/手机传送另记录资源，不能冒称128MiB全HTTP已支持。

不新增UI/下载/平台操作或素材准入，后续明确素材登记HTTP接续。默认隔离服务/已连接Samsung授权持续，但无手机消费者不编造手机通过；浏览器/父来源/正式配置及真人素材缺口按原记录继续独立编码、不绕过控制。凝聚提交→原非作者→原QA，Developeraf14/父pending1及两业务许可false保持。

## 实际实现与失败语义

新增`PUT /api/operator/projects/:projectId/material-uploads/:objectId/bytes`，raw body只能application/octet-stream、不得Content-Encoding；metadata由x-sg-contract-version/x-request-id/x-idempotency-key头按严格共享command读取，另需原Cookie与x-csrf-token。路径原project/object固定，没有任意URL/key/actor/成功flag。先inspectForByteUpload实际operators/session/CSRF→guard→project/原ticket/受控binding及final DB钟，再释放全部锁读取原始流；body结束后原upload再次认证/CSRF/当前ticket/固定SHA/长度/条件PUT完整GET、final DB钟/CAS后才返verified历史。

prepare HTTP同时限制16MiB，已有超过上限的旧内部ticket可读但该PUT关闭；原内部128MiB能力不是HTTP全支持。chunk复制保持次序，统计不能超过票据长度或技术上限，声明Content-Length若存在必须精确相同；无length的chunked亦按实际bytes统计。总读15秒用timer及最后单调deadline检查，不因CPU阻塞迟到而成功；所有网络/存储IO不持数据库锁。此为每请求有界缓冲，不是全局并发/总内存/生产吞吐验收，分片、大型/有效媒体文件和集群容量仍待OPS/真实资料及WP28补验。

断开、缺字节、超量、源error及超时不返回成功body、不调用后续upload、不改verified；失败会关闭未完成请求流，客户端可能仅看到连接关闭而非完整400/408 envelope，必须保留原ID/原key并查当前状态，不擅自宣称请求未达/删除对象/换ID。完整但错误SHA按原store拒绝，同旧key换bytes409；精确旧key或并发只一次metadata推进，没有媒体准入/名额/Task/发布行为。PUT成功200仅最小verified历史、两许可false，不返opaque存储定位/凭据；GET读历史仍不重新GET物理对象。

共享新增2TS/JSON（bytes command/response）及Python语义，旧77 schemas/contractVersion逐项完全不变、Android生成不变。内部command仅同共享DTO规范化UUID；bytes response必须verified_bytes且verify时间/changed-replayed/false权限一致，不把pending当成功。原stage5复核窗口确认完整Cookie值带`=`后缀被旧split截断接受的1P3（需真实有效前缀与CSRF，非无凭据越权）；本阶段解析保留第一个`=`之后全部内容，再要求精确43字符、同名唯一。unit及实际metadata/PUT已补后缀拒绝，原固定报告/RED保留，作者不能自签原P3清零。其余旧operator控制器存在同类解析需下一独立安全切片共用严格helper并全消费者回归，不将本局部修复当全站已修。

## 作者实际验证

证据`artifacts/acceptance/product/B3/wp15-stage6-author`。首次check TS2352只因新fixture异形header数组被错误强转Record，未运行该次unit/HTTP；改成明确typed案例与精确401/400+error code，未放宽业务断言。随后check/lint、unit9/9（新stream5＋旧controller2/core2）首次通过；13实际AppModule＋自有PG/MinIO初轮13/13，Cookie整改后最终13/13，全fail/cancelled/skipped0。故意故障为期望拒绝，不称真实失败已消失；首轮check诊断保留。

13＝原6metadata/API/配置边界＋新7：真正prepare→binary PUT→实际存储核验→GET/原key重放；前置Cookie/CSRF/版本/type/encoding/长度拒绝且upload0调用；错SHA/旧key重用及真实双并发仅一次；真实partial HTTP等待时独立100ms内取得operators与guard锁，再原bytes补齐200；partial期间实际撤销会话，补齐后401/0推进；客户端主动断开及chunked多一字节只连接关闭或错误、pending原票据不变；实际生产15秒deadline触发（不是降低时限的HTTP夹具），pending且同原ID/key完整重试成功。全部合成bytes/合法内部fixture会话，不是媒体可解码/真实浏览器上传业务或手机成功。

新stream5覆盖offset/chunk复制顺序、无效界限/短/长/string拒绝、真实stall关闭、源error固定安全码、25ms同步CPU阻塞后单调deadline拒绝。最终根环境/check/lint/test/build全通过，产品**354/354**＝48TS＋22Python＋262BE＋4EX＋18Web；全隔离PG **253/253**通过，13另计不重复加总。新共享TS1/Python1含根354，生成/old77机器核验通过；文档结构不是完成证明。没有新Web/Playwright、手机、平台、模型请求、父来源13或公开发布。

## 自有资源与补验分工

原QA完整70行`artifacts/acceptance/product/B3/20260930T234021Z-wp15-byte-bf5c8cf/acceptance-report.md`已全文读取：be02..bf5固定26文件组合实际12BE/3TS/3Python/13联合、原7/新9 guard-only全部通过，原局部P3双有限实际清零、新增/remaining0、QA新oracle0。QA实际PG17.11 Debian与原复核17.10 Alpine分开；完整CID/volume/网络DB cluster逐套reset前守卫、自有两容器/卷/三桶精确清理及0|0|0，原证据SHA不变。首manifest/sha路径/忽略日志及原筛选/lint诊断保留；不认领作者354/253/旧be02/父来源13。只此组合有限门禁通过，不签父pending1/Developer推进、真实浏览器/媒体/Task/手机或全AC/G3；下文待QA是bf5形成时状态，不抵触本新接续证据。

原非作者完整74行`artifacts/review/wp15-byte-bf5c8cf.md`已全文读取：固定1486..bf5的18文件，WP15-1486-01原三case及零写断言实际清零、新增/remaining0。原指定12BE/3TS/3Python/13联合、原1～7 guard-only及新9独立通过；不认领作者354/253或父来源13。原8第8裸object PUT404仍合法，但旧组名不准确，新第9单独适配验证真实`/bytes`200及仍缺路由404；首次筛选误执行8和首次自有lint诊断保留，不声称旧8描述现功能。原窗口PG17.10、自有4fd4c5/515ae6及唯一卷已自身清理/0|0|0；原QA组合复验尚待，Developeraf14/父pending1不清。后续其余消费者统一实施及真实作者结果见[独立Cookie切片](operator-cookie-hardening.md)，未混入此固定原门禁。

自有PG实际17.10 Alpine/镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整IDfa47df0cfae170ec37d963b528438f17afc68fdec9d58fa6cc1565f3540893e1/sg-wp15-byte-pg，回环32870/sg_byte_api，唯一匿名卷169e54f1d3e5b2db04a383790e8891e7884520ffccd0170b3abd7a117118826d。MinIO实际RELEASE.2025-09-07T16-13-09Z/commit07c3a429，镜像sha256:69b2ec208575b69597784255eec6fa6a2985ee9e1a47f4411a51f7f5fdd193a9，完整IDc724cce001c6ae9963d2b6a21bf824037535029b0457b58636ec55c70631c31d/sg-wp15-byte-storage，回环32904，唯一匿名卷f13b55ddb4509c3d9cca254e890ea3e08760025b9f16cf3e3a6623148bb1e049。只显式合成私有桶/bytes，无宿主挂载/外国秘密读取。实际PG最后schema/其他连接/deadlocks=0|0|0，完整ID/name/image/port/AutoRemove/卷独占核验后仅停止并删除自身两容器/唯一卷，after两个文件0字节；合成数据不可恢复但可重建，全部源码/首次及最终日志保留，原review32903/32869及其他实例不动。

复现根env/check/lint/test/build、文档结构；`tsx --test src/material-byte-transport.test.ts src/material-upload.controller.test.ts src/material-upload-core.test.ts`；明确专用URL/reset的全test:postgres；`test:material-api-storage`现在严格自有32870/sg_byte_api及32904/isolated1/显式合成credentials，先核验实例归属再运行，不能用旧stage5或原9000服务。实际AppModule只临时loopback入口并退出，非替代Playwright的独立E2E项目验收。

四态：作者上述工程通过；首轮check类型失败及原stage5独立RED保留、未作者清零；原浏览器/父来源/正式存储/真实素材/真人批准与媒体依据仍阻断所属门禁；素材登记HTTP/UI/真实准入/Task/下载到手机/Artemis选取/公开发布/全AC和生产容量未实现或未验。下一先BE统一严格Cookie消费者并回归原auth，再接素材登记API；WEB管理员恢复后沿原图/prompt真实Playwright上传/错误/重试/旧结果交错，OPS交受控实际location/最小权限/容量/分片恢复，BIZ交合法原身份/资料/批准边界，EX交实际Task文件准备与正确选取证据。职责非真人已签，人工/配置缺口记录继续独立工程，默认服务/Samsung授权不扩大为公开发布或真实资料外发。
