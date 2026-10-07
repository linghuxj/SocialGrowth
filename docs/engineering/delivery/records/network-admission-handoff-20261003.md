# 网络准入接口阶段暂停交接 — 2026-10-03

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

用户于本轮明确要求“先暂停开发工作，提交现有的 git，编写对应的交接内容”。本记录是开发检查点，不是正式网络准入、真机业务或发布验收结论。暂停时核验时间：2026-10-03 23:40 北京时间。

本记录随代码检查点一并提交；对应 SHA 使用 `git log -1 --format=%H -- docs/engineering/delivery/records/network-admission-handoff-20261003.md` 获取，避免在提交内写入自引用 SHA。

## 接续基线与授权

- 当前分支：`codex/core-automation-loop-stage1`。本轮提交前 HEAD 为 `e13ba3150da1a0e6ca643174d4a8da460a49cd03`；该提交是既有 Android 页面范围确认，不归为本轮开发成果。
- 上阶段固定证据：`d46c66b` 受限策略草案/真实 Tailnet 传输预检；`e5a1013` 可信来源适配及只读控制面检查。详见 `tailnet-restricted-preflight-20261003.md`。上阶段 Samsung 9/9 来源预检仍可复用，但不能用于声称本轮新增 API 或完整链路通过。
- 用户允许直接处理、安装和测试既有 Samsung 与授权素材/账号；**暂不测试撤回，尽量不公开发布**。本轮没有发起撤回、参与确认、配对、媒体操作或发布。
- 已确认只有一台 Samsung；管理端使用 Android 模拟器。双真机扫码尚无条件，不能把模拟器管理端计为双真机验收。
- Google Artemis 继续负责真机 UI 的识别、决策及操作。后续业务验证必须从 Web 经 Playwright 发起；本轮原生 instrumentation 是非 UI 协议补充检查，不能替代该流程。
- 保留 unknown publication `d634e4c6-4266-4cc7-a784-3a31a1737cac` 及既有 6 个 identity unknown 任务，不重试、不改为成功。受保护 `scripts/execute-real-slice-publication.mts` 不读取、diff、hash、运行或提交。

## 本轮已完成的代码

| 范围 | 内容与边界 |
| --- | --- |
| CT-05 独立协议 | 新增 state/begin/challenge/proof 严格请求、当前范围/阶段快照、挑战响应绑定和固定错误格式；拒绝客户端传入节点、修订、限制证据或授权布尔值。快照始终不发放网络及动作许可 |
| HTTP 入口 | `NetworkAdmissionApi` 和 Nest controller 提供四个入口；严格校验版本、输入、安装 bearer、归属范围。主业务 AppModule 没有真实核验 runtime，状态可读取，注册/挑战/证明关闭；正式条件不会从主业务连接借用 |
| 事务约束 | Store 的 authenticated state/begin/apply 在 provider→installation→association/device→enrollment 锁序下校验安装代次、归属版本和有效 session；session 行共享锁保持至提交，再检查撤销/有效期与来源新鲜度。重复签名命令保留原请求键/内容，返回当前事实，不复活历史许可 |
| 来源适配 | `TailscaleAdmissionRuntime` 只使用可信 listener 的 opaque socket handle、实际 WhoIs 和独立的、当前范围的 revision port。缺少控制策略能力或修订时关闭；超时、离线、伪造 handle、陈旧修订、关闭连接或节点/key 不匹配均不产生来源证明 |
| Android 消费层 | 新增严格 snapshot/challenge/error parser、显式 HTTPS verifier client（不跳转、不替换 TLS/主机名验证、有界响应）和只读 state client；调用方须保存同一签名和请求键重试，不能重新随机签名 |
| 本机事实页 | 新增自动读取网络核验事实；检查安装、设备和事实版本相同后才展示。只展示状态，不自动注册、签名、准入或启动参与 |
| 生成边界 | `generate-admission-api.ts` 从 TS schema 生成 Kotlin 字段/阶段/错误清单，纳入 generate 与 generate:check |
| 受控测试工具 | 新增独立 API 核验入口、真实安装会话协议 instrumentation 和手机检查脚本；均不配置真实策略/修订 producer。手机脚本当前在升级准备阶段失败，待下轮修正，不能当作可成功执行的交付脚本 |

主要文件：`product/contracts/src/network-admission.ts`、`product/backend/src/network-admission-api.ts`、`network-admission.controller.ts`、`network-admission-store.ts`、`tailscale-admission-runtime.ts`、`product/android/app/src/main/java/com/socialgrowth/product/NetworkAdmissionApiClient.kt`。

**尚未实现**：服务端真实 networkRevision 生产/持久化、受控策略写入和并发保护、实际受限路径检查、正式凭据及策略 worker、正式 TLS。现有 runtime ports 是工程接口，不是这些外部能力的实现；本轮没有增加网络修订 ledger/migration，也没有编造修订、真实限制或成功状态。

## 验证事实

