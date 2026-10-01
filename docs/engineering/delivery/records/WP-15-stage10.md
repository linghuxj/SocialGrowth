# WP-15 第十阶段：上传票据恢复列表

2026-10-01；基线e006851，feature/wp-15-upload-inventory-api-stage10。BE实施代理Codex，原复核/QA独立固定门禁；WEB/OPS/BIZ/EX真人协作待签。[第九阶段](WP-15-stage9.md)、[质量手册](../quality-gates.md)、[需求基线](../../../current-requirements-summary.md)。

领取认证项目上传票据稳定objectId分页，重载后找回原ID/字节描述和pending状态，不以新object重复上传恢复；默认20/最多50，显式同project cursor、最小视图。只读历史，不需要配置或SDK，不返回存储地址/密钥/actor/原幂等key，不替客户保存本地文件；重传仍需原真实字节和显式命令key，verified_bytes也不是当前物理对象存在、媒体或发布资格。原运营同权，不新增成员权限、提供者或公开下载入口。

计划分步：共享契约/Python语义→原事务认证/最终DB钟下的只读分页→controller最小投影→真实AppModule/隔离PG reader补充→产品检查→阶段提交/原非作者→原QA。WEB待管理员浏览器恢复后按原设计接上传恢复页并Playwright；OPS配置/保留与恢复，BIZ合法成品和批准依据，EX真实Task/手机文件接线。人力与配置缺口记录继续独立工程，不假造实名签收。

父WP10来源pending1/Developeraf14、管理员浏览器控制及保护发布脚本只路径状态保持。默认自有隔离服务/Samsung授权不等于解除平台控制/公开发布授权；本阶段没有浏览器/手机/模型或发布，不代签WP15/全开发/AC/G3。

原单项登记QA完整报告`artifacts/acceptance/product/B3/20261001T001838Z-wp15-registry-api-14cc7aa/acceptance-report.md`已全文读取：固定8c2..14cc19文件，7BE/TS2/Py2/旧PG14/新joint9/原8 guard-only通过，新增0/QA新oracle0；实际PG17.11 Debian与原复核17.10 Alpine分开。原首manifest基线错误证据保持、最终仅修夹具不放宽401/零登记/IO；有限非UI增量通过，不清父pending或业务门禁。原QA资源完整身份/三次reset前cluster匹配/最终0|0|0及两自有服务卷已清理，原外部服务未动。批量历史原复核在执行，第九列表尚未发起固定门禁，读取已有报告不重发。

## 实际实现与作者验证

`GET /api/operator/projects/:projectId/material-uploads`：原唯一完整operator Cookie、真实auth/guard/project/最终DB钟事务。strict afterObjectId UUID/null及pageSize十进制default20/max50，未知/异项目cursor409而非empty，拒绝重复query/前零/小数/额外status。DB UUID升序limit pageSize+1，只本页调用原load完整ticket/manifest一致性核对，controller allowlist10字段再shared响应校核；无原key、actor、内部descriptor/locator，pending/verified分别保留false许可。未选页不声称全库验证。cursor存在性不需要未选ticket本身校核；选中损坏关闭500，不返回部分页。

对象随机UUID顺序只技术游标，不是时间或业务排序；跨请求实时视图非冻结snapshot，新对象如果排序位于已走过cursor之前，必须重新从头查询才能看到，不承诺增量变更流/全部新到达零遗漏。票据状态可能在请求间推进；分页不删除/更正/取消上传，不为应用持久保存本地文件/原请求key。原read/prepare/upload/inspect/auth/storage主体不改，独立新增list，无新迁移/角色权限。配置关闭仍只读DB，不调用SDK，不代表既有verified_bytes物理文件现在还存在；缺文件/原bytes/原key按事实交人工或恢复流程，不新ID掩盖未知结果。

