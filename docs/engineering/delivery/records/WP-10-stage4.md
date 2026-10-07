# WP-10 第四阶段：维护持久账本及共同预算观察

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01；基线40a6833，feature/wp-10-maintenance-journal-stage4。EX/BE实施代理Codex，原非作者/QA固定门禁，AND/OPS真实连接事实和当前上下文，TL真人参数/新轮签收待落实。依据R-074/075/109/148～151、CT-05、AC14/15/59、[上一阶段](WP-10-stage3.md)、[质量手册](../quality-gates.md)。维护账本仅预算原型，不是执行器或业务ready。

## 实现与明确关闭的入口

0016增维护round/command，按device唯一一轮及round唯一，固定安装/接入组合FK、代次/归属scope、limits；既有迁移逐字不改。端点/来源epoch、进程或重新初始化不能开新轮/提升参数/清旧预算；重新绑定/人工新轮需要正式复核程序，当前无reset或删记录入口。UPDATE禁止scope/config/创建时刻/已结束历史改写、次数数组缩短和耗时/时钟倒退，未知占位不能退回running，人工phase不能重开。行政DELETE、备份/保留、权限治理及生产容量不由trigger保证。

ConnectionMaintenanceStore无Nest/HTTP/worker/Artemis接线。当前上下文resolver缺省null，所有有效调用在连库前关闭；未来可信DB-only broker必须核对锁下当前maintenance scope和真实任务/真实无任务，不能取模型/body/header的eligible/task=null作为事实。resolver只用本事务当前DB，不允许远程IO或在device锁后倒序拿provider/install上游锁；这里没有生产resolver、安装认证/来源/目标许可证明。测试是独立SQL合成context表，不是已实现生产者。

共同锁序device→maintenance→task，与既有TaskRecoveryStore的device→task兼容。初始化/命令/最小审计均同事务，所有保存/command/audit和双方观察写入须RETURNING实际1行；真实COMMIT确认后返回，确认丢失原键接续不新增尝试。每份state的版本须有完整覆盖的command版本，缺关键command不静默重新确认；不宣称能发现管理员删除同版本的所有重复命令或防整库改写。读取原快照不刷时钟，也不是实时额度许可。

当前上下文在旧键重放前检查；精确历史重放给**当前维护state且joint=null**，绝不恢复旧预算可执行判定。当前任务存在时维护-only begin明确TASK_BUDGET_REQUIRED：联合分配/完成尚未实现，不能借维护空余额绕任务额度。observe_joint只从resolver获取真实task scope，必须实际有对应持久预算，缺失不当无任务；在双方行锁后取DB微秒钟，以同一时间观察两账本，任务command/audit和维护command/audit共同原子提交。返回budgetsAvailable仍仅预算上限，非动作/目标/当前来源授权；没有自动派发连接、重试、任务resume、清pause/exit或正常变化通知。

## 验证和交付证据

证据artifacts/acceptance/product/B2/wp10-stage4-author。首次定向14/14及全PG**197/197**（原183＋新增14）通过，失败/取消/跳过0；收尾强化所有入口当前task设备隔离，再定向14检查，不相加各轮。根check/lint/test/build/生成**252/252**（42TS17Python171BE4EX18Web），收尾同范围重跑；backend类型/lint通过。完整旧0015测试为未来增迁移调整baseline选择`<0015_`，否则0016依赖被错装在0014基线上；只修测试迁移选择，不改旧0015或放宽生产约束。无单独E2E套件、不替代Playwright页面验收。

14组真实SQL：空库完整0001～0016及旧0015已有身份保留、实际CHECK/FK；default closed且0连接；跨instance pinned round/参数/epoch不清预算；并发精确一次与当前人工state重放；实际COMMIT成功仅ack丢失；新OS进程重载；当前任务禁止单独begin及缺预算不降级；共同观察/未知发布；双方round/command/audit共6种真实RETURN NULL均完整回滚；真实task表行锁等待后再取中心钟；未知跨重载占位及晚成功不清人工/pause；真实audit异常安全回滚、严格命令与变更scope在缓存前拒绝；真实DB旧历史/config改写拒绝、坏elapsed不修补；行政删关键command后read/replay/新命令均拒绝。重载不声称DB服务重启或手机恢复，暂停表断言不声称实际App停止。

独立cached postgres:17-alpine实际17.10（镜像93aa428…），完整IDe005770abefb5c0d4627ce5550c58d32d08a4d59150ff695603ccc94a9ab15cd，sg-wp10-maintenance-pg，回环32855/sg_maintenance；仅合成可重建夹具。原review@32861、nestar@55449、Minio@9000均其他窗口资源不碰。启动/实际version/env与最终清理日志独立保留；收尾仅在全部本轮命令退出、schema/其他连接/deadlocks及精确身份核验后停止自有实例与其匿名卷，不对其他实例reset。无新UI/APK/手机、账号/短信/邮件/公开发布或系统网络变更。

实际收尾schema/其他连接/deadlocks=0|0|0，全部命令退出，精确ID/name/回环端口/AutoRemove/无宿主bind/卷唯一所有者核验后已停止上述e005实例；自有容器和匿名卷ca56552…均消失，after-stop两日志均0字节，日志和源码保留。删除仅可重建合成夹具；原review/其他服务不动。最终同scope跨设备task读取负向、定向14和根252再次通过，旧197全量为收尾前固定工程运行，不相加或冒充另一次全量。

复现根`pnpm env:check`及`pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product`。明确新独立可销毁DB后，以`SG_PRODUCT_TEST_DATABASE_URL=<新隔离库> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:postgres`；定向同环境`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/connection-maintenance-store.postgres-test.ts`。这些是非UI工程检查，合成context/未准入enrollment关系并非权限、实际任务或真实恢复成功。

## 原窗口状态、整改及下一步

原af14非作者76行及原QA完整报告已读取，0findings/remaining，QA新240/15及完整10组12600时间对照/56mixed；无新服务/手机，旧证据按固定字节复用。工作树/祖先/旧tip CAS后Developer605→af14，不含b60/40a/本阶段。

b60原非作者已实际确认WP10-B60-01一P3：返回时过期的来源对象在同步abort回调被改新时间，随后实际写receipt/audit；原13组日志含12正常＋1 RED。窗口在报告收尾前发生平台内容检查中断，**没有完整门禁报告，不记复核通过/问题清零**。已仅请原窗口整理已保存结果，不新增探针、不绕平台限制。下一项独立整改“复制返回证据早于取消回调”，保留原RED；固定整改复核/QA未通过前不合该链。本维护阶段作者完成不抵消父问题，原40a纯预算尚待固定门禁。

下一内部阶段是实际任务双方预算原子占位/完成及受控事实查询，先不开放动作；真实current-task/身份来源、LocalAPI/配对/目标挑战与旧策略收回、正式维护参数及真人支持矩阵仍沿RES-WP10-01～04。平台报告阻断、管理员浏览器RES-WP14-03、SEC-WP14-01分别记录，不因授权测试或工程GREEN关闭。默认服务/已连接Samsung授权有效，缺人工/环境输入继续独立编码，但完整WP10/B2/AC/G3与全部开发未完成。
