# WP-24 第三阶段：版本固定的运行时日历边界

2026-10-01；基线546d35b，feature/wp-24-runtime-calendar-stage3，BE实施代理Codex；AI/BIZ/OPS/EX/WEB/原非作者/QA真人待签。[原观察窗](WP-24-stage2.md)、[质量手册](../quality-gates.md)、[CT09](../contract-checklist.md#ct-09-反馈周期与业务-ai)。

领取server-only ICU实际日历转换，explicit sourceTimeZone/dayStartsAt/tzdataVersion及calendarId/days/实际publishedAt声明；无默认午夜/手机时区/平台规则批准，不创建真实publication或比较资格。只支持明确列举六时区及2000～2099技术范围，gap/overlap截止关闭不自行选择，366日界限沿原技术护栏。OPS扩展实际支持区/日期与更新版本需补测试；BIZ确认平台统计日截止/历史规则、EX核验真实发布、BE固定批准policy/FK与历史版本仍需实际producer。

计划实际Intl/ICU固定版本→精确任意fraction首完整日选择→真实DST边界与gap/overlap/skip日反例→原window消费相容检查→产品检查/凝聚提交/原门禁。无新公开schema/SQL/HTTP/模型/Task/手机、UI或调度，不修改原数据可比/恢复规则；sourcePolicyVerificationRequired/双false，不认为计算时区就是平台日界或真实批准。人力/环境缺口继续RES-WP24-01～04，原三窗口模式及默认服务/Samsung授权/保护脚本仅路径状态/父pending1/Developeraf14/browser/SEC保持，全部开发/AC/G3未完成。

## 实现与实际验证

只支持UTC/Asia/Shanghai/America/New_York/Europe/London/Australia/Lord_Howe/Pacific/Apia、输入时间年份2000～2099及转换后相邻civil日期同范围；这不是全部IANA时区支持或物理TZif归档。实际Node24.16.0、ICU78.3、tz2026b，显式expected版本与实际不一致立即关闭。显式日截止HH:MM:SS；±72小时逐小时取实际offset并逐候选精确roundtrip，gap/overlap/跳过civil日不猜early/late。此算法的范围是上述六区与技术日期范围，不能自动扩成任意时区/历史规则支持。

Date只处理完整秒以定位civil日期，原任意fraction比较复用精确时间函数；恰在截止可含发布日，晚哪怕512位小数的最末一位也只从下一完整平台日开始。部分发布日原时间保留、整日边界允许23/25/23.5小时。输出新的日历/边界，不改输入或旧window；provenance不是当前批准policy/FK或真实发布来源证明，sourcePolicyVerificationRequired=true、executionAllowed/publicationAllowed=false。现有纯window可消费形状，但正式writer必须核验批准来源及固定历史版本，不能运行时版本升级后重写旧窗口。

指定8组首次通过：NY春秋23/25小时、512位小数与等价offset、Shanghai显式10点截止、NY不存在/重复截止及Apia跳日关闭、London23小时/LordHowe23.5小时、版本漂移/strict范围、闰年366日连续/对象隔离、旧window兼容与许可false。美国2026转换日期参照[NIST DST说明](https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst)，实际结果由固定ICU运行证据确认；公共Node Intl文档读取一次InternalError只是资料访问诊断，不是产品失败或浏览器验收。

作者日志`artifacts/acceptance/product/B4/wp24-stage3-author`：env/check/lint/test/build退出0，根403=59TS+33Python+289BE+4EX+18Web，失败/跳过0；指定8首日志另存，不与根重复累加。`pnpm env:check`提供真实Node/SQLite，runtime-version.log记录实际ICU/tz；`python3 docs/engineering/delivery/check_consistency.py`仅文档结构通过。93原JSON/SQL/Android/Web/executor与基线无Git语义差异；不声明raw Android CRLF字节或未运行的PG/Redis覆盖。未启动或接触服务/容器/浏览器/真机，无新公开副作用。命令均单次退出，非UI补充不替代Playwright。

## 原报告读取及后续门禁

原QA b0b8完整56行报告`artifacts/acceptance/product/B3/20261001T020015Z-wp16-contract-b0b8cb2/acceptance-report.md`已全文读取，SHA22379910e6f9812df144a0610d595a9156b60f39bf5282d60687202d22944f34：BE3/TS5/Py5/原独立9通过，543语义case含202精确时间case与84分类含拒绝；QA新增oracle0。原27/32RED/22/11/29证据指纹保留，首snapshot尚未导出ENOENT辅助诊断同脚本重跑0；无服务/DB/浏览器/手机，自有快照已清理。结合原非作者新0，该纯契约有限双门禁通过，不清父pending1。

原非作者145c完整55行报告`artifacts/review/wp16-recheck-queue-145c3c5.md`已全文读取，SHA69b62e840e492b3f874e9e3b618c960eb9774b521ab13a7fad9bfa16a7a71d8b：新增WP16-145C-01/P2/remaining1，原配置2/Redis8通过，独立10=9PASS+1RED，另9纯配置复现只是缺陷确认。无效URL的refinement原生异常带完整endpoint；未观察真实秘密泄露，不触碰SEC保护脚本。原RED/辅助诊断/19锁条目vs14安装项分别保留，自有Redis f77d488及唯一46f286卷精确清理，原服务未动。先独立修复并交同一复核窗口，不能向QA称145c新0；cc41881/546d35b/本阶段待各自固定原门禁，不由本阶段根403代签。

RES-WP24-01～04仍要求真人平台日政策、批准配置/历史日历版本、权威发布/任务/路径、实际指标与模型/UI签收；工程日历补齐不关闭这些。阶段性凝聚提交，下一项优先修复已发现P2；默认服务/Samsung授权有效，人工缺口记录继续，全部WP/AC/G3未完成。
