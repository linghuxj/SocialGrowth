# Android 内测手机连接准备

本轮范围：少量明确登记的内测手机、官方 Tailscale App、运营保存的固定 Auth Key、中心原有 ADB 身份。先完成连接准备，不扩展 Tailnet 管理平台。手机上的主流程是「连接业务网络 → 允许远程连接 → 完成连接确认」。

## 手机操作

已关联执行手机从「网络连接与准备设置」进入。按提示连接 Wi-Fi、安装或打开 Tailscale。新手机可点击「获取并复制接入密钥」，随后在 Tailscale 登录页右上角菜单选择 **Use an auth key** 并粘贴；系统 VPN 请求仍由用户确认。也支持已有授权账号登录。密钥不会显示在页面，剪贴板标为敏感并在一分钟后清除本次内容。

点击「打开关于手机」或「打开开发者选项」，由用户开启开发者选项与无线调试。Samsung 在「软件信息」中连续点击版本号七次。返回 App 自动检查；检测到 VPN 不代表已进入本项目网络。当前自动发现适用于 Android 14+ 的选定机型。

点击「开始连接检查」并允许通知。已有中心配对会先尝试恢复连接；首次配对时保持执行手机的系统配对码弹窗打开，在另一台管理手机的设备详情点击「连接这台执行手机」并输入六位配对码。中心完成真实 ADB 连接与 Android 硬件身份读取后，执行手机才显示「平台已连接到这台手机」。配对码只用于这次请求，不保存、不自动重发；不确定的结果先刷新核对。

连接检查在通知栏可停止，单次最多一小时，退出进程或手机重启后不会自行启动。停止检查意味着不再维持端点报告，不能用它代替业务暂停或确认真机已停止操作。

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

通过实际 Demo Web 发起，Playwright 操作 Web，Artemis 操作 Samsung；保留原始失败结果。`output/android-access-20261006/guide` 已通过三步引导、现有 Tailscale 重连和无线调试检查（5 项通过、0 失败、0 待确认）。`connection` 首轮在修复过程中未完成验收，已从 Web 停止；后续结果另行保存。

本轮优先核验现有中心授权恢复及端口变化。全新手机 Auth Key 实际注册、双手机首次配对、断开 USB 后的 Artemis 执行须分别留真机证据，不能由接口测试代替。

仅记录后续事项：Android 11–13 的发现支持、单手机通知栏配对操作、VPN 内置方案、重启后的恢复提醒、固定 key 更换提示和正式网络权限管理。当前不扩展这些功能。
