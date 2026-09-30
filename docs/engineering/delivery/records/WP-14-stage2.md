# WP-14 第二阶段：初始资源预留约束核心

2026-09-30；初始编码基线31c6095，收拢基线6394cde，feature/wp-14-resource-reservations-stage2。第一阶段6394cde已获原非作者问题清零，独立QA正在核验，仍不声称业务验收通过；本阶段独立开发无手机副作用的内部核心，以新固定提交交原窗口。BE为实施职责，EX/WP-13接线，原非作者复核、原QA独立工程核验；实际BIZ/OPS资源责任待实名，不编造签收。

依据需求R-006/027/032/033/103/107/130/145/146及[WP-14](WP-14.md)、[工作包](../work-packages.md#wp-14-项目批准范围与资源约束)和[技术设计§2](../../../technical-design.md#2-业务代码边界与数据归属)。AC-25/26仅不变量工程输入；不签署完整业务验收。本阶段无新UI/Android，不新增图稿，不运行以合成资源假装真实页面/真机已分配的验收。

## 交付范围

- strict内部快照/初始预留规则：账号所属平台与身份一致，账号同期一项目、手机同期一项目、同手机同平台一身份、同身份一当前手机；同手机可只FB或YT，也可FB+YT同项目，不强制双平台。多台手机可服务同项目，同公司登录账号下不同Page可在同项目不同手机，不能据此跨项目共用登录账号。
- UUID先规范小写再匹配，重复/未知/额外字段、断裂引用及混项目/错平台的存量事实均失败关闭；输入不被修改。请求只能初次预留/补同项目尚空的另一平台，不能靠换键旋转、换机或跨项目转移。完全相同预留为无改动；未实现释放、撤销、交接或自动替换。
- 迁移0009：媒体账号/发布身份中央登记引用、不可变的UUID/平台/来源键、平台来源键唯一；设备/账号项目唯一预留，身份唯一及device/platform唯一，组合FK保证手机、账号和身份属于同项目/平台。所有身份预留固定pending_initialization，返回也显式携带该状态。没有接受收益承接起点/就绪/已核验/执行许可字段。
- ResourceReservationStore内部operator会话/CSRF权威写入，actor只来自有效会话；与ProjectService保持相同元数据锁顺序：operators表SHARE ROW EXCLUSIVE→actor/session→guard→project→device（包括读取）。不在持锁时调用外部服务，不再获取provider/install/network/control锁。表锁/guard仅串行短资源元数据，不替代同机动作互斥；未来登记生产者也必须遵守同一顺序及guard。
- 请求携带所见资源/project/device版本，当前版本冲突拒绝；同actor/key摘要包括范围/版本，不含requestId，身份数组按集合排序。重试返回当前预留快照而非执行授权。无改动只记同键请求、不增加业务版本/审计。预留、单键记录、guard版本及最小operator审计同事务；审计/SQL/会话锁后到期异常全部回滚，未知原SQL/cause不向上泄漏。读取不是分配、恢复或许可更新。
- 手机unassociated/exit_pending/exited拒绝新预留；已占用手机的暂停/提供者离线/人员停用不自动释放。暂停手机可保留筹备预留，但不能因此开始初始化或发布。当前仅设备登记与状态作为预留门槛，**没有**证明实际归属/网络/ADB/参与意愿/停止/身份核验；这些必须由WP-13有效授权事实加载和动作许可路径再次检验。

## 自检与迁移

产品148/148（33TS＋11Python＋84BE＋4EX＋16Web）通过；新增规则12/12。全套隔离PG17.11为105/105，新增资源12项含竞争唯一赢家、另一phone/平台/项目拒绝、跨Page账号专用、另一同权operator代办、CSRF/撤销、版本改变、无改动、响应丢失重放/重启当前读取、审计回滚及数据库实际越过会话截止时间后拒绝。组合FK/唯一约束和中央来源引用不可变负向探针通过。迁移在0001～0008真实schema及既存筹备项目上前向应用0009，原项目仍preparing，没有删旧迁移或历史；整体DROP只在显式reset隔离夹具库前后。

第一次新增测试的函数参数由randomUUID模板字面量推断过窄，规则运行通过但类型检查失败，改为明确string[]后check/lint通过。第一次PG全套通过同时出现单client并行query的驱动废弃警告，改为同事务依次读取；最终核心12及资源PG12再次通过且无该警告，旧全套日志保留。最终阶段类型/lint/build通过。完整命令/原始输出保留artifacts/acceptance/product/B3/wp14-stage2-author（product-tests.log、postgres-tests.log、resource-postgres-sequential.log、resource-postgres-final.log）；pg夹具与类型检查不能替代真实UI或平台证明。

收拢6394cde父提交后根check/lint/test/build全通过；产品150/150（33TS＋11Python＋84BE＋4EX＋18Web），新增的2项Web属于父提交未知回执整改，不冒充本资源核心的新覆盖。原始输出另存final-gate.log。早期PG全套105/105在顺序读取/返回显式pending状态调整前运行，调整后核心12/12及资源PG12/12再次通过；这些日志保留实际执行版本。

交叉检查发现资源actor→guard→project与另一运营更新项目负责人project→owner可能成环。新增第13项真实PG交错测试：外部事务占guard，资源A等待guard，项目B修改负责人为A；修复前观察到数据库死锁计数1且断言失败，原始metadata-lock-order-red.log、metadata-lock-order-red-database.log保留。修复将与项目基本信息相同的operators表锁前置到actor之前，读取同样遵守，避免读取等待guard参与成环。修复后完整PG **106/106**（原93＋资源13）通过，无取消/跳过，backend check/lint/build通过；原始postgres-final-lock-order.log保留。相同测试库死锁累计仍为1，新增106项运行死锁增量为0，不声称历史累计为0。checks schema及活动连接最后均0。此为作者非UI数据库证据，原非作者与原QA固定快照门禁仍待核验。

本轮专用PG17.11容器sg-wp14-resource-lock-pg，完整ID af122d775392013e7e1b084a3365406d7df4e1730a2ab41cc9069b67d468dee8，回环32842/sg_wp14_resource_lock；核对ID、AutoRemove及端口后已停止，仅删除本轮可重建夹具库，红绿日志保留。其他窗口服务及真机未动。

```sh
pnpm env:check
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<明确隔离测试库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

临时容器sg-wp14-resource-pg，ID21cfb1c48562325d725c25e46f435fb47d508081805b288b33039a1132b624c2，回环32842/sg_wp14_resources，仅合成非UI事务夹具。未启动Web/backend/Artemis消费者，未操作媒体账号或手机。其他项目nestar-qa-session及原复核容器、qm-dev-postgres、minio-test不动。测试结束按精确ID核对并停止，重建源与日志保留。

本阶段检查结束时checks schema=0。该本窗口容器随后单独新建四个空部署UI库用于第一阶段P2整改，未混用checks夹具，资源内部核心不接HTTP或消费者；两者证据分目录。整改验收完成后只读无数据库活动连接，按完整ID21cfb1c48562核对后停止容器并AutoRemove删除五个可重建测试库。原容器及其他窗口实例未动；本阶段没有借整改UI证明真实资源分配。

## 缺口与继续路线

| 缺口 | 真实责任/输入及最晚阶段 | 解除与继续工程 |
| --- | --- | --- |
| RES-WP14-04 中央媒体登记生产者未实现 | BE/EX＋BIZ核对公司持有登录账号和实际Page/频道稳定来源键及账号关联，登记接线前 | 迁移只存中央引用；没有注册HTTP/CLI或猜测来源。未来生产者必须解析canonical source ID（不是显示名/URL/随机模型猜测），同guard去重、不可变映射。当前唯一性仅对已正确中央登记的引用成立，不宣称真实平台别名已去重或身份已核验 |
| RES-WP14-05 预留到实际分配/初始化未接线 | WP-13 BE/EX确认active归属/安装、网络、ADB、参与意愿与控制/停止事实；真实业务分配前 | 当前无HTTP/UI/注册生产者/任务消费者。真实页面必须建立合法资源并操作，Artemis核验身份后才形成逐身份承接生效依据。不能直接写fixture验收；本内部规则、迁移、事务可独立复核 |
| RES-WP14-06 换机及跨项目交接未实现 | WP-21/13＋EX/QA核对具体原/新资源、旧端实际停止、未决发布及收尾采集处置；任何首次转移前 | 没有释放入口，结束/空闲/新请求键不解占用；继续实现方向批准、资源登记及授权接线，真实交接须原QA对应平台/设备受控验证 |

尚未完成真实资源分配/平台资格、批准范围和周期等WP-14总体能力。第一阶段复核缺陷与本独立核心分别跟踪，剩余项不会被“核心通过”抹掉；G1等待固定提交原非作者清零和原QA工程核验，G3/AC未通过。
