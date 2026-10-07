# WP-16 通知配置 P2 整改

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01；基线ccc4707980841e4640731264a1d0af412ab5d893；fix/wp-16-queue-config-redaction；BE实施代理Codex，原非作者与原QA门禁，OPS实际签收待定。[原通知阶段](WP-16-stage4.md)、[质量手册](../quality-gates.md)、[原完整报告](../../../../artifacts/review/wp16-recheck-queue-145c3c5.md)。

原固定145c复核WP16-145C-01新增P2/remaining1：Zod发现无效URL后仍进入对象refinement，new URL抛原生异常、input可能含嵌入凭据。三入口parse/read/constructor均受影响；9次纯复现确认合成输入，并非真实凭据泄露证据。原55行报告SHA69b62e840e492b3f874e9e3b618c960eb9774b521ab13a7fad9bfa16a7a71d8b已全文读取，独立10首9PASS+1RED原源/日志及9次缺陷确认保留，不改旧断言。不接触SEC保护脚本、真实endpoint或账户。

## 最小修复与证据

仅configuration refinement中捕获new URL解析错误返回false，让现有safeParse统一抛TaskQueueError(CONFIGURATION_REQUIRED)；不将原异常附作cause/input，不记录原值，不改变合法URL/TLS/端口/DB0～15/namespace/timeout/默认关闭及旧权限限制。constructor第二次new URL仅在通过校验后，未建Redis前拒绝非法配置。没有HTTP/AppModule/Worker/恢复权限或实际业务入口变化。

新增一组3类×3入口回归：非URL、越界端口、合成userinfo＋越界端口；断言固定类型/code/message、仅code/message/stack属性、JSON仅固定code、stack不含合成秘密、调用者不变。原两配置组不改。作者首轮3组=2PASS+1RED，失败停在第一类parse，不计尚未执行的其余8调用已红；修复后相同断言3组全部通过、9调用均实际执行，无服务连接。日志`artifacts/acceptance/product/B3/wp16-queue-config-fix-author/unit-first-red.log`与`unit-green.log`分别保留。

env/check/lint/test/build退出0，作者完整404=59TS+33Python+290BE+4EX+18Web，失败/跳过0。pnpm8.14.0/实际项目Node24.16.0与SQLite在env.log，作者Python3.11.7不混为原QA3.12.12。93共享schemas/21SQL/Android/Web/executor/根lock与当前基线无Git语义变化；不重跑或认领原真实Redis8、独立10、旧PG/父来源13。队列源码在ccc4707与原145c逐字相同，因此本代码修复正是原145c的两行URL校验变更，不让后续pending outbox/备份/日历代码掩盖旧RED；这三个独立阶段仍待各自固定门禁。

首次辅助等价检查错误地把backend package的后续两个测试命令也纳入“原145c逐字相同”，git diff --quiet退出1；不是产品测试失败。equivalence-first.log保留差异路径，确认仅后来outbox/backup两命令，依赖及根lock不变；随后正确范围队列源码/原测试/根lock逐字相同检查退出0，不删后续命令或改业务断言来通过。

命令：`pnpm --filter @socialgrowth/product-backend exec tsx --test src/task-recheck-queue.test.ts`，随后`pnpm env:check`、`pnpm check:product`、`pnpm lint:product`、`pnpm test:product`、`pnpm build:product`与文档结构检查，单次退出。无服务/数据库/Redis/浏览器/真机创建或读取，无新发布/支付/外部账号权限。非UI补充检查不能替代Playwright业务验收。

## 后续职责与不能签收的范围

作者修复完成、原P2待同一非作者窗口复核，不自清remaining。提供新固定7文件增量与原145c队列源码等价依据，请原窗口保留原RED、复验完整旧10及新增三入口9调用；若需要实际Redis按既有默认授权创建自己的隔离实例并完整归属/网络runID核验及精确收尾，不复用已删除旧CID/卷。复核报告全文读取且原P2实际清零后才交原QA；不是重发读取已有报告、不变模式/模型、不新建对话。

原队列仅recheck运输/双false，没有真实Task准入/quota/当前批准或来源事实消费者、正式Redis部署ACL/TLS容量/服务器重启/AOF灾备。RES-WP16-01～03人工需求/输入/职责/解除条件仍开放；默认隔离服务与已连Samsung授权有效但不扩大公开副作用。父WP10 pending1/Developeraf14/browser拒绝/SEC及保护脚本路径状态边界不变，全部开发/WP/AC/G3未完成，继续可独立工程及按固定门禁分阶段交付。
