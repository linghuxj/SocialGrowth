# Android 正式客户端

这是与 Demo 隔离的原生 Kotlin 工程边界。WP-00 固定 JDK 17、compile/target SDK 36、AGP 8.10.0、Gradle 8.11.1 和 Kotlin 2.1.20；AGP 8.10 支持 API 36。WP-04 已实现提供者受邀注册、原手机号登录、管理会话加密保存及退出；设备扫码、设备事实和执行能力仍由后续工作包实现。

`minSdk 27` 只是 WP-00 的临时工程下限，不代表已确认首期支持设备矩阵或兼容承诺；Android 业务开发前由 TL/AND/QA 根据真实设备资源固定支持范围并记录兼容证据。

已检入 Gradle 8.11.1 Wrapper。为避免开发机全局 Gradle 初始化脚本改变构建，干净验证可使用独立缓存目录：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android assembleDebug --no-daemon
```

WP-01 增加 `FirstBatchContractBoundary`：其版本、码制、状态及错误码规格由 `product/contracts` 的 Zod 源生成，Kotlin 边界严格拒绝旧版本、未知字段和矛盾状态。可用下列命令执行 JVM 契约消费检查：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android testDebugUnitTest --no-daemon
```

WP-04 Debug 构建固定访问 `http://127.0.0.1:4320`，只供本机开发及通过 `adb reverse tcp:4320 tcp:4320` 的 USB 真机联调；Release 构建禁止明文 HTTP，并从 `SG_PRODUCT_ANDROID_API_BASE_URL` 读取 HTTPS 地址。未配置时使用不可用占位域名，不会误连开发后端。开发验证码读取接口不属于客户端能力，Android 只调用公开的 challenge、verify、register、login 和 logout 接口。

受邀注册深链格式为 `socialgrowth://provider/register?invitation=<共享码>`。客户端不因收到深链就声称邀请已验证；服务端接受验证码请求后才显示“邀请已校验”。登录成功后的 session token 使用 Android Keystore AES-GCM 加密后保存在私有 SharedPreferences，过期或无法解密时失败关闭；退出成功会先撤销服务端 session，再清除本地密文。

构建和单元检查本身只证明 Android 契约消费层与 APK 可构建。WP-04 的真机注册／登录证据见 `docs/engineering/delivery/records/WP-04.md`；这不证明真实短信、安装升级、正式签名、扫码或后续设备流程通过。
