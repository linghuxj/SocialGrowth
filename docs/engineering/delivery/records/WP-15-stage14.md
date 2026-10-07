# WP-15 第十四阶段：原字节/原键/原会话上传客户端

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01原非作者`artifacts/review/wp15-bytes-client-c8f4.md`完整报告已全文读，SHA8dc7ac70c076468a7a90fb425d6283b7600b3f41f116fd28e9e72b76b12bc899，原7/新独立12/旧36共55首次业务通过/new0-rem0；strict12/1201blob/21旧Web及完整operator逆提取/130links/402旧+11reports保持。独立helper首TS7060泛型仅另存<T,>修复，完整逆向还原原断言，原源和首diagnostic保留；快照Da7BBs/dev16777223/ino177060046/UID501精确gone。

原QA`artifacts/acceptance/product/B3/20261001T132641Z-wp15-bytes-client-c8f4/acceptance-report.md`完整报告已全文读，SHA663f275255dbc1f5ad64ec7464a969fed7b8032e18038ef2f0d22c0c23c22759；原7/复用12/旧36同55首过/new0-rem0/QA新oracle0，限定双工程0。prepare实际退出0后install，10辅助工具全文路径适配、driver仅输入final路径，source120秒wrapper原样未执行/active300在首执行前设置；15 own helper lint0/3实际dist对照，source49及402旧+11reports/先前QA434不变。snapshot sYJtcT/dev16777223/ino177137071/UID501精确gone，无服务；旧stage13辅助偏差没有被这批修复后的顺序抹掉。两窗报告已向用户汇报，均无真实HTTP/S3/Browser/File/手机操作或全AC签收；非作者已完成后续批量复核，原QA已接批量新固定，已有报告不重发。

2026-10-01；基线430c56544b8d30a1db87d05e11dc30ee8eb833d5，feature/wp-15-material-bytes-client-stage14；WEB/BE代理Codex，原非作者/QA固定门禁，OPS/BIZ/EX真人资源职责保持。[票据客户端](WP-15-stage13.md)、[原HTTP边界](WP-15-stage6.md)、[质量手册](../quality-gates.md)。

非UI原字节PUT接线：严格ticket+upload command、同project/object及实际byteLength/现有16MiB技术上限；同步复制bytes/解析完整metadata/捕获原CSRF会话，在任何hash await前固定。Web Crypto SHA256实际核对本地副本与ticket声明，不相等零网络；缺secure context/subtle固定UNAVAILABLE而不跳hash。Blob是固定副本，每次显式send相同对象/原完整metadata/幂等键及bytes；无自动重试、换key/对象或认证切换，未知保存原包。purpose-specific route只从严格UUID命令构造，无外部URL/header/公开ACL/存储locator，唯一same-origin Cookie与CSRF/旧401时序。

真正HTTP响应必须strict verified_bytes/时间一致/两个false/changed-replayed互斥并完整descriptor回显；它只是服务声明的字节验证结果，不是实际媒体解码/版权/可靠未发布/已批准Task或phone存在。所有auth/当前绑定/实际SDK完整核验仍既有服务端决定，原票据即使verified也不跳过服务或自动复发。请求期间换登录的迟到结果不交新会话；不能从本地错误断言服务器未提交。

内存保留意图用于显式原包接续，不持久缓存、本地File picker/进度UI、分片/流式/断点续传/自动释放或memory zeroization声明；16MiB多份副本是已有限技术实现，不宣称生产内存/吞吐通过。原设计/管理员门禁暂停新UI保持，真实页面/Playwright与真机不可被单位fetch端口替代。

HTTP trace requestId/幂等键必须无首尾空白的可见ASCII（内部可含普通空格），避免Fetch header ByteString限制/规范化改变原键；CRLF/控制/非ASCII客户端固定INVALID、零请求，不改共享JSON键格式或后端已有规则。这个PUT传输护栏不意味着所有JSON请求必须ASCII。content-length由浏览器决定、不手填，不发content-encoding，底层服务仍实际核对长度/hash。

