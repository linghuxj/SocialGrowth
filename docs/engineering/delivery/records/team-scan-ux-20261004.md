# UX 页面与真实验收缺口扫描 — 2026-10-04

扫描范围：固定基线 `f583f184891bd3d0406c43821cb3d36e2eb1233a` 的 Web/Android 源码、Playwright 脚本，以及主仓库中当前未提交但已生效的 Android 对齐资料。此记录是接手扫描，不代表产品验收通过。未改动主仓库中的用户文件。

## 有效需求基线

- `docs/android-app-alignment.md` 与 `docs/android-app-page-spec.md` 更新于 2026-10-04，AND-001～025 已确认，11 组页面逐页复核完成；它们高于旧图稿和旧交付记录。设计确认不代表实现或验收。
- 页面规格要求管理手机底部导航“设备／分佣／我的”、首次用途选择、受邀注册/登录、扫码与手工关联、可选备注名、执行机逐步准备并在最后明确开始参与、本机粗粒度使用状态与暂停确认、设备详情和现场协助双端分工、按本人记录展示分佣且不显示总计、账号帮助。
- AND-018～020 已确认：本机状态页只留“暂停本机”；暂停前二次确认；粗粒度状态不披露平台/账号/内容/任务，也不等于独占控制。AND-021/022：现场处理步骤在执行机，管理端看停止事实并等自动检查，免手动提交结果。AND-023：退出设备折叠区。AND-024：分佣无合计。AND-025：退出管理登录移至“我的”。
- 页面规格还明确未知、失败、空态与过期身份需就地反馈，不能因本地状态推定准入、执行停止、结果成功。

## 页面实现与缺口对应

| 页面/需求 | 当前实现 | 待开发或整改 | 真实验收边界 |
|---|---|---|---|
| 管理 Web：运营登录、账号、邀请、设备事实 | `product/web/src/app.tsx` 有四个运营视图；设备事实通过 `device-facts-panel.tsx` 读取并支持刷新；现有登录/账号/邀请均是管理后台身份，不是新 Android 提供者端 | 缺少规格定义的提供者本人设备/分佣/我的管理端；设备页面未知与权限语义需要完整按来源验 | 根 Playwright 登录后从真实页面操作；设备事实 API 只读；不得用直接 API 写入或数据库造态 |
| 项目资料（C1） | `project-panel.tsx`、`material-workspace.tsx` 具项目/素材视图；上传经真实文件字节流程，人工事实可保存。当前源码已有 `currentReads` 序号保护，旧读取应答不能覆盖较新版本 | 本轮隔离 Playwright 已通过合成项目/文件及声明的创建、保存、v1/v2 读取竞态、采用最新版本、刷新与移动只读；真实来源权属和后端未来候选状态规则不在该测试范围 | 根入口实际浏览器执行并断言页面最终状态。此次证据是隔离 DB/临时 MinIO/合成素材，不是正式素材或来源权利验收 |
| 目标与周期草案（C2a） | `project-planning-panel.tsx` 和 API 有真实表单、读取/保存草案与未批准状态 | 本轮隔离 Playwright 已通过保存和持久读回；真实商业输入、后续业务 producer 消费与已批准计划的执行尚未形成闭环 | Playwright 真实表单和按钮；草案不可误称已批准/已生效；本轮实际是未批准合成草案 |
| 方向（C2） | `project-direction-panel.tsx`、API 已实现模型生成、确认方向、批准范围展示和未知结果接续 UI | 本轮隔离 Playwright 使用既有配置模型通过旧目标失效检查、方向确认、丢失响应后接续原请求、刷新及移动只读。方向仍以执行阻断结束；未产生手机任务、发布或完整任务／名额原子化下游流程 | Playwright 真浏览器和现有模型输入。不得把 UI/模型建议或方向批准表述成实际任务执行或发布 |
| 正式设备事实（C3/H3） | `device-facts-panel.tsx` 展示权威事实并支持刷新；现有 Web→Artemis 历史证据和脚本可复用 | 本轮根入口真实登录、刷新通过：Samsung 实际可见、状态为“已关联·待完成接入”，连接仍未知，接入与控制未就绪 | 只读断言与现场事实一致；此次没有暂停、恢复、退出、参与、写入或发布动作 |
| Android 首次用途、登录/注册 | `MainActivity.kt` 是现存产品客户端，尚未发现 AND-010 首次用途双入口与 AND-011 同页邀请输入规格落地证据 | 原生页面导航/表单仍需按 AND-001～017/25 逐页对齐；短信与邀请校验依赖真实服务，不能用开发码宣称送达 | Artemis 视觉识别/决策，经实际 Web/服务流程和已授权真机；不以 JVM/UI automation代替用户产品验收 |
| Android 设备首页／二维码及关联 | 当前 Android 有关联/API 边界模块及本机事实状态呈现 | 页面规格要求底部导航、退出设备折叠、扫码和手输、设备备注名、身份确认；实现完整性未达 | 真机连通 USB 可用；双真机扫码仍缺第二台设备，模拟器不算第二台真机 |
| Android 本机准备／状态／暂停 | 当前有 NetworkAdmission API client、参与服务/事实页等原语 | 尚缺逐步准备引导、最后一步开始参与、系统使用状态通知、单一暂停本机与底部确认、真实停止进展；当前后台行动许可与真实策略仍未建立 | 先有适配及当前许可；暂停状态必须以中心和设备停止事实核验。用户授权暂不测试撤回，不可碰参与撤回 |
| Android 设备详情／协助／恢复／退出 | 规格已有两端职责和未知状态分解 | 本轮扫描未找到完整页面交付证据；自动检查通过后恢复请求和退出进展须复用现有服务事实，不能添加“手动提交即完成” | 真实服务端、Artemis 与 Web/客户端配合；目标动作须在已授权边界内，不得把请求送达当执行已停止 |
| Android 分佣／我的 | 业务模块/部分 UI 是否齐备未有完整验收记录 | 严格按 AND-024 无任何总额，AND-025 身份和必要帮助；不新增完整账号找回 | 使用真实本人可归属数据；无收入事实显示缺失/待核，不能造数或展示他人信息 |

