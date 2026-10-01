# WP-16 第五阶段：认证待核对任务引用与同事务通知 outbox

2026-10-01原QA完整报告已全文读取：`artifacts/acceptance/product/B3/20261001T032458Z-wp16-pending-outbox-cc41881/acceptance-report.md`，SHA7227ae9f4a4950a50b490063e796ecf971734ae394a97f98bc3bcd30d518ad24，固定9文件新增0/阶段remaining0；纯2/旧14PG/原13joint/复用原独立12分别首次通过，QA新oracle0，有限双工程门禁通过。原指纹/所有RED保留，own新e7dec2 PG与3f7e56 Redis/CID卷及快照已精确清理；aux安装未结束缺pg零业务诊断保留。不是已准入Task/配额/真实Web/真机/AC/G3，不清父pending1/Developeraf14；原cc含旧URL而9f另双清零，下面“QA待接续”为此前历史不改写。接续独立backup/calendar QA与清单继承整改见[交接队列](B4-B5-review-queue-20261001.md)。

2026-10-01原非作者完整67行报告wp16-pending-outbox-cc41881.md已全文读取，SHA1e75a457f1280c06fad5d752055b7bba501bcb1026dc1583904f9d441ba71128：阶段新增0/remaining0，pure2/旧14PG/原13联合/独立12最终分别通过，首独立11PASS1FAIL非法enum夹具仅纠正合法值不改断言、ESM零业务加载诊断与40作者等指纹保留，自有双资源精确清理。已交原QA固定9文件复验；不是实际Task准入/配额/发布，不清父pending1/Developer。后续分批职责与门禁见[交接队列](B4-B5-review-queue-20261001.md)，原QA9f双清零是独立后续整改，不回写到本固定cc源码或原报告。

