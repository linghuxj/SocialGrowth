# WP-27 第三阶段：加密包认证绑定恢复清单

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01最新：原非作者4f2dbfe012b1d8d7e804eb2ec3e46dd71133782b4ada615b553c7440050557ae/原QA63cf830d99a93cbcb610baa48b30cd00f3686d2807933d1db41f584a5f43f279完整报告均全文读。原1921继承3PASS1RED保持；仅覆盖c147两个清单文件的最小组合，实际PG12/同oracle4/真实declaration1通过、新0/剩余0/QA新oracle0/有限双工程闭合。不是原1921全绿/可信SQL/当前权/业务验收。接续[文件故障阶段](WP-27-stage5.md)，下方待复核为历史，不覆盖首红/指纹。

2026-10-01原清单批发现继承漏检P2，v2第四批尚未复核，依赖等价保证暂不签通过；不据此判独立crypto失败或已验证。[小整改](WP-27-inheritance-remediation.md)只加清单早期双端点继承拒绝、不改v2/v1格式/crypto，作者实际PG原9＋新3从首9PASS3FAIL到12PASS/根414，仍待原非作者确认清零后接续第四批，再交原QA。以下作者9/414保持当时证据，不改为原非作者/QA通过。

2026-10-01；基线a761ea4，feature/wp-27-inventory-bound-backup-stage3；OPS/BE实施代理Codex，正式OPS/TL/原非作者/QA真人待签。[清单阶段](WP-27-stage2.md)、[第一加密包](WP-27.md)、[质量手册](../quality-gates.md)。

领取独立v2格式，将实际dump摘要/bytes与受限inventory-v1放同一AES256GCM AAD，避免维护端将未认证sidecar误当可信expected；V1格式严格独立且行为保持。只trusted server显式key/SQL与维护来源，无HTTP/fs/restore/Worker/授权或自动consumer；认证不证明实际capture与dump同snapshot、完整备份、当前外部事实或真实批准，始终reconciliation/双false。计划纯篡改/格式兼容→实际ownPG同snapshot清单＋v2 seal/open→恢复/目标未变反例→完整产品检查/凝聚提交/原门禁。RES-WP27-01～03/父pending1/Developeraf14/browser/SEC/保护脚本路径状态及原窗口模式不变，默认服务/Samsung与人工记录继续授权，全部开发/AC/G3未完成。

## 实现边界

独立format `2026-10-01.database-backup-v2`，metadata-v1/inventory-v1严格复用实际schema（原两个组件仅增加export，旧函数/查询/阈值不变），实际dumpBytes/SHA与inventoryScope=socialgrowth_product及全受限表/7类指纹、keyId、requiresReconciliation/双false共同作为规范codepoint排序AAD认证。原v1仍独立读取，拒绝追加inventory伪装；双方不能互读，不自动格式识别降级。显式32byte维护key/默认null关闭、随机12byte nonce/16byte GCMtag、strict canonical base64/原128MiB技术dump上界；不改生产容量或key轮换策略。

seal复制dump/key并finally清零copy、不改caller；open的decipher.update部分明文即使final认证失败也finally清零，成功后交付的dump由trusted维护caller及时清零、失败的已组装dump也清零。固定DATABASE_BACKUP_INVALID无cause/input/原配置，不承诺全JS/OS内存抹除。**清单manifest在包内仍是明文认证元数据，不是加密的清单**：行数/表名/hash可敏感，文件必须维护访问控制/0600与离线key保管，不日志/HTTP公开，包内cipher只加密dump。没有写文件/密钥存储/CLI runner/生产restore入口；密钥持有与MAC正确不升级为可信SQL或实际最新授权。

模块只认证调用端传入清单与bytes的组合；必须使用第二阶段自持事务的实际snapshot callback来同时取得真实inventory与同ID的可信dump，不能单靠seal调用证明两者源一致。恢复后仍另调readonly capture/compare，范围仅其普通PG17 schema/行/受限definitions，不验证跨cluster/globals/ACL/custom类型/实际对象/Redis/手机。原消费者/fence/current暂停/撤权/分配/预算/提交未知验证尚缺，v2输出不开放执行或恢复后重放。

