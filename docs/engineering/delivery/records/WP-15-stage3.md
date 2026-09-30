# WP-15 第三阶段：人工素材身份与不可变版本登记

2026-10-01后续门禁：原非作者固定ab2bc2b..747a9ce完整报告`artifacts/review/wp15-registry-747a9ce.md`已全文读取，新增0/本增量remaining0，指定5unit/14PG/8实际MinIO＋新独立9组与static通过；独立首轮2处夹具失败保留后仅修夹具最终9通过。不是作者根334/全PG253的再次独立通过。已交原QA同固定12文件接续，不包括未来0020/上传票据；QA未完成前不自签双G1，父来源pending1/Developeraf14/真实准入及手机缺口不变。

2026-10-01；基线ab2bc2b，feature/wp-15-material-registry-stage3。BE实施代理Codex；原非作者/QA固定门禁，WEB/EX/BIZ/OPS真人待签。[存储与真实资源](WP-15.md)、[名额规则](WP-15-stage2.md)、R-007/021～025/030～032/125、AC27～29及[质量手册](../quality-gates.md)。

领取实际operator会话/CSRF的内部素材登记与完整版本读取，固定项目/人工内容单元/类型/剧集、语言variant及连续修订；稳定原source/sourceRecord只映射一个内容单元，重导入不创造名额。项目/单元/variant不可重绑，不按hash/标题猜人工内容关系。不实现迁移历史、新上传UI、媒体批准/权威Task/实际平台发布或队列。登记producer为实际认证运营提供的声明，不是模型、自报版权或真实未发布证明。

对象完整性检查须显式服务器端port在事务外核验，缺省在connect前关闭；接收的是受保护人工说明及对象引用，不接任意URL/endpoint/key或秘密。port核对回来的完整对象引用必须与项目/对象定位相符；引用先复制固定，后续caller修改不能换依据。对象核验/登记保持分离，上传先固定object ID及受控存储配置仍归后续接线，本轮不自动获取现有MinIO秘密或重建桶。

登记结果永远pending_validation，不提供candidate/approved/published字段；人工“首次使用”声明、UUID、hash、存在数据库不是符合批准方向/可靠未发布或成品有效。后续可信准入生产者自动核对已批准边界、来源声明/重复疑点及媒体事实，不另造逐批人工发布审批。语言/更正只在原单元范围，修订记录不可覆盖、不变名额。图片组次序为显式数组，视频一个对象；文件实际上传/到手机/平台选取及Artemis决策未接线。

RES-WP15-01～05、RES-WP14-03仍按原卡：缺真实素材、批准/可信重复核查、正式存储及真机条件明确记录后继续独立工程，不以fixture登记当Web/AC通过；不绕管理员浏览器，不触碰用户脏发布脚本或原窗口。阶段性提交→原非作者→原QA，父来源pending1/原P1未清前不动Developer，不签全WP或全部开发完成。

## 实际实现与界限

0019新增人工unit/语言variant、不可变对象manifest与连续历史/命令、单例guard和最小audit关联；空schema及原0018后的既有operator保留均实际执行。source/sourceRecord在给定原命名空间全局唯一，unit所属项目/业务实体/形式/剧集身份不可更新，新语言引用原unit、同unit/language唯一。人工必须保持实际稳定原source和内容关系：任意改source命名空间、新UUID、hash或同名不能证明已查全量重复；这层不能识别真人重复造身份。series跨项目/业务实体或同集重复拒绝，无集序独立宣传不推断。language只是人工标签shape，不证明批准语言。

MaterialRegistryStore仅内部类，无AppModule/Nest/HTTP/共享跨端JSON/页面或Task消费注册。save只接严格metadata/原unit/source/显式业务关联/variant语言/expectedRevision、人工名称说明事实来源与首次使用声明、已固定objectIds。declared_not_previously_published是人的声明而非可靠未发布/版权证明，保存永远pending_validation，candidateAllowed/publicationAllowed=false；无新名额、文件撤回/任务改变/实际发布。资料尚不完整的会话草稿、实际准入生产者另待实现，不凭此结果取消原规则性检查或增加逐批审批。

默认verifier在connect前关闭新保存；既有read为当前operator内部历史，默认verifier缺失也能读取，但不重新证明当前对象仍在存储。配置server-only verifier后，先operator元数据→实际actor/session＋CSRF→material guard→实际project认证/旧key检查；释放全部事务再做3秒技术上限对象核验；返回值先clone/strict捕获再finally abort，取消回调不改赢得的依据。之后新事务同序重认证/新鲜DB钟/CAS/稳定映射与manifest一致性再写；未来生产者必须同guard/顺序，不能在锁内新增网络/手机/模型。对象数组图片次序保留，video只能单对象，显式MIME不匹配拒绝，但MIME/hash均不证明容器编码/成品有效或平台可用。引用只scope/key/binding/SHA/bytes/声明MIME，无任意URL/凭据。

