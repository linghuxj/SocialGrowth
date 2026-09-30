# WP-20 第二阶段：运营认证的全局待办摘要分页

2026-09-30；基线447eda5，feature/wp-20-authenticated-feed-stage2。BE/契约实施代理Codex，原非作者及原QA独立门禁；WEB/AND后续消费，EX实际事件生产者与OPS/BIZ提醒资源待落实。依据[总任务卡](WP-20.md)、[需求基线](../../../current-requirements-summary.md)、R-143/150/156与AC23/24/57；没有新UI设计或扩展事项类型。父组合447eda5仍在原复核，不因本子阶段自检直接合整条分支。

## 已实现，未宣称业务完成

- 正式Nest注册GET /api/operator/assistance-todos，以__Host-sg_operator_session认证有效当前运营，Cache-Control=no-store。同权运营看到全部此类历史事项，不按初始负责人过滤；联系人不是访问权限。默认20、最大50为技术分页保护，不是项目业务数量规则。严格拒绝重复数组参数、0/51/科学记数/无效UUID/额外owner等query，不能自选身份或权限。
- 分页只返todo/occurrence/provider/初始责任UUID、network_access_help、open/awaiting_recheck、factVersion、实际逐设备/说明计数、首次意图awaiting_configuration及时间；不返人工说明正文、手机/来源原错、联系人邮箱、令牌、SQL或凭据。originScope是创建时无项目来源，**不宣称目前仍未分配**；后来分配不改写原来源或关闭待办。
- opaque afterTodoId由DB重取created_at＋todoId，按原完整微秒键序分页，不拿显示到毫秒的JS Date当游标。确实多于pageSize才返最后一行ID；未知游标返回安全FACT_VERSION_STALE，不假装空页/全已处理。正常完成next=null；读取是该次当前页，不宣称跨页冻结快照，新增事项需从第一页刷新，结束不代表已解决。
- 新共享summary/page契约导出、注册及生成JSON/Python同步；strict拒绝resolved/sent/permission/project等伪字段。数量安全整数，impact至少1；awaiting_recheck须存在至少1条人工记录，更新时间不早于创建，UUID不因大小写重复，非空下一游标必须指该页末行。两运行时语义一致，不把摘要当动作许可或AI复核通过。
- 与项目/资源/待办元数据一致的operators表→actor/session顺序；事务内分页及计数投影，结束按实际DB钟再次确认会话，即使SELECT已取回也不向过期会话返回受保护数据。query无外部网络/通知副作用，不改变todo/设备/项目/许可。0012只加created_at/todoId索引，无历史业务重写。
- **只读列表消费入口**，没有对外故障创建/说明提交/真实复核/关闭/恢复/邮件发送HTTP，没有Web/Android投影消费或真实事件接线。现有生产环境没有由本阶段自动造事项；测试合成入库不能证明用户可在页面看到/处理真实待办。原内部recordNote仍不对公众/模型开放。

## 验证与环境

新增2TS＋1Python共享语义测试、2HTTP控制器非UI单测。首次仅generate未先build contracts即直接backend check，dist尚未有新导出导致TS2305；最终统一根入口先build共享依赖，未删错误记录或以any伪造导出。首轮根176后补齐awaiting_recheck/计数一致约束并重新跑完整根check/lint/test/build，最终176/176通过（38TS＋14Python＋102BE＋4EX＋18Web），失败/取消/跳过0，原日志见artifacts/acceptance/product/B2/wp20-stage2-author/root-final-gate.log，初始176日志保留。control方法单测的响应仅“non-UI-test-only”，不当认证/业务成功。

完整PG135/135（原131＋4）通过，失败/取消/跳过0：任何当前运营可看其他邀请责任事项、已分配后的历史origin不变/摘要无正文或会话秘密；两条真实微秒不同但显示同一毫秒的记录分2页不重复/不遗漏，所有页对照DB原顺序及大写cursor；非法query/未知cursor/伪身份/停用/撤销均拒绝；实际观察SELECT等待ACCESS EXCLUSIVE表锁并DB钟越过会话期限后只返回认证错误，不返回数据。全部SQL合成身份/事件/预留/时间/锁为非UI补充，未替代实际Web/Artemis。

专用PG17.11 sg-wp20-feed-pg@32850/sg_feed，完整ID496fadf54000a9a69bfe41b462b9a0c6801ba26a8f07c2afdbbccdc7faf70ad5。ready后执行，最终schema/其他活动连接/deadlocks均0，精确核验ID/AutoRemove后停止；可重建夹具删除、原始日志保留。原窗口32848及原PG55439/55432/MinIO9000不动，无新Web/backend/Artemis常驻实例、手机安装或外部账号/邮件/发布操作。

```sh
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<明确隔离可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

## 真实缺口仍保留并继续

RES-WP20-01/02/03：真实需要人工帮助的稳定来源、有效初始联系人渠道/受控发送服务、实际处理后复核/恢复消费者仍按总任务卡责任和最晚时点；当前没有假邮箱、模板AI复核或自动送达/关闭。下一步BE/WEB/AND完成认证详情/说明提交/同todo投影及消费者；项目范围合并/邮箱路由和逐任务恢复条件仍未实现。

RES-WP14-03：管理员浏览器策略拒绝持续，新待办UI与Playwright/视觉交付暂停，不借CLI/Chrome绕过；按既有原图/提示词/页面规格后续实施前重读。某次应用wait_threads状态接口未返回，仅停止本窗口读取等待脚本；未中断或重发原复核/QA，通过报告文件读取已完成28276f2工程QA并继续代码。

原报告必须固定版本门禁清零才合此阶段。176产品/135PG非真实Web、手机、网络恢复或邮件送达；完整WP-20、B2/G3及全部开发均未完成。默认获准临时服务和已连接Samsung联调，不扩展真实账号/公开发布/删除或候选凭据范围。

后续原662718f复核报告已完整读取（artifacts/review/wp20-stage2-662718f.md）：常规176/135、176对照/10工程探针通过，但新增日历互通P3一项，未签清零G1，因此未合Developer。共同0001～9999年域/安全异常修复与说明POST在[第三阶段](WP-20-stage3.md)实施，原反例保留并待固定新版同窗复核。此处第二阶段“没有说明提交HTTP”仅描述固定662范围，不外推后续版本。
