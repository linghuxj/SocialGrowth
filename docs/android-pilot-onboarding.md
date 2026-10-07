# Android 当前接入与连接操作

更新：2026-10-07。依据正式 MainActivity、自动连接监控、端点上报及连接 API。首次管理接入可使用官方 Tailscale；当前手机共存采用 SFA 内置 Tailscale endpoint 与 FlClash 非 VPN 订阅代理，操作见[手机网络准备](specs/2026-10-07-phone-network-preparation.md)。该接线不等于正式准入或零准备远端首次接入已验收。

## 手机操作

1. 使用有效邀请完成提供者注册，或用原手机号登录。可以在同一台手机进入本机接入，也可添加其他手机。核对本机安装身份并明确确认归属，不能覆盖其他提供者的关联。
2. 在本机准备页完成管理网络设置。首次接入按 Tailscale 引导；已经使用 SFA 时保留原配置，不重新领取密钥或恢复官方 VPN。配置由平台按已关联身份提供，返回后检查真实状态。VPN 图标不表示平台已连接。缺少资源时联系运营，不要求自行购买订阅或创建平台账号。
3. 按引导进入系统开发者选项和无线调试，由本人授权。当前原生发现的机型／API 范围以源码和实测为准，不能承诺全部 Android 版本。
4. 已关联 App 打开时自动检查连接并恢复端点报告；已有授权及中心配对有效时尝试重连。管理页和准备页均显示真实状态及更新时间，不要求每次手动启动。
5. 首次配对仍须本人提供系统配对码，使用当前设备的连接入口提交。单手机可在系统设置和 App 之间返回，其他手机也可通过本人设备管理入口处理；配对码不保存、不自动重发，结果未知先核对原状态。
6. 只有中心实际连接并核对硬件身份后才显示平台已连接。连接成功不等于正式准入、业务参与或允许发布。主动暂停自动连接的选择保留；明确恢复后再检查。不能承诺重启或各厂商后台长期保活。
7. 按第 4 步准备业务上网。先准备 FlClash 本地订阅代理，再由用户按指引导入本机 SFA 文件并允许 VPN 切换。切换后重新核对中心连接和 FB／YT；失败按原配置恢复，不重复未知业务。SFA 安装后 App 不自动恢复官方 Tailscale VPN。

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

## 证据范围

既有网络 Artemis、引导与自动恢复结果按[固定记录](engineering/delivery/records/README.md)的候选、环境和实际 transport 复用。2026-10-07 新指引通过真实 Web／远程 Artemis 检查，见[本轮记录](engineering/delivery/records/network-preparation-core-chain-20261007.md)。零准备远端首次安装、公开 HTTPS 首次联系、首次系统授权／配对、多机和长期后台分别验收；USB 或已有主机信任的恢复不覆盖它们。

实际模块与默认关闭条件见[技术说明](technical-design.md)。旧 Demo 发起命令和重复阶段流水已从本操作说明移除；原结果及失败仍保留在证据记录中。
