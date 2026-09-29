# Android 正式客户端

这是与 Demo 隔离的原生 Kotlin 工程边界。WP-00 固定 JDK 17、compile/target SDK 36、min SDK 27、AGP 8.9.2 和 Kotlin 2.1.20；业务页面、身份和设备能力由后续工作包实现。

已检入 Gradle 8.11.1 Wrapper。为避免开发机全局 Gradle 初始化脚本改变构建，干净验证可使用独立缓存目录：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android assembleDebug --no-daemon
```

这只证明 WP-00 Android 空壳可构建，不证明原生业务、安装升级、签名或真机流程通过。
