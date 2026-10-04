# 阻断整改与管理端／真机关联联调

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02 夜间至 2026-10-03；承接用户“解决目前仍阻断的问题，需要人工协助提前告知”。输入提交 `a531d0006aabe72298ca209affc92df8b5cb8c1e`，沿用 `codex/core-automation-loop-stage1`。当前已解除本地正式后端不可用、管理端资源不足、电脑 Tailscale 未连接三项联调阻断；完成实际管理端开发注册与 Samsung 扫码关联。已收到真实手机参与及撤回回执，并完成 Demo Web→Artemis 自有客户端操作；后台返回后的参与状态检查失败，远程控制准入、正式 Artemis 检查和原未知结果仍未验收通过。作者验证，不代替独立 QA，不清父 pending，不合入 Developer。

## 实际范围与配置

用户仅有 Samsung SM-S9110／`RFCW40MYYCV`，明确接受电脑 Android 模拟器作为管理端继续联调。同机切换管理／执行不符合现有专用执行端边界，未实现该绕行方案。管理端使用既有 `Medium_Phone_API_35` AVD 的独立只读冷启动实例 `emulator-5556`，不保存快照、不覆盖原 AVD；Mac `webcam0` 为扫码相机。双真机光学扫码验收仍未验证。

新增 `scripts/product-local-live.mts`，为本次人工联调提供可恢复的自有回环环境：Web 3100、backend 4320，PostgreSQL 17.11、`127.0.0.1:55432/sg_product_local_live`。容器 `socialgrowth-product-local-live` 与唯一命名卷均带专属归属标签，私有配置保存完整容器／cluster 身份和独立凭据；恢复时比对原身份，不重建或轮换会话。迁移 0001～0030 按原 SQL 应用，工具迁移账本保存 SHA256，单项 SQL 与账本同一事务，整个迁移过程持独立 advisory lock。没有预置手机、归属、网络准入、控制权或业务成功状态。

实际服务为显式授权下的前台进程组；退出仅停止自有 Web／backend，数据库保留以免打断人工操作。没有安装后台守护、启动正式 executor 或消费队列。开发短信按 R-157 使用回环内独立令牌保护的 capture 通道，不是真实供应商短信送达。私有配置及邀请码位于 `.runtime/product-local-live`，目录 0700／文件 0600，不进入 Git。

## 修复与补充检查

- Android 旧会话被拒绝时新增显式“重新验证本机身份”，沿用本机根凭据，不自动认领旧设备、解除暂停或恢复参与。已有加密身份损坏／缺钥时拒绝静默生成替代身份；更新身份／代次时清除旧关联码，相同身份续会话保留原关联信息。
- Demo 人工发布结果复核现在同时检查未决 identity_jobs；同机／同账号／同项目仍有 unknown、running 或 interrupted 时保留相应暂停。损坏记录拒绝复核并回滚，不重发、不修改初始化结果。
- Android `assembleDebug testDebugUnitTest` 通过，JVM 36／36（新增两项身份／代次补充检查）；runtime 构建、89／89 补充测试通过，lint 退出 0，保留既有两项 unused warnings。它们不代替实际 Web 或手机业务验收。
- 当前 APK SHA256 `b5a5c1e687e211ba23a96b6fa60905817930c17af46a848f1842352bd50a7f15`，实际 `install -r` 安装 Samsung 和本次模拟器，不卸载主包或清数据。见[安装结果](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/current-install.json)、[本轮 Android 构建日志](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/android-current-build.log)。前阶段真机 Keystore 10／10 仅复用其原证据，本轮没有重跑或外推。
- 三个本地联调脚本通过独立严格 TypeScript 检查；开发协助助手只读当前库、核验 DB／cluster，并读取用户在真实 App 请求的本次开发码，注册仍由用户在 App 提交。用后删除私有码文件，不输出验证码／令牌。

## 已发生的真实操作

实际 Playwright 从正式 Web 登录、填写邀请表单、点击创建；当前单次邀请 ID `397eac1e-0efb-4e18-bac4-221b5df7ad55`，上限 1／有效期 1 天。用户在模拟器实际填写开发号码、获取验证码、注册并进入管理；在 Samsung 打开本机安全身份页，以模拟器真实相机扫描手机二维码并明确确认关联。没有用业务 API／数据库写入或 Mock 替代这些操作，没有固定 ADB 点按／输入脚本。

