# WP-15 第九阶段：认证项目素材列表

2026-10-01；基线02a030a，feature/wp-15-material-library-api-stage9。BE实施代理Codex；原非作者/QA固定门禁，WEB/OPS/BIZ/EX协作真人待签。[单项](WP-15-stage7.md)、[批量/历史](WP-15-stage8.md)、[质量手册](../quality-gates.md)。

领取当前operator/实际project的素材variant稳定ID分页，显式pageSize/default20/max50与同project cursor；每项仍完整历史核对后只返回必要current pending视图、false权限，语言variant同unit不新增名额。不按filename/hash猜身份、不提供全部项目已合格或总数默认、公开下载/提供者入口；只本页选中variant的历史校核，不将分页视图冒作全项目准入。ID升序仅稳定技术游标，不推定上传/发布时间或最终页面设计排序。

原三窗口模式、新固定发送及仅读原报告不重新发起；默认自有隔离服务/Samsung授权、人力/配置需求记录继续。浏览器管理员控制不绕过，父来源pending1/Developeraf14/保护脚本路径状态边界保持。没有新UI/手机/模型/发布；页面/规则准入/Task/实际资料及全部AC/G3仍未验，阶段凝聚提交后原门禁，不自报全部开发完成。

## 实现与页范围

新增`GET /api/operator/projects/:projectId/materials`，当前唯一完整operator Cookie读，无Bearer/CSRF替代身份。严格afterVariantId UUID/pageSize十进制（default20/max50，拒绝前零/重复query/额外字段），实际session→registry guard→project及最终DB钟单事务；cursor必须存在同project，未知/异项目409而非空结果。运营仍原同权，项目过滤不是成员权限隔离，也不凭owner限制或扩大其他角色。无设备提供者/公众下载入口。

UUID标准化后以DB UUID升序limit pageSize+1，响应50以内、正好有后页才last variant cursor，末尾/已到末尾empty/null。无上传/发布时序、业务准入排序或全项目资格保证；语言variant同unit在列表是两项技术版本，不创造内容名额。每个所选variant调用原load完整连续1～1000历史/immutable manifests校对，再controller只投影最小current declaration/ordered字节事实/time/pending/两许可false，无内部key/location/binding/actor/fullhistory。当前页某variant早期损坏500/无部分成功；另页未选variant不声称已校验或合格。

只DB IO、不持锁等待S3/浏览器/手机；配置关闭历史列表仍可用，不能用已有manifest/SHA/MIME或声明推定当前物理bytes仍存在、可解码/版权/可靠未发布/批准。页current同一DB-only事务读，append-only新variants对后页可见，非冻结跨请求快照；共享新query/response及Python递归pending/语义，必须同project、variant ID严格升序/唯一、cursor等最后项。旧86JSON/contractVersion逐项不变、新2、Android不变，内部save/read/load/实际auth/storage主体未改，只有独立list方法，无新迁移或派发许可。full histories本页最多50各1000的内部成本保留，不虚称DB只查50简短行或生产吞吐已验。

## 作者实际验证

证据`artifacts/acceptance/product/B3/wp15-stage9-author`。指定BE10/10＝旧core5/controller4＋新list1、共享TS5/Python5；旧registry store真实PG14/14与新真实AppModule/PG8/8分开，fail/cancelled/skipped0。新8全部首轮通过：已认证真实空项目empty200/未知project409；同project7行3/3/1分页、uppercase cursor标准化、排除foreign项目行/同权运营仍可显式读他项目；50lookahead/第51项/末尾；所选第12版minimal current/长fraction；缺Cookie/假Bearer/三后缀/重复/credential变化/停用/撤销精确401无登记写（读不需CSRF）；严格query/未知或foreign cursor400/409；当前所选历史第1版坏声明500、不泄marker，同时前一无关页仍有效而不声称全项目合格；真实material guard被占实际pg_stat_activity观察等待，session500ms到期后550ms释放锁、最后DB钟401/不返回迟到页。

新8只人工构造合成PENDING历史元数据/manifest用以验证历史reader/auth/过滤，不预置verified上传ticket/真实bytes/媒体准入/成功UI/发布。没有启动MinIO或SDK，无物理对象成功Mock；不能从fixture列表成功冒称真实上传登记链路，前阶段真实字节/登记证据仅复用其原scope。旧14同样非UI补充，PG8/14不拼Playwright/批次或全PG。

第一次有新PG文件的check TS2345因为新fixture不同header数组推导了authorization?:undefined，&&因此未运行该次unit/PG；仅明确Record<string,string>[]夹具类型后check/lint及上述指定、真实PG通过，正式认证/HTTP断言未放宽，check-second.log保留。最终root env/check:product/lint:product/test:product/build:product全exit0，产品371/371＝53TS＋27Python＋269BE＋4EX＋18Web；旧全PG256未重跑、无新UI/手机/模型/父来源13或发布。文档结构仅结构。

## 自有环境与后续分工

自有PG实际17.10 Alpine/缓存sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整CID7104549b2013c24dc5b35123c4a90fa41610de8d480308df3f77afa3ba6ddd23/sg-wp15-library-api-pg@127.0.0.1:32874/sg_library_api，唯一匿名卷7fc673af222b3efc44d4ce42517d73243e2a7f5036b508effcf1c7264300e1e3，--rm/无host mount/仅合成DB，容器cluster7691486633879752737。实际最后schema/其他连接/deadlocks=0|0|0、完整ID/name/image/端口/AutoRemove/卷独占核验后仅stop自身，after容器/卷各0字节；合成数据不可恢复但可重建，源码/首check失败/最终日志保留。原9000/nestar、原复核32873/32906及原QA32872/32905未动，无他窗口秘密读取。

复现必须明确自有32874/sg_library_api、reset1和实例归属，`test:material-library-postgres`单次后退出；旧14单独`tsx --test --test-concurrency=1 src/material-registry-store.postgres-test.ts`，根及指定如上述，不能指他窗口同名库/生产，不是新增项目独立E2E验收。

通过仅作者上述有限工程；首次fixture类型诊断保留；浏览器RES-WP14-03/SEC-WP14-01、父来源pending1与正式配置/合法资料/媒体/来源及批准依据仍阻断各自门禁；UI/规则准入/Task/手机文件准备及Artemis选取/发布、全局并发/总内存/吞吐/完整AC G3仍未验或未实现。WEB解除后按原批量/preview/bulk-dialog设计prompt/图片接真实页面与Playwright；OPS受控配置/最小权限/保留恢复/容量；BIZ人工关联/真实来源和批准边界，EX实际Task/文件到指定手机可用/正确选择。实名/签收不假造，缺人/配置记录继续后端可独立工程，不拿同权过滤当新增权限方案。
