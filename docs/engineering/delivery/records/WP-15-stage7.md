# WP-15 第七阶段：认证人工声明单项登记 API

2026-10-01；基线8c2bc97，feature/wp-15-material-declaration-api-stage7。BE实施代理Codex；原非作者/原QA固定门禁，WEB/EX/OPS/BIZ真人待签。[内部登记](WP-15-stage3.md)、[字节HTTP](WP-15-stage6.md)、[Cookie统一](operator-cookie-hardening.md)、[质量手册](../quality-gates.md)。

按R-125领取单项人工身份/声明保存及当前版本最小读取：真实operator Cookie/CSRF、共享严格TS/JSON/Python输入，复用受控runtime和已上传票据的实际字节核验/原unit/source/语言variant/CAS/历史。保存只pending_validation/false权限，不从MIME、hash、声明或DB记录推定媒体合格/版权/从未发布/批准；不制造模型识别、新名额或Task许可。新增单项POST与current GET，完整历史仍内部保留核对，独立分页历史/显式批量HTTP接续，不拿单项称批量页面完成。

默认授权自有隔离服务/Samsung持续，无新手机消费者则不编造真机成功；浏览器控制未解除不换入口，父WP10来源pending1/Developeraf14不动。正式存储、合法真实成品及身份/来源/批准依据缺口按WP15卡记录，继续独立编码。阶段完成实现/文档/验证后凝聚提交→原复核→原QA，不按小操作提交、不自签全WP/AC/G3或全部开发完成。

## 实现与边界

真实AppModule注册`POST /api/operator/projects/:projectId/materials`及`GET .../:variantId`。单项POST要求支持的版本、严格声明/原身份/source/variant/objectIds、path/body同project、当前唯一完整Cookie及CSRF；先独立DB认证/项目/最终钟，即使配置关闭也不能以503冒充认证成功，再原save重新认证→锁外实际字节核验→重新认证/CAS/固定身份及最终DB钟事务保存。preflight不是租约，不跳过原save权限；未配置合法写503、旧read仍历史可用，未配置save包括旧key关闭的原语义保持。

共享声明身份/文本/证据/对象唯一性是唯一输入源；内部只UUID和language规范化，图片对象次序保留、evidence集合排序，不自动分组/识别内容。不增加新迁移/生产凭据默认/来源或批准生成器。当前GET先原store校核完整1～1000连续历史/immutable manifests，再只投影最新修订；历史保留但尚无分页历史HTTP或列表。响应只project/unit/source/identity/variant/language/currentRevision、当前declaration/ordered objectId-SHA-bytes-MIME、recordedAt/pending_validation及两个false许可；不返内部key/位置/binding/存储URL/secret、actor或全历史。声明含业务文本仅当前认证运营读取，不自动外发模型/提供者。历史损坏不能只隐藏早期并返回当前成功；bytes历史亦不证明当前存在、有效媒体/来源真实性或可靠未发布。

Nest原默认JSON大小未改；合法单项字段最坏Unicode编码仍小于100KiB，真实最大测试通过。声明150/5000等是既有技术限制，当前依赖按Unicode code point计长度，TS/Python一致；不用图稿数值当生产配置。每项IO3秒/历史1000是既有内部边界，完整历史核对成本、全局并发/吞吐及正式容量未验；批量HTTP、独立分页历史/素材准入与下载/Task/手机另接续，不能凭9个合成byte组称完整素材业务通过。

## 作者实际验证与首次诊断

证据`artifacts/acceptance/product/B3/wp15-stage7-author`。指定7BE＝原core5＋新controller2，TS2/Python2；旧内部registry实际PG14/14（含锁外IO/原子失败/最终钟/连续旧历史）与新实际AppModule＋自有PG/MinIO9/9分别统计，fail/cancelled/skipped0。新联合初轮6/6后增加3最终9/9：真实HTTPprepare→bytes PUT→声明/GET/重启/旧key；Cookie三后缀/duplicate/缺凭据/假Bearer/坏CSRF/撤销/停用精确401零登记；path/version/秘密输入/pending和跨项目bytes拒绝；实际并发一推进、新key无变化不增revision/audit、连续更正/旧key当前及重绑409；物理合成对象删除后历史GET/原key仍可读但新save503；配置关闭仍先auth401合法503历史200；早期history故意损坏当前read/replay500/无原source正文；有序图片更正保留旧次序、语言variant同原unit/source；最大单项声明真实HTTP通过、151字符拒绝零新增。

