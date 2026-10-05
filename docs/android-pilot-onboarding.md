# Android 内测手机连接准备

本轮范围：少量明确登记的内测手机、官方 Tailscale App、运营保存的固定 Auth Key、中心原有 ADB 身份。先完成连接准备，不扩展 Tailnet 管理平台。手机上的主流程是「连接业务网络 → 允许远程连接 → 完成连接确认」。

## 手机操作

首次接入页可先进入「先准备网络与无线调试」；服务不可达时也保留设置检查入口，不需先完成关联。已关联执行手机从「网络连接与准备设置」进入。按提示连接 Wi-Fi、安装或打开 Tailscale。新手机可点击「获取并复制接入密钥」，随后在 Tailscale 登录页右上角菜单选择 **Use an auth key** 并粘贴；系统 VPN 请求仍由用户确认。也支持已有授权账号登录。密钥不会显示在页面，剪贴板标为敏感。App 使用独立于页面的计时器，在一分钟后及页面销毁时尝试清除自己复制的内容；Android 后台读取限制或进程退出时不能承诺系统剪贴板一定按时清空。

点击「打开关于手机」或「打开开发者选项」，由用户开启开发者选项与无线调试。Samsung 在「软件信息」中连续点击版本号七次。返回 App 自动检查；检测到 VPN 不代表已进入本项目网络。当前自动发现适用于 Android 14+ 的选定机型。

点击「开始连接检查」并允许通知。已有中心配对会先尝试恢复连接；首次配对时保持执行手机的系统配对码弹窗打开，在另一台管理手机的设备详情点击「连接这台执行手机」并输入六位配对码。中心完成真实 ADB 连接与 Android 硬件身份读取后，执行手机才显示「平台已连接到这台手机」。配对码只用于这次请求，不保存、不自动重发；不确定的结果先刷新核对。

连接检查由用户主动开启，在通知栏可随时停止，持续报告当前端点。手机重启或进程退出后不会自行启动，需回到 App 重新开启；不能承诺各厂商系统长期保活。停止检查意味着不再维持端点报告，不能用它代替业务暂停或确认真机已停止操作。

## 内测部署

Auth Key 保存在运营主机的私有文件，例如 `.runtime/tailnet-control/pilot-auth-key.txt`，权限 `0600`；不写入 APK、仓库或日志。固定 key 采用 Reusable、非 Ephemeral；Tailscale 本身判断实际有效性。已知到期日期可填入配置，已知过期时接口不返回 key；未知日期返回 `expiresAt: null`，不承诺 key 有效或永久可用。

`SG_PRODUCT_TAILNET_PILOT_CONFIG` 指向权限 `0600` 的 JSON：

```json
{
  "authKeyExpiresAt": null,
  "devices": [{
    "deviceId": "当前设备 UUID",
    "providerId": "当前提供者 UUID",
    "installationId": "当前安装 UUID",
    "installationGeneration": "1",
    "nodeId": null,
    "tailnetAddress": null
  }]
}
```

最多登记 50 台。未入网时允许节点和地址同时为空，当前安装与关联必须匹配该登记才能获取 key。入网后由运营通过官方只读设备列表核对节点，再填写真实 StableID 与 Tailnet 地址。客户端不能自行声明或认领节点；中心只读 WhoIs 验证其在线及绑定一致后才连接。此状态称 `pilot_verified`，不写成正式网络准入，也不授予业务任务执行权。

其他显式环境配置：

- `SG_PRODUCT_TAILNET_PILOT_AUTH_KEY_FILE`：固定 key 的私有文件路径。
- `SG_PRODUCT_TAILSCALE_CLI`：官方 Tailscale 可执行文件绝对路径。
- `SG_PRODUCT_CENTER_ADB`、`SG_PRODUCT_CENTER_ADB_USER_HOME`：中心 ADB 程序及原有 `.android` 目录，必须保留原有私钥。
- `SG_PRODUCT_CENTER_ADB_TAILSCALE_CLI`：仅在 Mac GUI Tailscale 没有系统 Tailnet 路由时显式启用，复用官方 `tailscale nc` 建立短期本地转发；正常服务器有路由时不配置。

