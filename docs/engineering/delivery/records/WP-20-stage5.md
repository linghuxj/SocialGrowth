# WP-20 第五阶段：运营处理说明的认证分页历史

2026-09-30；基线6fc8c30，feature/wp-20-note-history-stage5。BE实施代理Codex，原非作者及原QA固定工程门禁，WEB后续页面消费，AND只消费本人摘要、不开放运营私密正文。依据R-143/150/156、CT-04、AC23/24/57及[总任务卡](WP-20.md)、[质量手册](../quality-gates.md)。B4基础4448849原复核及原QA已通过，工作树/祖先/旧tip核对后Developer从2ffa860快进4448849；父6fc8c30仍在原复核，不能以本轮自检合入父链。

## 有限实施范围

- 新正式GET /api/operator/assistance-todos/:todoId/notes，只以当前Host运营会话认证，query仅afterNoteId/pageSize，默认20/上限50/no-store。同权有效运营可看同一事项的当前摘要及实际保存的说明作者、类型、正文、记录时间；不接受调用者actor/provider/项目/许可。GET不产生处理动作，也不赋予写CSRF或执行许可。
- 当前摘要沿用已复核的运营契约及当前版本/影响/说明计数，不从旧POST响应推定现状。正文只面向运营，提供者接口保持摘要隔离；人工文本不能视为可信指令、秘密配置或AI复核证据，后续UI须作为纯文本显示，不自动送模型、日志或通知。现阶段没有UI消费者、渲染或新的模型调用。
- operators元数据→当前operator/session→todo FOR SHARE，读取期间保持中央元数据一致。结束以实际DB钟再次核验会话，锁等待越过期限不能返回已读正文；失效/禁用/撤销或错principal安全拒绝。只读COMMIT不代表业务处理完成，SQL/损坏记录统一安全内部错误，不返回半页、原错误或私密数据。
- opaque noteId游标须属于路径事项，他项与不存在游标同安全FACT_VERSION_STALE。由DB重取完整(recorded_at,note_id)，不用JS显示毫秒分页；不同微秒但同显示毫秒不重不漏。有超过pageSize的下一行才next，末页不代表事项解决。每页当前事实一致，不承诺跨页冻结快照；新记录后应刷新首屏。
- 新note view/page strict TS、生成JSON及Python同语义：UUID唯一、最大50、页数量不超过当前说明计数、next指向最后项、记录时间在事项创建至当前更新时间内；正年份共同0001～9999。任意精度小数及offset按共享精确比较，不拿显示timestamp+UUID排序校验替代DB微秒键。
- 0013仅添加(todo_id,recorded_at,note_id)读取索引，保留既有命令/正文/记录，不建设旧历史迁移或清洗。原内部load仍可读取全部说明，本阶段不宣称所有路径大容量性能已解决；无事项关闭、真实复核/恢复、责任转移、邮件、provider写入或事件生产者。

## 实际检查及环境

新增1TS/1Python契约、2控制器非UI单测及5实际PG组：两有效运营真实作者/说明只读且不改变权限；同毫秒不同微秒cursor大小写重问及跨事项拒绝；坏输入/不存在事项/损坏BC记录与撤销安全关闭；实际表锁等待、pg_stat_activity观察和DB会话到期后无正文；在已保存记录上删除本轮索引后执行新增DDL，逐行to_jsonb前后完全一致。

最终产品209/209（42TS＋17Python＋128BE＋4EX＋18Web）及PG150/150（父145＋5），失败/取消/跳过0；根check/lint/build/生成检查退出0。首次产品门禁成功后追加说明时间上下界，再跑最终完整门禁，日志分别保留、不相加。全部身份/事项/文本和行政坏数据是隔离non-UI夹具；接口与PG检查不代替Playwright、真实提供者、短信、Artemis、手机或邮件业务验收。

```sh
pnpm --filter @socialgrowth/product-contracts build
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<已核对本轮隔离可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
python3 docs/engineering/delivery/check_consistency.py
```

日志artifacts/acceptance/product/B2/wp20-stage5-author。PG17.11 sg-wp20-note-history-pg，回环32854/sg_note_history，完整IDd22629973bdc780bf08acff0e1dd60645b30988ebd5298a40a966f708272e8c3，AutoRemove；启动与结束核对ID/端口，schema/其他client/deadlocks=0后停止仅本轮实例，可重建夹具删除、日志保留。原55439/55432/9000及原复核32853未动；未启动Web/Artemis、操作手机、真实账号、短信/邮件或公开发布。

## 缺口及分工接续

RES-WP20-01～04真实来源/受控联系人sender/逐对象复核与当前恢复权限/客户端项目范围继续按[总卡](WP-20.md)由EX/BE/AND、OPS/BIZ、AI/EX/QA、WEB/AND落实；WEB使用此历史接口补纯文本详情、分页/刷新/会话失效，QA须从真实入口提交和读取说明再断言。AND保持本人摘要，不因后台内部正文可读扩大权限。责任角色不代表真人已签收。

RES-WP14-03管理员浏览器控制拒绝保持；使用product-design:image-to-code的设计验收约束使新增UI/视觉捕获暂停，不换CLI/Chrome/代理绕过，恢复前重新读取原图/提示词/页面规格。SEC-WP14-01人工候选凭据核查未关闭，无关脏脚本只路径/状态。用户默认授权隔离服务及已连接Samsung联调有效，不扩大外部发布/删除/账号或任意邮件。缺人工/环境记录真实需求及解除条件并继续独立后端，完整WP-20/B2/G3、AC及所有开发均未完成。

后续完整读取原artifacts/review/wp20-stage5-7f0ee97.md，1P3/remaining1：行政坏记录比事项创建早或当前更新晚1微秒、仍在同一显示毫秒时，在Date投影截断后被HTTP200接受。正常209产品/150PG及122对照、11组正常SQL通过不消除两个RED反例（同一个finding）。本阶段退回修复、不合入、不向QA报清零；须在原DB精度处校验并补±1微秒/inclusive/正常微秒分页/BC拒绝，再原窗口固定复验。原RED和报告保留、不修改旧历史来伪造通过。

后续[原始微秒整改](WP-20-stage5-precision.md)已增加DB全事项边界校验及真实±1微秒/页外/inclusive回归，作者209/151通过；准备fixture约束失败与最终重跑分别保留，不自报原P3清零。新固定整改须原非作者及原QA确认，显示精度/DB游标与原公开契约不混为同一个问题。
