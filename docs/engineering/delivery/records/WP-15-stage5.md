# WP-15 第五阶段：受控存储运行时与认证票据 API

2026-10-01；基线be02bd7，feature/wp-15-authenticated-material-api-stage5。BE/OPS实施代理Codex；原非作者/QA，WEB/EX/BIZ真人待签。[上传票据](WP-15-stage4.md)、[质量手册](../quality-gates.md)，R-007/022～025/125、AC27～29。

领取显式server-only存储配置/生命周期、真实operator Cookie＋CSRF的prepare及当前票据read、最小TS/JSON/Python契约和AppModule接线；不将生产配置缺口伪造为已配置。业务请求不提供endpoint/bucket/key/secret/location或verified状态，响应不返内部descriptor定位；未配置写入关闭、历史只读单独区分。字节HTTP传输及完整素材登记HTTP是下一切片，不用此阶段宣称已跑通上传页面。

默认允许启动自有隔离服务/已连接Samsung联调；但当前无新增手机消费者，浏览器RES-WP14-03仍未解除，不换工具入口。原正式存储/真实素材/批准/媒体核验/Task/手机缺口依WP15资源清单，配置和真人工作记录后继续独立代码；父来源pending1、Developeraf14以及保护用户发布脚本限制不变。阶段凝聚提交→原非作者→原QA，不作者签准入/公开发布或全部开发完成。

## 实现与可用接口

MaterialRuntime在真实AppModule注入Pool/auth，显式读SG_PRODUCT_MATERIAL_MODE；默认unavailable不构造SDK，且有任何已知material配置但未configured则安全报错，不静默解释为成功。configured要求LOCATION_ID、ENDPOINT、REGION、BUCKET、FORCE_PATH_STYLE(true/false)、ACCESS_KEY、SECRET_KEY、MAX_OBJECT_BYTES(1～134217728十进制)、REQUEST_TIMEOUT_MS(1～300000十进制)，可显式SESSION_TOKEN。所有键前缀SG_PRODUCT_MATERIAL_，无默认location/凭据/AWS profile/metadata链，不发现现有桶或自动创建真实存储。endpoint只能HTTPS origin或回环HTTP且无用户名/路径/query/hash；server配置不从业务输入取得。parse错误固定CONFIGURATION_REQUIRED、不回显值。Runtime持有private fields、JSON为{}，shutdown只关闭自有SDK，由原DatabaseLifecycle关闭pool。

配置后内部uploads和registry真正使用同受控storage及已持久票据resolver；这只是server接线，不是素材准入。`POST /api/operator/projects/:projectId/material-uploads`用Host operator Cookie＋CSRF、严格共享prepare contract、path/body同project；同key/同对象描述不可换原ID/绑定。`GET .../material-uploads/:objectId`以当前operator读同项目当前历史、final DB钟校验，默认无存储时历史read仍可用但不重新证明物理bytes。重复session cookie或畸形token不选第一个冒充可信。GET/POST均no-store，无provider/installation bearer替代、无caller actor/status/location。不存在byte PUT/GET下载、列表、素材登记HTTP、UI或手机路由，不能拿内部upload辅助调用称HTTP上传通过。

新增3严格TS/JSON契约＋Python消费语义，旧74 schemas及contractVersion逐项完全不变，Android两个生成文件不变。prepare DTO为唯一共享源，内部仅额外规范化UUID；opaque server descriptor只内部使用。响应只返回project/object、SHA/长度/声明MIME、pending_bytes或verified_bytes、prepare/verify时间、两个false业务许可；prepare再带changed/replayed，不返location/binding/key/endpoint/桶/credential或操作人字段。严格校验0001～9999及精确fraction/offset、状态与nullable时间一致、verify不得早于prepare，changed/replayed不得同时true；损坏server result报安全500而不是归罪caller400。verified_bytes仍非可解码成品/版权/未发布/批准或Task事实。

## 作者实际验证与历史失败

证据`artifacts/acceptance/product/B3/wp15-stage5-author`。初次generate/check/lint及5新BE unit通过；第二check TS2345仅新fixture headers联合推导含undefined，未启动该次HTTP检查，改为明确Record数组，不改正式认证。首次真实6组中5通过/1失败23514（合成撤销遗漏revoked_reason违反既有约束）；补原logout原因后第二次5通过/1失败（新fixture错误期待禁用operator403）。读取未改原authenticateSessionInTransaction确认其既有设计统一AUTHENTICATION_REQUIRED/401；仅修fixture期待为精确401＋原错误code并增加disabled零写断言，未修改认证/SQL约束、未放宽成任意4xx。两次真实失败及check失败保留。