| 检查 | 暂停时实际结果 |
| --- | --- |
| 项目环境 | pnpm 8.14.0；`pnpm env:check` 确认实际 Node v24.16.0 和 SQLite，未改全局 Node |
| 隔离 PostgreSQL | **26/26 通过**。包括跨安装请求、重复证明、撤销发生于来源观察与消费之间、等待归属锁期间 session 撤销、过期 session、陈旧/无效观察值及原有事务回归。使用独立临时数据库，未用真实库预置业务成功 |
| Node 核心/来源 | **35/35 通过**：admission core、实际来源适配边界和新 runtime 的非 UI 补充检查。运行后又补加 runtime 对已固定 node/key 的前置匹配；该小改动随检查点保存、类型检查通过，但没有重跑其行为测试，后续需补验 |
| CT-05 契约 | **2/2 通过**。新 API 字段/消费主要由上述 PostgreSQL 和 Android 边界检查覆盖；不能称为新增 API 的完整单独契约测试套件 |
| Android | Debug JVM **44/44**，0 failure/error/skipped；主 APK 和 API instrumentation APK 构建通过。最初新测试文件有 Kotlin 声明语法错误，已修正后成功构建。没有发布构建或正式签名验收 |
| backend / 生成 | backend build/check、contracts build/generate:check 已通过；暂停收尾再次执行 backend check。两个新增根脚本没有单独完成严格 TS/lint 检查，后续需补验 |
| 独立入口启动 | 固定 daemon/socket owner→PROXY v1→既有 Debug TLS→安装 API 入口真实启动并正常停止；**accepted=0**。只有监听准备，未收到本轮实际手机 API 请求；不能认定新增真机接口通过 |
| 本轮手机检查 | **失败于 main_package_upgrade**。脚本 `packageUid()` 查找 `userId=`；本台 Android 16 dumpsys 实际为 `appId=10377`，在安装前的 UID 断言处停止。主包 `lastUpdateTime=2026-10-03 13:10:25`，测试包 `lastUpdateTime=2026-10-03 23:10:56`，均保留原版本。已完成原 APK 私有备份，没有进入替换测试包阶段；报告 `testPackageRestored:false` 不表示测试包已被替换。本轮新增候选未安装，11 项真实 API 检查未执行 |
| 本轮 Web | 根 `pnpm test:playwright` **失败**：`http://127.0.0.1:3100` 连接拒绝。当时 Web 入口已停止，旧 backend 孤立运行；随后恢复产品本地服务，但暂停前没有重新执行 Playwright，故仍未通过本轮 Web 验收 |
| 远程 ADB | 当前实际设备列表是 Samsung **USB** 连接。不能将旧无线端口或上阶段证据作为当前远程重连、无 USB 或新版本验收。本轮没有重建无线 ADB |

补充检查中出现的回收/退出用例仅在隔离数据库验证状态机；没有对真实手机测试撤回。Web 未通过、新 APK 未安装、实际策略未变，均不能被编译结果或前阶段证据替代。

## 暂停后的运行与资源

- 已停止本轮临时独立核验服务（9443→4443），实际 `tailscale serve status --json` 返回 `{}`。没有开启 Funnel、修改全局 incoming preference 或应用 Tailnet 策略。
- 临时容器 `sg-admission-http-test` 已停止；其 `--rm` 隔离数据库一并删除。真实 `socialgrowth-product-local-live` 数据库和卷保留，未 reset/drop。
- 本地产品 Web 3100/backend 4320 已恢复运行，暂停时监听 PID 分别为 12758/12748，监督进程为本轮 `scripts/product-local-live.mts serve`。PID 只是当时记录，续接须重新核验。该入口没有启动设备队列消费者；保留服务便于人工查看，未配置新后台守护。
- Samsung：`RFCW40MYYCV`，SM-S9110，Android 16/API 36，USB 实际连接；现有安装身份及数据未清除。device `0fef3177-636c-4b82-8209-1af38134e00f`、installation `b0bf106f-a844-4087-a42b-9cb23899ec9e`，后续只读核对当时状态，不据此直接构造授权。
- `.runtime/product-local-live/config.json` 和 `.runtime/tailnet-control/read-only-oauth.json` 保留在本地私有目录，未提交凭据。当前只具备受控只读 Tailnet 配置。
- 真实策略仍是既有广泛 grant；上阶段草案/校验不等于实际隔离。上阶段策略 SHA/ETag 和草案定位见前述预检记录，重新应用前须重新读取并检查并发变化。
- 临时 Debug TLS 信任仅限本地诊断，证书于 **2026-10-05 04:30:56 UTC** 到期；续接不得关闭证书/主机名校验或拿它作为正式部署。
- 原主/测试 APK 备份在 `.runtime/verifier-phone-probe-*` 私有目录，凭据仍只留在手机 Keystore/本地配置；不将这些目录加入 Git。

## 后续阻断与接手顺序

