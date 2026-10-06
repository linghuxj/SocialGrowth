# 平台网络待确认：原因与恢复

日期：2026-10-06。用户要求解决 Android 的“平台网络待确认”，并区分状态展示问题与 Web 运营处理问题。

## 原因

本轮核对运行于 4320 的产品后端，没有加载 `SG_PRODUCT_TAILNET_PILOT_CONFIG`、`SG_PRODUCT_TAILSCALE_CLI`、`SG_PRODUCT_CENTER_ADB` 和 `SG_PRODUCT_CENTER_ADB_USER_HOME`。统一启动脚本仅从本次启动环境透传这些路径，正常 `pnpm dev` 重启时未继承此前临时启动的网络配置。

`DeviceConnectionApi` 在没有网络核验适配器时返回 `NETWORK_AUTHORITY_UNAVAILABLE`，Android 显示“平台网络待确认”符合该事实。已保存的节点绑定与手机配对没有消失；本轮独立官方 CLI 查询确认固定节点在线且身份匹配。

Web 运营协助中的“报告已处理”只登记说明并等待复核，不会安装后台网络适配器或写入网络准入。它不是本次配置缺失的原因，也不能用来绕过真实网络确认。现有 Web 设备详情的连接字段仍为“未知”的展示占位，并非 Android 实时连接 API 的数据源；本轮不将该占位当作手机离线证据。

## 修复

- 在已有统一启动入口 `scripts/product-local-live.mts` 读取明确安装的私有 `.runtime/product-local-live/network.env`。仅允许六个现有网络配置项，内容均为绝对文件／程序路径，要求文件私有且属于当前用户；目标不存在或配置无效时停止启动，不静默丢失核验能力。现有显式环境配置仍可覆盖文件。
- 本机安装六项已有路径，复用既有 pilot 节点绑定、Auth Key 文件、官方 Tailscale CLI、中心 ADB 与原主机信任。没有申请新密钥、修改 Tailnet 策略、重配对或写入正式准入。
- 确认没有实际执行中的设备任务后，通过标准 `pnpm dev` 重新启动产品 Web／后端。原业务 workflow 租约已过期且 runtime 原操作为 unknown；原记录保留，没有重发该业务任务或宣称解决 unknown。
- 更新已有“仅检查已连接准备页”的 Artemis 描述，以支持当前同机管理首页和顶部状态摘要；仅授权通过实际 App 开启连接检查，保留参与及配对。

## 验证

- `pnpm dev` 实际构建及启动通过；Node 24.16.0，SQLite OK。新后端进程确已加载网络与中心 ADB 路径，启动无需临时导出环境变量。
- execution-runtime 构建通过；现有 web-verification 测试 15 通过、0 失败；`git diff --check` 通过。
- 恢复配置后，App 从网络待确认转为旧连接过期状态。Artemis 通过实际 App 恢复连接检查后，后端取得新的端口上报和中心连接：`pairing_state=paired`、`connection_state=connected`、`blocker_code=null`，硬件序列号 `RFCW40MYYCV`。
- 中心实际使用 `Tailscale nc`，独立对本轮远程 ADB 序列号读取硬件序列号匹配。USB 用于本轮 App UI 操作；没有用 USB 连接状态代替平台远程连接结果。私有补充证据在 `.runtime/network-authority-20261006/`。

Web → Artemis 验收通过：task `70a3aca3-0fb6-478c-af72-9ff412706b48`，trace `e4b56a75-95a9-42ed-a495-ae087ec900d0`；completed，1 通过、0 失败、0 待确认、0 未检查。最终实际 UI 断言要求同一顶部摘要显示“平台已连接／网络节点 已确认／调试配对 已配对／检查于时间”，检查器独立确认通过。实际 Web 结果目录为 `output/playwright/network-authority-restored-20261006/`，登录提交 0、未点击内容发布、清理确认 true。临时 Demo Web 已停止，连接检查、产品服务、公开网关及替换后的 runtime 继续运行，旧人工接管与 unknown 保留。

复现入口（已有任务先 reconcile，不覆盖结果或重复派发）：

```sh
pnpm dev

SG_WEB_TARGET=demo SG_DEMO_WEB_SCOPE=client \
SG_DEMO_REAL_CLIENT_TEST=authorized SG_DEMO_CLIENT_MODE=connectivity_test \
SG_DEMO_REAL_CONNECTIVITY_TEST=authorized SG_DEMO_VERIFY_CONNECTED_GUIDE_ONLY=authorized \
SG_DEMO_REQUIRE_CENTER_CONNECTION=authorized SG_DEMO_ENDPOINT_REPORTER_START=authorized \
SOCIALGROWTH_VERIFICATION_OUTPUT=output/playwright/network-authority-restored-20261006 \
pnpm test:playwright
```

范围：恢复当前内测手机的网络核验与真实远程连接，不等于新手机逐设备正式网络准入、业务执行授权或发布成功。[前轮连接 UI 记录](android-connection-ui-20261006.md)保留其检查时平台未加载配置的事实。
