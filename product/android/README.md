# Android 正式客户端

Kotlin 原生工程。当前实现见 [MainActivity](app/src/main/java/com/socialgrowth/product/MainActivity.kt)，后台连接见 [EndpointReportingService](app/src/main/java/com/socialgrowth/product/EndpointReportingService.kt)及 [AutomaticConnectionMonitor](app/src/main/java/com/socialgrowth/product/AutomaticConnectionMonitor.kt)。当前可见流程包含受邀注册／原手机号登录、本人管理、本机关联、扫码／手动关联其他手机、本机准备、连接检查、控制、协助、分佣和资料读取。各页面按服务端事实展示，不从设计图推断成功。

同一台手机可管理和执行。提供者会话与安装身份分别安全保存；管理退出不等于设备暂停。关联、页面切换和自动联网不开始业务任务。用户主动暂停自动连接后保留选择。首次系统授权和首次配对仍须本人完成，步骤见[接入说明](../../docs/android-pilot-onboarding.md)。

## 构建与契约

[build.gradle.kts](app/build.gradle.kts)固定当前工具版本和发布门禁；minSdk 是工程范围，不是所有对应手机已经兼容验证。契约源和生成物来自 [contracts](../contracts/README.md)。

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android assembleDebug --no-daemon
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android testDebugUnitTest --no-daemon
```

Debug API 默认 `http://127.0.0.1:4320`，可用 `SG_PRODUCT_ANDROID_DEBUG_API_BASE_URL` 显式设置无账号、路径、查询参数的 HTTPS 服务地址，例如 `https://growth.mhtm.top`；不开放任意 HTTP 地址。USB 开发转发只证明对应现场环境，不作为新手机异地首次接入证据。Release 的真实 HTTPS、版本、签名与证书必须满足[部署门禁](../deploy/README.md#android-发布输入)，无调试签名回退。

## 验证边界

APK 构建、JVM 或 Keystore／NSD 补充检查不替代真实 Web、本人授权、扫码关联、手机执行或平台验收。现有原生补充 runner 由 Gradle 测试参数选择，测试前核对目标设备和在途状态；不清除原 App 数据或读取原秘密。

固定候选的真机、自动连接和恢复证据见[证据索引](../../docs/engineering/delivery/records/README.md)。这些结果只适用于记录的候选与环境；零准备远端新手机、多机、升级签名和完整业务验收不能从旧单机通过推导。本轮文档整理没有重跑真机验收。

本机准备中的管理接入、业务代理、SFA 切换和断线恢复见[手机网络准备](../../docs/specs/2026-10-07-phone-network-preparation.md)。安装 SFA 后不自动启动官方 Tailscale VPN；客户端安装状态不证明运行或平台准入。

## 邀请入口（2026-10-07）

运营发出的 HTTPS `/register?invitation=...` 链接进入受邀落地页，提供打开 App、下载正式 APK 和复制邀请码。App 首页“受邀加入”支持粘贴邀请码、同一生产域名的邀请链接或 `socialgrowth://provider/register` 链接；格式检查只表示内容可读取，有效期、剩余名额及注册资格仍由服务器核验。安装不会自动保留浏览器邀请，用户可从原页面再次打开 App 或粘贴邀请码。原有账号登录不消耗邀请名额。