Playwright 随后从实际 Web 核验邀请 `1 / 1`、1 位提供者，进入“账号与设备”→“手机”、点击刷新、选择提供者并打开 Samsung 详情，断言唯一设备真实行的状态“已关联 · 待完成接入”、连接确认“未知”。不是从筛选下拉框中出现相同文字推定设备状态。真实 device ID `0fef3177-636c-4b82-8209-1af38134e00f`，安装代次 1。证据：[注册 Web 结果](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/web/registration-result.json)、[关联 Web 结果](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/web/verify-result.json)、[Web 设备详情截图](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/web/associated-device-web.png)。

用户连接电脑 Tailscale 后，实际状态 Running／本机 Online，Samsung Android peer Online；实际 `tailscale ping` 到该 Samsung 成功，约 243ms。该事实只证明本轮两端 Tailnet 可达，不证明系统自动网络准入、业务出口、ADB 授权或控制路径互斥；只读端口属性未提供无线 ADB TLS 端口。见[连通摘要](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/tailnet-connectivity.json)，原网络清单保留私有，不进入报告。

## 真实参与、Artemis 操作与失败收口

后续无线 ADB、USB 拔线、真实后台断续诊断和新候选修正，见[无线真机验收记录](remote-adb-native-acceptance-20261003.md)。下文保留原阶段事实，不将后续修正改写成原任务通过。

用户找不到“确认当前参与”时，只读核查发现 Samsung USB 已断开；本轮 debug App 访问手机回环 4320，经 USB reverse 连接电脑后端。用户重新插线并解锁后，恢复本次 `tcp:4320→tcp:4320`，没有重关联或改写其他转发。用户点击重试后实际显示本机设备事实，再由用户本人点击确认参与。用户报告“显示失败”，但随后实际页面显示“本机参与已确认”，只读中心回执与前台服务检查也确认参与成立。

真实 run `4a3fbd16-6379-4fa9-926d-30f7f6522c43`，安装／关联 scope 一致；收到持续更新约 12 分钟的回执。01:27:37 补充核查 sequence 189；01:29:09 核查 sequence 211、确认时间 01:29:06.904、有效至 01:29:16.904。两个 actionPermissionGranted／stopConfirmed 均为 false，control generation／journal 均为空；这证明当前客户端参与确认工程流程，不能证明正式控制准入。

用户随后明确要求直接操作手机测试。新增 Demo `client_test` 诊断模式，仅绑定自有包 `com.socialgrowth.product`；拒绝凭证、登录提交、安装、平台身份创建和发布，仅用于现有参与后台与撤回。仍使用原 Google Artemis Pro 配置和 SDK checkout，未改 SDK、未启动 worker、未消费正式队列。它不替代正式物理控制门禁，也不宣称所有宿主路径已受控。

根 Playwright 从实际 Demo Web 申请本次设备接管、填写平台／包／模式／说明、勾选范围并启动任务。任务 `f2c1e17c-8e49-4b3d-bc27-99a47ee57dcb`，trace `2df07606-9fce-4602-99b2-7c85ae7783d5`，01:27:59～01:31:23。Artemis 自主识别并普通 Back 返回 launcher，等待 30 秒，再进入自有 App，点击撤回。没有固定 ADB 点按／输入脚本，没有 FB／YT 操作、登录或公开发布。

**本轮后台验收失败，不能记为通过。** 原模型输出 CLIENT_TEST_COMPLETED，但原 checker 为 3 passed／2 failed／0 inconclusive：重新进入 App、点击撤回前，页面显示“当前确认已过期”，没有满足仍有效参与的断言；保存的简要 note 也未包含要求的 JSON 字段。Agent 在状态异常后仍执行了撤回，未按原提示在失败点停止。后台状态失败根因尚不能确认；没有把它直接归为纯页面恢复问题，也没有以 earlier pulse 推定 30 秒全程有效。

实际中心收到 sequence 217 的 withdrawn 回执，run revoked_at 为 01:30:14.037，validUntil 等于 checkedAt，scope 一致，两个权限／停止字段仍 false；01:33:44 再核查仍 sequence 217，手机参与服务及 foregroundService 均不存在。撤回事实和后续确认停止已证实；journal 仍为空，没有实际 stop_requested 记录，不能把本机服务退出记为手机所有控制路径停止。

