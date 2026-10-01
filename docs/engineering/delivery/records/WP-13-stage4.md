# WP-13 第四阶段：显式受控密钥保管与轮换接缝

2026-10-02开工，基线3c0ce79c940dca13c23bf2d7d8c955049794764d，codex/wp-13-controlled-key-custodian-stage4。WP13/CT10/需求基线§6与技术设计§6，BE实施代理Codex，OPS/TL实际key来源/轮换备份保管，EX/AND当前许可及可靠模型前保护，WEB/QA管理员UI解除后真实页面，BIZ实际资源权属；真人姓名/预约仍待签。原非作者固定stage3 strict17，原QA固定stage2 strict13；不混本开发，不换窗口/模型/入口绕过。

计划限定显式可信进程内custodian：新synthetic输入的owned key copies、全ring原子replace与dispose、每次write同步snapshot及owned副本清理，现有静态keys调用兼容，default AppModule依然null key。无文件/env/历史密钥读取、无HTTP管理keys接口、无自动跨worker推送或生产secret-manager/KMS声明。旧digest key缺失必须关闭原key重放，轮换不复活失效secret；全部密钥保留周期/backup/TLS请求日志/实际custodian操作授权由OPS/TL提供并补验。信任服务器内部组件，不把JavaScript callback当沙箱或可靠模型保护。

当前仅领取与规划，未完成/未验；测试保留首次source/log、单元及真实自有PG为工程补充，不签Playwright/Artemis/初始化/完整ACG3。Developeraf14/source13 pending1/UI/SEC门禁及保护脚本PATH-STATUS不变，人工缺口只阻对应范围，其他工程继续。

## 开发实际检查点（优先于上述开工计划）

显式process-local custodian已实现owned ring/原子replace/null关闭/不可重开dispose，私有字段避免普通JSON/inspect误显示keys；同步借独立owned副本给可信copier、消费后清零所有原借Buffer引用（即使callback改数组/替换key引用），不返回结果或错误cause，JS/caller/OS不是擦除保证/任意callback不是沙箱。Store保持静态keys兼容，显式custodian每次write在await前借snapshot→自有keys，读不需要key，关闭仍实际auth后报告；AppModule null-key/HTTP/所有schema/23SQL不改，无实际生产key source、敏感填写或模型前保护。

作者首7单元全部过。新增稀疏array边界：new custodian误接受hole，legacy static snapshot清理TypeError覆盖AUTHENTICATION_REQUIRED；相同9首7PASS2RED已保留完整源/log。仅custodian与Store对digest ring用Array.from逐slot验证、旧Store额外Array.isArray，随后相同9全过、原9断言不改；不能把历史stage2/3限定0报告冒充本新边界已覆盖。正式根`pnpm test:product`504=66TS/38Py/337BE/4EX/59Web首次过，新增9含在根，不叠加495/先7/9red-green；check:product/lint:product/build:product actual0，新PG源后BE check/lint/build0。当前12组HTTP-PG文件复用阶段三原8body仅资源身份/显式custodian接线及finally disposal变化，再加4rotation-specific正文，独立original窗结论不由作者签。

本阶段曾误运行普通Demo `pnpm test`（132通过，仅原Demo合成补充、非产品/非验收）/普通check（命令不存在、启动器engine22.12警告）/普通lint（Demo既有可访问性/React等错误exit1）/普通build（Demo构建0）；原logs保存，没有改Demo、未重跑独立Demo验收，没有把它们计产品根或用绕过Playwright。随后核对根package及stage3原日志header，改用正式*:product命令的独立新日志，不覆盖旧错目标日志。阶段三author报告复现命令缩写也已依原header纠正并告知同原复核窗，原495等证据/SHA不变。

实际新PG身份、首次HTTP结果与清理将在本卡据实接续，当前不能预签。证据目录`artifacts/acceptance/product/B2/wp13-stage4-author`，源/RED/首次产品日志保持；有界资源guard与人工需求仍按前文，不重新操作已gone stage3实例。

## 进一步缺陷与实际资源接续

异步copier误返回rejected native Promise会被同步拒绝但原拒绝未消费，形成unhandled rejection。新增第10保持原9，首10=9PASS1RED的源/log保留；仅output标注unknown并对native Promise用原型catch丢弃原错误（不await、不延长borrowed bytes寿命、不能停止任意callback代码），同10全过。正式根最终505=66TS/38Py/338BE/4EX/59Web及全product check/lint/build0；原504是此前代码检查点，不累加。受控Store只同步copier，此修改不开放异步provider/KMS或模型操作。

