# 连接后的手机环境初始化

范围：手机已通过本机关联、无线配对和中心硬件核验后，自动准备网络客户端并核验 FB／YT。复用现有执行库、Artemis、执行回执和人工协助。首次配对及系统 VPN 授权仍由机主完成。本流程不授予登录、账号变更或发布权限。

## 执行顺序

1. 后端核对当前关联、安装代次、端点和真实硬件；每 15 秒检查一次已连接设备。
2. 为同一安装及归属生成固定请求编号。掉线后查询原任务；失败、未知或进程中断不自动重跑。不覆盖人工接管或未决业务。
3. 执行器核验受保护配置、凭据有效期和中心地址。检查官方 Tailscale 的安装状态；不启动第二个 VPN。
4. 检查 SFA、FlClash、Facebook、YouTube。已有受支持版本保留；缺失应用只从校验签名、哈希、版本、SDK、ABI 和所需 split 的目录安装。不卸载或清除数据。
5. 按本次接入生成独立 SFA 节点及持久状态目录。私有文件临时交付到本机，仅供正常导入；不把凭据放进模型文字、Web 回执或日志。完成或停止后删除交付副本。
6. 开启独立的、最多 15 分钟的 Artemis 原生准备权限。正常导入 FlClash 与 SFA 文件，保留其他配置。FlClash 使用本地 7890 代理、Global、VPN 关闭；SFA 是唯一 VPN，内置 Tailscale。需要系统授权时暂停并提示机主。
7. Artemis 在实际画面分别核验 FlClash 核心、SFA 运行、Facebook 新在线响应、YouTube 播放推进至少 20 秒。四项检查均须通过；缓存页面或成功文字不能代替检查证据。
8. 中心独立核对在线节点、节点密钥、无线端口及原硬件，同时观察反向连接和 Tailnet 连接至少 5 分钟。通过后才交接管理通道。

5 分钟是本次接入检查窗口，不能证明数小时运行、锁屏、重启、网络切换或新手机首次接入已验收。初始化失败保留原回执及接管状态，运营核对后处理；不以联网结果恢复未知业务或发布许可。

## 配置位置

- 后端开关：`SG_PRODUCT_PHONE_INITIALIZATION_ENABLED`，默认 `false`。
- Docker：在生产及执行 overlay 后使用 `product/deploy/compose.phone-initialization.yml`。
- 服务器私有目录：`SG_PHONE_PREPARATION_DIR`，0700，运行用户可读。`initialization.json`、`sfa-template.json`、`subscription.yaml` 为 0600，均不提交 Git。
- `initialization.json`：协议版本、允许的产品设备编号、中心 Tailnet IP、接入密钥到期时间、SFA／订阅文件路径、代理组／批准节点、观察秒数。当前候选只允许现有 Samsung；新增设备须配置允许范围及可信应用包，不能套用另一手机节点或密钥状态。
- `catalog.json`：可信包元数据、签名与 SHA-256，以及本地 APK／split 路径。缺少应用来源或完整包时拒绝安装。
- 执行器 ADB：`tcp:127.0.0.1:5038`，与后端健康检查使用的 5037 分开，避免健康检查超时断开大文件传输。Artemis 子进程同时接收一致的 ADB host、port 和 socket。两个端口均不向公网发布。

当前候选尚未在生产启用自动准备。实际通过、失败和未验证项见[本轮记录](../engineering/delivery/records/phone-environment-initialization-20261008.md)。此前已成功的共存检查见[既有记录](../engineering/delivery/records/network-preparation-core-chain-20261007.md)。

## Web 验证入口

执行 `SG_PRODUCT_WEB_SCOPE=phone-initialization pnpm test:playwright`，使用 `SG_PRODUCT_WEB_URL` 和受保护的 `SG_PRODUCT_DEPLOYMENT_LOGIN_FILE`。多设备时指定 `SG_PHONE_INITIALIZATION_DEVICE`。`SG_PHONE_INITIALIZATION_RETURN_CONTROL=true` 仅在没有未决业务时，从页面交还现有运营接管；不清除初始化失败的接管。脚本始终查询原任务，等待窗口结束返回待确认，不取消或新建手机任务。人工请求需要机主实际完成，再从 Web 提交确认。结果及截图默认写入 `output/playwright/phone-initialization/`。