首轮 Playwright 仅断言模型完成码，错误地将此测试记为脚本成功；保留原 result.json 与截图供追溯。随后修复 runtime 完成判定：客户端完成必须有 completed checker、非零 passed、零 failed／inconclusive 及后台／撤回字段，否则 UNCONFIRMED；Web 对旧矛盾回执明确显示“客户端验收未通过”，不改历史库记录。补充 Playwright 失败计数断言，并从原真实 Web 卡片再次核对失败提示；reconcile 模式不重启任务、不点击参与、不写业务状态。runtime 92／92 补充检查通过，build／lint、Web 类型及脚本严格类型检查通过；lint 保留既有两项 warnings。最初从根运行 tsc 未找到命令，改用 Web 工作区的已有 TypeScript 后通过，未安装工具。

证据：[原检查核对](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/client-artemis/checker-reconciliation.json)、[实际 Web 失败回执核对](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/client-artemis/original-web-reconciliation.json)、[Web 失败提示](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/client-artemis/original-web-reconciliation.png)、[撤回后补充状态](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/client-artemis/withdrawal-after-artemis.json)。原 SDK 私有原始日志不进入 Git。

复现真实诊断：`SG_WEB_TARGET=demo SG_DEMO_WEB_SCOPE=client SG_DEMO_REAL_CLIENT_TEST=authorized pnpm test:playwright`。脚本已有 durable intent 时拒绝再发任务；原操作核对使用同一命令加 `SG_DEMO_CLIENT_PHASE=reconcile`，不把失败结果重试为新任务。当前已撤回；需要新的本人明确参与时提前通知，不能因 Agent 例行测试授权自动恢复参与。常规识别、导航、等待和撤回不再要求用户反复协作。

## 原未知与正式执行阻断

复查原 publication task `d634e4c6-4266-4cc7-a784-3a31a1737cac`、trace `c41af179-58fd-4628-a227-20e777f6db70` 的原归档：SDK completed、5 项检查 passed，但最终结构化结果为空。原最后截图为 Facebook 新贴文预览，发布按钮仍可见，没有公开 permalink。它只支持截屏时停在提交前，不能证明全局从未发布、全部控制路径已停止或不再有在途提交。模型检查通过不替代平台结果和可信停止证据。见[原归档复查](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/original-archive-review.json)。

原发布及原六项初始化 unknown 保留，不按历史图伪造平台明确拒绝，不重发、不释放占用。正式物理检查器尚未接入，缺少实际全路径互斥与目标静止证明；正式 executor 继续 disabled。当前注册／扫码／Tailnet 在线不构成这个门禁的替代证据。下一项先复现并解决后台参与检查失败，再处理实际网络节点绑定、受控 ADB 与物理检查器接线，再从正式 Web 发起 inspect_app；FB Page／YouTube 频道创建和公开发布本轮均未尝试。

## 失败尝试与复现

初次环境准备尝试未缓存 PostgreSQL 镜像导致 pull 等待，停止本次自有命令后改为缓存 17.11 的 `--pull=never`；首次启动 readiness 命中了 init 的临时 Unix socket 服务，改为明确 TCP 就绪后复用原容器／配置恢复。邀请创建最初的表单 locator 错误发生在服务返回后，先通过真实 Web 核对原邀请未使用并撤销，再创建当前邀请；没有从 DB／审计取回秘密或盲目重复创建。恢复撤销时补充处理真实确认对话框。

注册验证首轮遗漏“手机”分类 tab，超时后改为按实际页面依次点击，后续通过；补充脚本严格检查发现 nullable 类型推断问题，改为明确接口后通过。开发码助手首次错误地将 Fetch 的 `ok` 布尔值当函数，修正后读取原请求成功；未更改后端验证码或业务状态。失败没有计作验收成功，也没有放宽业务断言。

运行：`pnpm exec tsx scripts/product-local-live.mts prepare`；确认自有实例、无在途工作后 `pnpm exec tsx scripts/product-local-live.mts serve` 前台启动。实际浏览器验证为 `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=prepare|registration|verify pnpm test:playwright`（逐个真实阶段执行，不把竖线作为 shell 命令）；已有邀请复用原私有记录，不重发。

开发人工协助：`pnpm exec tsx scripts/product-local-human-assistance.mts status|sms|participation`（选择一个模式）。只读状态只作补充证据，不能用于替代注册、扫码、参与按钮或伪造准入。截图、日志和配置须保持私有；本次模拟器已不在 ADB 列表；真实关联／提供者数据保留，不再次注册。Demo 自有进程组在本次任务终止、接管释放且无 running 工作后停止；正式回环联调服务与数据库保留，供后续网络／客户端诊断。受保护发布脚本只路径／状态检查，外来工作保持。
