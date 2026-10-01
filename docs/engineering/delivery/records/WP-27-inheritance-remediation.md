# WP-27 恢复清单继承漏检整改

2026-10-01补齐：原QA B完整63cf830d99a93cbcb610baa48b30cd00f3686d2807933d1db41f584a5f43f279已全文读；原1921继承RED不改，最小两文件组合PG12/同oracle4/真实declaration1过、新0/剩余0/QA新oracle0，与原非作者有限双闭合。A原P2双实际清零保持，[第五阶段](WP-27-stage5.md)未改清单SQL/PG测试或清父门禁，下方QA B执行中为历史。

2026-10-01最新：已全文读取A完整原非作者与QA报告，原REV-WP27-INHERIT-01 P2双实际清零/new0/remaining0。原63首RED、错SQLSTATE、A工具hook首错误及正确新源均保留。B原完整非作者报告也已全文读，原1921继承RED历史不改，1921+c147两文件最小组合new0/remaining0、PG12/同oracle4通过；原QA B正在独立复验，不由A或作者自签B通过。报告SHA/分层与[下一文件阶段](WP-27-stage4.md)记录，下面pending为此前历史状态。

2026-10-01；基线`e4988c005f74c2794732c902e8b5bdf24bf7cd85`，分支`fix/wp-27-inheritance-inventory`。OPS/BE 实施代理 Codex；原非作者窗口复验、原 QA 独立工程复验；正式 OPS/TL 真人待签。[清单原阶段](WP-27-stage2.md)、[v2 依赖](WP-27-stage3.md)、[质量手册](../quality-gates.md)。

## 实际报告与受影响范围

原复核窗口已完成四批中的前三批，并非主窗口结束后全部停止。完整 `artifacts/review/wp27-inventory-63b9cae.md` 已全文读取，SHA `817f0958be9a7d3be81973687f569cc9d8b29024f24ef104ba643001264fc47a`。`REV-WP27-INHERIT-01` P2：两个空普通表添加真实 pg_inherits 边后，行和七类定义摘要未变，仍错误返回 sameSchemaAndRows=true。原独立4首2PASS2FAIL，其中继承是产品缺陷；snapshot 失效组错误期望 SQLSTATE22023 是复核方 oracle 错误，不计第二项产品缺陷，也不称该组通过。原源/首日志保留不覆盖，第四批 v2 尚未复核，依赖清单等价保证暂不签通过。

本次只整改受限 profile，不扩展继承支持。实际只读同 snapshot 在行聚合、接收行及 export/callback 前查询 pg_inherits，只要任一父/子端点属于 socialgrowth_product 即固定 INVENTORY_UNAVAILABLE；另一个端点在外部 schema 也拒绝。正常无继承清单格式/七摘要内容不变，不修改 v1/v2 crypto、format、阈值或许可，不把 requiresReconciliation 当生产强制 fence。

新测试追加到原实际 PG9 后，原9正文/断言不变：同 schema 空表同列、域内子表继承外部父表、域内父表被外部子表继承。分别实际确认 pg_inherits 从无边到有边，要求固定错误且 callback0；NO INHERIT 后恢复原清单，最终删自身 fixture 后66表原清单仍等价。

## 作者检查、首失败及收尾

证据目录 `artifacts/acceptance/product/B5/wp27-inheritance-fix-author`。新增三个实际回归首次在旧产品上执行 **12组9PASS3FAIL**（三项 Missing expected rejection），首源 `pg-first-source.ts`、旧组件 `inventory-before.ts`、`pg-first.log` 保留。只增加早期目录守卫后，完全相同测试源实际 **12/12 PASS**、fail/skip0；原9仍通过，不改宽松断言、不把首红计为通过。只检查继承拒绝与维护恢复，不是真实业务/UI验收。

项目 `pnpm env:check` 确认 Node24.16.0 实际路径及 SQLite OK；check/lint/test/build 全 exit0。根产品414=59TS+33Python+300BE+4EX+18Web，实际 PG12 单列，不加入根计数或与历史测试累加为业务覆盖。无依赖/lock/共享93 schemas/21 SQL/Android/Web/executor/v1-v2格式或 crypto 源改动，未重跑父来源13/旧全PG/Playwright/手机。文档一致性与限定源等价核验结果另存本目录。

