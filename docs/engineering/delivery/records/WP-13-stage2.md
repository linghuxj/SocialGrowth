# WP-13 第二阶段：受控媒体凭据与初始化前保护

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

## 原非作者完整复核接续（2026-10-02）

随后原QAcompleted/cursor88完整报告`artifacts/acceptance/product/B2/20261001T161501Z-wp13-credentials-6555/acceptance-report.md`全文读取，SHA7fd3a8613855387fae22bcfd8366b06228355245a611eac6e192faacbdebfb43。限定新0/余0，复用512+独立11（6PG/5crypto）=523首次过，不和非作者512叠加；独立nonce100/Buffer view/逐byte tamper/UTF8边界、12路竞争/旧AES缺失只旧HMAC重放/16noop/13SQL形状拒绝/COMMIT前回滚均据原源，不签HTTP或真实平台。68来源/旧613+18reports/先前661QA证据与5实际编译副本保真；复用3unused警告exit1、final-helper首unused警告与未执行初稿修正、foreign最初Name/Ports偏宽记录均保留。自有CID39f6a881a8dd84ca74ec2483e8d97dcdb88e22ea419b408fda7a75eef7d2cc30/卷1a877fab67b828eb019d9d07549fbb76aa52fb604a0596f5e5cddc8fd75a8551/32890/cluster7691734786705158182及snapshotZaKwxl/dev16777223/ino177573652/UID501精确gone，原窗只读来源报告不重发。QA报告复现段简写pnpm test，而其实际root-unit486.log header为**pnpm test:product**；本记录明确实际复现命令，不改原报告/日志指纹或执行新报告任务。报告内stage3未提交是开工固定上下文，当前stage3已经3c0提交并在原非作者复核，绝不补齐本stage2固定范围。新stage4作者发现的稀疏key配置/异步copier边界另有RED及修正，不把既有有限0当全边界证明。用户已获汇报，有限双工程门禁闭合，不解除生产key/模型保护/真人/UI/父pending，Developeraf14不前移。

固定a42bc1501d2b12784ae5208031d1646398d25d02→6555a5aa5cb34dbd781893fe8a9478cb713972cd，strict13=6产品7docs；原只读窗口completed/cursor187，完整`artifacts/review/wp13-credentials-6555.md`已全文读取，SHA3b8fbd22109a5d2ca46a1f8e26c21237c22e6f6cd9bef2d1682f64beb40a1d00。限定新0/余0，486根+原12PG+新独立8PG+新独立6crypto=512首次过，作者5不另叠加；包括独立Node AES-GCM/raw HMAC/实际deferred COMMIT故障及绑定约束/等待DBclock/元数据实际SELECT护栏。旧613证据/18完整报告、作者所有首RED及辅助失败保持。复核helper lint旧3unused/deny exit1、初manifest错TAP文本、generator inverse前置失败、最终报告验证属性未引号SyntaxError均原源/工具诊断保留，有限字面量逆proof，不重跑业务洗绿；final-manifest及report-validation-final为终核。

自有CID4f97571e3705a32817cbcd0b090c23122cf9e93fd282ae5f58a372b8036954c2/卷9a8bed76f8b1f743e33498608b0b9fff094557559ac79ced88f0186db8d80dc7/32888/cluster7691726923750375462、快照tgoZ6Y/dev16777223/ino177500027/UID501精确gone，foreign仅metadata核验。已向用户汇报，并在原窗口完成后实际交同原QA新固定a42→6555严格13；QA等待完整报告，不把发送当通过。阶段三在作者分支继续且不纳本固定范围。此门禁仅非UI工程，可进入相同工程QA，不签真实页面/真机、完整G1/AC21/22/G3/生产/全部开发，不解除父pending或合Developer。

## 本次凝聚子范围（优先于下方早期开工检查点）

交付server-only加密及持久凭据原语，不是完整vault/初始化。基线a42bc15，新增0023三表和内部MediaCredentialStore：一个媒体登录account对应一个不可变credential UUID/平台，current head指向不可变加密revision历史；invalidated revision无envelope/密钥ID。history双向FK以deferred首次原子创建，不允许同credential跨account/平台换绑；head只能递增1，revision/command不可UPDATE/DELETE。旧22迁移、resource guard、引用与预留不改，既有媒体company/platform状态不被凭据写入证明。加密历史会保留旧密文供受控恢复/审计，不是物理擦除或平台注销；历史保留/毁钥政策必须OPS/TL实际落实。

