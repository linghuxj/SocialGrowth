# WP-24 第二阶段：观察窗口与数据就绪校验

2026-10-01接续：原非作者da06e9f/b9b1983及原QA b9b1983完整报告已读，观察范围原9组/1260独立时间对照及39readiness判定在固定源码重跑通过，组合有限工程G1已合Developer@b9b1983。真实来源日历/批准窗口/持久消费者与AC48仍未验证；以下保留作者当时历史。

2026-09-30；基线7f0ee97，feature/wp-24-observation-readiness-stage2。BE/AI实施代理Codex，原非作者/原QA固定门禁；WP-22来源、EX已核验发布、WEB消费、BIZ/TL配置与质量标准分别协作，实名签收及人日待落实。依据R-045/046/092～094、CT-09、AC48、[总卡](WP-24.md)、[需求](../../../current-requirements-summary.md)、[质量手册](../quality-gates.md)。B4第一阶段4448849已原门禁合Developer；父6fc8c30原非作者清零已交QA，7f0ee97在原复核，不由本阶段作者自检合入父链。

## 有限实施与消费者边界

新增内部observation-window-core及12单测，复用已固定metric-snapshot-core，只读无副作用。没有共享公开协议、HTTP/数据库/模型/日历生成/调度/页面/手机接线；原规则不改，UUID、配置及输入标志均不证明真实授权、发布、批准或来源质量。

- 配置项目默认窗口＋四种具体平台/形式唯一覆盖；没有默认时长，不把7天复盘或每日采集套为观察窗。exact_hours以正整数小时；platform_days以正整数日数，当前367个边界/366日为内存数组技术保护，不是已确认业务最长窗，正式配置越界须显式扩展并复验，不能截断或偷偷改变口径。
- 冻结window关联project/configVersion/identity/实际publication/task/contentUnit/variant，校验当前对应输入配置及合法平台/形式；后续须由可信生产者关联实际FK/原批准配置及历史窗口。本函数不从现在配置重算旧窗，不持久化或自动更改已有报告。
- 精确小时窗从actual publishedAt同一瞬间起算，实际ends-start须精确等于配置小时数。只将完整历日秒送Date，任意长小数另按BigInt定宽计算；不舍弃微秒，不用手机时区，不比例拆日汇总。
- 完整平台日消费可信source calendar的实际publicationDay边界、连续完整日边界及原时区/版本标识，不生成或证明TZif/DST。发布在统计日边界时可包含该完整日；中途发布从该日结束开始，首段publishedAt..firstFullDayStart单独返回，保留原数据，不混入后面的完整日比较。合法日形状不等于实际日历批准，23/25小时只输入不同实际边界、不宣称已跑真实夏令时源。
- 只选指定source/report最新显式更正；不累加累计快照，不凭采集较新覆盖旧截止，不将账号级数值拆内容。数据须对应同一原发布范围，实际available且值存在（真实0保留）、来源时区已知、精确覆盖window、截止至少覆盖结束、采集不来自评价时刻以后；累计值更须对应恰好结束的截止，完整日中途发布不可用生命周期累计值推算扣除首日。
- 四态工程之外的内部stage为observing、data_insufficient、ready_for_evidence_review：窗口未到继续观察，已到但缺失/延迟/错范围/未知覆盖等列具体原因。最后一种仅表示可进入**真实证据充分性复核**，不是可比已通过、质量足够、AI选优、完整初期表现、任务成功或执行许可。
- 双内容对齐从原输入重新运行校验，不接受caller伪造ready/comparable：同项目/平台/形式、实际窗口类型/配置长度、source/definition/measurement/original timezone、实际持续时长与发布后偏移均须一致；完整平台日还须同来源日历。同观察/发布或同source report不自比。同天数不自动相同小时/年龄；不同平台/形式/定义不凭时长一致直接比较。返回alignedForEvidenceReview也只是进入质量复核，不是因果或优化授权。
- 输出不新增/取消/停发/重发任务，不替换主指标，不改7天复盘、周期计数或每日采集。实际充分性标准不足只阻对应优化，独立有效日常任务、项目汇总及重大异常路径仍按原权威许可；本阶段没有上述运行消费者，不能声称已现场证明它们继续运行。

## 自检及可复现命令

12项新增backend单测覆盖默认/覆盖与不猜时长、重复配置、平台形式/旧版本/错项目、151位小数/等效offset、精确小时端点、首不足日及边界发布、坏日边界/技术数量护栏、零/缺失/延迟/未来/未知时区/截止及精确覆盖、账号/原发布范围隔离、显式更正保留未知、同日数但23/24小时或不同年龄不对齐、来源定义不一致/伪ready/self comparison拒绝、累计截止不冒充旧时点、输入不变与无grant/调度副作用。合成source calendar不是源平台或DST验证。

首次backend类型检查因never箭头未产生可空分支收窄失败，check-initial.log保留；改为同仓库显式never函数后type/lint及首10项通过，再补2项累计端点/不同长度源日与未知时区护栏后完整根门禁复跑。最终结果写实际日志，不用准备错误隐藏为所有首轮通过。

```sh
pnpm check:product && pnpm lint:product && pnpm test:product && pnpm build:product
python3 docs/engineering/delivery/check_consistency.py
```

证据artifacts/acceptance/product/B4/wp24-stage2-author；本阶段无新SQL/存储/传输及消费者，不重复跑未变PG150/MinIO，不把父结果累计成新增通过。未启动服务或新容器，未安装APK/操作Samsung/Artemis/实际账号/短信邮件或公开发布。Web18只是单元，不是Playwright。

最终产品221/221（42TS＋17Python＋140BE＋4EX＋18Web），失败/取消/跳过0；根类型/lint/build/生成检查退出0，文档结构9文档/230链接/157需求errors空。新增12 backend包含在140及221内，不累加首轮10；文档检查只结构，不证明全部业务语义或真正观察窗口可用。

## 真实缺口与下一步分工

| 需求记录 | 责任/最晚时点 | 解除及继续 |
| --- | --- | --- |
| RES-WP24-01 实际批准配置及可信日历 | BIZ/TL/BE/OPS，正式window生产前 | 配置具体小时/统计日数和历史版本、逐指标真实源时区日界/TZif版本/首完整日规则，持续边界源与FK核验；本规则只消费已批准事实，不用随机calendarId代替 |
| RES-WP24-02 已核验发布与来源关系 | EX/BE/WP-16/18/19/22，正式摄取/评价前 | 正确历史身份/原task与content、实际发布时间和source report/definition；来源精度可支撑该窗口，平台日不能按比例造小时，暂停手机不能为采集重新操作 |
| RES-WP24-03 历史窗口/报告持久化 | BE/AI/WEB，业务更正前 | 原配置与window不重算，补齐/更正关联原报告、多进程/重启/幂等核验，不跨期重计；纯guard不冒充持久完成 |
| RES-WP24-04 真实充分性及比较消费者 | BIZ/AI/QA/BE，内容优化前 | 逐指标单位/样本/延迟/覆盖、可比来源/平台形式与年龄标准事前确认及实证；ready/aligned只候选，不自动放优化。实际调用模型/页面/原计划继续运行由后续真实链路证明 |

原窗口角色及默认服务/连接Samsung授权不变，人工/环境需求记录后继续独立包。RES-WP14-03管理员拒绝及product-design:image-to-code的真实视觉验收约束使新增UI暂停，不换CLI/Chrome绕过，恢复前重读图/提示词；SEC-WP14-01人工核查不关闭，无关脚本只路径状态。完整WP-24/B4/AC48/G3及全部开发未完成。
