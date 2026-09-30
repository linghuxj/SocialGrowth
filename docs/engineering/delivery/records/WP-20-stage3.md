# WP-20 第三阶段：认证人工说明命令与共同日历修复

2026-09-30；基线662718f，feature/wp-20-assistance-notes-stage3。BE/共享契约实施代理Codex；沿用原非作者复核及原QA窗口，WEB/AND消费、EX/AI真实复核、OPS/BIZ资源职责不变。依据[总任务卡](WP-20.md)、[质量手册](../quality-gates.md)、R-143/150/156与AC23/24/57；实际人员签收、业务与完整WP仍未完成。

## 已实现的有限范围

- Nest新增POST /api/operator/assistance-todos/:todoId/notes，当前Host运营会话＋CSRF；路径与body UUID须同对象，strict契约版本/metadata/版本CAS/kind/text，不接受自报actor、收件人、verified/resolved/恢复许可。no-store，错误沿用安全envelope。人工单行1～150字符为既有存储技术保护，不替代完整协作记录产品设计。
- 复用已复核的持久recordNote事务与中央鉴权、锁序、CAS、actor/key摘要及最终DB钟检查。任意有效同权运营可说明；普通note保留原状态，reported_processed仅awaiting_recheck。原键换requestId/UUID大小写不再写入，返回当前摘要；新影响重开后不能重放旧“已处理”状态。设备、项目、首次通知及执行许可不因本命令改变。
- 返回实际事务结果的公开摘要，不做COMMIT后的第二认证读取，不返回正文/内部历史/凭据。返回投影损坏时是安全可重试INTERNAL_ERROR，不误报400 INPUT_INVALID或暗示未提交；保留原键核实，不能重新创建说明。现有内部load仍读取完整历史，本阶段不自称有分页详情/性能规模证明。
- 共享请求/响应注册、导出、生成JSON及Python消费同步，未改contractVersion常量（向前新增独立schema，无旧写入字段变化）。没有真实事件摄取、sender、AI复核、关闭/恢复入口、Web/Android客户端或Artemis动作。

## 662718f 原复核反馈修复

完整读取原报告artifacts/review/wp20-stage2-662718f.md：新增P3一项，常规176产品/135PG及10组工程探针通过，但**未签findings清零G1**。TS摘要/分页接受0000年而Python抛原生ValueError；实际行政BC时间夹具同样复现，不是当前正常DB钟或普通用户可以造出的业务故障。

本阶段三个摘要响应形状共同限定本地ISO年0001～9999。使用共享完整ISO语法生成带年域保护的单个pattern，生成JSON也拒绝0000/五位年份；保留合法日期、offset、任意长小数的比较，不修改旧63个schema。Python日期解析域外异常包装为ContractDataError（属于ContractValidationError），不泄露原始日期异常。既有schema不扩大为支持公元0年，未静默清洗历史。P3只记“作者已修复，待同窗复核”，不能作者自报清零。

## 检查与复现

原始日志在artifacts/acceptance/product/B2/wp20-stage3-author。首次新增夹具幂等键短于既有16字符保护，contracts测试失败；initial-fixture-failure.log保留，修正夹具而非放宽业务校验。初轮138PG通过；加入实际BC投影与提交后安全未知回归后重跑最终139/139（原135＋4），失败/取消/跳过0，不把旧轮替代最终版本。新四组：第二运营报告/UUID与requestId重放/新影响返回当前open且设备不变；非法权限/CSRF/异载荷/陈旧CAS/撤销重放无额外写入；真实COMMIT仅回执丢失，原键恢复一次；行政BC历史GET安全失败、POST已提交而投影不合法返回安全可重试未知，重复原键仅一说明/命令/审计。

最终产品181/181（40TS＋15Python＋104BE＋4EX＋18Web），失败/取消/跳过0；根类型/lint/build/生成检查通过，最后service错误分类调整后又跑backend check/lint。原独立176组正常年域对照原样运行差异0；新增calendar-parity.mjs跨三个形状33组（域外拒绝、0001/9999、边界offset、微秒/200位小数真序逆序），Python无非契约异常，原63个schema逐项不变。文档结构检查9文档/226链接/157需求无错误，仅结构非全业务语义。

```sh
pnpm env:check
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<已核对新隔离可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

本轮专用PG17.11 sg-wp20-notes-stage3-pg，回环32851/sg_notes，完整ID25f33c18007b918f21efc832fd1009b2fd2cd748aa1f7e305688beb6d6f200ca，AutoRemove。测试合成会话、事项、设备、BC时间及丢回执仅非UI补充，不证明页面登录、实际人工处理/短信/网络/邮件或手机恢复。最终schema/其他client/deadlocks均0，按精确ID核验后仅停止本轮实例，可重建夹具随AutoRemove清理、原日志保留；原服务与手机不动。

## 分工与独立继续

RES-WP20-01真实event/occurrence来源（EX/BE/AND）、02有效联系人及受控邮件sender/送达/未知核实（OPS/BIZ/BE）、03真实模型/人工复核及当前权限重查后的恢复（EX/AI/BE/WP-11/12/16/QA）、04认证详情/同事项跨端消费者/项目合并（WEB/AND/BE）仍缺，责任和最晚时点按总任务卡；不能用测试写库解除。

RES-WP14-03管理员浏览器控制拒绝保持，新UI/Playwright/设计捕获暂停、不换CLI/Chrome绕过；后续UI开工须重读原图、提示词及规格。SEC-WP14-01待人工受控核验，不接触无关脏发布脚本。默认服务/已连接Samsung联调授权有效，不扩到真实发布、邮件/账号或候选凭据验证。继续未受阻契约/后端；代码合并须原固定版本复核及对应工程QA，G3/完整WP/B2/全部开发不宣称通过。

后续原2ffa860非作者完整报告wp20-stage3-2ffa860.md及原QA完整报告artifacts/acceptance/product/B2/20260930T124108Z-wp20-stage2-stage3-2ffa860/acceptance-report.md均已读取：原P3实际清零、新增0，独立181/139及176/99两端对照、分页/说明各10工程组通过。原QA范围447eda5..2ffa860共20文件包含阶段二＋三，不误写成只16文件；未计真实UI/Artemis。仅本root执行工作树/祖先/旧tipCAS检查后，Developer由447eda5快进2ffa860，不含后续B4/本人投影。旧662 P3报告不追溯改通过，实际来源/邮件/客户端/复核恢复与G3仍未完成。