最终根env/check:product/lint:product/test:product/build:product全exit0，产品362/362＝50TS＋24Python＋266BE＋4EX＋18Web；不是本阶段全PG256重跑，新14与9不拼为UI/批次验收。旧79JSON schemas/contractVersion逐项不变、新3（save request/current view/save response）；Android生成无变更。生成JSON表达结构，跨字段/trim/重复/类型关系依TS/Python语义，不虚称raw JSON自足。

首次TS两次各1过1失败是新fixture误认为76emoji超过150长度；读取本仓库Zod实际codePointLength逻辑后仅改为真实151负向并新增150正向，Python由误拟UTF16检查改成实际字符计数，正式既有text界限未收紧/放宽。第一次Python未执行，最终TS2/Python2通过；首次/补诊断保留。check/lint/BEunit/14PG/初6与最终9从首轮均通过，失败结果不抹除。没有新Playwright/手机/平台/模型/父来源13或真实公开发布。

## 自有资源与补验分工

原非作者76行`artifacts/review/wp15-registry-api-14cc7aa.md`已全文读取，固定19文件有限新增/remaining0；指定7BE/2TS/2Python/旧14PG/新9联合、新8独立最终过。首独立5过3失败是前置bytes PUT已有manifest被自身夹具误期待0，原401/登记计数零不变，最终只改基线manifest1，原失败/首源/SHA保留，不虚称首轮覆盖全部子case。新44语义case为组内，真实preauth后失效/IO期间撤销/最终钟/COMMIT合成ACK/current第12版/早期损坏和无配置旧key503均实际验证；原PG17.10/自身648e9c、944633及卷已0|0|0清理，作者362/全PG256未认领。已交原QA固定19文件，未用未来batch/history/list404变化修改本固定旧oracle；父pending1/Developeraf14保持。

作者PG实际17.10 Alpine/缓存sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整CID be2d63cf657330f5ff35af89d5e8799ce7986bf071304b098ff8b4c5b4019c22/sg-wp15-registry-api-pg@127.0.0.1:32872/sg_registry_api，唯一匿名卷74e0fa32c08d57108cd9ab6ac29a624c9ab1325e604a1c9ea2025f4f11cb0908。MinIO实际RELEASE.2025-09-07T16-13-09Z/commit07c3a429/缓存sha256:69b2ec208575b69597784255eec6fa6a2985ee9e1a47f4411a51f7f5fdd193a9，完整CID 5cfbbcd753671c8fac468b24dc5005c479e6cfc161357b145b3a78f3a35fa633/sg-wp15-registry-api-storage@127.0.0.1:32905，唯一匿名卷9d3e80da1ec9e006d491a0b765a48247dc6150f3de6662ee58f4e068e470b7c5；均--rm/无host mount，显式合成凭据/随机私有桶/非媒体bytes，仅删除自有对象用于负向，不触原9000或原窗32870/32904/32871。实际清理结果补在下面，不按启动即宣称清理完成。

最后真实schema/其他连接/deadlocks=0|0|0，完整CID/name/image/端口/AutoRemove/两卷全实例独占核验后stop仅本两--rm容器；after容器与卷各0字节，已自动移除自有合成DB/两轮随机桶和对象，不可恢复但可复现重建。源码/首失败/6初轮/9最终/14PG及根日志全保留，原窗与其他实例未动。

复现先核验明确自有32872/sg_registry_api及32905完整归属，再显式URL/reset1/storage-isolated1/合成credentials，运行`test:material-registry-api-storage`后退出；旧14单独`tsx --test --test-concurrency=1 src/material-registry-store.postgres-test.ts`。根命令和指定7BE/2TS/2Python依上述。没有新独立E2E方式，HTTP/SQL只非UI工程补充。

四态：作者上述有限工程通过；首次新fixture长度预期失败保留；RES-WP14-03/SEC-WP14-01/父WP10来源pending1与真实OPS配置、BIZ合法资料/原身份/来源及批准依据仍阻断对应门禁；批量HTTP/分页历史/UI/自动规则准入/Task/文件到手机/Artemis正确选取及完整AC/G3未实现或未验。WEB管理员解除后沿原materials-batch/preview/bulk-dialog图与prompt真实Playwright；OPS受保护存储、最小权限/容量和保留恢复；BIZ可核对身份/原来源/声明及已批准边界（UUID/声明不等证明）；EX真实Task/手机可用文件/目标正确选取。职责不冒作真人签收，不新增逐批人工发布审批；缺人/配置记录后继续独立BE批量接口和有界历史。
