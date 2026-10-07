# WP-13 第三阶段：受控凭据服务接口与安全元数据

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

## 凝聚交付范围与实绩（2026-10-02，优先于下方历史检查点）

固定基线6555a5aa5cb34dbd781893fe8a9478cb713972cd，codex/wp-13-controlled-credentials-api-stage3。交付4strict共享schema、GET/POST控制器、AppModule默认无钥metadata接线、3TS/2Python/4controller单元与8实际HTTP-PG组、唯一单次PG命令；无新UI/手机/生产key来源、旧97schema/阶段二原语及全部23SQL不改。原非作者阶段二完整有限0已读SHA3b8fbd22109a5d2ca46a1f8e26c21237c22e6f6cd9bef2d1682f64beb40a1d00、512首次过，已实际交同原QA严格13；本阶段另凝聚固定复核，不夹入旧门禁。

首次生成后根495=66TS/38Py/328BE/4EX/59Web、fail0/skip0；随后新8组**真实loopback HTTP+PostgreSQL**首次全过，独立于root，不叠加阶段二原12或复核512。实际AppModule（实际auth/pool、synthetic pepper、SMS/material unavailable）验证default无钥empty/current metadata及写经auth后关闭；另targeted Nest模块使用真实controller/auth/store/PG及明确新synthetic AES/HMAC keys验证合法写，**不是生产AppModule配置完成**，不是Mock业务结果，也不是真实Web/真人登录。合成operator/session/media_ref仅nonUI fixture，不能据此宣称资源或页面流程成功。

8组覆盖：上述default关闭/当前读；put/update/invalidate、精确raw byte私有解密补证/current invalidated旧key重放/最小audit/两false；真实COMMIT之后HTTP socket ACK断连及controlled Nest app关闭重建后原key只返当前失效（同pool/key，**非OS进程重启**）；path/body目标与额外authority/版本/非canonical或坏JSON字节零写；实际Cookie/CSRF/credential-version/revoked校验；同key两HTTP并发只一个revision、改原意图409；实际RETURN NULL audit故障全回滚/移除后同原key首次成功；真实native JSON parser400/413不回显secret。guard/income/reservation无写只是补充观察，不签承接/执行许可。

首root/check stale gate零业务保留，generate后原97逐项结构相同/101总数，原schema/controller四首源均不改。新增API-PG首8源完整保存；后typecheck首TS2322（headers union含undefined）保留，只增加`as Record<string,string>[]`纯类型assert，完整逆提取及TypeScript转译JS等价证明，不删/改任何断言，不重跑首8洗绿。最终check/build/lint实际0。package在最终静态后仅新增一个既有tsx单次PG命令，无deps或配置变化；旧命令全文逆提取证明，旧23SQL/阶段二代码/旧Web-Android-executor/原设计保持。源、日志、编译产物SHA及全范围proof见`artifacts/acceptance/product/B2/wp13-stage3-author/run-report.md`与final-verification.log；先前verification-first仅495未HTTP时的真实检查点，保持原样而非覆盖。

自有PG17.10/Alpine：CID232a31a9bb7491b0a5678a1856a5f6413df75b381da578047d07f65e17033245、name sg-wp13-credential-api-author-20261001、image sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74、owner wp13-credential-api-author-20261001/AutoRemove、loopback32867、DBsg_wp13_credential_api_author/user sg_credential_api_fixture、cluster7691729616497094689、唯一匿名卷1e6f9eef0d0c302f2090e7574e9363647a9bfafce8a3d46a99cf3871be19ce19。每DDL/reset核完整CID/name/image/label/own合成Env/AutoRemove/端口/唯一卷/所有running仅Id-Mounts独占性及TCP DB-user-cluster/仅ownDB与postgres清单。未读foreignEnv/数据/历史凭据；两个Nest app/pool退出后schema0/otherConnections0，全guard后只stop精确CID。