沿[Node24 GCM认证API](https://nodejs.org/docs/latest-v24.x/api/crypto.html)设置AAD与tag，实际项目Node24.16.0；复用第一阶段已核验[PG17 trusted archive/snapshot边界](https://www.postgresql.org/docs/17/app-pgdump.html)，不把当前官网版本代替本地运行环境。正式OPS密钥使用次数/轮换、归档存储/保留/RPO-RTO与维护权限仍须事前落实RES-WP27-01～03。

## 作者实际检查与资源

日志`artifacts/acceptance/product/B5/wp27-stage3-author`：v2新5纯组及原v1未改4分别首次通过（合计指定9但不重复加进root）；root414=59TS+33Python+300BE+4EX+18Web、env/check/lint/test/build/文档结构exit0，失败/跳过0。共享93JSON/21SQL/Android（Git clean-filter）/Web/executor/根lock不变，没有依赖或package测试命令变化；旧v1和inventory helper只export已有schema，没有修改旧format、crypto函数或SQL。在原inventory PG演练增量将第一组同snapshot实际dump置入v2 seal→open再pg_restore、finally清零原dump/打开dump，并新增一组篡改/错key恢复调用0及目标指纹不变；原其他7组业务断言未改。

实际新PG9/9首次通过：66表/七定义真实同snapshot dump＋认证清单，源先在另一自有连接实际变更但snapshot/restore保留原值、当前源不同；改manifest函数digest或错key均在pg_restore前关闭/目标相同，其他RLS/结构/容量/异常池释放反例继续通过。纯组涵盖每个inventory digest/row count、跨包manifest换入、nonce不同、错误key/id、cipher/tag/metadata/base64/未知字段、v1/v2互拒及caller对象/key不变；fixture以PGDMP前缀的纯字节不是实际SQL合法性证据，实际9另用真实pg_dump，不把crypto测试当发布/业务Mock验收。上一阶段首42703及原作者/原QA所有RED保留，本阶段没有产品/fixture首次失败。

全新ownCID2fad559d0e2ada6dc48bf84c836e2c3a096b6207e9a8ff68fafcc9cde6170594，/sg-wp27-inventory-pg@127.0.0.1:32878、label wp27-restore-inventory、--rm/nohostmount、唯一卷aee4744f0ccad258af2b3e3bc8c52ab1bf53cb1623e1d6ad6ce7a9577ed7ecbb，实际PG17.10 Alpine/image93aa/cluster7691530766891520033。启动前lsof无listener，不复用已删除stage2 CID；每reset/restore/after完整元数据与全实例卷独占、双库TCP db/user/cluster核验；只选外来Id/Name/Image/port/Mounts而非Env/数据。after清own source/restore schema、临时RLS role撤销删除、随机key清零及Pool关闭；cleanup复制上一阶段已执行工具到新路径，仅apply_patch改新CID/volume/cluster，原工具/日志不覆盖。最终每库schema/他连接/deadlocks/临时roles各0|0|0|0后只stop精确新CID，匿名卷消失/32878关闭。合成两库不可恢复但源码可重建；源码证据保留，未动他窗/9000/nestar或现有Web/runtime，没有dump/key落盘。

复现fresh自有同名label/32878 fixture、完整归属核验→`SG_PRODUCT_TEST_INVENTORY_CONTAINER_ID=<新完整own CID> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:database-inventory`单次退出→自己的完整守卫及精确清理；旧历史CID不能复用。非UI补充不替代Playwright/真机/生产恢复/正式OPS签收。

## 原窗口与交付四态

原队列9f非作者47/QA59完整报告已在此前全文读取并记账，运输原P2有限双实际清零；父WP10 pending1与Developeraf14仍不清。原非作者cc41881九文件当前执行中：原14PG/13joint已过、独立12中一项夹具诊断后通过的状态仅窗口进度，不当完整报告结论，待报告完成再全文读。原backup546d35b、calendar ccc/a761整改、inventory63b9cae及本v2仍须各自固定门禁；不发送新任务打断正在运行的原复核、不重发既有读取/换窗口或模式。

**通过**仅作者v2认证组件及合成实际PG9/root414；**失败**本阶段0、历史首失败按原记录保留；**阻断**正式维护资源/KEY/retention频率/RPO-RTO/生产当前事实与consumer/fence、browser管理员/SEC/父来源；**未验证**真实来源可信、生产完整backup/跨cluster与联合恢复/容量、Android升级回滚/Web与真机/全部WP/AC/B5/G3。工程职责不是真人签收，继续记录真实需求/解除条件并推进可独立工程，阶段提交不自签G1合并。
