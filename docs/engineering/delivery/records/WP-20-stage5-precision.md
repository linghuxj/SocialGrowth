# WP-20 第五阶段P3整改：说明原始微秒边界

后续原窗口结论：fad821c 原非作者报告和原QA 20260930T150329Z-wp20-stage5-fad821c 完整读取，原P3清零、新增/remaining0；QA实际209/151及17 SQL/Nest组65 HTTP断言通过，有限工程G1放行。经工作树/祖先/旧tip CAS，Developer已快进fad821c。以下作者历史保留；并非说明UI/真实来源或全WP通过。

2026-09-30；基线7f0ee97，fix/wp-20-note-timestamp-precision。BE实施代理Codex，原非作者及原QA固定工程门禁，WEB未来消费者及真实业务验收边界不变。依据R-143/150/156、CT-04、AC23/24/57、[说明历史](WP-20-stage5.md)、[质量手册](../quality-gates.md)。原artifacts/review/wp20-stage5-7f0ee97.md完整报告已读：1P3/remaining1，普通209/150通过不能抹除两个实际HTTP RED；不修改原报告或坏历史以伪造通过。

## 实际修复

旧读取先将事项及说明PG timestamptz交驱动Date/toISOString，微秒丢失后才做契约语义。新同一保护SELECT在**原始DB精度**计算note_times_valid：事项更新不早于创建，且该事项的所有说明没有recorded_at<created_at或>updated_at；结果须严格true后才投影任何正文或摘要。false/NULL/未能判断均安全可重试INTERNAL_ERROR，整页拒绝、无原SQL或私密正文；包含未在当前page/afterCursor范围内的坏记录，不能借分页藏坏历史。

同页中央元数据屏障、运营/session认证、todo FOR SHARE及末尾DB钟检查保持。显示仍允许JS毫秒，cursor仍从DB取完整(recorded_at,note_id)，不以改显示位数遮掩坏时间。原TS/Python精确上下界、生成71schema、HTTP入口、写端点、auth/store、0013及旧迁移/普通写入不变；不清洗历史、不增加关闭/许可/模型/sender或UI。

全事项NOT EXISTS检查会读取该事项关联说明，分页数量有界不等于整个语义扫描或旧内部load性能已解决；当前已有计数同样需读关联行，容量/查询性能按真实判据另验，不能据此宣称高容量达标。

## 自检结果与准备失败

新增1实际PG组包含两±1微秒原反例：created .123400/update .123600、note .123399/.123601，SQL原判断坏且三者Date.getTime完全相同；首屏与从另一合法noteId后分页都安全拒绝，读取不增加说明/命令/审计/影响/意图。之后两条note分别精确等于创建/更新，上下界inclusive可读；同显示毫秒分页仍不重不漏/末页null。原正常微秒/BC/认证/过期/锁/索引/POST等全量组保持通过。

初次新增fixture末尾还试图把事项created_at设为updated_at以后；原0011已有CHECK直接拒绝这种行政数据，PG151中150通过/1fixture失败，不是新读取逻辑失败。删除不可成立的该步骤，不删约束、不放宽真实±1微秒断言，postgres-first-fixture-failure.log保留；完整重新运行最终151/151，失败/取消/跳过0。两个非法说明反例及inclusive已在首轮实际执行，最终仍完整复验，不把失败fixture隐藏成所有首轮通过。

根check/lint/test/build/生成全部退出0，209产品（42TS＋17Python＋128BE＋4EX＋18Web）通过；修fixture后backend类型/lint单独再过。基线只取7f0ee97，不包含另分支6a6a6d8观察窗及69630b9原生层，因此此209不是从其221倒退或删测试；生成/依赖/其他模块源不变。新增PG1在151内，不累加两轮。作者源码级PG补充不是Node HTTP/Playwright或真人处理通过；原窗口需在新固定源码独立重跑实际HTTP两个RED。

```sh
pnpm --filter @socialgrowth/product-contracts build
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<明确本轮新隔离可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
python3 docs/engineering/delivery/check_consistency.py
```

证据artifacts/acceptance/product/B2/wp20-stage5-precision-author。本轮SQL SELECT version实测PostgreSQL17.11，专用sg-wp20-note-precision-pg，回环32856/sg_note_precision，完整ID3f7ec9a43a916a05cc10656fe1466291810873a03f8c82e8ce2f41bd9b344783，AutoRemove；最终schema/其他client/deadlocks=0，核验精确ID/端口后仅停止该实例，可重建夹具删除、日志保留。原55439/55432/9000等未动，无Web/Artemis常驻或手机/真实账号/短信邮件/公开发布动作。本轮日志早读版本文件曾出现ENOENT，实际版本后已读取、测试未用未知库。

原6fc8c30非作者与原QA完整报告均已读取，固定G1通过，工作树/祖先/旧tip核对后Developer从4448849快进6fc8c30；新7f及本整改不因作者自检合入。6a6a6d8/69630b9仍在独立执行分支保留、待固定原门禁，不丢实现或虚报全部完成。RES-WP20-01～04来源/联系人sender/实际复核恢复/跨端消费者及项目范围、RES-WP14-03管理员浏览器拒绝、SEC人工核查仍保持真实缺口；只继续独立工程，不自报P3清零或完整WP/B2/G3/AC通过。用户默认授权隔离服务和连接Samsung联调有效，不扩外部资源权限。

随后原artifacts/review/wp20-stage5-fad821c.md完整报告读取：原1P3在实际SQL/service/Nest两个±1微秒反例上清零，HTTP200→安全500，新增及remaining0；原209/151、176/99/122对照及17组65HTTP通过，实际PG17.10与作者17.11分开。已向原QA交固定6fc8c30..fad821c独立复验；Developer仍6fc8c30，不把原非作者通过当QA或真实业务通过。原7f RED/报告保持，新的清零仅针对固定整改。