迁移为 `0045_android_device_connection.sql`。正式安装入口的业务 API 必须能在尚未入网时通过 HTTPS 访问，才可完成安装身份、关联和取 key；只在 Tailnet 内提供 API 的环境，需先由运营在 Tailscale 完成首次入网。本轮开发地址 `https://macbook-pro.tail3656e0.ts.net:8443` 属于后者，不能作为全新远端安装免配置接入的证据。

## 验证与待完善

通过实际 Demo Web 发起，Playwright 操作 Web，Artemis 操作 Samsung；保留原始失败结果。`output/android-access-20261006/guide` 已通过三步引导、现有 Tailscale 重连和无线调试检查（5 项通过、0 失败、0 待确认）。`connection` 首轮在修复过程中未完成验收，已从 Web 停止；后续结果另行保存。最终源码候选 `145c70b` / Android 候选 `52e550b` 的 `final-guide` 已通过：实际 Web 发起、Artemis 操作已关联 App，独立检查 2 项通过、0 失败、0 待确认，核实当前页面显示真实平台连接。

本轮核验现有中心授权恢复及端口变化：Samsung 实际连接端口由 46093 变为 34163，中心通过 Tailscale 守护进程通道读回硬件身份 `RFCW40MYYCV`。`final-tailnet-artemis` 显式使用中心网络 ADB transport `127.0.0.1:50312`，通过实际 Web 发起 Artemis，独立检查 3 项通过、0 失败、0 待确认；USB 当时仍物理连接，故证明的是实际选择并使用网络通道，不把它扩大为 USB 拔除、重启或长期后台验收。全新手机 Auth Key 实际注册、双手机首次配对、断开 USB 后的 Artemis 执行须分别留真机证据，不能由接口测试代替。

仅记录后续事项：Android 11–13 的发现支持、单手机通知栏配对操作、VPN 内置方案、重启后的恢复提醒、固定 key 更换提示和正式网络权限管理。当前不扩展这些功能。

### 可复现检查

补充检查：`pnpm --filter @socialgrowth/product-backend check`、`pnpm --filter @socialgrowth/product-backend build`、`pnpm --filter @socialgrowth/execution-runtime build` 均通过。`pnpm --filter @socialgrowth/product-backend exec tsx --test src/device-connection-api.test.ts src/device-connection-adb.test.ts src/network-setup-api.test.ts` 为 14 项通过。Android 使用项目 Gradle 构建，通过 `adb -s RFCW40MYYCV install -r` 保留数据安装。安全审查批准源码候选 `145c70b70af0f1ddfa33d858c0d61057523a71b2`；这些均不能替代真机业务验收。

宽范围的 `reconnect`、`final-connection`、`final-candidate` 运行保留为待确认：执行记录显示完成设置、复制提示与中心连接，但 Artemis 独立检查分别出现请求体超限或未返回可确认结论，Web 按严格条件拒绝完成。调大临时本地检查请求上限也不作为通过依据；最终采用只核验当前客户端真实连接的范围，不重做已覆盖的设置操作。

```sh
SOCIALGROWTH_VERIFICATION_OUTPUT=output/android-access-20261006/final-guide \
SG_WEB_TARGET=demo SG_DEMO_WEB_SCOPE=client \
SG_DEMO_REAL_CLIENT_TEST=authorized SG_DEMO_CLIENT_MODE=connectivity_test \
SG_DEMO_REAL_CONNECTIVITY_TEST=authorized SG_DEMO_ENDPOINT_REPORTER_START=authorized \
SG_DEMO_VERIFY_CONNECTED_GUIDE_ONLY=authorized pnpm test:playwright
```

输出目录每轮必须全新，已有任务使用脚本的 reconcile/cancel 流程，不能覆盖原结果。正常部署必须使用自己的可达 HTTPS API；本地 pilot 的运行配置不提交仓库。

内测交付状态：Samsung 已保留原数据安装该 Debug APK，界面停留在已连接准备页；本地 4320 后端与私有 Tailnet HTTPS 8443 服务保留运行供客户端使用。验收用 Demo 3000/4318 服务已停止，临时 Artemis transport 和请求上限已恢复；没有启动业务 worker 或公开发布。产物和原始结果保存于 `output/android-access-20261006/`，不提交 APK 或凭据。
