# WP-15 第十一阶段：运营素材只读客户端接线

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01最新原QA完整报告已全文读取：`artifacts/acceptance/product/B3/20261001T114003Z-wp15-read-client-7f08/acceptance-report.md` SHA82ca92b1bfdb8b8b106b4e0cf35a222edefacfc822e90d8f9394a0ee9e5a366e，原8/复用独立10/旧operator实际11首次通过、new0/remaining0、QA新oracle0，限定双工程闭合。1192允许blob/全实际旧Web/GET seam/121链接、来源41与旧269及QA旧282项指纹不变；own快照canonical XZfeOF/dev16777223/ino176709283/UID501精确清理，3构建产物保留。首静态120秒timeout/status=null未当通过，仅自有元数据wrapper延至300秒后实际exit0；unused repo一warning导致整套deny-warnings exit1、独立oracle三文件零诊断，cleanup早读ENOENT及来源App/styles/early evidence诊断保留，不改产品或历史RED。root439未由QA重跑。已向用户汇报并交同QA新固定保存49f；真实HTTP/UI/Playwright/手机/合法素材与准入仍阻断或未验，下方旧待QA为历史。

2026-10-01原非作者完整37行`artifacts/review/wp15-read-client-7f08.md`已全文读取/确认completed，SHA8f18ba10e4028cc2d6d608e74ec9ecf747abe70ea4339724c4afb9622e0dc130，new0/remaining0；原8/新独立10/旧operator11首过（自有日志名18实际11），root439未本窗口重跑。原旧正文及全Web树逐blob/1192允许blob/121链接/旧269指纹保持，自己的快照按身份精确清理；两误App/styles静态路径与cleanup早汇总ENOENT诊断保留，不改产品或首红。已交原QA固定c397→7f strict14，原非作者接保存49f strict12，不读未来票据/bytes；本客户端QA/真实Web-UI-手机/全部AC仍未签，下方此前待复核为历史。

2026-10-01；基线c397e6ca5864d5c8e560431ef1893a65ea24d6a7，feature/wp-15-material-read-client-stage11；WEB/BE实施代理Codex，原非作者/QA固定工程门禁，真人WEB/OPS/BIZ待签。[素材列表](WP-15-stage9.md)、[上传恢复列表](WP-15-stage10.md)、[质量手册](../quality-gates.md)。

## 范围与设计门禁

原材料设计图materials-batch-v1.png（实际1487×1058）、原21行materials-batch-prompt.txt、图稿索引及页面规格§4已读取/查看；浅色四项全局导航、项目内素材、人工资料与文件/资格/发布分离继续为后续页面真值。设计图6行/2候选/3待补/1失败/文件名/日期只是示例，不能预置业务状态。这里只有标准库File/Play图标，不需生成栅格asset，不生成虚构视频或头像；后续沿用已有Phosphor和字体/token，不新建独立prototype/锁文件。

Product Design index/image-to-code/get-context/user-context及所需critical/communication/preflight/design-qa已完整读；user-context预检无保存上下文，仓库当前规格为依据。当前root design-qa已有管理员策略校验不可用/暂停新UI实现，RES-WP14-03仍无解除证据；image-to-code/design-qa要求实际渲染/同状态对照，不能以源码/构建或旧截图过门禁。**暂停本阶段UI组件/页面/样式实现**，不换CLI/Chrome/模型/代理或再探受拒入口，改推进不受阻的只读HTTP客户端基础；不发已可用工作台或视觉完成交付。

本阶段新增运营Web内部GET读取：项目素材分页、单条资料、连续历史、上传票据分页；复用唯一same-origin Cookie/401-CSRF时序及strict共享schema，不公开token、不增加mutation/upload/download/发布/准入入口或权限。入参/路径UUID规范化，项目/对象对应、页面大小/游标进展与历史起点额外核对；异常只固定本地code、不泄露原响应/网络路径。真实页面搜索/筛选/编辑/批量保存/视频preview及Playwright均未实现/未验，不将此基础当完整素材业务交付。

计划：新只读方法→非法请求零fetch/严格响应及echo/历史连续/overscan/跨人项目错误关闭/401新会话保护/网络固定失败补充→根检查→记录原窗口完整结果与下一固定队列→阶段凝聚提交。仅单元fetch端口可用合成数据，按非UI补充分层，不能用Mock证明真实Web或业务通过；不需要启动服务或手机。首期真实页面待管理员恢复后按原图/prompt/规格和实际账号对象补验，人工责任/解除/补验见RES-WP14-03及原交付卡。

上段为开工计划。作者实际新8/8首次PASS，根439=59TS+33Python+317BE+4EX+26Web（新8已含根，非额外累加）；check/lint/test/build均exit0，env:check实际项目Node24.16.0/SQLite OK。证据`artifacts/acceptance/product/B3/wp15-stage11-author`，复现`pnpm --filter @socialgrowth/product-web exec tsx --test src/material-api.test.ts`以及根env/check/lint/test/build。没有启动服务/手机、执行真实HTTP/PG/浏览器或保存新UI截图；fetch stub严格属于非UI单元补充。原operator request/login/mutations/CSRF正文仅新增GET seam，既有backend/契约/迁移/依赖/页面及样式不改。

断言包括4个GET正确路径/大小写UUID/默认20与same-origin Cookie、非法输入零fetch、strict shape及项目/对象回显、overscan/游标不前进/历史起点与终点、verified_bytes两许可仍false、401仅清原会话不损较新CSRF、不自动重试、网络及非JSON失败固定错误。没有从合成声明推定素材权利/准入/任务或手机文件；此客户端不自动注册页面、不提供搜索/编辑/视频播放/上传。

原窗口结果已完整读取并汇报：WP27 stage4 QA完整63行报告SHA abee7a2a6a1b4d3f423a042f5d03a606337026fd5ff09787e02fcc015c5563f1，有限双工程new0/remaining0；stage5复核完整43行SHA 2c34628c82e59d5b0b94db770c58aa0972b14a50bc24bcf455ebb10dedd8c111，new0/remaining0，首port6PASS1FAIL错误save预期与更正单一预期后7PASS分开保留。已向原QA发送新固定525→4e18严格10，向原复核发送新固定4e18→c397严格10；不重发旧报告读取、不混本未提交客户端。详见[交接队列](B4-B5-review-queue-20261001.md)。

allowlist核验`verify.mjs/verification.log`实际确认原operator所有方法正文逐字基线（逆去唯一GET seam）、backend/契约/21迁移/依赖/原页面不变、3份原完整报告SHA保持、121本地文档链接存在与Developer af14不变；交付一致性passed。文档整包patch首标题匹配失败零文件落地，核对实际标题后重新准确补写，不是测试或产品失败。

四态：**通过**作者8/根439/静态；**失败**本批无测试首诊断或业务RED，其他批首红保持；**阻断**RES-WP14-03管理员真实浏览器/新UI设计门禁及素材真实资源/父来源/SEC各自范围；**未验证**本客户端非作者/QA、实际HTTP/页面/Playwright/Artemis/真机/全部素材AC与G3。后续先固定非作者复核与原QA工程复验；管理员恢复后WEB/QA按原图/prompt及真实账号对象实现页面并补真实操作/同尺寸视觉对照，BIZ/OPS提供真实素材来源权利及受控存储配置，不造签名/批准。默认自有服务/Samsung授权、父pending1/Developeraf14/SEC/保护脚本仅路径状态及原三模式不变；不因页面门禁停全部工程。
