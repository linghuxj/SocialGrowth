# WP-15 第十二阶段：原请求/原会话人工声明保存客户端

最新接续：原stage6完整50行`artifacts/review/wp27-capture-c397.md`已全文读取，SHA0f07c7359bb060deab567793ac3f0ab797dd05b80d2e128118905b3df699f45b，新0/remaining0/原3+原PG4+独立PG4首次过；独立最小1表不当66表、COMMIT code是UNAVAILABLE非新UNKNOWN枚举、只清转交Buffer view范围/provider拒绝前自清。33own/21author与旧215指纹保持，新746801 PG32880/2f870卷/cluster7691652632562597926三库归零后精确清理，旧首诊断保留。已向原QA发新固定4e→c397严格10，向原非作者发新固定c397→7f08c79严格14读取客户端；不重发旧读取、不混本未提交批。下方此前收尾为历史进度。

2026-10-01；基线7f08c79a44a360158fd5f8cfc3ff85e522823d14，feature/wp-15-material-save-client-stage12；WEB/BE实施代理Codex，原复核/QA固定工程门禁，BIZ/OPS/WEB/EX真人资源职责不变。[只读客户端](WP-15-stage11.md)、[现有单项API](WP-15-stage7.md)、[分工](../work-packages.md)、[质量手册](../quality-gates.md)。

依当前R-125人工输入，继续非UI单项声明保存接线，不在现有设计暂停期间新增页面/组件/样式。严格共享请求在构造时深解析、固定完整JSON/原requestId/原幂等键；闭包持有原CSRF会话、不暴露token，未登录/变更会话零fetch。每次send均显式授权的同一原请求，不自动重试/生成新key/新unit/换variant，不持久化本地声明/secret。

响应严格pending/two false/changed-replayed互斥，并对应原项目/unit/source/variant/人工identity与语言；非replay须expected版本推进及相同声明/对象顺序。原key replay合法返回更晚current，不能要求最新声明仍等于旧输入或误报本输入为当前事实；保存是登记pending，不是素材准入/文件可用/Task/发布。请求期间账号切换，迟到成功不交给新会话，记原请求未决，不凭客户端错误推定未提交。所有失败保留原请求，不能用HTTP码/retryable=false当未知写零副作用证明。

上述为实施范围。作者首10/根449/check-lint-build全PASS；自查进一步补POST seam只允许`/api/operator/`规范相对段路径（不允许绝对/协议相对/其他scope/穿越/百分号/query/fragment/backslash/空段）及新零fetch组。首10源码/日志/449结果另存，原10业务正文不改；最终11/根450=59TS+33Python+317BE+4EX+37Web/check-lint-build全部PASS、fail/skip0，新11含根不重复累加，env:check实际Node24.16.0/SQLite OK。没有真实HTTP/PG/服务/Playwright/手机/生产写，fetch stub仅非UI单元，不是素材保存验收。证据`artifacts/acceptance/product/B3/wp15-stage12-author`，复现`pnpm --filter @socialgrowth/product-web exec tsx --test src/material-save-api.test.ts`及根env/check/lint/test/build。

11组包括原输入深快照/未知响应后显式同key重试、严格非法零fetch、缺初始登录/切登录零fetch、全identity/project/source/variant/language及假许可关闭、新写/无变化版本声明及ordered objects对应、真实server规范化语义、更晚合法current的原key replay、400/409/500和坏成功仍保留原请求、迟到成功关闭/旧401不清较新会话、runtime私有字段不序列化及固定本地错误、CSRF路径范围零请求。不自动调用send，也不由客户端确认当前授权或从保存pending赋予准入/Task。会话CSRF仅本地意图约束、非服务端身份证明；真正Cookie/DB auth/CAS/字节核验仍原服务执行，页面刷新后的内存请求丢失/持久未决管理尚未接入，不能当完整恢复能力。

原QA WP27 stage5完整63行`artifacts/acceptance/product/B5/20261001T105718Z-wp27-file-fault-4e18/acceptance-report.md`已全文读取，SHA a2ffbfa552376d7aec49fff0aec9e91c767202857926bd3b77456d7b03817a4a，限定双new0/remaining0/QA新oracle0，原14/复用6/OS EACCES1/最终port7分别过，首port6PASS1FAIL和辅助历史34vs后来35计数诊断保留；39来源指纹不变，35新目录及snapshot按身份清理，不开服务/跑PG/根428或签业务。原非作者固定c397当前收尾，尚未凭进度签过；素材读取已凝聚7f08c79严格14，排其后固定新批，不混本未提交保存接线或重发旧读取。

allowlist核验verify.mjs实际证明所有旧operator方法/GET逐字7f、原10正文逐字首源、旧backend/契约/迁移/依赖/读取客户端及设计暂停门禁不变，4份原报告SHA保持/123本地链接与Developer af14核对；原报告新增后另核stage6 SHA并增为5份。交付一致性passed。无自有服务/文件fixture资源需清理，证据保留。

分工/门禁：WEB/BE代理实现非UI准备/发送；原非作者固定源码与时序风险，原QA单次工程复验后仍须管理员恢复真实入口，WEB/QA补真实页面/Playwright；BIZ合法声明/身份/来源，OPS受控存储/配置、EX实际Task与手机文件。人工真实输入/解除/补验继承原素材及RES-WP14-03，不假造姓名或签收。四态：**通过**作者11/根450/静态；**失败**本批无业务RED，首10与自查加固前状态保留、旧各批首红不动；**阻断**管理员新UI/真实Web、合法对象及批准输入/父来源/SEC各范围；**未验证**本固定非作者/QA、实际HTTP/页面/恢复持久化/准入/Task/手机/全AC-G3。父pending1/Developeraf14/保护脚本路径状态及默认服务Samsung授权保持，继续未受阻工程，不以交接为结束。
