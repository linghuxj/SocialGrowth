# C3a Artemis 提交前会话编排（未生产接线）

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-02（Asia/Shanghai）。基线08c48f902c59bb9e03d588f08c29643420d80c54，主窗EX/BE实施。用户本次要求提交Git并盘点分支；本阶段仅凝聚已写会话编排及验证/交付状态，不扩为真实执行或公开发布。需求依据R-106/109及核心C3切片，原分批职责/范围见core-automation-loop.md。

## 本次交付

`product/executor/src/artemis-preflight-session.ts`及同名测试：严格中央publication Task、指定物理序列号、有序对象/sha/准备路径校对；不可变意图摘要、启动前现行guard→持久意图claim→再次guard；未知启动/trace绑定ACK不重启原尝试；poll仅能查询/请求停止与本意图绑定的trace。Artemis结构化调用明确Pro/strict、指定App，由模型视觉识别和自主决策，不写固定ADB点击或坐标脚本。

completed和模型report只是不可信观察，identity/trace/serial/结构不符保持unknown/human；`reported_ready`也始终publicationState=unverified、publicationAllowed=false。stop请求仅stop_unconfirmed，不伪装真实停止/未发布。未知错误不回显原RPC秘密。

构造默认端口null、main/worker未注册；没有凭据/环境读取或真实模型请求。工具、guard和journal接口**不是生产实现**；当前没有中央实时权威事实/holder/逐底层读取动作物理fence、持久PG journal、实际文件准备及独立证据解析。旧Demo READ_ACTIONS提前放行不符合新guard接口，提示词约束不能代替物理控制，严禁注入allow-all然后启动真机。

## 实际检查与证据

旧首8PASS日志保留在`artifacts/acceptance/product/B3/core-loop-stage3-author/unit-first.log`。本次同当前源码10PASS（包含新增并发重复启动和意图提交后撤权），exit0；`pnpm env:check`实际Node24.16.0/SQLite OK；product-executor check/lint/build均实际exit0。全`pnpm test:product`实际exit0，534=66TS契约+38Python+339BE+14EX+77Web。全产品测试源日志为该目录`tests-commit-check.log`，14EX包含本新10，不叠加次数。

命令：`pnpm --filter @socialgrowth/product-executor exec tsx --test src/artemis-preflight-session.test.ts`；同filter check/lint/build；根`pnpm test:product`。这些仅合成工具/内存journal的工程补充，不能证明真实持久事务、进程重建、物理许可、Artemis实际执行或Web闭环。没有新增服务/手机动作，不绕浏览器策略。

## 四态与下一步

- 通过：本阶段10单元、根534及上述静态/构建，仅作者工程；独立门禁尚未派发或签署。
- 失败：本新10无失败；另C1非作者C1-READ-01/P2及C1-DOC-01/P3仍未修，不用本534抹去原确定性RED。
- 阻断：真实Web/视觉仍因CUA/IAB安全校验服务不可用未准入；不是已证实管理员封禁、用户拒绝或产品403，不换CLI/Chrome/CDP绕过。恢复后原QA实际页面补验。
- 未验证/未实现：中央生产任务/实时许可、持久intent/trace、逐动作物理fence、文件准备MIME/内容绑定、独立evidence事实、真实模型/手机和完整C3。没有这些生产端口前保持默认关闭；接口旁注不当成完成实现。

下一步先落实C1固定整改和原窗口复验、C2a独立批次，再由EX/BE接真实Task/journal/当前权威许可与Artemis动作门禁，补真实持久并发/ACK/重建与撤权/在途行为；WEB/AI/BIZ按核心C2记录补准入、初始批准、真实获准模型、原子计划/Task/outbox。合成工具只能开发补充，原QA必须从真实Web发起→Artemis决定动作→人工介入/提交前回执验证。

真实短信、第二机与部署/观测/备份/更新回滚延期，不扩大成新专项阻断。真实配置/素材/账号需求按BIZ/AI/EX责任、解除条件及补验记录，继续可执行工程；不读历史凭据。最终发布未授权，不合Developer掩盖父pending。

## 原窗口最新报告（已全文读，非本C3门禁）

C1 fixed f3b1→6cb22d3 strict13：`artifacts/review/core-c1-6cb2.md`（SHAea7aefca591796649c7777de1a80ad404400a63927c6a300a64ac1ab6b633ece），非作者524PASS/1FAIL，新增P2/P3余2；cursor196/idle。`artifacts/acceptance/product/B3/20261001T184639Z-core-loop-c1-6cb2/acceptance-report.md`（SHA8770fa4e0eb409561f23695a8d85dd3c88c56c060abf9f477ee44ae3d7a0455c），QA520有限工程/真实Web视觉阻断，cursor93/idle。两窗结果不相加，QA不抵消非作者发现。原报告/首RED/元数据恢复例外保留，已有报告仅读。

本阶段提交不等于清C1问题、不签G1/G3；用户要求检查分支的只读结果见branch-audit-20261002.md，未删除/合并/推送分支。临时handoff文档仍是交接时快照，其“新增2项未跑”已被本次实际10PASS更新，后续以此记录和固定commit为准。
