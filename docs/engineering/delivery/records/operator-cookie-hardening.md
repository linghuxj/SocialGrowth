# 运营 Cookie 边界统一整改

2026-10-01；基线bf5c8cf，feature/operator-cookie-boundary-hardening。BE实施代理Codex，原非作者/QA固定门禁。[原配置/API](WP-15-stage5.md)、[局部整改及字节HTTP](WP-15-stage6.md)、[质量手册](../quality-gates.md)。

原1486完整报告artifacts/review/wp15-api-1486eaf.md全文已读：WP15-1486-01一P3/remaining1，独立8为7正常/1 RED（三case同问题），指定5BE/2TS/2Python/6联合不抵消。bf5作者局部修复未原窗清零，本切片进一步统一六类operator Cookie消费者，只接受一个完整43字符base64url值，不再split截断、选首个重复或合并array。格式收紧不改变身份/会话/CSRF/DB权限，不推断无凭据越权或扩展业务权限。

既有operator账号/邀请/设备事实、项目、规划草案、待办feed/notes及新material控制器统一helper；正常Cookie与HTTP响应Cookie属性保持。纯解析/六类controller路由转发及实际AppModule＋自有PG认证回归，不是浏览器登录验收，且不读原用户发布脚本/外部凭据。原Cookie RED不改业务断言，bf5新PUT路由合法新增不能将原8的“PUT不存在”整体冒称guard-only GREEN，原Cookie第3组必须精确复验、其他兼容检查说明范围。

默认隔离服务/已连接Samsung授权持续；人力/正式配置/浏览器/父来源pending1记录继续安全编码。原三窗口/模式/固定门禁不变，Developeraf14不因本作者修复快进；正常服务和实际资料/设备/发布权限不扩展。阶段凝聚提交后同原非作者复验，再原QA，不自签原P3/全站生产安全或全部开发完成。

## 实现与作者证据

统一`operatorSessionTokenFrom`供六类控制器使用：仅单string头、拒绝CR/LF/NUL和同名重复；只trim HTTP SP/HTAB，不Unicode trim/解码/合并数组，保留首个等号之后完整值，再精确43字符base64url。正常无关Cookie含等号及普通OWS保持；响应Cookie属性、auth/session/CSRF/SQL和业务权限未改。旧operator两个纯转发fixture原短token本不符合实际auth，改为明确合成43字符并保留路径覆盖、CSRF、请求/equality断言，不放宽parser接受短凭据。

证据`artifacts/acceptance/product/B1/operator-cookie-hardening-author`。新unit2/2：完整语法反例及六类controller精确转发；新实际AppModule/PG3/3：八GET正常结果含pending票据历史/未知notes409，三后缀和重复名精确401/AUTHENTICATION_REQUIRED且零写，真实项目写入/原key重放正常而畸形Cookie不能读旧成功或写草案。数据库认证夹具仅非UI，未预置verified/准入/发布成功；不替代Playwright登录或真机验收。

最终`pnpm env:check`、`pnpm check:product`、`pnpm lint:product`、`pnpm test:product`、`pnpm build:product`全部exit0；产品356/356＝48TS＋22Python＋264BE＋4EX＋18Web。全PG256/256＝旧253＋新3，fail/cancelled/skipped0；新3已含全PG，不重复加总。旧契约/Android生成无变更。首次check两次TS2339来自新fixture猜错controller方法名，依据真实`list()`修正；首次新PG1过2失败42P01来自计数helper猜错表名，改成实际project_metadata_commands及完整规划计数，正式SQL未改；首次全产品BE262过2失败为上述旧短tokenfixture；重跑成功不删除首次诊断。一次误用不存在的根check命令exit1后改用实际check:product，未执行后续legacy test/E2E。所有失败日志保留。

## 自有环境、清理与下一门禁

8c2固定16文件原非作者60行与原QA完整73行`artifacts/acceptance/product/B1/20260930T235359Z-operator-cookie-8c2bc97/acceptance-report.md`均已全文读取：有限新增/remaining0，双方指定7unit/新3真实AppModulePG及原7独立；原非作者新oracle、QA仅guard-only复跑新oracle0。65536UTF16为一个组内case，真假转发/认证分层；14表hash/邀请/原key/真实logout覆盖。不认领作者356/256、bf513或父来源13。QA实际PG17.11 Debian/复核17.10 Alpine分别保留，两方完整cluster归属/自身清理0|0|0；首lint/manifest/QA守卫SQL引号及cwd诊断保留。可仅记本增量G1，不外推全站或父来源清零；Developeraf14不动。下文作者“待原QA”是固定8c2形成时状态，以本接续原完整报告为准。

pnpm8.14.0/项目Node24.16.0实际路径及SQLite OK；作者Python3.11.7与原窗口3.12分开。PG实际17.10 Alpine/缓存镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整CID ae58417120ff8c7c5ef29a2ab400dbd6970af30302095dba53df5f21ff395bf0/sg-operator-cookie-pg，回环32871/sg_cookie_fixture，唯一匿名卷996e0a01051d86079c9510c84712d107d48d83cbcb3e95fe98a5667f37b46122，无host挂载。最终schema/其他连接/deadlocks=0|0|0；完整ID/name/image/端口/AutoRemove/唯一卷归属核验后stop及rm-v仅本fixture，after容器/卷文件为空。合成数据不可恢复但可重建；原服务、原9000、复核自身32870/32904未动，源码/日志保留。复现新PG脚本必须确切127.0.0.1:32871/sg_cookie_fixture及ALLOW_RESET=1，先独立核验实例归属；运行后退出/清理自身。

原bf5完整74行报告`artifacts/review/wp15-byte-bf5c8cf.md`已读取：局部WP15-1486-01同窗实际清零、新增/remaining0，指定12BE/3TS/3Python/13联合、原1～7 guard-only及新9通过；仅bf5material控制器，不包含本统一helper。原8第8的裸object PUT404事实上仍可通过，但旧组名“无bytes routes”不再准确；新第9组单独验证`/bytes`200及仍未实现路由404，不能把8整体记当前bytes覆盖。原窗口首次筛选意外跑8、首次自有lint警告及仅变量命名修正均按报告保留，不改原RED。原QA组合复验与本切片独立复核仍需固定提交；原父pending1/Developeraf14/浏览器管理员限制保持。下一可独立工程为素材登记API，真实配置/媒体/真人批准、页面、Task、手机及全AC/G3仍未验，不报全站生产安全或全部开发完成。