| ID | 责任与优先顺序 | 处理/验收标准 |
| --- | --- | --- |
| H1 | Android/测试负责人，先处理 | 修正手机脚本兼容本台 `appId=` 的 UID 核对，保留安装前/后 UID 及失败恢复约束；补验脚本类型/lint。先核对没有新鲜参与或在途操作，再 `install -r`；不可 clear data/uninstall 主包 |
| H2 | 后端/客户端负责人 | 对冻结候选重跑新增来源匹配行为检查、构建和所需补充检查。启动受控独立入口，再真实运行 11 项安装会话协议检查，核对真实库前后没有新增 enrollment/授权/参与操作；结果失败必须保留阶段与原包恢复事实 |
| H3 | Web/真机负责人 | 核验 3100/4320 在运行后，从根 Playwright 真正登录、刷新设备和查看明细，保存断言及安全截图；再按 Web→Artemis 方式验收新本机事实页，不能使用固定 adb tap 或原生协议检查替代 |
| H4 | Tailnet 管理员，外部依赖 | 用户已确认管理员账号可用，只读配置已保存；本轮已提前询问受控写配置路径，暂停前未得到新路径。准备本地私有写配置，不在聊天中发密钥；在实际下发前审查具体草案、并发 ETag/摘要保护及恢复方案 |
| H5 | 网络/后端负责人 | 实现真实受限策略操作、路径探测及服务端单调 revision 生产，再连接现有内部 ports。必须真实证明独立入口可达，而 ADB、其他手机、运营服务、业务出口及叠加规则不产生额外访问；缺任一真实检查继续关闭 |
| H6 | 设备执行负责人 | 真实受限链路和 Keystore 绑定后，接续中心许可、首次配对/端点独立上报、后续端口变化及无线重连/无 USB 验收。保留既有可复用证据并标注范围；不要重复列为全未验证，也不要用 USB 在线冒充远程链路 |
| H7 | 全链路负责人，最后 | 接续账号分配、初始化、Page/频道创建编排和业务就绪的真实 Web→Artemis 流程。继续暂不测试撤回，停在发布最终步骤之前；公开发布须遵守现有具体授权边界 |

先 H1–H3 恢复并验收已写代码，H4 可同时准备；H5 的真实策略下发依赖 H4。不要把上述剩余项汇报为已完成。

## 续接命令索引

以下命令记录本轮方式，不表示当前环境自动满足前置条件。已存在服务/配置时不重复初始化；补充检查不替代根 Playwright 验收。

```sh
pnpm env:check
pnpm --filter @socialgrowth/product-contracts build
pnpm --filter @socialgrowth/product-backend check
pnpm --filter @socialgrowth/product-backend build

# PostgreSQL 文件会 DROP SCHEMA，仅允许全新、明确隔离的临时测试库。
SG_PRODUCT_TEST_DATABASE_URL=<isolated_database_url> SG_PRODUCT_TEST_ALLOW_RESET=1 \
pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/network-admission-store.postgres-test.ts

pnpm --filter @socialgrowth/product-backend exec tsx --test \
src/network-admission-core.test.ts src/tailscale-admission-runtime.test.ts src/tailscale-source-verifier.test.ts
pnpm --filter @socialgrowth/product-contracts exec tsx --test src/network-admission.test.ts

SG_PRODUCT_ANDROID_DEBUG_API_BASE_URL=https://macbook-pro.tail3656e0.ts.net:8443 \
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle \
product/android/gradlew -p product/android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest \
-PsgAdmissionApiChecks=true --no-daemon --console=plain

# 真实策略 ports 仍为空，只允许状态与拒绝路径的协议补充检查。
SG_PRODUCT_ADMISSION_PROTOCOL_CHECK=authorized \
pnpm exec tsx scripts/run-network-admission-verifier-check.mts
# 先修复 H1 再运行。须满足独立入口、既有安装会话和无在途参与的条件。
SG_PRODUCT_ADMISSION_PHONE_CHECK=authorized \
pnpm exec tsx scripts/verify-network-admission-phone.mts

SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live \
SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=verify \
SOCIALGROWTH_VERIFICATION_OUTPUT=artifacts/acceptance/product/B3/admission-api-20261003/web \
pnpm test:playwright
```

本轮安全元数据位于 `artifacts/acceptance/product/B3/admission-api-20261003/`：启动/停止记录、手机失败报告；Web 失败 JSON 与遮罩截图留在本地，不以失败截图充当验收。原控制面策略全文、OAuth、安装会话、配对信息、APK 备份及其他私有日志不提交。

## Git 与未提交范围

本检查点只提交本轮明确归属的 CT-05/API/Android/检查脚本、上述安全 JSON 及此交接记录。没有修改或混入他人的 ADR、review 队列、分支审计/清单、`WP-11-stage3.md`、`artifacts/review/`，受保护发布脚本亦保留原未提交状态；不为暂停整理扩建分支、不推送/合并/发布。后续先查看 `git status --short` 和对应作者/记录，再开展协作。