作者实际新7/7及root463=59TS+33Python+317BE+4EX+50Web全部首次PASS/skip0，check/lint/test/build/env exit0，实际项目Node24.16.0/SQLite OK；7已含根不重复加。证据`artifacts/acceptance/product/B3/wp15-stage14-author`，复现`pnpm --filter @socialgrowth/product-web exec tsx --test src/material-bytes-api.test.ts`及根env/check/lint/test/build。actual Web Crypto SHA256在Node24.16运行，native Blob读取完整[1,2,3]真实小view（非整个带边界backing），caller在构造后修改bytes/metadata/ticket不影响原请求；首次网络未知显式重试仍同body/key，无自动请求。其他覆盖非法/16MiB超限/错实际hash零fetch、purpose-only路径/HTTP头规范保护、全部descriptor/两许可/状态/私有字段关闭、async hash等待切会话零发送、迟到成功不交新会话/合法verified原key重放、原ProductApiError和raw transport只固定失败。

这些是fetch端口补充，**没有实际HTTP PUT、服务、S3对象、Browser secure context、真实File/页面/Playwright/手机或生产写**；shared/current GET/原POST/body与所有backend/契约/21SQL/依赖未改。原阶段作者helper含App.tsx/styles.css的非实际路径（实际app.tsx/style.css），其旧证据不改；本批强化为遍历基线所有旧Web文件逐blob完整验证并证明operator仅新增schema import/专用PUT seam，其余原正文逐字，不用不存在路径的diff exit0作证明。

原窗口完整结果：素材读取原复核37行`artifacts/review/wp15-read-client-7f08.md` SHA8f18ba10e4028cc2d6d608e74ec9ecf747abe70ea4339724c4afb9622e0dc130已全文读/确认completed/new0/rem0，原8+独立10+旧operator11首过（日志命名18实为11），自有App/styles路径两误与cleanup早汇总ENOENT诊断保留，仅固定静态helper纠正，269旧指纹保持/自己的snapshot精确清理。采集原QA完整57行`artifacts/acceptance/product/B5/20261001T111918Z-wp27-capture-c397/acceptance-report.md` SHA42f0cf18f951f2a4a5d3093f0c6fcc6ec13a485dc12a1a243755706759f603d8全文读/confirmed完成/限定双new0/rem0/QA新oracle0，原unit3初次及导出结束后同正文3重跑不重复计，两实际PG4首过；取证顺序/helper三处旧路径/动态status首假设及来源unused show的own整目录deny-warnings警告保留，不称全辅助首次绿。37来源与旧215/本QA217指纹保持，new own ceb58 PG32881/62ff卷/cluster7691658486722490406三库0|0|0|0与两文件/snapshot精确清理。

完整结束后已向原QA发新固定c397→7f读取strict14、同原非作者新固定7f→49f保存strict12，不混430/本未来字节，不重发旧读取/不改模式。保存49f/票据430已凝聚，本批准备提交后按顺序原门禁；主窗口继续无依赖实现、主动全文读取汇报，不在交接停点。真人WEB/QA管理员恢复后真实页面/视觉对照及实际上传，OPS受控配置/容量，BIZ真实合法字节及身份来源，EX实际已准入Task/指定手机文件/Artemis选择；实名/签收不假造，输入/解除/补验沿用原卡及RES-WP14-03。

当前verify.mjs/verification.log实际核：除新增seam外21个基线旧Web文件逐blob不改，operator逆去唯一schema import/PUT接线逐字原文，backend/契约/迁移/依赖与设计暂停记录不改、7份原完整报告SHA保持/130本地链接存在/Developer af14不变/一致性passed。未借不存在文件路径作证明。无自有service/业务fixture需清理，所有源码日志保留。

四态：**通过**作者7/root463/静态；**失败**本批无测试/业务RED，所有旧首诊断与SHA保持；**阻断**管理员新UI与真实Web/真实存储素材资源/父来源/SEC各范围；**未验证**本固定非作者/QA、真实browser crypto/HTTP/S3/媒体/准入/Task/文件到手机/完整上传链路或全部AC-G3。内存意图刷新后丢失/未知持久接续仍未交付。父pending1/Developeraf14/保护脚本仅路径状态及默认自有服务Samsung授权不变。