write仅显式trusted服务器调用，strict metadata/credential/account/platform/expectedRevision/put-or-invalidate，put另借原始UTF8 Buffer；永不普通明文GET。put任何新key新revision、不用秘密归一化判断相同密码；相同原key按精确raw bytes和业务意图重放，requestId排除但版本/操作不排除；等价JSON空白或不同字段排列的秘密payload也不当同raw意图。重复invalidate新key在当前已invalidated时仅journal/noaudit/norevision；expectedRevision仍须当前。首次未有凭据不能invalidate，旧credential UUID/平台/账号不能更换；MAX_SAFE_INTEGER及输入未知授权字段关闭。read只SELECT当前ID/账号/平台/revision/state，不把envelope/keyId/login/password取入普通response。两许可false不构成执行许可或承接事实。

意图使用domain-separated HMAC-SHA256，AES和HMAC都是显式独立32字节key；加密key不作普通SHA密码对照。最多16个显式digest-key是有界技术配置，不当轮换政策；写用currentDigestKeyId，重放加载原journal digestKeyId，对应旧key缺失时安全关闭，不创建新命令或恢复旧密码。更新可用新AES key，不隐式读旧密文/旧key。无自动env/file/historical-secret读取或生产provider；key保管/来源/旧HMAC留存、备份恢复与轮换真实资源仍RES-WP13-02。所有input/payload/key在await前固定自有副本，finally清理自有byte/key，调用者副本/JS string/OS memory不保证擦除。

实际运营鉴权/CSRF与operators→actor/session→resource guard原顺序保持，最后clock_timestamp核会话仍有效，事务内无网络/手机动作。revision、head、audit、command四写均rowCount1，否则整体rollback；审计仅ID/平台/revision/state，无secret/hash/envelope。所有driver/crypto异常不带payload/cause，default null key经真实鉴权后关闭。COMMIT后的异常作为未知，持久actor/key可接续，不能按错误换key或重复录入。没有currentphone permission-loader/lease/网络或真实身份事实，不暴露任何自动解密/Artemis消费者。

### 作者实际验证与保留失败

新自有PG17.10/Alpine实际跑11组首次全部通过，追加唯一“实际COMMIT后适配返回故障”一组后最终原11+新1共12全过/skip0，原11全文仅新增type PoolClient import，旧正文保持。这是注入adapter返回异常、实际DB提交及重建store对象原key接续，**不是HTTP/TCP ACK丢失或服务进程重启证明**。11与12重叠不累加；覆盖0022→0023旧引用、空库顺序迁移/metadata read0writes、原字节/历史/当前失效重放、原key不同意图、同键/不同键并发、同权另一actor、新UUID冲突、鉴权/CSRF/credential-version/disabled/revoked/default key、显式轮换/丢旧key/共钥拒绝、四处RETURN NULL/UPDATE抑制/审计异常整体回滚、重复失效no-op、坏UTF8/未知字段/MAX_SAFE、guard等待DB到期、调用者异步变更及SQL历史/绑定护栏。账户承接producer没有接入，不宣称真实承接或注销；income/reservation无写仅补充观察。

根产品486=63契约TS+36Python+324BE+4EX+59Web通过，新增PG不在根unit中，不能混算覆盖。全根check/lint/build通过；首store-check-first TS18048窄化问题与store-first-source保留，仅引入const ownedKeys替代闭包捕获可变keys后check0，原业务不改；迁移编写稿在首次执行前加context括号，migration-first-source编写稿也保留，不假称已执行失败。加密第5首4PASS1RED及相同5GREEN、首4/root485/最终486与工具转录均仍保存。根各检查/PG/helper退出及完整逆proof、日志SHA见`artifacts/acceptance/product/B2/wp13-stage2-author/run-report.md`。