2026-10-01；基线145c3c5，feature/wp-16-pending-recheck-outbox-stage5。BE实施代理Codex；EX/AI/OPS/BIZ/原非作者/QA协作真人待签。[契约](WP-16-stage3.md)、[队列](WP-16-stage4.md)、[CT-07](../contract-checklist.md#ct-07-任务队列与外部副作用)、[质量手册](../quality-gates.md)。

领取真实operator session/CSRF和项目下的非执行待核对task引用快照与同事务recheck notice；保存始终pending_current_checks/false权限，中央事实缺口不把UUID/声明变批准/名额或动作权。不注册HTTP/Worker/调度循环，不发送实际发布、初始化或手机操作，不把pending引用当已准入可执行Task。原真实model/批准scope/素材准入/分配及当前授权仍需真正producer，Task/quota/admission的原子生效不能由这份引用账本代替。

分步：专用迁移/不可变版本和notice→原auth/final DB clock的CAS及原key查询/重放→锁外运输与待核对引用的current版本检查/unknown保留原ID→真实ownPG补充事务断言→产品检查/阶段提交/原门禁。OPS正式队列配置与保留/灾备、AI/BIZ批准事实及合法媒体、EX真实当前Task/Artemis consumers待签，人工缺口记录继续独立基础。

145c队列11文件作者389/配置2/真实Redis8已提交未代签原非作者；b0b8契约13文件交原复核，原QA接续2639上传恢复16文件。已完整读取e006原QA69行及2639原复核完整报告，原模式/仅读旧报告不重发与新固定发送保持。默认自有服务/Samsung授权、父来源pending1/Developeraf14/browser/SEC与保护脚本只路径状态不变，无新UI/手机/外部模型/公开发布，不报全开发/AC G3完成。

## 实现、并发与未知结果

迁移0021新增guard/records/revisions/outbox/commands五表。项目与operator真实外键，任务/原尝试/设备/身份/分配/批准/素材的其他UUID仅待核对声明，未解析为批准事实；数据库及所有返回均pending_current_checks、executionAllowed/publicationAllowed=false。当前记录只允许连续1～1000版本，不可改项目/状态；历史不可变，outbox原message/task/revision不可重绑定、transport attempts不可倒退。没有已准入Task表/名额占用或执行API，不接受此引用作为WP11许可凭据。

save严格metadata/expectedCurrentRevision/task及下一版本；明确UUID规范化与canonical摘要（requestId只追踪不参与命令身份），actor原key同载荷重放返回完整当前历史、无额外版本/command/audit。同key变载荷拒绝，expected版本CAS；原attempt/device/identity/unit/variant/platform/form/recovery轮及完整限额不得更换/重置。待核对proposal字段可以显式新版本纠正，不等于可修改已开始的真实Task。每次真实auth/CSRF、operator锁→guard→项目锁→最终DB clock；五次rowCount必须1、快照/通知/outbox/命令/最小audit同事务。完整1～1000历史逐项contract/notice/UUID/关联/time/连续性/恢复限额/outbox存在性核对，早期损坏关闭read/replay/relay，不仅读最新掩盖。

relayOne缺省无transport即关闭，不自动注册服务/Worker。100～60000ms只是运输claim lease、非手机停止或业务恢复预算。短事务只选当前版本due消息并核对完整历史，保存唯一deliveryToken/transport attempts/下一对账时间，commit及释放连接/所有锁后才送clone到Redis；发送者不能改私有原notice。确认必须匹配原ID/observed/两许可false，异常或错误确认只delivery_unknown/原ID，消息未删除。合法ACK仅更新token CAS的queue_observed_at；旧token迟到reconciliation_required，不能覆盖新claim。队列ACK不是中央消费/发布事实，outbox持续保留、lease后原ID可重复核对；历史旧版本notice也保留但不新投递。Redis清空后消息可重加，完整业务去重/消费及当前事实许可仍待实现。领取后与网络IO之间proposal可能改版/会话撤销，未来实际consumer必须重新核对当前版本和权威许可，当前通知不含动作权。

## 实际作者检查与首诊断

证据目录`artifacts/acceptance/product/B3/wp16-stage5-author`。纯unit2；实际own PG17.10 Alpine＋Redis7.2.11联合13组（补充工程检查，非另一套UI/E2E验收）：五写原子/原key和纠正/并发CAS与恢复reset拒绝/真实auth/五处RETURN NULL回滚/final DB clock expiry回滚/仅当前revision发送/实际Redis add后合成ACK丢失原ID1job恢复/锁外IO及clone保护/实际COMMIT后合成ACK丢失及pool重建原notice/真实两claim迟到nonce拒绝/跨项目locator与同权读取和读末钟/早期历史损坏拒绝。合法项目/session全部合成认证fixture；其他Task引用刻意未预置成批准、就绪或发布成功。合成fault仅在真实SQL/Redis操作后丢响应或注入错误确认，不Mock成功/认证/外部结果。13组扩展首次及最终分别全pass，旧registry PG14单独pass；旧verifier是原非UI事务fixture，不是真实物理素材成功。本轮不运行旧全PG256、不认领原来源13或手机/Playwright。

首check-with-tests.log因新测试缺对象闭合`}`报TS1005，仅修测试语法；首pg-redis-first.log **2过8失败**，own数据库错误定位到`SELECT *,revision::text ORDER BY revision`歧义，修产品为表限定numeric排序，断言未放宽，第二10全pass，再扩展13。旧根test-product.log **BE276过1失败**：既有15ms模型timeout测试signal未捕获(TypeError)，当时根回归与联合测试并行；未据此证明确定根因或修旧断言。原文件单独18pass、原根命令复跑全pass，仍保留时序不稳定诊断供QA，不抹首失败。辅助猜错tracker/test路径及glob诊断没有启动相关测试，不算产品通过。最终env/check/lint/test/build exit0，产品**391=59TS+33Python+277BE+4EX+18Web**，纯2和联合13/旧14分别计数不合并虚报闭环。

## 原窗口与资源

e006原QA完整69行`artifacts/acceptance/product/B3/20261001T011203Z-wp15-library-e006851/acceptance-report.md`已全文读：16文件/新0/QA新oracle0，10BE/5TS/5Py/旧14/新8/原独立9 guard-only；原34指纹不变，实际PG17.11 Debian、CID cc5ad54cba58ff534d08f6dc90e1b50d817575ff0b48ec1b7bd02215a14fb67e/唯一卷66330e02838c7ac0db9eb1df3c8c08bc822444487825ddc1824f70e142f66c80清理0|0|0。列表双有限通过，父门禁不清。

2639原复核完整报告`artifacts/review/wp15-upload-inventory-2639d7b.md`已全文读，SHA256 41d56f3b35b95cd8b24630256119667b538d874d5d307fea85c8bd18ffe46048：固定16文件新0/remaining0；5BE/4TS/4Py/14PG/新7/独立9（34语义case在一组），非真实恢复；原旧8未跑/不计新GREEN，首次辅助文案匹配失败保留。实际PG17.10 Alpine、CID f3f1adb94e962489ef0b26ec72b6dfdc4b2439a5b01fd355652b462e3537e6bf/卷8a3d9413f3e3bf1f63b55b9cc05ea16ad9673dc4fcf73fa628b5531eb89ba0ca精确清理0|0|0，三次reset前完整TCP cluster守卫。新固定阶段交原QA2639、原非作者b0b8；145c及本阶段尚待固定门禁，不重发已完成报告读取，不将现场后续/依赖纳旧快照。

本轮独占root PG CID552d95a844e823e76f36cb3f7f26e8d8b656889eca32d570fcee36d8697139b3/sg-wp16-outbox-pg/32876/sg_task_outbox，image93aa、实际17.10 Alpine、cluster7691503791441887265、唯一卷b6670d9604edd805abf5f28a4fe622f96cdf718804b18f22b650bb8582f1e52f；Redis CID787b1555390af9c35a901d7c3c52085277e31cefab231779dac65a5abc7ca7b4/sg-wp16-outbox-redis/32910/DB0、image645b、实际7.2.11、runID d17a812c08e0b2b2e7e749c91ed26e20566c9edb、唯一卷75b5d0d81dd991efb03e9dfad0b8e947fa4f1549b8336a31260f793232e7cb61。--rm无hostmount；首reset前完整身份/唯一卷、TCP DB-user-cluster与Redis runID分别等own容器且DBSIZE0；后续reset前可复现resource-guard.mjs完整核验，原服务不动。最终PG schema/其他连接/deadlocks0|0|0、Redis DBSIZE0/noeviction/AOFyes/everysec；cleanup.mjs同完整guard及空数据库后只stop上述两个完整CID，容器/匿名卷消失、端口无listener。仅合成DB/队列/AOF删除不可恢复但源码可重建，证据保留；没有Redis server crash/restart/AOF灾备验证。

复现先新建归属明确own隔离库/Redis，不能使用已删除CID或他人同端口：完整guard通过后，设置`SG_PRODUCT_TEST_DATABASE_URL=<自有32876/sg_task_outbox>`/ALLOW_RESET=1、`SG_PRODUCT_TEST_REDIS_ENDPOINT=redis://127.0.0.1:32910/0`/PASSWORD=<仅合成fixture>/ISOLATED=1，`pnpm --filter @socialgrowth/product-backend test:task-recheck-outbox`单次退出；旧14单独执行原文件命令，结束精确清理。真正非UI补充，不替代Web实际入口Playwright/Artemis。

通过仅上述作者基础；首失败及旧模型时序诊断保留，原门禁待固定提交。阻断/责任：BE/AI/BIZ真实model及批准/当前分配/合法媒体/Task名额producer（RES-WP16-01）、OPS生产Redis/TLS/ACL/保留灾备（RES-WP16-02）、EX/QA真实来源/current许可/Artemis消费者和实际停止/四媒体验收（RES-WP16-03）。管理员browser/SEC/父来源pending1仍独立阻断对应门禁。解除需真正事实writer/来源认证/原子Task-quota-outbox、实际消费/副作用前许可、逐目标公开发布授权及原Web/真机补验，不以声明/FK/lease/ACK/evidence IDs代替。人工需求记录继续可独立开发，WP16/全部WP/开发/AC/B1～B5/G3未完成。