证据`artifacts/acceptance/product/B3/wp15-stage10-author`：指定旧core2/controller2＋新list1=5BE、upload TS4/Python4；新真实AppModule/自有PG7和旧registry真实事务14分开，全fail/cancelled/skipped0。7组只构造PENDING历史ticket，无verified成功/bytes/manifest/UI/准入状态预置：空项目与未知409、同project3/3/1/uppercase游标/同权运营可读他项目/无写无泄露、51票据＋追加52/restart原ID单读、strictquery/异项目cursor、完整Cookie/credential/停用/撤销401、选中year0票据坏500而未选前页仍200、实际guard等待被pg_stat_activity观察到/session500ms到期550ms释放最终401。只有合成历史reader补充，不是上传业务链路或Playwright；前阶段真实bytes证据只复用原scope。

最终env/check:product/lint:product/test:product/build:product exit0；产品374=54TS+28Python+270BE+4EX+18Web。旧88JSON逐项不变/new query-response2、contractVersion/Android不变；本阶段未跑全PG256/新UI/手机/模型/父13/公开发布。指定check/测试首次通过；早期辅助读取猜错task-cards/test目录、zsh无匹配glob和无listener exit1为路径/环境诊断，不算产品失败，未重写产品断言。触发器正常保护prepared_at，reader损坏测试仅own合成数据库显式临时disable/try-finally restore后注入year0，非正式修改/成功Mock。

## 原窗口与资源门禁

批量历史原78行`artifacts/review/wp15-batch-history-02a030a.md`已全文读取，SHA cde1127817f325babf4e73c7613a1a2e9e0c6c0f66245a642780aa45696be4aa：9BE/TS4/Py4/旧14/new joint9/旧oracle1～7 guard-only＋新独立9（45语义case属一组）新增0/remaining0；旧第8保持未改且不计通过，原首aux lint重复变量/未执行初稿保留，actual9首次pass。新100KiB/多1byte、真实客户端断开授权剩余项继续/原key恢复、51→52 live数值、同事务到期回滚/后项合法提交等按原scope；actualPG17.10 Alpine/3合成桶/own两CID卷已精确清理0|0|0。已发原QA固定14cc..02a17文件，同时原非作者新固定02a..e00616文件（第九列表）。只发送新门禁，读取已完成报告不重发，原模式不变，不纳现场stage10。

自有PG完整CID f43e9409c92b0a8cd19b18a95f2500afc78525542f8e81867502ff76d5b5a4fe/sg-wp15-upload-inventory-pg@127.0.0.1:32875/sg_upload_inventory；实际17.10 Alpine/缓存image93aa，--rm无hostmount唯一匿名卷8484ca1cb97265440b0eca6d3d08f473beb94bc0ef19b993aea066a8ad7e6ef4，own容器cluster7691491572822949921。启动前端口无listener且当前docker列表仅原9000/nestar；首次新7 reset前记录完整own身份与容器DB-user-cluster，**未单独在首次reset前比对网络cluster**，不补造先验守卫。旧14 reset前网络DB/user/cluster精确等own值且schema0；最终网络同归属/schema-otherconnections-deadlocks0|0|0、完整CID/name/image/ports/AutoRemove/唯一卷全实例独占再核验后只stop自身/自动删匿名卷，删除合成DB不可恢复但可重建，源码日志保留。不动他窗/原服务，无MinIO/SDK/实际存储或临时Web服务。

复现：frozen install、共享generate/check；明确自有32875/sg_upload_inventory且reset1，归属/唯一卷/TCP DB-user-cluster核验后`pnpm --filter @socialgrowth/product-backend test:upload-inventory-postgres`单次退出；旧14单独原文件命令，绝不指他窗/正式库。通过仅作者有限工程，非作者/QA待固定提交；当前产品断言无失败；浏览器/SEC/父来源/正式配置/合法媒体来源及批准依据阻断各自门禁，UI/准入/Task/手机/实际恢复/集群容量及全AC/G3仍未验或未实现。人工/环境需求继续按原WP卡，不自签Developer或全开发。
