# WP-15 第十五阶段：逐项原请求批量声明客户端

2026-10-01；基线947efef（包含已提交字节c8f4bb3与最新报告调度文档），分支feature/wp-15-material-batch-client-stage15。WP15/R-007/022～025/125，AC27～29仅人工资料保存接线子范围；主责BE/WEB实施代理Codex，原非作者复核与原QA固定工程门禁，BIZ/OPS/EX/WEB真人输入与业务补验待实际签署。[分工](../work-packages.md)、[质量手册](../quality-gates.md)、[已有批量API](WP-15-stage8.md)、[单项客户端](WP-15-stage12.md)。

## 范围及设计依据

已再次读取原materials-batch及materials-bulk-dialog完整提示词、图稿索引和页面规格§4，并查看原批量图1487×1058。保存范围不是勾选范围；应用草稿、逐项保存、准入、发布是不同事实。图中6项/候选数量/日期/文件和剧名仅示例，不能预置真实素材或成功。RES-WP14-03/根design-qa的新UI暂停门禁保持；本批只有非UI客户端，不创建页面/弹窗/样式/截图，不以源码或旧图签视觉通过。

连接现有`POST /api/operator/projects/:projectId/materials/batch`：wrapper只有trace，不生成batch幂等键、全批事务、任务或allSaved标志。每项原完整body/key/顺序保留，坏JSON声明项仍按原值发给后端独立校验；后端已提交项不因其他项失败回滚。构造零发送；每次send由调用者显式发同原包，没有自动拆批、重试、换key、去重/换unit或扩大保存范围。重复引用同原条目仍保留两个index，后端原key replay不当作新内容创建。

未知item不能依赖Zod unknown完成深克隆：先安全复制JSON数据，只接受有限JSON数字、普通/null原型对象和密集数组，拒绝undefined/NaN/Infinity/BigInt/function/symbol/循环/访问器/隐藏或symbol属性/自定义toJSON/非JSON对象，避免静默变null或执行getter/toJSON。共享引用可复制两份，不能误判为循环；保留未知项内容给服务器，不将所有item预先严格parse形成假整批原子拒绝。节点/数组长度预限102400，仅作为有界序列化技术保护，不是业务材料限制；递归/序列化异常固定INVALID不回显输入。实际JSON UTF-8正文最多100KiB，恰好102400字节可发、超1字节或多字节超量零fetch；此边界来自本地已安装body-parser2.3.0默认102400与现有Nest未覆盖的JSON parser，不称真实HTTP边界在本批重新验过，更不自动拆分。

响应使用原strict batch schema，额外核对原项目及精确item数量/序号；每个saved必须对应可严格解析的原单项并通过相同人工identity/语言/source/unit/variant、fresh版本/声明/有序对象或合法更晚current replay关联。invalid原项不能返回saved，假许可/秘密字段/缺项/错index/换identity关闭；rejected保留合法安全error和原index，无假全批成功。单项原校对逻辑只提取共用函数，其他正文不变，不改backend/契约/迁移/依赖或旧operator seam。

原CSRF会话在构造时捕获，缺初始登录/换会话零fetch，迟到成功不给新会话，旧401不清新CSRF。全响应HTTP/非JSON/协议/网络失败都保留所有原项未决，retryable=false或4xx不证明无提交；本批没有读取事实后自动确认commit或重建新请求，也不提供持久草稿。已解析逐项结果是服务端声明，不代替实际保存/素材权利/字节或准入事实。

## 实际作者工程验证

证据`artifacts/acceptance/product/B3/wp15-stage15-author`。原首8/根471=59TS+33Python+317BE+4EX+58Web全部通过；首lint exit0但新test一条no-unused-expressions warning如实保留。仅将短路赋值改显式if，原8全部断言不删，并新增第9重复原项/原key replay测试；first8-source.txt/unit-first/check-first/lint-first/test/build保留。最终9/根472=59TS+33Python+317BE+4EX+59Web通过，check/lint/build/env均exit0，最终lint零诊断。9已含根不额外累加，首与最终不计18/943套新覆盖。

