# WP-17 第二阶段：缺省关闭的业务模型协调

2026-10-01；基线a6e239a，feature/wp-17-model-coordinator-stage2。AI/BE代理Codex，原非作者/原QA固定增量门禁；AI/TL/BIZ模型与脱敏业务输入、BE真实事实与任务生效、WEB真实页面职责按[第一阶段](WP-17.md)及[质量手册](../quality-gates.md)，真人未签。依据R-016～018/072/073/095/125、CT-09、AC-32，仍非真实AI闭环或可执行任务服务。

## 协调流程与真实未接线部分

BusinessModelCoordinator须显式配置facts reader、model port、服务/model版本标签和技术deadline，缺任一项在读事实/请求模型之前返回configuration_missing。无生产reader、HTTP模型adapter、Nest/worker/队列、凭据或付费供应商默认；没有从环境/用户脏脚本发现密钥，没有发真实模型请求。配置标签、attemptId、modelRequested和responseId是内部关联，不独立证明供应商网络调用或已计费；实际证据仍须RES-WP17-01落实。

未来可信reader给完整校验过的project/fact-set/批准/任务/素材/名额上下文及有限文本事实引用；上下文校验复用第一阶段，抽出parseBusinessSuggestionContext，旧名额/时间函数体不改。描述须对应factId/version，拒绝重复/跨项目/不完整注册；私有输入先校验并复制，给model port另一个副本，模型不能通过改入参伪造第二次读取。文字字段不能保证没有秘密，生产reader必须先授权和脱敏，禁止把密码/验证码/令牌或未经允许真实资料发入模型，不能仅凭schema证明已脱敏。

model port只有结构化JSON文本与adapter responseId返回。响应按字符与UTF8字节双限262144检查并解析，strict业务建议检查继续；原输出/异常/cause不返回或普通日志回显，坏JSON、额外控制字段、超长文本和服务失败分别拒绝/不可用。无模板、旧成功缓存或fallback，失败不伪造本次建议，也不暂停无关既有有效任务。

完整first-read→model→final-read共享配置技术deadline（1～30000ms，仅内部技术界限，不修改恢复额度）。AbortSignal传每个port，finally取消/清timer；同时用进程单调时钟在每段前后及形成结果前检查，事件循环被阻塞不能靠延迟timer获得晚成功。超时后结果固定不可用，迟到模型输出不触发最终读取/任务生效。取消请求不是供应商实际停止/免计费证明；未来adapter要落实并发、成本、取消能力和持久请求接续。

模型响应后必须再次读取当前事实，在**最后一次await之后**取服务钟检查计划仍未过期。除了可前进的观测时刻外，整个引用/批准/状态/素材/任务/名额/事实文本须对应原私有snapshot；任何变化拒绝，不只看版本号或沿用旧context。时钟每次非倒退，观测不可倒退或来自未来。最后检查仍仅输出checked_advisory及待检查项，之后任务生效时必须事务内再次校验；本模块没有替代该原子步骤或发动作许可。

作者补查加固第一阶段缺口：新schedule即使task不在当前任务投影中，也不能把quota已有同task的reserved/unknown/published_verified精确重放当新候选；reserveContentQuota.changed=false拒绝QUOTA_CONFLICT，旧名额模块本身不改。新增一组覆盖3状态及输入不变。原固定a6非作者仍按原源码出报告，该作者修复不自签原 findings 清零。

## 作者验证

证据artifacts/acceptance/product/B3/wp17-stage2-author。首次类型/lint及原16＋新15协调**31/31**通过；补最后await后时钟、逐次时钟非倒退两组后根285通过；单调deadline CPU迟到组后根286通过；已有slot新排期补组后最终根check/lint/test/build/生成**287/287**＝42TS17Python206BE4EX18Web，新模块18组＋边界17组共35定向范围，失败/取消/跳过0。不相加多轮或把注入结果当真实模型调用。

18协调组实际覆盖缺省关闭0调用、正确port/内部provenance/非许可、私有副本隔离、服务/事实/时钟失败不泄漏/无兜底、描述版本与缺数据、JSON/envelope/UTF8限制、模型不能改批准/成功/暂停、等待期间当前事实变化、仅观测时刻前进、三阶段技术超时和迟到结果、旧成功不兜底、最终await后过期、逐次时钟倒退、事件循环30ms合成CPU延迟不能越15ms技术deadline。没有真正模型网络、数据库、手机/Artemis、公开发布或新Web测试，不能替代Playwright业务验收。

复现根`pnpm env:check`和`pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product`；定向`pnpm --filter @socialgrowth/product-backend exec tsx --test src/business-suggestion-core.test.ts src/business-model-coordinator.test.ts`。不启动服务或触碰原手机/其他窗口资源，不新增独立E2E。日志保留各固定源码检查过程，不把较早285/286冒称最终287。

## 门禁与接续

2026-10-01新状态：a6原58行报告完整读取1P3；c347同窗完整52行与原QA完整报告（20260930T202414Z-wp17-coordinator-c347d28）均已读取，WP17-A6-01实际清零/新增0/remaining0，双方指定35＋原6＋原窗口独立10通过。原QA10为guard-only新环境复跑不是新oracle，未重跑作者根287。原第7组characterization/RED保留，不报旧7GREEN；此有限增量双通过仍不清父来源pending1或签父链Developer G1/真实模型/Task生效。以下为当时交接历史，不把旧“待读/待门禁”当当前结论。

原40a纯预算55/82行双有限增量通过，原91e复核/QA102行完整已读取增量0；df700原复核66行0已读交QA。父来源P3及平台补验仍pending1，Developer保持af14，不能快进本未放行链。原a6第一阶段固定非作者已确认上述同task旧slot误标新安排一问题，独立7组6正常＋1RED，完整报告待读；其RED包含接受旧行为的characterization，不能原样跑新代码后冒称7GREEN。原脚本/RED不改，后续同窗以正常拒绝3状态及旧6组继续核对；作者287不自签原问题清零，本阶段待固定门禁。

RES-WP17-01模型供应商/真实版本/接口及受控凭据、费用和真实资料发送授权仍未落实；RES-WP17-02当前事实、素材/Task producer、事实性/频率/引流/观察判据、持久模型请求记录/原子安排修订仍未实现。缺口记录后继续独立工程，下一可做部分为请求/建议/校验结果持久关联或项目/素材更正的安全任务决策，不用注入夹具或模板宣称模型服务接入完成。WEB仍受管理员浏览器限制；原窗口模式/发送新任务与读取已有报告方式及默认隔离服务/Samsung授权不变，全部开发/完整WP17/AC/G3未完成。
