# WP13-KC-01 小范围整改

2026-10-02；基线 `09146dd7e6490030b3b2ca4deeb38f5c3f76de5c`。作者：主开发窗口 Codex；非作者：原复核窗口；QA：原验收窗口。范围仅跨 realm 原生 Promise 拒绝消费，非生产密钥/部署能力建设。

完整读取原报告 `artifacts/review/wp13-key-custodian-0914.md`：527 组中 526 PASS / 1 FAIL，P2 WP13-KC-01 尚未由原窗口清零。原报告、反例和首失败不改。阶段三 QA 完整报告 `artifacts/acceptance/product/B2/20261001T171727Z-wp13-credentials-api-3c0/acceptance-report.md`：518 首次通过、新0余0，仅有限工程，不把其结论转给阶段四。

新增独立子进程反例使用可信 `node:vm` 原生 rejected Promise，strict unhandled-rejections，断言同步安全拒绝、立即清零、stderr为空及正常退出。相同11组首次10 PASS / 1 FAIL；修复仅将 `instanceof Promise` 改为 `node:util.types.isPromise`，不await、不延长租期、不调用任意 thenable。相同11组修后通过；首源码及日志在 `artifacts/acceptance/product/B3/core-loop-stage1-author/custodian-first.test.ts`、`custodian-first.log`，修后 `custodian-fixed.log`。原10断言不改。

没有服务/数据库/手机操作。没有原作者或非作者覆盖计数相加；任意同进程恶意代码不在保证内。原默认null AppModule/真实Store同步copier不变。作者不签原P2清零，凝聚提交后交同原窗口按原反例复验。

最新主线转为管理前端及 Artemis 核心业务串联；真实短信与第二真机延期，WP27/部署观测备份更新回滚留上线前。此次为已报告缺陷有限收口，不扩展密钥运维专题。