旧key当前读0verifier、不重复版本；新key相同当前声明/objects只增加command，不加版本/audit。明确新版本CAS保留原decl/ordered files，跨variant/unit/project/source重绑和同语言另造variant拒绝；1～1000技术历史上限，底层数值列排序，损坏/缺manifest/缺历史关闭，不回旧成功。对象/单元/variant/修订/command/最小audit每写实际1行，同事务影响行数和最后真实会话过期再核验。强DB owner仍可改控制，不声称防篡改或生产保留/吞吐完成。saveBatch最多50显式items，各项独立事务及结果/固定安全错误，坏项不阻后续好项；保存不是全批合格，source正文不进错误/audit/日志或默认模型。

MaterialStorageVerifier用显式受保护manifest lookup和已配置MaterialObjectStorage实际readVerified完整下载/SHA/长度/类型核验，不信caller已上传标志。无生产upload/location resolver、没有自动读现有MinIO秘密或环境凭据；当前protected lookup接线仅真实隔离存储测试的server-owned put返回manifest。生产受控上传/位置绑定/重启pending upload恢复需下一阶段落实，不能把port存在计为已上线。实际MinIO8与registry14分开执行，不冒称已通过真实UI或联合素材上传业务。

## 作者实际验证与清理

证据`artifacts/acceptance/product/B3/wp15-stage3-author`。首次check/unit4通过，lint出现control-regex/未用type两警告（exit0），改为逐code point控制字符检查和删未用import，原日志保留。新增批量测试后check第三次TS18048（测试未按outcome收窄）/TS2550（测试用了目标lib之外toReversed），未启动该轮PG；只改测试判别/复制reverse，未改全局Node/tsconfig或业务断言。最终check/lint/unit **5/5**、PG **14/14**、实际MinIO **8/8**（旧7＋新实际verifier坏字节/找不到manifest/取消）通过；最终根env/check/lint/test/build **334/334**＝45TS19Python248BE4EX18Web，全隔离PG **253/253**＝原239＋新14，fail/cancelled/skipped0，专项不重复加计。

14PG含空/原0018前向安装、真正operator/CSRF及微秒记录/6种原子写入、不接verifier的当前原key、语言/连续更正/旧版原文件、全局原source跨unit/project与身份绑定拒绝、真实并发同key与陈旧更正只进一次、实际观察object IO期间guard未锁及同步abort回调改写不改已捕获manifest、真实3秒超时/坏scope/异常无正文、CSRF在IO前0调用/实际pg_sleep跨session到期后0保存、1～12数值连续与SQL不可改/跳版、六table INSERT RETURN NULL逐一全部回滚、真实COMMIT成功失ACK重启0 IO回当前、4items两失败两成功分别audit、剧集重复/跨项目与图片次序版本保留、固定manifest冲突/故意删除早期历史read/replay关闭。全是合成非UI项目/来源/文件引用，不是实际素材、合法未发布证明或Playwright验收。

自有PG17.10 Alpine/缓存镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整ID430c871547075ae84986a195ed78334310c78c1ac083a7e2dcc8239c941bdd20，sg-wp15-registry-pg@127.0.0.1:32867/sg_material，唯一匿名卷d66f1d925f1c2a233ef39e96c323cd7b8676b6778c27687a67febfa7d91e33f1。MinIO实际RELEASE.2025-09-07T16-13-09Z/commit07c3a429bfed433e49018cb0f78a52145d4bedeb，缓存镜像sha256:69b2ec208575b69597784255eec6fa6a2985ee9e1a47f4411a51f7f5fdd193a9，完整IDd16fe6ee1da5473ff0b3604e716faf117d63cd765e7d69417790ba845fd7255d，sg-wp15-registry-storage@127.0.0.1:32900，唯一匿名卷dbf45071d2ae8c02a0666d2f2fbc327d23a03ab3f8b2e83dbb756e48f68fae31。只有合成私有随机fixture buckets，不使用原9000凭据/数据；两实例无宿主挂载。PG最终schema/其他连接/deadlocks=0|0|0，完整ID/名称/镜像/端口/卷独占复核后只停止删除本轮可重建夹具，源码/所有首次与最终日志保留，其他实例/原窗口/手机未动。

复现根env/check/lint/test/build、文档check_consistency仅结构；`pnpm --filter @socialgrowth/product-backend exec tsx --test src/material-registry-core.test.ts`；明确专用隔离reset URL下`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/material-registry-store.postgres-test.ts`或全`test:postgres`。存储仅本明确32900新自有fixture及显式合成环境凭据下`test:storage`，不能改指原MinIO/真实bucket。作者待固定原门禁，不自报全部素材/AC/G3或开发完成。下一独立工程为受控上传/object ticket/位置绑定与当前认证HTTP/契约；WEB原materials-batch/preview/bulk-dialog图和prompt在管理员解除后落实，不改变原设计方向。
