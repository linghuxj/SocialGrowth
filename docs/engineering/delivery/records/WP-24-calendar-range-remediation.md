# WP-24 日历范围边界整改与历史规则回归

2026-10-01；基线63b9cae4c57473e20d7ac3fd95bd3962b3b58d57；fix/wp-24-calendar-range-boundary；BE实施代理Codex，原非作者/QA固定门禁及BIZ实际日政策待签。[日历原阶段](WP-24-stage3.md)、[质量手册](../quality-gates.md)。

作者继续检查发现范围不一致：schema只核对输入标签年，`2000-01-01T00:00:00+14:00`转UTC民用日期1999-12-31，原代码只在shifted检查范围，可能保留范围外publicationDayStartsAt。不是假年份/时间精度或真实批准漏洞，但违反声明的六区/2000～2099civil范围。新增回归首10=9PASS+1RED、失败Missing expected exception，原8与新历史组通过；范围组在第一条失败，不将未执行的另一个上界case计作首次已过。首日志保留，不改既有8组或用户范围以掩盖。

最小产品修复只有一行：实际sourceTimeZone civil(pub完整秒)的year必须2000～2099，边界构造之前否则CIVIL_BOUNDARY_UNRESOLVED；原输入标签年检查与每次shifted范围也保留。这里是标签年/civil年技术profile，并非要求所有生成UTC字符串的year也在同范围：上海2000-01-01午夜对应UTC1999-12-31是合法civil2000边界，不要把时区换算误判。未放宽zone词表/dayStartsAt/days/tz版本/gap-overlap/精确fraction或旧比较窗口，仍sourcePolicyVerificationRequired及双false，不增加平台政策/来源信任/许可。

新历史组确认NY2006-03-12正常24小时、2006-04-02春23小时、2007-03-11春23小时，以及Apia2022-09最后周日已无DST仍24小时；不能将现行美国春转换日期套全部历史或把Apia过去DST无限延续。依据[IANA North America规则](https://data.iana.org/time-zones/tzdb/northamerica)与[Australasia规则](https://data.iana.org/time-zones/tzdb/australasia)的历史参考，实际转换仍Node ICU78.3/tz2026b；本组件不下载/IANA TZif导入，不将网页current源码版本等同本机实际安装版本，也不改变平台已批准统计日。

修复后同10指定全pass，根env/check/lint/test/build exit0，409=59TS+33Python+295BE+4EX+18Web，失败/跳过0；作者指定10包含原8、新历史1与范围1，不与根重复累加。证据`artifacts/acceptance/product/B4/wp24-calendar-range-fix-author`：unit-first/unit-green/env/check/lint/test/build/consistency；Node24.16.0真实项目路径/SQLite与ICU版本另有记录。共享93JSON/21SQL/根lock/Android（Git语义）/Web/executor与基线不变；无服务/Redis/PG/浏览器/手机或外部账号连接，不认领以前actualPG/Redis/父来源13，本纯工程不能替代Playwright/真机/平台发布。

## 原报告读取与下一门禁

原QA9f完整59行`artifacts/acceptance/product/B3/20261001T024359Z-wp16-queue-config-9f5812f/acceptance-report.md`已全文读取，SHAd1e7492e84be1f896645963b26363dc04ab79d6934d8bc82c23e0779efcde108：两固定运输11＋整改7并集12路径/最终9f限定快照，当前3/原2重叠不累计、真实Redis8/原独立10/三入口1组9调用首次pass；P2在原非作者与QA实际清零、新0、QA新增oracle0。原75源文件before/after及32/24/28/10证据保持，原RED/e4ba…与9次缺陷确认只保留不当绿，作者389/404非该窗口新增覆盖。一个aux早读未生成build.log诊断保留，不改产品断言；12脚本96规则deny-warnings0。新ownRedis47470b32/唯一8ab96f卷/网络runID6ffdba2与完整归属守卫、DBSIZE0/clients1/AOFyes/noeviction后精确清理，5编译产物指纹保存、仅自有快照清理。限定运输双工程门禁通过，不清父WP10来源pending1/Developeraf14或真实派发/灾备/UI。

原非作者目前复核145c..cc41881 pending引用严格9文件；原backup546d35b/日历ccc4707/恢复清单63b9cae/本整改各自待固定门禁。后续日历可限定原546..ccc六路径＋此整改卡，从最终修复tip导出，共七允许路径，校验本代码相对ccc只一行范围修复及两新组，不纳backup/outbox/后续源；既有阶段历史/作者首RED照留，原窗口判断是否需先独立旧日历报告再固定整改，不作者自认全绿。

原三窗口职责及默认隔离服务/Samsung授权已在memory复查仍一致，新固定任务发送与读取已有报告不重发/不改模式不变。RES-WP24-01～04要求真人批准policy/config/history、真实pub/task/path与指标/模型/UI，记录真实输入/责任/解除条件继续，范围修复不关闭这些。保护脚本仅路径状态/SEC/browser限制及父来源pending1保持，不换入口/模式重试受限探针，不动Developer；所有WP/全部开发/AC/G3未完成。
