# 手机当前参与事实接线

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

> **文档状态：历史阶段证据（2026-10-04 标记）。** 正文中的“当前”“下一阶段”和操作授权仅对应记录日期及固定候选，不作为现在的开发任务、设备状态或执行许可。历史通过、失败、阻断、未知结果及证据范围保留；不因本次标记自动关闭阻断。
>
> 账号管理与受控登录开发先读[最新需求基线](../../../current-requirements-summary.md)、[R-159 确认记录](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[当前账号交接](media-accounts-web-handoff-20261004.md)。执行编排见[执行库说明](../../../specs/2026-10-02-account-preparation-execution-library.md)；阶段验收限制见[2026-10-04 收尾快照](team-integration5-20261004.md)。本记录仅用于追溯与按原范围复用证据。

2026-10-02；承接用户“继续推进下一阶段内容”，沿用 `codex/core-automation-loop-stage1`，输入提交 `1b3c37b62718358e7e60b6ba453c1266d16950a3`。本轮落实上一阶段第一项中的**本机参与确认及其中央事实读取**。完整真实执行接线仍未完成；本记录是作者检查，不代替非作者复核或独立 QA，不更新父 pending，不合入 Developer。源码和检查结果见[manifest](../../../../artifacts/acceptance/product/B3/account-preparation-stage5-20261002/manifest.json)。

## 实现

新增独立协议 `2026-10-02.participation-v1`，不更改首批身份契约。已关联 Android 页提供显式开启／撤回及当前状态。`ParticipationService` 由可见 Activity 开启前台服务，不 sticky、不自动开机启动、不自动重新开始参与。复用已保存安装会话，每四秒请求当前六秒 nonce，再确认十秒有效的参与事实；用单调时钟保守控制本机显示期限。收到确认前不显示已确认。参与会话固定准确设备、关联、安装与代次、设备事实版本、控制 generation；变化后结束，须重新显式开启。启停串行，撤回期间不启动另一条 worker，原 worker 完成后按当前 startId 收口；系统拒绝服务启动时显示失败。服务类型及声明参考 [Android 官方 connectedDevice 规则](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device)。这不是系统准入或真实后台保活的实测结果。

正式 Nest 服务已挂载 `POST /api/installation/participation/start|challenge|confirm|withdraw`，使用现有 Bearer 安装会话。请求不能携带 scope、确认时间、动作权限或停止证明；中心生成准确事实和有效期，响应全部明确 `actionPermissionGranted=false`、`stopConfirmed=false`。Kotlin 的键、UUID、时间、精确代次、整数和有效期边界与共享契约对应生成／校验。

0030 迁移保存每台手机唯一的当前 challenge／receipt，以及显式参与 run 与启停审计。心跳更新当前槽，不不断追加审计。新 challenge 保留上一条仍有效 receipt，避免轮询间隙把当前参与误报为缺失；重放原 nonce／确认不延长有效期。provider→installation→association→device→控制日志→session 的一致锁顺序下，锁等待后重新认证并使用中心时钟验证会话。当前事实读取还要求会话、角色、安装代次、关联、设备版本和控制 generation 匹配；过期、替换、暂停或角色停用即不可作为当前依据。

撤回与中央 `request_stop` 在同一事务中提交，提升控制 generation、保留在途事实，不伪造实际停止。新参与 run 替换旧 run 时也撤销旧控制代次。迟到的旧 challenge／confirm 不会恢复参与；旧 run 已提交的撤回重放仅返回原历史，不撤销后继 run。审计失败同时回滚撤回及控制日志。撤回网络失败或进程被系统结束时，当前 pulse 到期失效；不把中心未收到撤回写成物理停止成功。

初始化“核验执行条件”已接当前参与读取器。有有效当前参与时，只移除对应参与阻断；真实网络、ADB 授权与准确目标、停止证明、holder／任务范围、全部底层动作 fence、executor 组合及可信证据消费条件仍各自保留。已保存的核验是历史快照，不能替代实际执行前的当前权限读取。

## 验证及证据

项目环境实测 Node 24.16.0（项目管理路径）、pnpm 8.14.0、SQLite OK。隔离 PostgreSQL 17 容器仅绑定回环随机端口；重置前严格核验独立库名与集群 ID。两组 PG 是明确合成的补充组件 fixture，不能证明真机参与或平台准备完成。真实 Web 使用另一空库，从 0001 到 0030 完整迁移，标准管理入口从 stdin 初始化临时运营登录；业务项目、初始化请求、核验及接续均从实际 Web 表单／按钮操作，不预置手机成功事实。

| 检查 | 结果和范围 |
| --- | --- |
| `pnpm test:product` | 574 通过：contracts TS 69／Python 38、backend 340、executor 41、Web 86；补充检查 |
| `src/local-participation.pg-test.ts` | 11／11：真实 HTTP 路由、认证／伪 scope 拒绝、原时限重放、上一 pulse 保留、过期及旧 nonce、原 run 撤回／后继并发、版本与角色变化、锁等待中会话过期、审计原子回滚及有界心跳 |
| `src/account-preparation-api.pg-test.ts` | 19／19；新增实际安装确认只消除对应阻断、撤回恢复阻断、始终不派发的 HTTP 组件检查 |
| Android `:app:assembleDebug :app:testDebugUnitTest` | APK 构建通过，34 项 JVM 检查通过，其中新增参与边界 3 项；没有新增／运行 UI 单元测试或其他 E2E 套件 |
| `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=account-preparation pnpm test:playwright` | 八类真实页面场景通过、页面错误 0；输入缺少阻止提交、原任务保存、执行核验及丢 ACK 接续、版本变化、请求丢 ACK 接续、重载与 390px 只读 |
| `pnpm env:check`、`pnpm check:product`、`pnpm build:product`、`pnpm lint:product` | 通过；新组件检查后 backend 类型检查、最终 native 收口后 Android 构建／JVM 检查再次通过；保留原有 backend 两条 `new Array` lint 警告 |

首次 PG 9／11，两个 HTTP fixture 错把角色提示 `Installation` 当成认证协议头；实际客户端与服务都使用现有 `Bearer`。修正测试头后 11／11。保留[首次日志](../../../../artifacts/acceptance/product/B3/account-preparation-stage5-20261002/participation-pg-first.log)，没有覆盖失败或将其解释为实际设备故障。最终日志、[浏览器结果](../../../../artifacts/acceptance/product/B3/account-preparation-stage5-20261002/ui/result.json)、[桌面](../../../../artifacts/acceptance/product/B3/account-preparation-stage5-20261002/ui/preparation-desktop.png)及[390px](../../../../artifacts/acceptance/product/B3/account-preparation-stage5-20261002/ui/preparation-mobile.png)截图已检查。只读 SQL 确认两个请求、一条历史核验、holder grants=0、participation slots=0、Artemis intents=0；Web 没有通过播种手机参与结果绕过验收。

复现参与 PG 需准确独立 DB `sg_participation5_component`、`SG_PRODUCT_TEST_DATABASE_URL`、`SG_PRODUCT_TEST_CLUSTER_ID`、`SG_PRODUCT_TEST_ALLOW_RESET=1`；准备流程 PG 需 `sg_preparation2_component`。命令均为 `pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/<对应文件>`。Web 使用根 `pnpm test:playwright` 及 `SG_PRODUCT_PREPARATION_OWNED_ENV=1`、回环 URL、专属截图目录和私密临时登录变量。Android 使用 JBR 17、现有 Android SDK 与独立 `/tmp/socialgrowth-product-gradle` 缓存，`product/android/gradlew -p product/android --no-daemon :app:assembleDebug :app:testDebugUnitTest`。证据不保存密码、令牌或安装根凭据。

## 四态与下一阶段

通过：本机参与模块实现、当前事实读取、撤回原子撤权、PG／JVM 补充检查、正式 Web 阻断回归。失败：最终无未解决的检查失败。未验证：新 APK 真机安装、用户实际开启／撤回、真实后台保活与断网恢复；尚不能宣布本机参与在授权 Samsung 上验收通过。阻断：可信内部 broker 的完整当前任务／网络／准确 ADB／holder 组合，以及 Artemis 所有底层读屏、模型工具、人工补图、刷新和动作路径的实际保护与可信停止／交还，尚未接线。

沿用上一阶段的原任务未决边界：Demo 原 task `d634e4c6-4266-4cc7-a784-3a31a1737cac`／attempt `4920b891-f2aa-4ecc-bb3e-6c1df7dff7fc`／trace `c41af179-58fd-4628-a227-20e777f6db70` 的差异需要从原操作核实；上一阶段 SDK 存档 completed 不等于全部物理路径已停止。本轮没有重查其当前存活状态、修改 Demo 状态或重发动作。既有 Google Artemis 远程已验证证据保留其原覆盖范围，本轮未重新称为全未验证。

下一步继续把当前参与读取接入可信内部 authority broker，并覆盖实际全部底层调用与停止路径；达到条件后才从正式 Web→worker 发起一个 `inspect_app`，核实原 trace 与 ACK 丢失，最后接独立平台证据消费者。正式 executor 主入口仍 disabled；未提前写真实身份就绪。新 Artemis 调用、FB Page／YouTube 频道创建、公开发布均为 **0**。

专属 Web／backend 已退出，专属 PG 容器及卷、私密临时凭据／辅助文件已清理，其他服务及外来工作保留，见[资源收口](../../../../artifacts/acceptance/product/B3/account-preparation-stage5-20261002/resource-closure.json)。未读取、修改、暂存或执行受保护发布脚本。
