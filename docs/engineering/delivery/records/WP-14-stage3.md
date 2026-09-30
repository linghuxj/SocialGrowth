# WP-14 第三阶段：未批准的项目规划输入草案

2026-09-30；编码基线5227127，分支feature/wp-14-planning-drafts-stage3。BE代理实施、契约同步，原非作者固定提交复核，原QA工程核验；WEB待环境解除后接真实页面，BIZ真实业务输入及实名责任待落实。依据R-017/125/131/132/153～156、[需求基线](../../../current-requirements-summary.md)、[工作包](../work-packages.md#wp-14-项目批准范围与资源约束)、[质量手册](../quality-gates.md)及[总任务卡](WP-14.md)。AC25/26仅作为工程输入，不签署业务验收。

## 本阶段范围

- 新增strict规划输入契约：正式开通前/后目标说明、正式开通后广告收益/引流优先级、人工国家/语言标签、FB视频/图文/YT Shorts/常规视频允许形式、内容规则说明、业务时区、首次周期起点、复盘间隔、项目每周期引流最低数量、小时观察窗、结束收尾天数、每日项目总发布数量上界及发布有效窗口。国家/语言和规则说明是人工草案标签，不是可执行批准范围、完整语言/国家字典或机器规则；最长150字符为输入保护，不宣称完整策略编辑器。
- 允许缺项，空数组/null表示未配置，不表示全部允许或无约束；没有把候选国家语言、图稿6项、7天、时区或其他演示值写成已采用默认。引流最低数量可明确为0但不默认0；数量均安全整数。时区最初采用Intl/ZoneInfo，原复核发现大小写兼容差异，已按下述整改为共享区分大小写的固定enum；部署实际时区数据及转换仍须单独核对。窗口端点按精确时间比较、结束不含，超长小数不经Date.parse截断比较。形式只限首期四种，列表有长度保护并拒绝精确重复；大小写或不同人工标签不能据此宣称真实地域已去重。
- 返回永远unapproved_draft，携带projectFactVersion/draftVersion、保存时间/实际会话运营；未保存version0只允许完整空输入且无保存来源。没有批准、AI生成、平台正式资格或执行许可字段。
- 新增0010草案/同键命令，只在preparing项目上读取/保存。运营同权、Host会话及CSRF，HTTP路径与body项目相同、no-store；GET/POST /api/operator/projects/:projectId/planning-draft已在正式Nest模块接入，但没有Web消费入口。不是对外公众接口。
- 与项目/资源保持operators表元数据锁→actor/session→project。projectVersion＋draftVersion CAS；草案改动同事务递增两版本、保存输入/来源、最小审计和actor/key摘要；同输入不增加两版本/保存时间/审计。三列表按集合排序后求摘要，requestId不参与，结果未知可以同actor/key返回该项目当前草案而非重复写入；异载荷或不同项目不能复用原键。锁后实际DB时钟再次确认会话，审计/SQL/认证失败回滚且不泄漏原SQL/cause。
- 修改草案不会开启周期、不改变正式资格阶段、不形成方向批准、不派发任务。首次周期配置现在只是草案，不建立实际运行周期；运行中的项目不允许走此筹备接口，未来WP-24必须按R-132下周期连续生效，不能以此入口重设当前边界。
- additive JSON/Python契约扩展，补充Python minItems/maxItems与重复/窗口/时区/保存来源语义，既有Android消费字段及协议版本未变。旧项目基本页面仍真实显示目标尚未配置：本阶段未连UI，不用新增后端夹具冒充页面已显示保存状态。

## 已执行与未验证

项目环境pnpm8.14.0、Node24.16.0及SQLite通过。根check/lint/test/build通过，产品155（35TS＋12Python＋86BE＋4EX＋18Web）。新增2项TS、1项Python语义、2项HTTP非UI单测。第一次直接backend check使用旧contracts/dist导致6个导出不存在错误，先build contracts后检查通过，不是运行期错误或静默跳过。

PG17.11隔离全套首轮115通过；补齐完整0001～0009已有schema上的前向0010、真实COMMIT已成功但仅回执丢失、最大版本拒绝三个测试后118通过。收尾自查发现PG输出canonical小写UUID与请求原大写比较可能阻断原键接续，已在摘要/命令匹配前规范项目UUID、读取同样规范，新增大写首次写入/原样及小写同键重问同一对象断言。最终完整 **119/119**（原106＋规划13），失败/取消/跳过0；修正后backend check/lint/build再次通过。含部分草案/无缺项猜测、同键重启当前重读/集合重排、防重复、无改动、两同权运营竞争、基本信息与草案互相版本冲突、CSRF/撤销/停用/未知项目、审计故障全回滚、真实观察project锁等待且DB钟越过session期限后拒绝、存量JSON污染失败关闭及overflow。数据库是合成非UI事务夹具，不是真实运营输入、业务批准、页面成功或平台任务。

原始证据artifacts/acceptance/product/B3/wp14-stage3-author，postgres-tests.log为早期115，postgres-final-tests.log为118，postgres-canonical-uuid-tests.log为最终119。root-final-gate.log为收尾UUID规范前完整根检查155项；该规范后backend check/lint/build及完整119PG再次通过，未改契约/Web/单元测试，明确各执行版本不冒充重跑。命令：

```sh
pnpm env:check
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
SG_PRODUCT_TEST_DATABASE_URL=<本阶段明确隔离可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend test:postgres
```

本窗口容器sg-wp14-planning-pg，完整ID c9133ee081f1306fba1c3ca8b1165b961833ac6ee23403851f62a446c2c1ad33，回环32844/sg_wp14_planning，只用于非UI补充；checks schema、其他DB活动连接、deadlocks最后均0。无Web/backend/Artemis服务或队列消费者，无手机/外部账号操作。核对完整ID/AutoRemove后停止专用容器，可重建夹具删除、原始日志保留，其他窗口容器及原MinIO不动。

收尾UUID规范另建sg-wp14-planning-final-pg，同空端口/库名但完整ID9807482451d5dc5407e713c2ccd856b9f2bb2da7834514f3116683113c09eb88，不复用已删除旧库；119项后schema、活动连接、deadlocks仍均0。只停该精确ID及AutoRemove删除可重建夹具，日志保留。

## 真实缺口与后续

### 原复核P2及整改

已读取原窗口报告artifacts/review/wp14-stage3-c039407.md：c039407仍有1/P2，155产品/119PG及其他探针通过不能抵消时区跨语言差异，因此未合Developer。作者用原330项探针、Python3.12.12和真实TZif字节的区分大小写ZIP来源复现24项TS接受/Python拒绝，red-cross-runtime.log保留断言失败；没有修改原复核探针。

fix/wp-14-case-sensitive-timezones仅从c039407分出整改，不混入未过门禁的WP-15。提交固定554个真实TZif规范键/已声明别名，来源系统2026c-rearguard与Node24.16.0/ICU78.3/tz2026b可识别键的交集；刷新脚本须显式指定源目录、手工执行并复核diff，不在install/build/start自动生成环境相关词表。Zod enum直接产生JSON enum，Python只消费同一生成约束；UTC/Asia/Shanghai/Asia/Kolkata/Asia/Calcutta/US/Eastern/Etc/UTC/Etc/GMT+8保持原规范写法，不对大小写做猜测或隐藏转换。6种非规范大小写及未知键在请求解析、摘要和SQL之前即拒绝；没有旧数据静默改写或迁移历史。历史污染值仍安全拒绝，不宣称已有真实存量均清理。

共享词表是配置契约，不是执行环境时区转换成功证明。WP-24真实调度必须另核验所需TZif可用、版本、DST/本地时刻和实际转换；缺数据不得退到UTC或解读为无限窗口。全部554键/null的四种契约形状正向及原6大小写/未知/空白负向、保存不隐式改写已有别名补充覆盖；原330项区分大小写ZIP探针最终差异0。新增PG实存规范US/Eastern、同键重问/只写1命令1审计及6种大小写零命令/零审计/草案版本不变，完整120/120通过（原119＋1），没有业务输入或平台成功夹具冒充真实验收。

整改首次根检查因已有负向测试把Asia/Unknown作为窄enum静态类型失败，保留root-initial-negative-fixture-type-failure.log；测试调用辅助输入改为unknown，与正式服务验证边界一致，不以类型断言把非法值标合法。最终根check/lint/test/build通过，产品157（36TS＋13Python＋86BE＋4EX＋18Web），原始证据见artifacts/acceptance/product/B3/wp14-stage3-timezone-fix。PG17.11隔离实例7ec1c6bc23987321e9a5fe32fcbf61dbb4781b96261cef793bf56ebb0671cab5，回环32844/sg_wp14_timezone，末次schema/其他活动连接/deadlocks均0，已核验ID/AutoRemove后停止；可重建夹具删除，原始日志保留，原有PG/MinIO及复核窗口独立32902实例不触碰。无新浏览器、Web/backend/Artemis或设备操作。整改后仍须原窗口清零及原QA门禁，不自签通过。

| 记录 | 真实输入、责任与最晚时点 | 解除条件与可继续 |
| --- | --- | --- |
| RES-WP14-03 浏览器策略服务不可用 | 运行环境维护方，任何新产品页捕获/设计验收前 | 原QA固定6394cde再次收到管理员控制拒绝。按image-to-code/design-qa暂停新UI实现和视觉交付，不换CLI/Chrome/代理绕过该目标。设置原图project-settings-v1.png/原提示词、页面规格§3及DESIGN作为后续UI依据；当前无新截图或视觉通过结论。先完成后端、契约和事务工程 |
| RES-WP14-07 真实目标及可执行范围 | BIZ/TL确认国家语言的真实规范标识、两阶段目标/优先级、内容形式/规则/数量边界/有效窗口/周期/引流/观察口径，实际批准前 | 人工标签先保存为未批准草案，空项不扩权；将真实输入映射到严格机器范围、版本及缺项校验后形成AI方向，不能拿测试例替代 |
| RES-WP14-08 方向生成/批准及资格事实未实现 | AI/BE＋BIZ落实实际模型服务、非敏感事实输入/输出及正式开通证明，WP-17/方向批准前 | 没有固定模板冒充AI、模型提供方未从Demo推定，未读取候选凭据。后续真实模型端口＋范围校验＋实际运营确认、不可变批准版本、逐身份正式开通生效链路继续；本阶段没有批准按钮 |
| RES-WP14-09 运行周期/观察覆盖 | WP-24/22 BE/AI/QA落实首次本地时刻及DST处理、平台/形式覆盖或完整统计日口径、真实效果来源，正式周期运行前 | 当前仅小时草案值，没有建立运行周期/完成数；R-132及迟到更正、最低数不补到下周期、数据不足不优化仍须独立实现/验收 |

G1等待原非作者固定提交清零及原QA工程核验。完整WP-14、B3、G3、所有开发均未完成；资源/方向批准/素材/执行/反馈等剩余包见台账。不把环境延期或扩展预留记成实现完毕。

2026-09-30已完整读取原整改报告artifacts/review/wp14-stage3-remediation-28276f2.md：28276f2原P2实际清零、新增P0～P3=0；157产品/120PG、原默认与区分大小写330、15544四形状对照、5组实际服务探针通过，旧红例和历史污染失败关闭保留。第三阶段工程G1非作者复核通过，已交同一原QA独立工程复验；仍未合Developer，不扩大为时区转换/DST/调度、UI、实际批准或G3通过。
