# WP-10 第二阶段来源快照时序整改

当前原复验结果：完整53行限定报告artifacts/review/wp10-source-0d7ae82.md已读取，静态/240/184完成，原13独立反例和相关指纹未运行，未签原P3清零/G1。平台限制及实际真人输入/同窗补验条件见[复核补验记录](WP-10-review-blocker.md)。不以作者GREEN或后续共同预算208代签，Developer仍af14；以下保留固定整改作者交付事实。

2026-10-01；基线b60ad24，fix/wp-10-source-evidence-snapshot。EX/BE实施代理Codex，原非作者/原QA固定门禁；真实来源和生产上下文仍AND/EX/OPS负责，真人签收未落实。依据R-109/148～151、CT-05、AC14/15/59、[原阶段](WP-10-stage2.md)、[质量手册](../quality-gates.md)。整改只处理WP10-B60-01，不替代完整WP10或其他作者分支。

## 原问题与修复

原b60非作者79行完整报告已读取，remaining=1/P3、G1不通过。合法合成来源返回时已过期，但finally先abort，再clone；同步取消回调能在clone之前把时间改新，原独立真实PG反例实际提交receipt/audit。原13组日志保留12正常＋1 RED，不被作者覆盖。原窗口后来只整理已有证据完成报告；平台中断是否解除未验证，原probe lint及收尾hash/DB指标未完成，不能自行填GREEN。

调整为Promise.race返回winning对象后，在观察try内先structuredClone私有快照，再finally取消/清理。clone失败也安全SOURCE_UNAVAILABLE；仍保留3秒技术超时/AbortSignal、事务外观察、锁下当前身份核验与提交前DB微秒钟TTL检查，不提升来源权限/时间限额、不绕null默认关闭、不增加HTTP/Android/worker注册。同步取消回调仍执行，但只能改原对象，不能改已取得的私有事实。

新增一个PG组共6个入口/时序组合：begin/report/query各覆盖返回时过期→回调改新时间，以及返回时错scope→回调修scope。每次都核对callback实际执行、对应SOURCE_STALE/SOURCE_MISMATCH和原journal/receipt/audit全部不变。不是模拟成功/真实网络观察，不证明生产verifier或手机端点。三个入口新反例补齐原报告只实际report的覆盖。

## 作者检查及安全边界

证据artifacts/acceptance/product/B2/wp10-stage2-remediation-author。新组在旧b60源上先RED：18通过/1失败，Missing expected rejection，原日志endpoint-pg-red.log保留；修复后19/19通过，失败/取消/跳过0，不累计两轮。根check/lint/test/build/生成240/240（42TS17Python159BE4EX18Web），本分支没有未来维护代码/0016，不能冒用其他分支252/197。

原13组完整journal probe复制到本证据目录，仅替换自有root/DB环境guard，全文反向归一化对原件逐字相等；SHA256与验证结果保存，不改case、预期或RED判断，不称新oracle。原文件与报告不改。须全量PG退出/空schema后再运行副本，且当前分支构建已完成；不能从旧b60编译或工作区未来代码得到假GREEN。所有API/SQL仅合成工程夹具，非Playwright/观众/独立来源验收。

实际全量PG**184/184**＝原183＋新增1组，失败/取消/跳过0；随后确认schema/其他连接=0|0，串行重跑上述完整13组退出0、normal13/confirmed反例0、findings空。原组13名称保留RED历史标签，但判断实际为PASS；不另创oracle或将这些数加进184/240。probe lint退出0，实际source/dist及未改原证据指纹保留。原非作者P3清零仍需固定独立门禁，本段只作者结果。

授权的独立cached PG实际17.10，完整ID4e06ca92c74eab2329c8b7c7d5e75865da788cd19f3aa7ad91a7e55dd0e074d4，sg-wp10-source-copy-pg，回环32856/sg_copy；只有本轮合成可重建数据，其他nestar/Minio与窗口资源不触碰。无UI/手机/App或网络策略/公开发布/短信/外部账号操作；保护用户脏发布脚本只路径/状态，绝不读取/导出/使用候选凭据。复现`pnpm env:check`与根检查；明确新隔离DB并设`SG_PRODUCT_TEST_DATABASE_URL`/`SG_PRODUCT_TEST_ALLOW_RESET=1`后运行backend test:postgres或定向src/endpoint-report-journal.postgres-test.ts，不新增E2E替代Playwright。

收尾全部命令退出，schema/其他连接/deadlocks=0|0|0；精确ID/name/回环端口/AutoRemove/无宿主bind及匿名卷唯一所有者核验后仅停止自有4e06实例。容器与匿名卷fd43367…均已消失，after-stop日志0字节；只删除可按固定代码重建的合成夹具，全部日志/原RED/脚本/source和dist指纹保留，其他服务未操作。

原af14非作者和QA完整报告已读取0findings，Developer经祖先/工作树/旧tip CAS已605→af14；本整改及40a/91e维护作者阶段都未合Developer。原窗口模式/发送新阶段与读取报告方式、默认服务/已连接Samsung授权不变。需要人工/环境帮助的实际输入写RES-WP10-01～04，继续未受阻工程，不绕浏览器/平台限制；整改作者GREEN不自行清原P3或签G1。完整WP10/B2/AC/G3及全部开发仍未完成。
