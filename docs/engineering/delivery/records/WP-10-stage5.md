# WP-10 第五阶段：共同恢复预算原子占位与完成

2026-10-01；基线a068530（40a/91e维护作者工程正常合并0d7来源整改），feature/wp-10-joint-reservation-stage5。EX/BE实施代理Codex；原非作者与原QA负责固定版本门禁，AND/EX/OPS负责真实当前任务和回执接线，TL负责维护参数及真人签收。依据R-074/075/109/148～151、CT-05、AC14/15/59、[第四阶段](WP-10-stage4.md)及[质量手册](../quality-gates.md)。尚无生产执行器或完整业务ready。

## 实现和默认关闭边界

0017新增不可UPDATE的joint_recovery_reservations，以device/recovery唯一并绑定完整维护scope、原opaque端点引用及可空的原task预算scope。任务FK只证明对应预算存在，不证明实际任务、执行者、来源或动作权限。无任务必须由未来可信当前事实broker核对，不能拿客户端null当事实，也不会制造任务ID/预算。0016及更早迁移不改，无历史回填；用户已要求不用考虑迁移历史。若旧原型已有尝试却缺关联，读取安全拒绝CORRUPT_STATE，不清历史、不自动重置或伪造关联。行政DELETE/保留治理和生产升级程序另行落实。

Store仍缺省current-context=null，连库前关闭；未注册Nest/HTTP、队列、worker、手机或Artemis。测试context是独立SQL合成表，不是实际任务生产者。DB-only resolver提供锁下当前维护scope、实际task scope/真实无任务及提交阶段；有任务而提交阶段缺失安全拒绝，possible_submission进入核验而不创建尝试，verified_success不重试。旧维护-only begin不能绕当前任务预算；旧complete不能单独释放双方占位。

reserve_joint锁序device→maintenance→task，双方锁后统一取DB微秒时钟，校验双限额/占位后在一个事务先递增双方计数、写不可变关联及各自command/audit。任一RETURNING不是实际1行全部回滚；任务原2次/5分钟规则不变，维护参数仍显式输入（3次/120秒仅测试草案）。共同余额/占位确认不是动作token，尚无外部调用、派发、自动恢复或pause清除。

complete_joint按不可变旧关联加载原任务预算，不用后来的当前任务替换；双方结束结果须对应，端点/scope必须匹配。未知结果同时保持双方占位，跨instance不释放；晚结束只补原尝试，人工状态仍粘滞，成功不重置累计次数/耗时。回执字段只是内部结构检查，不是手机独立观察或物理调用结束证明，生产回执adapter尚待实现。精确旧键重放仍返回当前维护state且joint=null，无旧可执行结论或新占位。

## 作者检查与可复现证据

证据artifacts/acceptance/product/B2/wp10-stage5-author：根env/check/lint/test/build/契约生成退出0，产品**252/252**（42TS17Python171BE4EX18Web）；定向**24/24**＝原14＋新10；全量PG**208/208**＝原0d7组合184＋维护24，失败/取消/跳过0，各轮不相加。这些为非UI工程检查，无新Web/真机测试，不替代Playwright业务验收或原窗口门禁。

新增10组实际SQL覆盖双方相同恢复ID占位/成功不清余额、真实无任务可空关联、并发精确一次与实际COMMIT成功仅ack丢失、任一限额耗尽、未知发布/缺提交阶段、未知双方占位及晚成功人工粘滞、拒绝替换端点/矛盾结果/旧complete及新任务不能承接旧回执、关联/双方round/command/audit共7种真实静默跳过全回滚、完成时任务写失败不释放维护槽、删除关联后读和重放均拒绝。合成发布阶段并非真实平台提交证据。

复现根`pnpm env:check`及`pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product`。仅明确新可销毁隔离DB后，`SG_PRODUCT_TEST_DATABASE_URL=<新隔离库> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:postgres`；定向同环境`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/connection-maintenance-store.postgres-test.ts`。不新增独立E2E、不用接口/预置状态代替页面。

本轮cached PG镜像93aa428…实际17.10 Alpine/musl，自有94619f795f33b0887ad97bf418c932b05a1c293574cc12d99e689adad288afea、sg-wp10-joint-pg、回环32857/sg_joint，无host bind。全部命令退出后schema/其他连接/deadlocks=0|0|0，精确ID/name/端口/AutoRemove/卷唯一所有者核验后仅停止自有实例；容器和自有匿名卷fdb9f801…均消失，after-stop日志均0字节。只移除可重建合成夹具，证据和代码保留，其他服务及原手机数据未动。

## 协同门禁和实际待办

Developer仍af14：第一阶段原复核/QA双G1通过，不包含此链。原b60完整79行报告remaining1/P3；原0d7限定53行报告已完整读取，静态、240/184工程检查通过，但原13独立反例/相关指纹和补充对照未执行，**未签P3清零或G1**。平台限制及人工解除输入见[补验记录](WP-10-review-blocker.md)。作者组合和208通过不能替原窗口签收。

原40a纯预算完整55行复核已读取，增量findings/remaining=0，固定12＋独立6组及静态检查通过，已交原QA同一纯范围；未运行PG/Web/手机或来源探针，不借常规检查通过解除历史平台限制。原非作者接续独立40a..91e维护持久增量。均不放行未通过的父持久链，不换窗口/模型规避。后续EX/BE接续当前任务事实/真实回执消费契约；AND/EX/OPS提供已授权设备与实际来源/目标核对；TL/BIZ/QA落实真人签收、维护参数、RES-WP10-01～04和补验时点。缺人工/环境输入记录后继续独立工程，全部WP10/B2/AC/G3及全部开发仍未完成。