清理**首次辅助失败**：docker stop实际返回正确CID，但立即inspect仍status0，assert expected1失败；不把stop未完成或业务失败混称，pg-cleanup-first.log及源保留。随后独立只读helper（不再次stop/delete、不连接旧DB）实际确认同CID/卷gone、32867 TCP ECONNREFUSED、开工原foreign三完整ID仍在、当前仅Id/Mounts无共享该卷；没有跨时foreign完整metadata基线，不声称其全文不变。仅删除可重建的自有合成fixture，无法恢复此临时卷，无其他窗/产品/手机数据删除。复现必须新实例及完整身份，不能直接运行已gone owned-pg.json。BE `pnpm test:media-credentials-api-postgres`需SG_PRODUCT_TEST_ALLOW_RESET=1、SG_PRODUCT_TEST_DATABASE_URL仅127.0.0.1/sg_wp13_credential_api_author、SG_PRODUCT_TEST_CLUSTER_ID、SG_PRODUCT_TEST_CONTAINER_ID、SG_PRODUCT_TEST_VOLUME；测试guard绑定此批name/image/owner/合成Env，新资源必须适配身份并保留原源/仅身份逆proof。

四态：通过以上作者工程与静态；失败并保留stale零业务/type TS2322/即时AutoRemove及所有原RED，不洗绿；阻断生产受控key-provider/TLS请求保密、当前初始化授权与模型前screen/text/tool保护、管理员UI/SEC/父门禁；未验生产写入/真实Playwright页面/Artemis真机/真实身份初始化及AC21/22/G3/OS崩溃重启。BE作者实施→同原非作者新固定→同原QA相同工程门禁；真实页面只能门禁解除后原QA Playwright，真机由Artemis决策，不能把API fixture冒充验收。

真实人工需求不因default服务Samsung授权自动解除：OPS/TL当前合法受控key来源/HTTPS日志保护/轮换备份及旧digest保留；EX/AND当前许可和可靠敏感填入/模型前保护；WEB管理员新UI门禁解除后按原prompt/图稿合法录入；BIZ真实公司账号/Page/频道/项目权限逐项给依据。RES-WP13-01～04及RES-WP14-03/SEC-WP14-01记录角色、解除条件与对应补验，真人姓名/预约未签不编造。Developeraf14/父source13 pending1不合并隐藏，保护脚本仅PATH/STATUS，无最终发布。下一无依赖工程候选为显式可信受控key-provider接缝（默认仍关闭、只新synthetic inputs测试），不得读取历史key/将私有crypto callback称可靠模型保护。全部可执行开发及真实目标尚未完成，保持调度继续。

## 以下为开工与495历史检查点（当时未HTTP，不覆盖上述实绩）

2026-10-01开工，基线6555a5aa5cb34dbd781893fe8a9478cb713972cd，codex/wp-13-controlled-credentials-api-stage3。Codex BE实施代理，原只读非作者/原QA门禁；OPS/TL当前合法受控key-provider/轮换保管与真实配置，EX/AND当前初始化许可及可靠敏感填写/模型前screen-text-tool保护，WEB门禁解除后按原图prompt合法录入，BIZ真实公司媒体/项目授权，真人及预约待签。WP13/CT10/需求基线§6/技术设计§6、AC21/22仅服务录入准备范围，未签初始化业务。

阶段二6555a5a已strict13凝聚提交并实际交同原非作者，待完整报告，不由作者签G1；筹备a42原双完整有限0已读、用户已获汇报，不重复旧报告任务。本阶段不改变6555固定快照，只开发下一受控HTTP接线，原三窗口模式不变。

本阶段开发中：四新共享strict schema（safe metadata/null read、put/invalidate request、三个changed/replayed组合response），现有97旧schema不放宽。UUID单lowercase绝对末尾regex/版本safe integer/idempotency ASCII严格。敏感输入作为canonical base64原UTF8 JSON byte body、最多8192原byte，padding bits严格；**base64只是编码，不是加密或防日志截图保护**，不能流入URL、普通日志、模型、队列或响应。解码后仍由阶段二私有secret validator保护login/password，不trim或改变原字节。采用ASCII byte envelope避免密码Unicode字符串长度在TS/Python对照时混淆，不以此制定平台密码政策；真实生产HTTPS/请求日志保护必须OPS确认后才启受控key来源。