自有PG：CID701722604ab4b7703bb6eda28d24bc7145b417829c4b19b65304569d8cdc2b05，image sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，owner wp13-credentials-author-20261001/AutoRemove，DBsg_wp13_credentials_author/user sg_credential_fixture，loopback32866，cluster7691717950954745889，sole匿名卷20d452889f831f6b48974c151f6ba97b645e7044427a1ede5ae9bf5ce51b87f7。每DDL/reset核全CID/name/image/label/ownEnv/端口/唯一卷与所有running容器仅Id/Mounts的独占性，TCP DB/user/cluster及允许DB清单；不读取foreignEnv/数据或连接foreignDB。tests实际退出后schema0/otherConnections0/仅ownDB-postgres，全身份复核后精确stop，CID/卷gone、端口拒绝、四foreign ID不变（其中有其他窗在途实例，不动其资源）。删除仅可重建自有合成DB/卷，不能复用已gone字面配置；没有产品/手机数据删除。

复现必须先新建自有instance/anonymousvolume、空端口并记录完整身份。BE `pnpm test:media-credentials-postgres`要求SG_PRODUCT_TEST_ALLOW_RESET=1、SG_PRODUCT_TEST_DATABASE_URL仅127.0.0.1/sg_wp13_credentials_author、SG_PRODUCT_TEST_CLUSTER_ID、SG_PRODUCT_TEST_CONTAINER_ID及SG_PRODUCT_TEST_VOLUME；当前guard绑定本批name/image/label/合成Env，复现若改身份须先适配guard和来源proof，不能直接运行旧资源JSON/已删CID。原crypto测试 `pnpm --filter @socialgrowth/product-backend exec tsx --test src/media-credential-envelope.test.ts`不需PG；root/static命令保持正式目标。无新deps/锁文件、sharedschema/旧parser/Android/Web/Artemis变化；package仅新增单次PG命令。筹备原QA5f6d114…完整报告随后全文读，各522/有限双0/QA新oracle0；本阶段不替旧报告签完整AC。

### 分工、四态及后续

通过：以上作者非UI确定性/实际隔离PG和静态；失败并保留：首加密第5及store类型、所有原筹备/客户端历史诊断；阻断：真实key来源保管、可靠模型前保护/current许可及管理员UI/SEC/父门禁；未验：生产HTTP/真实Web、实际填写/平台登录/逐身份核验/承接/真机/完整AC21/22与G3。原a42非作者完整有限0报告已读取SHAe25589…，只交原QA筹备严格24；本阶段待新固定同原非作者，不能由作者签G1。

BE实施代理Codex负责持久原语和后续受控API/metadata契约，原非作者先独立安全/事务复核、原QA同固定工程复验；OPS/TL提供当前合法受控key-provider/轮换备份保管/密文及digest-key保留政策，EX/AND落实敏感填入与模型前screen/text/tool保护/当前统一许可，WEB在管理员门禁明确解除后按原图prompt实现合法录入，不恢复示例就绪数据；BIZ逐真实媒体company/account/Page/频道及项目授权。真人姓名与预约未落实记录待签，不编造计划。下一阶段先做安全服务接入与当前初始化授权接缝，不默认解密/读取历史secret或把加密/存库冒充完整业务；独立工程继续，真实页面由原QA Playwright、真机媒体动作由Artemis决定。默认自有服务/指定Samsung授权不扩大生产/最终公开发布。

2026-10-01开工；基线a42bc1501d2b12784ae5208031d1646398d25d02，codex/wp-13-controlled-media-credentials-stage2。BE实施代理Codex，EX/OPS敏感填入与密钥保管、WEB合法录入、AND当前设备控制、原非作者/QA固定门禁；真人待实际签署。依据WP13/CT10、需求基线§6与技术设计§6，前阶段仅声明和筹备，未实现受控凭据；本阶段不能用加密模块代完整初始化/承接业务。

当前领取：默认关闭的server-only账号绑定/版本认证凭据加密边界；login/password不trim/归一化，实际UTF8数据有限，GCM认证context/keyId/版本，固定安全错误，可信敏感sink后清理自有Buffer。不同账号/平台/版本及篡改不能交换读取，不把明文hash放可见manifest，不返回decrypt payload或sink输出/异常给上层。无配置key关闭，不读取任何旧凭据/环境文件；只新synthetic测试。不是生产key管理、权限loader/真实数据库录入更新失效、受控填写或可靠屏幕脱敏证明。

