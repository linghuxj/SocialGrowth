# WP-09 原生发现 P3 整改：IPv4 链路本地地址

2026-10-01后续：b9b1983原非作者75行及原QA93行报告完整读取，原P3实际清零、新增/remaining0，有限组合工程G1通过；原QA新221产品、两变体各31、独立Samsung6生命周期通过但两端点UNKNOWN，原APK/UID恢复，PG151/17组65HTTP明确仅复用。工作树/祖先/旧tip CAS后Developer已从fad快进b9，不包含WP23/WP10。以下保留作者提交时历史，不改写原RED或把UNKNOWN改为发现成功。

2026-09-30；固定基线 da06e9f，fix/wp-09-ipv4-link-local。AND 实施代理 Codex；沿用原只读非作者及原 QA 窗口，EX/BE/OPS/BIZ 协作职责见[任务卡](WP-09.md)。实际人员签收仍待落实。原 b2-b4-next-da06e9f.md 报告完整读取：新增 1 P3；不自行宣布门禁清零。

## 修复及边界

原 sameAddress 把所有 link-local 都要求为 Inet6Address，导致相同的 169.254 IPv4 地址误拒绝。抽出纯 sameDiscoveryAddress，先比较地址字节，仅实际 IPv6 link-local 额外要求非零且相同 scope。原私有入口委托该函数，网络选择、全部本机地址校验、平台回调、代次/ticket、限时、权限与 UI 均不变。新增三个 JVM 检查覆盖 IPv4 普通/链路本地、IPv6 非零/零/异 scope、不同地址及不同 family。

这只修候选地址比较，不证明当前设备可信、实际端口发现、配对、认证上报或动作许可。没有安装 APK、开系统无线调试、改网络/账号/产品数据，未启动服务。本轮不包含独立 WP-23 提交或尚未提交的 WP-10 核心。

## 实际作者验证

证据目录 artifacts/acceptance/product/B2/wp09-ipv4-remediation-author。未改动原 DiscoveryReview.java：旧编译类 RED 有两个 IPv4 未匹配反例；修复 Debug/Release 各 GREEN，均 2400 状态转换、8 地址案例、15313 普通断言，addressMatchMisses=0/findingCount=0。这是作者复现原探针，不冒充新非作者结论；platformCallbacksRun/businessValidation 均 false。

固定 JBR17.0.9、Gradle8.11.1、SDK36，单次 offline/no-daemon 执行 testDebugUnitTest/testReleaseUnitTest/assembleDebug/assembleRelease/assembleDebugAndroidTest/lintDebug，BUILD SUCCESSFUL。Debug/Release 各 31/31（原 28＋新增 3），失败/错误/跳过 0；三个 APK 构建成功。当前 lint XML **9 Warning、0 Error**，包含依赖版本提示及既有图标/备份/布局/KTX；不把原报告的 7 Warning 机械复用为本轮数量。getAllNetworks 弃用编译 warning 仍存在，没有升级依赖来消除提示。

backend/Web/contracts/迁移/依赖与 da06e9f 的已跟踪源码保持一致，原组合 221、原说明整改 PG151及原 Samsung6生命周期证据仅按原环境复用，未重跑或累加为新业务通过。手机两个 UNKNOWN 不因 JVM 回归变为成功。

## 门禁与接续

原 fad821c 说明微秒整改的非作者与原 QA 完整报告均已读取：0 findings，QA 实际 209 产品/151 PG、17 SQL/Nest 组及65 HTTP断言通过，有限工程 G1 通过；QA PG17.11 与原复核17.10分记。工作树、祖先及旧 tip CAS 核对后 Developer 已从6fc8c30快进 fad821c，未包含本组合或新原生 P3。

本整改先固定提交→同一原非作者复验→原 QA 验证组合范围；通过后才允许合入 Developer。RES-WP09-01～04、RES-WP14-03 管理员浏览器拒绝及 SEC-WP14-01 人工核查保持开放，真实资源责任、解除条件与补验按原卡；缺口不阻独立工程，不绕过浏览器策略。完整 WP-09/B2/AC13/14/G3、全开发尚未完成。用户无关脏发布脚本只路径/状态，未读取、运行、暂存或提交。
