# WP-20 第四阶段：提供者本人待办摘要投影

2026-09-30；基线4448849，feature/wp-20-provider-projection-stage4。BE/共享契约实施代理Codex，AND/WEB后续消费，原非作者/原QA固定工程门禁；EX/AI/OPS/BIZ实际来源/复核/通知职责不变。依据R-143/150/156、CT-04及AC23/24/57、[总任务卡](WP-20.md)、[质量手册](../quality-gates.md)。父2ffa860原非作者/原QA工程G1已通过，Developer经核对快进2ffa860；B4基础4448849仍在原复核，不能因本阶段自检合入。

## 有限实施范围

- 正式Nest新增GET /api/provider/assistance-todos，以当前Provider Bearer会话导出本人providerID，不接受query自选provider/operator/device/project。strict微秒opaque游标及默认20/上限50/no-store，其他人的cursor与不存在cursor同安全FACT_VERSION_STALE，不泄露对象存在性。
- 与运营使用**同todo表/同todoID及当前版本**，只返kind、open/awaiting_recheck、历史无项目originScope、影响/说明计数和时间。不返provider/occurrence/运营责任ID、邮箱/通知配置、人工正文、手机来源错误/凭据/逐设备身份，不复制第二待办。origin只是历史创建来源，后来设备分配/退出/换属不改原事项或将旧设备权限授给本提供者。
- 提供者认证新增事务方法，复用既有Provider HMAC token与pepper，不另造权限。locator→provider FOR NO KEY UPDATE→session FOR UPDATE，重查本人活跃状态/未撤销/实际DB时钟；非键provider锁既阻停用/删除、又兼容其他事务引用provider的FK KEY SHARE。不是声称既有logout audit有provider FK（原audit actor无该FK）。结束再按实际DB钟检查会话，锁等待超时不得返回已获取的保护数据。
- 游标必须当前provider的todo，由DB重取完整created_at/todoId，不用JS毫秒显示作键；多于pageSize才next，未知/他人cursor不假装全部已解决。摘要检查计数/待复核有说明/原通知意图存在/共同0001～9999日历，损坏安全失败，不返回半页或源错误；只读不清洗历史。
- 新provider summary/page共享strict schema、JSON、Python语义与TypeScript一致，不能额外插入其他principal/内部text/sent/resolved/许可。原公开运营摘要/说明schema保持不变，不修改旧调用的authenticate方法。无新SQL或index（复用0012，不自称高容量查询已达标），没有事件生产者、提供者处理说明写端点、关闭/恢复/邮件或Android客户端页面。

## 检查与环境

新增1TS/1Python契约边界及2HTTP控制器非UI单测；实际PG新增6组：同事项/当前进度且本人隔离，owned微秒游标同毫秒不重不漏，他人cursor/伪query/错principal/停用/真实logout拒绝，真实SELECT锁等待及DB期限越过后无数据，真实持有session行锁＋provider FK写竞争时无死锁且撤销后重新拒绝，行政坏意图/BC时间安全失败。

最终产品205/205（41TS＋16Python＋126BE＋4EX＋18Web）及PG145/145（原139＋6），失败/取消/跳过0，根check/lint/build/生成全部通过；补原通知意图存在检查后又单独backend check/lint通过，最终build/PG已含该约束。文档结构检查9文档/228链接/157需求无错误，仅证明结构。身份/HMAC/事项/时间/锁等均新可销毁非UI夹具，不代替页面、真实提供者注册/人工处理、手机、短信/Artemis、邮件送达。只用原真实业务来源可补验G3，不能从接口数据预置证明本人端已可用。

```sh
pnpm --filter @socialgrowth/product-contracts generate
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<已核对新隔离可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

日志artifacts/acceptance/product/B2/wp20-stage4-author。专用PG17.11 sg-wp20-provider-feed-pg，回环32852/sg_provider_feed，完整ID3fb404abff625fb4ad8a455266407d97ae709cf7561d9e91aeb8b76fcb0d0557，AutoRemove；启动前核对原55439/55432/9000等不混用，原窗口测试独立。最终schema/其他client/deadlocks均0，精确核验ID/AutoRemove后仅停止本轮容器，可重建夹具删除、原日志保留；无Web/Artemis常驻实例、手机安装或外部账号/发布动作。

## 缺口与后续职责

RES-WP20-01真实稳定事件、02有效联系人/受控sender、03实际处理后复核/恢复当前权限、04客户端同事项消费/分页详情/项目范围仍按[总卡](WP-20.md)执行：AND/WEB接认证分页与失效会话、EX/BE接真实source，OPS/BIZ落实地址渠道，AI/EX/WP-11/12/16落实逐任务当前事实复核，QA补真正页面/设备故障/权限验收。提供者读接口不等于Android已经显示，计数不等于运营说明可详情读回，完整任务不据此关闭。

RES-WP14-03管理员浏览器拒绝保持，新UI/Playwright/视觉QA暂停，后续恢复须重读原图/提示词/页面规格，不能换CLI/Chrome绕过。SEC-WP14-01候选凭据人工核查仍未关闭，无关脏脚本仅路径状态。默认授权临时隔离服务和已连接Samsung联调，不扩大真实账号/邮箱/发布/删除；人工或环境缺口记录责任、时点及补验后继续未受阻工程。固定作者结果不是非作者清零，完整WP-20/B2/G3/AC及全部开发仍未完成。