后续需同原媒体账号映射、当前有效会话/版本和命令幂等的持久凭据录入/更新/失效、只返回安全metadata，不开放普通明文GET。真正消费前必须当前初始化授权/同机控制持有者/代次/lease、归属/安装/network/ADB/参与意愿/实际身份复核；模型只获动作请求，敏感截图/屏幕字和工具返回必须可靠模型前保护，不能保护直接人工。加密不建立这些事实，不可直接对Artemis开放。

RES-WP13-02持续：OPS需提供实际受控密钥来源/轮换/恢复/保管和可信服务边界，EX/AND需落实敏感填入及模型前保护适配能力，BIZ提供真实媒体资料但不得普通对话/文档贴秘密。解除由原安全复核与实际批准输入/设备证据，再同原QA真实页面/指定Samsung补验；管理员UI/父pending1/SEC仍原限制，已授权自有服务和手机不扩大生产/公开发布。当前只工程开工，完整持久凭据/消费者和G1/G3未签，阶段内不逐操作提交。

## 开发中检查点（非完整阶段交付）

server-only media-credential-envelope实现：AES256GCM随机12字节nonce、16字节tag、canonical base64、AAD固定format/credentialId/accountId/platform/revision/keyId/payloadBytes，不输出秘密SHA/明文或自动读env；账号绑定是认证数据，不证明当前权属/版本或许可。原UTF8 payload只允许strict login/password，login最多320/password4096字符、完整实际UTF8最多8192字节是有界技术保护，不猜平台密码政策、不trim/改变空白/Unicode。上下文/来源key严格、wrong key/身份/平台/版本、cipher/tag/nonce/长度/额外字段篡改关闭。可信敏感sink前认证并validate owned原byte副本，异步期间原key/context/input/envelope变化不能替换它，sink输出丢弃/异常固定且不携cause；借出自有Buffer和内部key副本终清零，调用者副本/JS string/OS memory不保证清除，不将可信sink当任意同进程JS沙箱或模型前截图保护。

作者首4单元/产品根485=63TS+36Py+323BE+4EX+59Web首次通过、BEcheck/2源lint0；首unit命令未重定向，unit-first-tool-transcript.log明确工具返回转录不是原childstdout，首source/test原样保存。新第5针对caller Buffer.toString覆盖副作用：原source5中4PASS1RED，unit-five-red.log/test-five-red-source保存；改为先验证Buffer类型/实际长度→固定自有raw-byte副本→validate该副本，两个shape/copy代码差异可逆。完全相同5最终5PASS；原4所有断言不改，最终根486=63TS+36Py+324BE+4EX+59Web及全根check/lint/build通过，零fail/skip。首485/4、RED5和final486/5不当相加覆盖。

证据`artifacts/acceptance/product/B2/wp13-stage2-author`。没有启动任何服务/容器、执行PG/Artemis/手机/模型调用或读取真实/historical秘密，仅新synthetic字节。backend build生成此组件文件不代表AppModule注册/生产消费者，尚无credentials持久录入/更新/失效/API、当前permissionloader/受控填入/敏感capture保护。此检查点保留未提交开发范围，完成这些阶段职责后再凝聚提交固定复核；原非作者目前只审a42bc15筹备，当前component不得混入其固定快照。人工缺口记录继续，下一步实现受控版本化持久写及安全metadata视图，不开放明文GET或无授权模型sink。

verify-progress实际exit0：首source只前述bounded owned copy变化可逆，最终5源码全文等于RED5原源、去唯一新增第5后全文等于首4，原业务断言保持。所有已跟踪product/契约/22SQL/Web/Android/executor/deps/design暂停相对a42bc15不改，仅两新增backend源；原QA f153a5…全文报告SHA不变，源码与首源/首RED/最终日志SHA清单保留。取证helper --deny-warnings exit0、结构一致性157R/30WP/61AC/10CT/13风险/280links通过。未stage/commit本开发中部分、未签独立门禁，原非作者新增14/旧13/76跨语言只是进度，完整报告待读取后才评断/交QA；不在作者台账偷签。
