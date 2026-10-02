# 阻断整改与管理端／真机关联联调

2026-10-02 夜间至 2026-10-03；承接用户“解决目前仍阻断的问题，需要人工协助提前告知”。输入提交 `a531d0006aabe72298ca209affc92df8b5cb8c1e`，沿用 `codex/core-automation-loop-stage1`。当前已解除本地正式后端不可用、管理端资源不足、电脑 Tailscale 未连接三项联调阻断；完成实际管理端开发注册与 Samsung 扫码关联。手机参与、远程控制准入、正式 Artemis 检查和原未知结果仍未验收通过。作者验证，不代替独立 QA，不清父 pending，不合入 Developer。

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

## 人工参与验收仍待完成

用户找不到“确认当前参与”时，只读核查发现 Samsung USB 已断开；本轮 debug App 访问的是手机回环 4320，经 USB reverse 连接电脑后端。关联已在中心成立，但手机无法刷新后续页面。用户重新插线并解锁后，恢复本次 `tcp:4320→tcp:4320`，没有改写其他转发或重新关联。实际截图显示“暂时无法准备关联码／无法连接服务／重试”；已请求用户点击“重试”，到本机已关联页后确认参与，并返回桌面约 30 秒。

目前只读补充检查没有 local_participation 回执，不能记为参与成功。等待实际参与持续更新后，再由本人撤回，核验不再更新、中心撤权及 stop_requested；撤回／服务退出不直接记为手机已停止。手机截屏留本地 0600 私有证据，不公开二维码或验证码。临时 netcat 健康探测没有获得响应正文，归为不确定的辅助探测，不当成 App 网络失败或恢复成功的证据。

## 原未知与正式执行阻断

复查原 publication task `d634e4c6-4266-4cc7-a784-3a31a1737cac`、trace `c41af179-58fd-4628-a227-20e777f6db70` 的原归档：SDK completed、5 项检查 passed，但最终结构化结果为空。原最后截图为 Facebook 新贴文预览，发布按钮仍可见，没有公开 permalink。它只支持截屏时停在提交前，不能证明全局从未发布、全部控制路径已停止或不再有在途提交。模型检查通过不替代平台结果和可信停止证据。见[原归档复查](../../../../artifacts/acceptance/product/B3/blocker-resolution-live-20261002/original-archive-review.json)。

原发布及原六项初始化 unknown 保留，不按历史图伪造平台明确拒绝，不重发、不释放占用。正式物理检查器尚未接入，缺少实际全路径互斥与目标静止证明；正式 executor 继续 disabled。当前注册／扫码／Tailnet 在线不构成这个门禁的替代证据。下一项在真实参与完成后处理实际网络节点绑定、受控 ADB 与物理检查器接线，再从正式 Web 发起 inspect_app；FB Page／YouTube 频道创建和公开发布本轮均未尝试。

## 失败尝试与复现

初次环境准备尝试未缓存 PostgreSQL 镜像导致 pull 等待，停止本次自有命令后改为缓存 17.11 的 `--pull=never`；首次启动 readiness 命中了 init 的临时 Unix socket 服务，改为明确 TCP 就绪后复用原容器／配置恢复。邀请创建最初的表单 locator 错误发生在服务返回后，先通过真实 Web 核对原邀请未使用并撤销，再创建当前邀请；没有从 DB／审计取回秘密或盲目重复创建。恢复撤销时补充处理真实确认对话框。

注册验证首轮遗漏“手机”分类 tab，超时后改为按实际页面依次点击，后续通过；补充脚本严格检查发现 nullable 类型推断问题，改为明确接口后通过。开发码助手首次错误地将 Fetch 的 `ok` 布尔值当函数，修正后读取原请求成功；未更改后端验证码或业务状态。失败没有计作验收成功，也没有放宽业务断言。

运行：`pnpm exec tsx scripts/product-local-live.mts prepare`；确认自有实例、无在途工作后 `pnpm exec tsx scripts/product-local-live.mts serve` 前台启动。实际浏览器验证为 `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=prepare|registration|verify pnpm test:playwright`（逐个真实阶段执行，不把竖线作为 shell 命令）；已有邀请复用原私有记录，不重发。

开发人工协助：`pnpm exec tsx scripts/product-local-human-assistance.mts status|sms|participation`（选择一个模式）。只读状态只作补充证据，不能用于替代注册、扫码、参与按钮或伪造准入。截图、日志和配置须保持私有；本阶段资源保留供人工联调，结束后仅收口本次自有服务／模拟器，数据库保留。受保护发布脚本只路径／状态检查，外来工作保持。