首启动误将缓存 image ID 写作 registry digest，docker125/unexpected EOF，未创建容器/零业务断言；`container-first-diagnostic.log` 保留。实际核验缓存 image ID及端口空闲后直接用同缓存 image ID启动，没有借外来服务或更换产品依赖。

新 own CID `167a63776d324104f3009b337d33fb2102e93317e54432580bac0f56694bfac9`，/sg-wp27-inventory-pg@127.0.0.1:32878，--rm/label socialgrowth.fixture=wp27-restore-inventory/nohostmount，image93aa，唯一卷 `8fda298e1f9f7aa74f18eb74f3f4ea22ea7dcbdbb949b98457835f7ba53e95f8`，cluster `7691618540281544737`。每 reset/restore/新故障DDL及 finally 前全 CID/name/image/AutoRemove/端口/label/全实例卷独占核验；两个库 TCP DB/user/cluster 等 own 容器。不读外来 Config.Env/数据，不碰9000/nestar/原窗口资源。

测试 finally 清自身两个 schema 与新 external fixture，RLS role已删，dump/key按原9 finally 内存清零；收尾工具复制自己旧已执行工具到新路径，再 apply_patch 新 CID/卷/cluster及新增 external schema 检查，旧工具/日志不覆盖。最终 source/restore 各 schema（含external）/其他连接/deadlocks/临时role=0|0|0|0，全守卫后仅 stop 上述精确CID；容器/唯一卷消失，32878无 listener。合成两库删除不可恢复但固定测试可重建，源码/首红证据保留，无其他服务清理。

复现须全新 own 同名/label/独占32878 PG17双库归属，`SG_PRODUCT_TEST_INVENTORY_CONTAINER_ID=<新完整 own CID> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:database-inventory` 单次退出；禁止使用本已删除 CID/卷或抢占别人端口。复核方原继承 oracle 必须原样复验，仅路径/own资源适配；错误 SQLSTATE 组若修正须另存新源并保留旧22023首红，不由作者改其原证据。

## 独立批次与接续

cc41881 原 QA 完整报告 `artifacts/acceptance/product/B3/20261001T032458Z-wp16-pending-outbox-cc41881/acceptance-report.md` 已全文读取，SHA `7227ae9f4a4950a50b490063e796ecf971734ae394a97f98bc3bcd30d518ad24`；纯2/旧registry14/实际PG-Redis13/原独立12分别首次通过、新0/阶段remaining0/QA新增oracle0，有限双工程门禁。其原指纹/旧RED及aux pre-install缺pg日志不改，own e7dec2/3f7e56双资源/卷与快照已精确清理；不是Task准入/配额/真实Web或真机验收，cc旧URL问题以独立9f双清零证据另记，不回写cc固定源。

原 backup546 完整报告 SHA b1e7d56e604dfb051bb1aab026b7ceef9b725b5e9a6f212a6ad03a7f76afe3f2、日历a761完整报告 SHA ca482866b2421fbb72c474b57844ec56ea50e4686615e6eca7eaa4ebbfd7ead6 已全文读取；分别新0/remaining0，日历原P3同oracle清零。已向原 QA 顺序发送这两个**新固定**批次，严格8及日历原6/fix7并集7的原546限定基底；不重跑旧cc报告、不新建/改模式。它们不依赖本继承问题，可继续工程复验。

本整改形成固定凝聚提交后交回原非作者：先原继承 oracle 和新三个 PG 回归，清单阶段 P2 实际清零后再接续原 v2 第四批与此小整改的兼容组合；收到完整报告并全文读取后才提对应原 QA。不用作者12/414自签P2清零/合Developer。当前 **通过**仅作者整改检查；**失败**原P2及首三红保持历史；**阻断**清单等价/v2依赖签收及父/平台对应门禁；**未验证**非作者整改、生产恢复/真实Web/真机/全部开发/AC/G3。父WP10 pending1/Developeraf14/browser管理员/SEC及RES-WP27-01～03不变；真人/配置输入记录继续独立工程，不以平台拒绝为停止全部开发的理由。