复现：`pnpm --filter @socialgrowth/product-web exec tsx --test src/material-batch-api.test.ts`，根`pnpm env:check`、`pnpm check:product`、`pnpm lint:product`、`pnpm test:product`、`pnpm build:product`；交付一致性及明确allowlist静态核验另留日志。环境实证Node24.16.0/SQLite OK、pnpm8.14.0，未新增依赖或锁文件。合成fetch只是单元补充，无真实HTTP/账号/S3/业务数据库/浏览器/手机操作；本批未启动任何服务或创建需要清理的fixture，自己的源码日志保留。

实际`verify.mjs/verification.log`确认严格11路径、23个实际旧Web文件逐blob不变（单项save例外作完整等价逆提取）、旧operator/read/票据/bytes全不动、首8全部断言仅等价if可逆、11份完整报告SHA保持、123本地链接存在、3份本轮实际构建产物逐SHA等于dist、Developer af14不动。核验工具本身oxlint --deny-warnings exit0。batch source SHA360413a0728b60e80622ee5a57ca74788cb351d4e0a65a95d23aa7cf231767a2；test SHA2e061fb7fe234873d6885ad6662bfbc930cf0052608f9c17ed2f156b4252def2；等价单项helper SHA f7a4df69b7f6493772e5b514a711179eba570959d3d0e2c358245e0883506628。未将未提交用户保护脚本或artifacts/review加入允许清单，未按空diff声称不存在路径受测。

## 原窗口完整报告与接续

第12阶段QA完整报告`artifacts/acceptance/product/B3/20261001T120524Z-wp15-save-client-49f2/acceptance-report.md`已全文读取，SHA2600018cd7998d70487f20197bf22542b7cad0c592b3dd9758af263b1fe71362，原11/复用独立12/旧operator11+GET8首次过、new0/rem0、QA新oracle0，限定双工程闭合；1195允许blob/123链接/来源35、旧313及QA333指纹保持，own13工具零lint，快照0j2jfs/dev16777223/ino176850928/UID501精确清理。历史早读、作者first10/449及final11/450不改，QA未重跑根或真实保存。

第13阶段非作者完整报告`artifacts/review/wp15-ticket-client-430c.md`已全文读取，SHA30fcc6a7d6c540d4cc9b43a418dcfec215c889e001f56913dc8cc63360d714e6，原6/独立10/旧30首次过、new0/rem0；1198允许blob/20旧Web/106链接/旧363指纹保持，快照LiL4vs/dev16777223/ino176850512/UID501精确清理，无服务或业务对象操作。已向用户汇报并确认两窗完成后实际交同原QA49f→430 strict8票据复验、同原非作者430→c8f strict12字节复核；不重发已有报告读取、不混本批保存helper。

## 四态、真人需求及后续

- 通过：作者最终9/root472/环境/类型/lint/build、明确11路径静态/单项等价提取及原报告指纹；尚不能代非作者复核。
- 失败：本批产品测试0；首lint一warning保留并用等价if修复，不包装所有辅助动作零诊断；其他历史RED保留。
- 阻断：RES-WP14-03真实browser/新UI、父WP10 pending1/平台解除、SEC-WP14-01及真实资料/存储等各自范围，没有换入口绕限制。
- 未验证：本批独立门禁、真实HTTP逐项保存/失ACK/并发、页面保存范围和失败输入、Playwright/视觉、素材权利与准入、持久未决/Task/Artemis/手机文件/公开发布、全部ACG3与完整开发。

管理员环境维护方需提供策略服务恢复及解除证据；WEB/QA按原图/prompt/§4从真实页面核对保存范围、逐项反馈与并发/未知恢复。BIZ提供真实项目/人工身份/来源权利，OPS提供受控存储与合法对象/容量，EX提供已准入Task及指定手机文件条件；这些是角色职责，不伪造真人姓名、签名或批准。服务/Samsung默认授权持续但不能扩大为生产发布，保护用户发布脚本只PATH/STATUS。父pending1/Developeraf14不因较晚绿色或部分工程闭合消失。

阶段凝聚提交后，排在原字节复核之后交同非作者；清零再提原QA，真实资源解除后再补Web/手机业务，不把本基础接线当完整批量素材交付。当前线程heartbeat继续读取完整结果/汇报/整改及其他有需求依据的未阻断工程；发送交接不当全部目标完成。
