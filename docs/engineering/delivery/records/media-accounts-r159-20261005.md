# R-159 账号管理实施与验收

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

> **当前实施记录，2026-10-05。账号管理页面已通过本地合成数据验收；R-159 整体尚未完成。真实手机分配及 Artemis 辅助登录仍有明确阻断。**
>
> 业务规则以 [R-159](../../../requirements-alignment.md#r-159公司社媒账号独占分配与-artemis-受控辅助登录)及[需求基线](../../../current-requirements-summary.md)为准。原[账号交接](media-accounts-web-handoff-20261004.md)保留为需求交接与固定源码审核快照，不再把其中的旧待办当作当前实现状态。

## 实现范围

- 独立媒体平台账号入口，与内部 Web 运营账号及设备提供者的 Android 管理身份分别管理。没有个人 Facebook／Google 账号注册入口。
- 平台、登录标识、密码共同保存；可选识别名及既有真实核验资料。账号、加密凭据、审计和原请求键在同一事务内持久化，保存后仍为未核验。
- 资料更正、可选资料清空、凭据替换及失效。平台规范身份未知时保持未知；本地凭据失效不表示平台改密或退出登录。
- 原请求查询与恢复；响应丢失后不另换键建档。刷新仅保存操作键，不保存密码；原请求内容已丢失且权威结果未确认时保持阻断。
- 账号／手机分配接口及页面：同手机同平台一个账号、同账号一台执行手机、同期项目专用。暂停／掉线不释放占用。换机请求在旧端停止及未决事实没有可信核验时保持原绑定，不提供假成功释放。
- 显式持久密钥保管器和离线初始化工具，启动时没有随机密钥替代。受控输入的密封协议、Android 输入服务和授权组件属于源码交付；不能据此认定实际 Artemis 工具已经接通。

## 固定证据

最终集成源码：`997c03d9608f6248430e2529477696104829d014`。该候选重新完成全新 PostgreSQL 迁移、后端启动及实际 Web 验收；`pnpm check:product` 通过，`pnpm lint:product` 0 错误、5 条未使用变量／数组写法警告。新 `0040` 授权组件迁移和 AppModule 启动通过不证明真实授权消费链路已经运行。

独立安全审查批准 base `8a53bea9608cafa0956cd1838020df096f4fae8a` → 上述最终 head 的 69 个源码变更文件：与各自已批准候选一致，无新增实质问题。审查为固定源码范围；Web／数据库运行证据由中央验收提供，不是审查者重跑，也不解除下述实际执行阻断。

| 范围 | 固定候选与结果 | 证据边界 |
| --- | --- | --- |
| 真实 Web 页面 | 最终 `997c03d9608f6248430e2529477696104829d014`；9 组断言通过，0 失败。此前 `24988fb` 同样通过 | 从运营登录入口填表、点击及核对页面；仅合成 `.invalid` 账号，不证明真实公司密码有效 |
| PostgreSQL 补充验证 | `0b5b66d`；2/2 通过 | 原绑定保留、矛盾历史拒绝迁移、原子保存、账号独占、交接阻断及轮换状态；不能代替页面分配或真机验收 |
| Android | `0d4fc050e48b1e61944c46fbdc4252ad10037e97`；最终 `testDebugUnitTest`、`assembleDebug` 通过 | 独立隔离构建；没有安装真机、开启系统无障碍权限或完成实际输入 |
| 密封协议及签名钥加载 | `ee73baef727571da03594d341fff2544721d1a46`；8/8 通过，精确源码复审批准 | 组件测试；与 Android 的字节布局经独立源码对照，不是跨语言真机运行结果 |

Web 已实际验证必填拦截、Facebook 保存、资料更正／清空、YouTube 已提交但响应丢失后的原键查询、刷新持久状态、凭据替换／失效、未知请求不重复建档及 390px 只读模式。恢复测试只丢弃实际响应或在请求发出前中断，没有 Mock 成功结果。

最终账号页面结果：[result.json](../../../../artifacts/acceptance/product/media-accounts-r159-20261005/997c03d-integrated-web/media-accounts/result.json)，[桌面截图](../../../../artifacts/acceptance/product/media-accounts-r159-20261005/997c03d-integrated-web/media-accounts/media-accounts-desktop.png)，[手机截图](../../../../artifacts/acceptance/product/media-accounts-r159-20261005/997c03d-integrated-web/media-accounts/media-accounts-mobile.png)，[环境清理](../../../../artifacts/acceptance/product/media-accounts-r159-20261005/997c03d-integrated-web/cleanup.json)。此前页面通过与失败结果均保留。截图在密码字段清空后保存；原始浏览器传输错误及后端原始日志未作为产物持久化。

前四轮 Web 失败分别涉及同名标题、下拉框的精确标签定位以及折叠区状态假定，原失败结果保留在同一验收目录下；后续通过不改写失败历史。PostgreSQL 前两轮失败来自合成重复任务清理触发不可变历史规则；修复仅作用于受严格自有数据库保护的测试清理，未放宽生产历史约束。

## 复现与环境

根目录使用 pnpm 8.14.0／项目 Node 24.16.0。用户本轮明确授权临时隔离 PostgreSQL、Web 和后端，所有实例仅绑定回环地址，独立数据库及临时钥仅用于合成数据，不消费设备任务、不调用模型、不发布。

```sh
SG_PRODUCT_CORE_SQL_ONLY=1 SG_PRODUCT_CORE_SCOPES=media-accounts-postgres \
  SG_PRODUCT_CORE_OUTPUT=artifacts/acceptance/product/media-accounts-r159-20261005/pg-recheck \
  pnpm exec node scripts/verify-product-core-loop-local.mjs

SG_PRODUCT_CORE_BROWSER_ADMITTED=1 SG_PRODUCT_CORE_SCOPES=media-accounts \
  SG_PRODUCT_CORE_OUTPUT=artifacts/acceptance/product/media-accounts-r159-20261005/web-recheck \
  pnpm exec node scripts/verify-product-core-loop-local.mjs
```

浏览器参数只用于已经获得实际浏览器准入的环境，不能绕过浏览器拒绝。生产服务／真实设备仍按现行启动与执行边界处理，不能沿用这次临时环境授权。

本轮已结束环境的 `cleanup.json` 均记录自有服务退出、自有容器删除及临时凭据清理。生产钥没有生成、覆盖或更换。实际服务需显式配置持久 `SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE`；离线设置、保管及恢复边界见[后端说明](../../../../product/backend/README.md#公司社媒凭据的持久密钥)。

## 尚未通过的范围

1. **真实手机分配页面。** 本次全新数据库没有真实可分配手机，未播种设备事实。分配竞争、真实停止／换机及历史交接不能据 SQL 通过认定完成页面验收。
2. **Artemis 辅助登录。** 现用上游固定源码缺少自定义登录工具注册入口，完整的观察关闭／排空及可信 host-to-device 服务尚未接通。Android v1 没有安全恢复观察的 CLEAR 阶段。详见[准确源码阻断](r159-artemis-controlled-login-blocker-20261005.md)。当前保持关闭。
3. **真实公司账号、父登录和发布身份。** 没有执行真实 Facebook／Google 登录、验证码／双重验证、Page／频道和管理权回读；不得开放发布或认定承接开始。模型完成报告、密封输入回执和本记录的页面通过均不能代替这些事实。

共享任务状态仍读取 AGENTS.md 指定的 `tasks.json`。本记录是固定交付证据，不新增滚动任务系统；R-159 不标为整体完成。