最终真实AppModule＋自有PG/MinIO **6/6**，末次共享DTO接线后再次6/6，fail/cancelled/skipped0：实际Cookie/CSRF prepare与GET/旧key当前/最小字段；禁止caller秘密/成功状态/假actor/path/version；缺Cookie/重复Cookie/假Bearer/错CSRF/真实撤销/停用都关闭；actual AppModule无配置下仍读历史且新写503/0新增；真实双并发仅一次ticket/audit、key/descriptor/project冲突；内部真实条件上传后HTTP读verified历史及管理员合成manifest损坏安全500。不是浏览器登录/字节上传HTTP/实际素材页面验收。合成认证预置只供非UI工程补充，不绕过待验收Web。

最终环境/根check/lint/test/build通过，产品**347/347**＝47TS＋21Python＋257BE＋4EX＋18Web；全PG **253/253**失败/取消/跳过0，与新6联合单独计数。指定新BE5，末次加旧upload core2共7/7；共享TS2/Python2含在根347。旧74 JSON不变的机器校验在contract-preservation.log，生成检查随build通过；文档check_consistency仅结构不证业务。没有运行Playwright/手机/公开发布或父来源13，不认领原窗口结果。

## 资源与接续

后续be02..bf5配置与bytes整改组合已获原QA完整70行报告有限增量通过、局部P3双清零，详情[阶段六原报告接续](WP-15-stage6.md)。非真实存储/页面/媒体准入或父来源解除；本1486历史RED及原固定未通过状态保持，不将新结果改写旧tip。

原非作者固定1486完整报告`artifacts/review/wp15-api-1486eaf.md`已全文读取：WP15-1486-01一P3/remaining1，完整Cookie带等号后缀被截断，需真实有效前缀及CSRF，非无凭据越权；指定检查通过但独立8为7正常/1 RED，原结果保留。后续bf5固定局部整改完整74行报告`artifacts/review/wp15-byte-bf5c8cf.md`已读，原第3组业务断言逐字不改，三case POST/GET401及零写实际清零、新增0；原QA当前配置/API＋bytes整改组合仍需复验。其余旧运营消费者统一见[Cookie切片](operator-cookie-hardening.md)，不将bf5局部清零外推全站或父来源门禁。

自有PG实际17.10 Alpine/镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整ID82dca9a0985c485f832c525679b08fd4b24c33fd1f0dfd2e21df6ebc542b8973/sg-wp15-api-pg，回环32869/sg_upload_api，唯一匿名卷51d06b17f55e08796999914dca6d2d0d83dba188352b853fcd540b58db5dde9f。MinIO实际RELEASE.2025-09-07T16-13-09Z/commit07c3a429，镜像sha256:69b2ec208575b69597784255eec6fa6a2985ee9e1a47f4411a51f7f5fdd193a9，完整ID83c7e42be67d197a720098c31f20f03acdc7503485ea37a3901c961e59ebbb80/sg-wp15-api-storage，回环32903，唯一匿名卷16d7f9592bade9054d0d21ca07c108d54386c15694bd0631fcb396d58f7ff6c7。仅显式合成私有随机桶/bytes、无宿主挂载；其他实例/原9000秘密未读。最后schema/其他连接/deadlocks=0|0|0、完整CID/挂载/卷独占核验后仅停止并移除本两容器/匿名卷，after两文件0字节；合成数据不可恢复但按脚本可重建，源码/失败及最终日志保留。

复现根env/check/lint/test/build；新指定unit `tsx --test src/material-runtime.test.ts src/material-upload.controller.test.ts`；明确专用reset URL全`test:postgres`；`pnpm --filter @socialgrowth/product-backend test:material-api-storage`必须自有127.0.0.1/sg_upload_api＋ALLOW_RESET=1、32903＋ISOLATED=1/显式合成credentials，运行前另核验完整服务归属（现SQL守卫不单独断言端口）；不能指生产/外国同名库。测试真实AppModule监听自有临时loopback端口并退出，非替代Playwright的另套项目验收。

通过为上述作者有限工程；历史失败明确保留；正式location/最小权限凭据/保留恢复、真实声明/批准/素材及浏览器为人工/环境阻断；真实HTTP字节流/登记/页面/手机/Task/准入/发布/全AC仍未实现或未验证。OPS须受保护部署上述真实配置并给最小权限/回收恢复证明，BIZ给原身份/资料与既有批准边界，WEB管理员解除后按原设计prompt/图实现并真实Playwright操作，EX给原Task文件准备/正确选取及Artemis证据；职责非真人签收。下一独立BE切片为受认证、受大小/时限限制的HTTP bytes传送，再接明确素材登记API，不因配置/真人缺口停独立编码、不越权外发。