实际PG初代CID2c639962f201b51b5c32371d16e6253a991ea7aa70dd4237ca286f4b2a65299d、loopback32868、cluster7691739139916427297、唯一卷3c868f90491258b32a0998026b63bc1f1a1d7deecda5268e7fccf4b2a4916439。真实8既有HTTP正文复用+4新轮换组首11PASS1FAIL（等待观测false）；仅pg_stat_activity监测由持锁transaction连接改为独立pool连接，expected真实Lock/assert/4秒界限及业务全部不改，最终12全过。统计缓存是可能原因，不以缺乏原trace证明已确认缓存；首观测失败与完整逆提取保留。最终覆盖真实轮换新AES/旧HMAC重放当前失效、缺旧digest关闭后明确恢复、已在途snapshot不被替换而下一请求取新ring、dispose未来关闭/读metadata仍有效/auth优先。不是生产key轮换、当前动作撤权或OS崩溃证明。

初代空schema/连接、仅ownDB-postgres/fullguard后精确stop，helper仅新增有界只读wait使AutoRemove检查等到gone，CID/卷gone/端口拒绝/foreign IDs不变actualexit0；初代JSON另保存owned-pg-first.json，不能运行旧ID。async修正后再次新建不同CID/卷，不把初代12当当前全文source执行结果。二代CID1ddb1daa0b73dd88961890d1b473d56ca5ae7431654a71b3f96154f956b5ee27、32869、唯一卷69b2d12706d04d842d00194d198c7c4bc3979086792caae70f550e2ca0249383。startup首轮询未取到identity而exit1，未保留轮询具体连接cause，不编造原因；随后误投test在bootstrap cluster未绑定时guard exit1，**零业务/DDL**。两个原失败log/未绑定JSON保存。另bind-second-identity helper全Docker身份/ownEnv/端口/唯一卷/foreign仅Id-Mounts独占及TCP DB-user-cluster/仅ownDB与postgres/schema0连接0实际0，确认cluster7691740971135586337，只补绑定这个新自有instance的cluster，不改产品/预置成功状态/放宽guard；此后当前source的实际业务和精确清理据最终日志接续。

### 最终作者范围（待凝聚独立门禁）

产品lint exit0但有2个unicorn(no-new-array) warning，准确在稀疏fixture的78:86/85:34，保留有意holes不采用推荐dense Array.from改掉验收前提。final-verification-first首误假定无warning而exit1/完整首源保留；最终元数据仅准许这两准确位置/规则且记录warning2、其他warning/error仍拒绝，不改产品/断言/原日志或业务重跑。final-verification最终actual0，helper本身deny-warnings另实际0，不假称全部无诊断。

二代完整guard后当前custodian/Store/test源实际HTTP-PG12首次业务全部通过，http-pg-current-source-bound.log actual0/fail0/skip0；原二代启动/未绑定guard失败零业务不擦除，初代11/12与二代12重叠不相加。二代所有app/pool结束/schema0连接0、全身份后精确stop，pg-cleanup-second.log actual0，CID/卷gone/32869拒绝/foreign IDs不变。两个可重建自有synthetic DB/卷不可恢复，未删除foreign产品或手机数据。当前正式根505与10unit/HTTP12/全product静态是作者补充，非独立门禁/页面/真机/生产key/完整初始化ACG3。

产品范围5：custodian/source单元/PG、Store最小接缝与dense ring修复、package唯一test命令；docs6：此卡/memory/tracker/queue/stage2门禁实绩/deploy说明。BE `pnpm test:media-key-custodian-postgres`需reset1、只127.0.0.1/sg_wp13_key_custodian_author及明确fullCID/cluster/solevolume；当前批name/owner/image/合成Env强守卫，新实例必须重新绑定所有真实身份。所有首源、RED与最终日志、源码/编译SHA、whole inverse、stage3原8与原10/9/7分段不改证明见author run-report及final-verification；没有旧helper偷换CID后当同首次源。

原QA阶段二完整报告523首过/独立11/有限双0已全文读并汇报，正式实绩及原报告缩写命令差异见stage2卡；原非作者仍固定3c0阶段三，不发送本未来打断或覆盖当前任务。待本阶段凝聚后排同原窗队列，报告只读、findings修复与固定复验。下一需求工程为当前初始化许可/身份版本的受控消费者边界，首先核对WP11现有许可/lease/停止事实，不开放secret给模型、不将permission参数交前端伪称，不跨source13/管理员门禁。真实密钥来源/TLS/保留期/输入和屏幕保护依前文角色记录，人工补验不阻独立工程。

上一阶段已实际凝聚3c0 strict17并交同原非作者。提交后metadata helper首git diff-tree合并-rz usage129/exit1保留，误述初退出0已向同窗口及时纠正；仅拆-r/-z完整逆提取、submitted-verification-final实际0，没重跑业务或更改固定stage3。正式stage3卡与author run-report保留完整实绩和未验边界。