## 可立即处理的最小切片与条件

1. **UX-H1：手机核验脚本 Android 16 UID 兼容**。已确认脚本在 `userId=(\\d+)` 解析处失败；手持机 dumpsys 返回 `appId=10377`。最小修改是严格解析 appId/userId、当二者同时存在且相矛盾时拒绝，补 parser 测试；不执行升级，安装/备份恢复由主会话串行控制，脚本不得 clear data 或 uninstall 主包。
2. **UX-H3：正式 Web 页面证据**。3100/4320 当前健康由主会话实查；根 Playwright 实际登录、刷新设备与项目/素材/草案/方向，保留无敏感信息的状态断言和报告。需要解决真实浏览器可访问的登录凭据/会话；不直调 API 写入、不模拟页面成功。有限且可在已有资料里执行的无副作用读操作先完成，若缺凭据或服务状态变化记录为阻断，不重启现有服务。
3. 若 Playwright 暴露实际故障，先修复该故障最小路径，使用已有 API/组件。当前 UX 页面与 H2 网络来源匹配不需要新增 API 字段，若发现必要接口需先通过团队契约登记协商。

## 证据/状态分类

- **扫描已确认**：AND-001～025 最新对齐及页面规格存在；Web 已有项目资料、未批准草案、方向生成/确认及账号/设备事实页；Android 当前仍是局部客户端协议和少量本机事实界面；H1 Android 16 UID 字段兼容缺陷已由实际 Samsung dumpsys 暴露。
- **开发未完成**：提供者管理 App 多页面及核心控制流程；素材候选判定的后端只读状态和 UI 呈现（团队正在对齐契约）；方向批准至任务生成/名额和真机执行的下游闭环；系统/network admission 实际权限。
- **验收未完成**：真实业务素材及来源权利、正式非合成目标输入、方向获批后实际执行；完整原生端验收；第二台 Android/双真机；短信实际送达；暂停/恢复/现场处理结果事实。C1/C2 当前三组合成隔离 Web 页面流程已通过，不等于这些下游验收通过。
- **已有但窄范围的通过证据**：既有 AND/R-109 Artemis 真机远程路径可以沿用其原报告说明范围；本扫描不重开、不扩大旧通过范围。
- **执行边界**：Web 页面通过真实 Playwright 操作写入本轮合成隔离数据库和临时对象存储；没有修改真实素材、设备状态或业务凭据。不触及参与撤回、真实媒体、公开发布或受保护发布脚本。

## 本轮真实浏览器、阻断与恢复证据

- **H3 设备事实通过**：根 Playwright `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=verify pnpm test:playwright` 完成；证据目录 `artifacts/acceptance/team-ux-20261004/device-live/`。真实 Web 显示已关联设备，但 `accessReady=false`、连接未知、物理控制器未就绪。
- **隔离 C1/C2 页面通过**：`pnpm exec node scripts/verify-product-core-loop-local.mjs`，显式 loopback Web/后端端口 3300/4420；临时 Postgres/MinIO 均有本轮 owner 标签并在清理时删除。根入口 `pnpm test:playwright` 实际操作素材、周期草案和方向页面。三个 Playwright 子流程通过；隔离 DB 最终只读汇总为 projects=3、material revisions=2、unapproved drafts=2、direction proposals=2、approvals=1、verified byte tickets=1。方向流程使用真实已配置模型但合成输入，结果 `execution=blocked`、publication 未执行。证据目录 `artifacts/acceptance/team-ux-20261004/core-loop-retry/`；无浏览器/模型凭据写入证据。
- **已解决的唯一启动阻断**：第一次隔离启动在 backend readiness 阶段失败，因为工作树缺少忽略的 `product/backend/dist`。本 runner 已增加 contracts/backend build，重试成功。失败轮已由 runner 停止其 own service 并移除两个自身标记的临时容器；当轮证据保留在 `artifacts/acceptance/team-ux-20261004/core-loop/cleanup.json`。
- **H1 真机补充协议失败**：主会话串行 USB 运行后在真实 native transport 失败。真实 USB 不代表 Samsung 已被 trusted Tailscale WhoIs 观察为在线；WhoIs `Online=false`，所以拒绝是预期关闭行为。主 APK 安装成功，UID=10377 保持；参与命令、网络准入和动作许可均未产生；主 APK与测试 APK各自恢复成功。证据：主会话 `artifacts/acceptance/team-lead-20261004/admission-protocol/phone-attempt-1.json`。测试业务部分失败，不把安装/恢复通过升级成准入通过。
- **后续解除条件与安全恢复**：只在可信 WhoIs 确认为当前节点在线且仍符合原身份绑定时重新跑 11 项手机协议；不以 USB 在线冒充 Tailnet 在线。`verify-network-admission-phone.mts` 的输出路径支持 `SOCIALGROWTH_VERIFICATION_OUTPUT`，后续跑使用唯一新目录，保留 `20261003` 历史。安装恢复依赖旧签名 APK 备份，只用 `install -r` 恢复主包，不执行主包 clear/uninstall。若在线条件持续不满足，保留该阻断并继续无设备 UX 工作。
