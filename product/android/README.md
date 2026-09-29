# Android 正式客户端

这是与 Demo 隔离的原生 Kotlin 工程边界。WP-00 固定 JDK 17、compile/target SDK 36、AGP 8.10.0、Gradle 8.11.1 和 Kotlin 2.1.20；AGP 8.10 支持 API 36。业务页面、身份和设备能力由后续工作包实现。

`minSdk 27` 只是 WP-00 的临时工程下限，不代表已确认首期支持设备矩阵或兼容承诺；Android 业务开发前由 TL/AND/QA 根据真实设备资源固定支持范围并记录兼容证据。

已检入 Gradle 8.11.1 Wrapper。为避免开发机全局 Gradle 初始化脚本改变构建，干净验证可使用独立缓存目录：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android assembleDebug --no-daemon
```

WP-01 增加 `FirstBatchContractBoundary`：其版本、码制、状态及错误码规格由 `product/contracts` 的 Zod 源生成，Kotlin 边界严格拒绝旧版本、未知字段和矛盾状态。可用下列命令执行 JVM 契约消费检查：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android testDebugUnitTest --no-daemon
```

构建和单元检查只证明 Android 契约消费层，不证明原生业务、安装升级、签名、扫码或真机流程通过。