新增GET/POST `/api/operator/media-accounts/:accountId/credentials`控制器，实际Cookie/CSRF下传，不接受body actor/当前许可；path/body账号一致、response credential/account/platform一致。GET只安全metadata，POST在finally清零自有解码Buffer、不反射secret原body/requestId/Zod issues/drivercause，错误trace由server新生成。AppModule默认new MediaCredentialStore(...,null)：可做真实鉴权metadata查询，但写鉴权后关闭，不偷偷加载环境/historical key，不开放解密GET/Artemis或任何受控填入。生产钥source未落实，显式可信adapter随后实现/复核；默认关闭不是可生产录入宣称。

新3TS+2Python契约边界及4controller借Buffer/零调用/错误/目标关联检查开发中，首完整root日志将保存于`artifacts/acceptance/product/B2/wp13-stage3-author`，当前尚未核验实际HTTP/新PG/真实页面。单元fake store只是补充，不当实际鉴权或业务成功；后续需自有隔离实际AppModule/PG从HTTP验证合法请求及default关闭、失效/当前重放/故障接续，真实Web仍Playwright而非API fixture。

## 当前实际检查点（未完整阶段提交）

首root/check被生成契约过期门禁阻断，root-first.log/check-first.log保留，零业务测试；四schema/3TS测试/controller/4controller测试首源均原样保存。随后运行现有generate命令actual0（正常机械生成，不放宽旧generator/parser），原97 JSONschema逐项全文结构保持，仅加4共101，Android生成与旧Web/executor/22旧SQL加新0023及阶段二crypto/store/PG/package完全不改。AppModule去唯一2import/controller/null-key provider及说明全文等于6555，registry/index去新增条目全文等于6555。新源及断言自首保存后不改；初次猜错schema-registry.ts读ENOENT只工具返回事实，随后读真实registry.ts，未改根/旧parser。

生成后首次真正业务root495=66TS+38Python+328BE+4EX+59Web全部通过，新增9包含3TS/2Python/4controller（不叠加原486），fail/skip0；全check/lint/build实际0，取证helper --deny-warnings actual0、文档结构157R/30WP/61AC/10CT/13风险/280links通过。verification-first.log 保存原97全文等价、源与首源/首stale诊断/生成后实际日志SHA；schemas-prior-fixed-baseline.json明确采自固定6555 Git blob，不假称首次workspace copy。root/静态first failures不洗绿，495不是首命令执行过业务或真实HTTP验收。

本阶段尚未凝聚提交、未独立复核/QA。未启动新的服务/PG/浏览器/手机、未读真实/historical秘密，controller store stub只是单元补充，实际AppModule/default关闭与合法受控provider下HTTP-PG/响应丢失仍待做；生产合法key-provider/TLS/请求日志保护及真实页面/初始化许可与敏感模型前保护未签。下一具体工程：新自有隔离实例，真实HTTP读/默认关闭/合法controlled fixture写与invalidated当前replay、path及Cookie-CSRF负向、安全parser/响应异常，保留首日志后再凝聚阶段交原窗。不能直接复用phase2已goneCID/name/端口或更改phase2固定oracle；真人输入只阻其范围，其他工程继续。

人工/环境阻断按RES-WP13-01～04/RES-WP14-03/SEC-WP14-01和WP10父source13/pending1保持，Developeraf14不前移；已有默认自有服务和指定Samsung联调授权不扩大生产/最终发布，历史secret不读/用。原devices-overview prompt/图稿UI014本轮已全文核对并查看，示例4台/在线/就绪不导入产品，管理员新UI门禁保持，无新页面/样式/手机或绕过浏览器。继续工程，不能把本阶段开工/单元当完整vault、可靠模型保护或初始化/承接/ACG3。
